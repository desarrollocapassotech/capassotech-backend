import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AuthenticatedRequest,
  FirebaseAuthGuard,
} from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FacturadorClient } from '../integrations/facturador.client';
import { FacturacionService, type AltaClienteDto } from './facturacion.service';

type Usuario = AuthenticatedRequest['user'];
type Cuerpo = Record<string, unknown>;

/** Ids del Facturador (cuid): se validan antes de armar la URL. */
function id(valor: string): string {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(valor)) {
    throw new BadRequestException('Id inválido.');
  }
  return valor;
}

/** El frontend manda una clave por intento: reintentar nunca crea ni emite dos veces. */
function claveIdempotencia(clave: string | undefined): string {
  // Se le agregan sufijos (-items, -borrador): el Facturador acepta hasta 100 caracteres.
  if (!clave || !/^[A-Za-z0-9_-]{8,80}$/.test(clave)) {
    throw new BadRequestException('Falta el header Idempotency-Key.');
  }
  return clave;
}

/**
 * Lo que la cuenta corriente necesita del Facturador: clientes y comprobantes ya creados. Los
 * comprobantes nuevos salen solo al imputar un pago. La configuración (emisor, certificados,
 * puntos de venta) se hace en el Facturador ("Ir al facturador"). Solo admin y contable.
 */
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CONTABLE)
@Controller('facturacion')
export class FacturacionController {
  constructor(
    private readonly facturacion: FacturacionService,
    private readonly facturador: FacturadorClient,
  ) {}

  /** Lo llama el frontend cuando un admin o contable usa el tracker. Responde sin esperar. */
  @Post('despertar')
  @HttpCode(202)
  despertar() {
    this.facturador.despertar();
  }

  @Get('configuracion')
  async configuracion(@CurrentUser() u: Usuario) {
    if (!this.facturador.configurado) return { configurado: false };
    try {
      const datos = await this.facturador.pedir<Cuerpo>(
        'GET',
        '/configuracion',
        { email: u.email },
      );
      return { configurado: true, ...datos };
    } catch (err) {
      if (err instanceof ServiceUnavailableException)
        return { configurado: false };
      throw err;
    }
  }

  // ── Resumen del mes ──────────────────────────────────────────────────────

  @Get('resumen')
  resumen(@CurrentUser() u: Usuario, @Query('mes') mes?: string) {
    return this.facturacion.resumen(mes, u.email);
  }

  // ── Clientes ─────────────────────────────────────────────────────────────

  @Get('clientes')
  clientes(@CurrentUser() u: Usuario, @Query('q') q?: string) {
    return this.facturador.pedir('GET', '/clientes', {
      query: { q },
      email: u.email,
    });
  }

  /** Clientes del tracker (para la factura manual), con su estado en el Facturador. */
  @Get('clientes-tracker')
  clientesTracker(@CurrentUser() u: Usuario) {
    return this.facturacion.clientesTracker(u.email);
  }

  /** Conceptos que se agregan solos a cada factura o recibo del cliente. */
  @Patch('clientes-tracker/:id/conceptos')
  cambiarConceptos(
    @Param('id') cliente: string,
    @Body() body: { conceptos?: unknown },
  ) {
    return this.facturacion.cambiarConceptos(id(cliente), body?.conceptos);
  }

  /** Factura en ARCA o recibo sin validez fiscal, por cliente del tracker. */
  @Patch('clientes-tracker/:id/documento')
  cambiarDocumento(
    @Param('id') cliente: string,
    @Body() body: { documento?: unknown; moneda?: unknown },
  ) {
    return this.facturacion.cambiarDocumento(
      id(cliente),
      body?.documento,
      body?.moneda,
    );
  }

  @Post('clientes')
  altaCliente(@CurrentUser() u: Usuario, @Body() body: AltaClienteDto) {
    return this.facturacion.altaCliente(body, u.email);
  }

  @Patch('clientes/:id')
  actualizarCliente(
    @CurrentUser() u: Usuario,
    @Param('id') cliente: string,
    @Body() body: Cuerpo,
  ) {
    return this.facturador.pedir('PATCH', `/clientes/${id(cliente)}`, {
      body,
      email: u.email,
    });
  }

  @Post('clientes/:id/vincular')
  @HttpCode(200)
  vincular(
    @CurrentUser() u: Usuario,
    @Param('id') cliente: string,
    @Body() body: { clienteTrackerId?: unknown },
  ) {
    if (typeof body?.clienteTrackerId !== 'string' || !body.clienteTrackerId) {
      throw new BadRequestException('Falta clienteTrackerId.');
    }
    return this.facturacion.vincular(
      id(cliente),
      body.clienteTrackerId,
      u.email,
    );
  }

  @Get('padron/:cuit')
  padron(@CurrentUser() u: Usuario, @Param('cuit') cuit: string) {
    return this.facturacion.padron(cuit, u.email);
  }

  // ── Comprobantes ─────────────────────────────────────────────────────────

  // Se crean solo desde la cuenta corriente, al imputar. Acá se ve, corrige o anula uno que ya existe.

  @Get('comprobantes/:id')
  comprobante(@CurrentUser() u: Usuario, @Param('id') c: string) {
    return this.facturador.pedir('GET', `/comprobantes/${id(c)}`, {
      email: u.email,
    });
  }

  @Patch('comprobantes/:id')
  actualizar(
    @CurrentUser() u: Usuario,
    @Param('id') c: string,
    @Body() body: Cuerpo,
  ) {
    return this.facturador.pedir('PATCH', `/comprobantes/${id(c)}`, {
      body,
      email: u.email,
    });
  }

  @Delete('comprobantes/:id')
  @HttpCode(204)
  async eliminar(@CurrentUser() u: Usuario, @Param('id') c: string) {
    await this.facturador.pedir('DELETE', `/comprobantes/${id(c)}`, {
      email: u.email,
    });
  }

  /** El frontend manda su Idempotency-Key: reintentar nunca emite dos veces. */
  @Post('comprobantes/:id/emitir')
  @HttpCode(200)
  emitir(
    @CurrentUser() u: Usuario,
    @Param('id') c: string,
    @Headers('idempotency-key') clave: string | undefined,
    @Body() body: Cuerpo,
  ) {
    return this.facturador.pedir('POST', `/comprobantes/${id(c)}/emitir`, {
      body: body ?? {},
      email: u.email,
      idempotencyKey: claveIdempotencia(clave),
    });
  }

  /** Anula la factura: emite la nota de crédito por el total en un paso. */
  @Post('comprobantes/:id/anular')
  @HttpCode(200)
  anular(
    @CurrentUser() u: Usuario,
    @Param('id') c: string,
    @Headers('idempotency-key') clave: string | undefined,
    @Body() body: { motivo?: unknown },
  ) {
    return this.facturacion.anular(
      id(c),
      body?.motivo,
      claveIdempotencia(clave),
      u.email,
    );
  }

  @Post('comprobantes/:id/verificar')
  @HttpCode(200)
  verificar(@CurrentUser() u: Usuario, @Param('id') c: string) {
    return this.facturador.pedir('POST', `/comprobantes/${id(c)}/verificar`, {
      email: u.email,
    });
  }

  @Get('comprobantes/:id/pdf')
  async pdf(
    @CurrentUser() u: Usuario,
    @Param('id') c: string,
    @Res() res: Response,
  ) {
    const r = await this.facturador.descargar(
      `/comprobantes/${id(c)}/pdf`,
      u.email,
    );
    res.setHeader('Content-Type', r.tipo);
    if (r.disposition) res.setHeader('Content-Disposition', r.disposition);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(r.buffer);
  }
}
