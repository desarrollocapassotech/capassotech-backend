import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

// Autenticación servidor a servidor para el Facturador (no usa Firebase).
// El header X-Integration-Key se compara contra el SHA-256 guardado en
// FACTURADOR_INTEGRATION_KEY_HASH (hex), en tiempo constante. La clave en texto
// plano solo la conoce el Facturador; acá nunca se guarda ni se loguea.
@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperado = (
      this.config.get<string>('FACTURADOR_INTEGRATION_KEY_HASH') ?? ''
    )
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(esperado)) {
      throw new ServiceUnavailableException(
        'La integración con el Facturador no está configurada.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clave = request.headers['x-integration-key'];
    if (typeof clave !== 'string' || !clave) {
      throw new UnauthorizedException('Falta la clave de integración.');
    }

    const recibido = createHash('sha256').update(clave).digest();
    if (!timingSafeEqual(recibido, Buffer.from(esperado, 'hex'))) {
      throw new UnauthorizedException('Clave de integración inválida.');
    }
    return true;
  }
}
