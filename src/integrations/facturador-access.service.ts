import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Botón "Ir al facturador": el tracker (con su API key del Facturador, que nunca
// llega al navegador) pide un token de acceso de un solo uso para el usuario
// logueado y le devuelve al frontend la URL a la que redirigir. El Facturador crea
// el usuario sin contraseña si no existe (ARCHITECTURE.md del Facturador, §8.1).
@Injectable()
export class FacturadorAccessService {
  private readonly logger = new Logger(FacturadorAccessService.name);

  constructor(private readonly config: ConfigService) {}

  async pedirAcceso(
    email: string,
    nombre: string | undefined,
    destino: string | undefined,
  ): Promise<{ url: string }> {
    const apiUrl = this.config
      .get<string>('FACTURADOR_API_URL')
      ?.replace(/\/+$/, '');
    const apiKey = this.config.get<string>('FACTURADOR_API_KEY');
    if (!apiUrl || !apiKey) {
      throw new ServiceUnavailableException(
        'La integración con el Facturador no está configurada.',
      );
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1/acceso/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          email,
          ...(nombre ? { nombre } : {}),
          ...(destino ? { destino } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar al Facturador: ${(error as Error).message}`,
      );
      throw new BadGatewayException('No se pudo contactar al Facturador.');
    }

    const body = (await res.json().catch(() => null)) as {
      url?: unknown;
      message?: unknown;
    } | null;
    if (!res.ok || typeof body?.url !== 'string') {
      this.logger.warn(
        `El Facturador respondió ${res.status} al pedir un token de acceso.`,
      );
      const detalle =
        typeof body?.message === 'string' ? `: ${body.message}` : '';
      throw new BadGatewayException(`El Facturador no dio acceso${detalle}`);
    }
    return { url: body.url };
  }
}
