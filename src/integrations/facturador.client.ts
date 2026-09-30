import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface OpcionesFacturador {
  body?: unknown;
  query?: Record<string, string | string[] | number | undefined>;
  /** Quién hace la acción en el tracker: queda en la auditoría del Facturador. */
  email?: string;
  /** Para POST: si no viene, se genera una (los reintentos del mismo pedido no duplican). */
  idempotencyKey?: string;
}

/**
 * Cliente de la API pública del Facturador (/api/v1). La API key vive solo en el
 * servidor (FACTURADOR_API_KEY); el navegador habla con el tracker, nunca con el
 * Facturador. Los errores de validación del Facturador (4xx) llegan tal cual al
 * frontend; los de conexión o de la API key se informan como 502/503.
 */
@Injectable()
export class FacturadorClient {
  private readonly logger = new Logger(FacturadorClient.name);

  constructor(private readonly config: ConfigService) {}

  get configurado(): boolean {
    return Boolean(
      this.base() && this.config.get<string>('FACTURADOR_API_KEY'),
    );
  }

  async pedir<T>(
    metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    ruta: string,
    opciones: OpcionesFacturador = {},
  ): Promise<T> {
    const res = await this.enviar(metodo, ruta, opciones);
    if (res.status === 204) return undefined as T;
    const cuerpo: unknown = await res.json().catch(() => null);
    if (!res.ok) throw this.error(res.status, cuerpo, `${metodo} ${ruta}`);
    return cuerpo as T;
  }

  /** Para el PDF: devuelve el binario y el nombre de archivo que propone el Facturador. */
  async descargar(
    ruta: string,
    email?: string,
  ): Promise<{ buffer: Buffer; tipo: string; disposition: string | null }> {
    const res = await this.enviar('GET', ruta, { email });
    if (!res.ok) {
      const cuerpo: unknown = await res.json().catch(() => null);
      throw this.error(res.status, cuerpo, `GET ${ruta}`);
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      tipo: res.headers.get('content-type') ?? 'application/octet-stream',
      disposition: res.headers.get('content-disposition'),
    };
  }

  private base(): string | undefined {
    return this.config.get<string>('FACTURADOR_API_URL')?.replace(/\/+$/, '');
  }

  private async enviar(
    metodo: string,
    ruta: string,
    { body, query, email, idempotencyKey }: OpcionesFacturador,
  ): Promise<Response> {
    const base = this.base();
    const apiKey = this.config.get<string>('FACTURADOR_API_KEY');
    if (!base || !apiKey) {
      throw new ServiceUnavailableException(
        'La integración con el Facturador no está configurada.',
      );
    }
    const url = new URL(`${base}/v1${ruta}`);
    for (const [clave, valor] of Object.entries(query ?? {})) {
      if (valor === undefined || valor === '') continue;
      for (const v of Array.isArray(valor) ? valor : [valor]) {
        url.searchParams.append(clave, String(v));
      }
    }
    const headers: Record<string, string> = { 'X-Api-Key': apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (email) headers['X-Usuario-Email'] = email;
    if (metodo === 'POST') {
      headers['Idempotency-Key'] = idempotencyKey || `tracker-${randomUUID()}`;
    }
    try {
      return await fetch(url, {
        method: metodo,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Emitir espera a ARCA: puede tardar bastante más que una consulta.
        signal: AbortSignal.timeout(ruta.endsWith('/emitir') ? 90_000 : 20_000),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar al Facturador (${metodo} ${ruta}): ${(error as Error).message}`,
      );
      throw new BadGatewayException('No se pudo contactar al Facturador.');
    }
  }

  private error(
    status: number,
    cuerpo: unknown,
    pedido: string,
  ): HttpException {
    this.logger.warn(`El Facturador respondió ${status} a ${pedido}.`);
    // Una API key inválida es un problema de configuración del tracker, no del usuario:
    // no se reenvía como 401 (el frontend lo tomaría como sesión vencida).
    if (status === 401 || status === 403) {
      return new BadGatewayException(
        'El Facturador rechazó la API key del tracker. Revisá FACTURADOR_API_KEY y sus permisos.',
      );
    }
    if (status >= 500) {
      return new BadGatewayException(
        'El Facturador no pudo procesar el pedido.',
      );
    }
    const objeto =
      cuerpo && typeof cuerpo === 'object'
        ? (cuerpo as Record<string, unknown>)
        : { message: 'Error del Facturador.' };
    return new HttpException(objeto, status);
  }
}
