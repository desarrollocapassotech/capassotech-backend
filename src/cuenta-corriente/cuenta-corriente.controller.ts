import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
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
import {
  CuentaCorrienteService,
  type DatosImputacion,
  type DatosMovimiento,
} from './cuenta-corriente.service';

type Usuario = AuthenticatedRequest['user'];

/** El frontend manda una clave por intento: reintentar nunca imputa ni emite dos veces. */
function claveIdempotencia(clave: string | undefined): string {
  if (!clave || !/^[A-Za-z0-9_-]{8,80}$/.test(clave)) {
    throw new BadRequestException('Falta el header Idempotency-Key.');
  }
  return clave;
}

/** Cuenta corriente de clientes y colaboradores. Solo admin y contable. */
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CONTABLE)
@Controller('cuenta-corriente')
export class CuentaCorrienteController {
  constructor(private readonly cc: CuentaCorrienteService) {}

  /** Portal de clientes: reemplaza los roles del controller. Solo devuelve la cuenta del usuario. */
  @Roles(UserRole.CLIENT)
  @Get('mi-cuenta')
  miCuenta(@CurrentUser() u: Usuario) {
    return this.cc.miCuenta(u.uid);
  }

  @Get('config')
  config() {
    return this.cc.obtenerConfig();
  }

  @Put('config')
  guardarConfig(
    @CurrentUser() u: Usuario,
    @Body() body: { mesInicio?: unknown },
  ) {
    return this.cc.guardarConfig(body?.mesInicio, u.email);
  }

  @Get('cuentas/:side')
  cuentas(@Param('side') side: string) {
    return this.cc.listarCuentas(side);
  }

  @Get('cuentas/:side/:id')
  cuenta(@Param('side') side: string, @Param('id') id: string) {
    return this.cc.cuenta(side, id);
  }

  @Post('saldo-inicial')
  saldoInicial(
    @CurrentUser() u: Usuario,
    @Body()
    body: {
      side?: unknown;
      cuentaId?: unknown;
      importe?: unknown;
      moneda?: unknown;
    },
  ) {
    return this.cc.cargarSaldoInicial(body, u.email);
  }

  @Post('movimientos')
  crearMovimiento(
    @CurrentUser() u: Usuario,
    @Headers('idempotency-key') clave: string | undefined,
    @Body() body: DatosMovimiento,
  ) {
    return this.cc.crearMovimiento(
      body ?? {},
      claveIdempotencia(clave),
      u.email,
    );
  }

  @Delete('movimientos/:id')
  @HttpCode(204)
  async eliminarMovimiento(@Param('id', ParseUUIDPipe) id: string) {
    await this.cc.eliminarMovimiento(id);
  }

  @Patch('movimientos/:id/moneda')
  cambiarMoneda(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { moneda?: unknown; tipoCambio?: unknown },
  ) {
    return this.cc.cambiarMoneda(id, body?.moneda, body?.tipoCambio);
  }

  @Get('movimientos/:id/comprobantes-previos')
  comprobantesPrevios(
    @CurrentUser() u: Usuario,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cc.comprobantesPrevios(id, u.email);
  }

  @Post('imputaciones')
  imputar(
    @CurrentUser() u: Usuario,
    @Headers('idempotency-key') clave: string | undefined,
    @Body() body: DatosImputacion,
  ) {
    return this.cc.imputar(body ?? {}, claveIdempotencia(clave), u.email);
  }

  @Post('imputaciones/:id/reintentar')
  @HttpCode(200)
  reintentar(
    @CurrentUser() u: Usuario,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cc.reintentar(id, u.email);
  }

  @Post('imputaciones/:id/sincronizar')
  @HttpCode(200)
  sincronizar(
    @CurrentUser() u: Usuario,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cc.sincronizar(id, u.email);
  }

  @Post('imputaciones/:id/deshacer')
  @HttpCode(200)
  deshacer(
    @CurrentUser() u: Usuario,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { motivo?: unknown },
  ) {
    return this.cc.deshacer(id, body?.motivo, u.email);
  }

  @Get('imputaciones/:id/recibo.pdf')
  async recibo(
    @CurrentUser() u: Usuario,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const r = await this.cc.pdfRecibo(id, u.email);
    res.setHeader('Content-Type', r.tipo);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(r.buffer);
  }

  @Post('imputaciones/:id/recibo/email')
  @HttpCode(200)
  enviarRecibo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { to?: unknown },
  ) {
    return this.cc.enviarRecibo(id, body?.to);
  }
}
