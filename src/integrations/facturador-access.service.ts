import { BadGatewayException, Injectable } from '@nestjs/common';
import { FacturadorClient } from './facturador.client';

// Botón "Ir al facturador" (para la configuración, que se hace en el Facturador): el
// tracker, con su API key, pide un token de acceso de un solo uso para el usuario
// logueado y le devuelve al frontend la URL a la que redirigir. El Facturador crea
// el usuario sin contraseña si no existe.
@Injectable()
export class FacturadorAccessService {
  constructor(private readonly facturador: FacturadorClient) {}

  async pedirAcceso(
    email: string,
    nombre: string | undefined,
    destino: string | undefined,
  ): Promise<{ url: string }> {
    const body = await this.facturador.pedir<{ url?: unknown }>(
      'POST',
      '/acceso/tokens',
      {
        body: {
          email,
          ...(nombre ? { nombre } : {}),
          ...(destino ? { destino } : {}),
        },
      },
    );
    if (typeof body?.url !== 'string') {
      throw new BadGatewayException('El Facturador no dio acceso.');
    }
    return { url: body.url };
  }
}
