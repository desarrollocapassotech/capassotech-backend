import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { Between, In, IsNull, Repository } from 'typeorm';
import { FIREBASE_ADMIN } from '../auth/firebase-admin.provider';
import { CollaboratorReceiptSenderService } from '../collaborators/collaborator-receipt-sender.service';
import { CollaboratorReceiptService } from '../collaborators/collaborator-receipt.service';
import type { GenerateCollaboratorReceiptDto } from '../collaborators/collaborator-receipt.dto';
import {
  BillingCurrency,
  UserRole,
  CcConfigEntity,
  CcImputationEntity,
  CcInstallmentPlanEntity,
  CcMovementEntity,
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  CollaboratorReceiptAcknowledgementEntity,
  TimeEntryEntity,
  type CcComprobantePrevio,
  type CcDetalle,
  type CcLineaDetalle,
  type CcMoneda,
  type CcSide,
} from '../database/entities';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { FacturadorClient } from '../integrations/facturador.client';
import {
  FacturacionService,
  type ComprobantePublico,
} from '../facturacion/facturacion.service';
import { datosCliente, MES, nombreMes, rangoMes } from '../facturacion/resumen';
import {
  adicionalesValidos,
  calcularImputacion,
  calcularSaldos,
  comprobantePrevioDe,
  conceptoDeCuota,
  convertir,
  cuotasAGenerar,
  EPS,
  facturasDeItems,
  facturaVigente,
  lineasDelComprobante,
  mesesCerrados,
  netoDeTotal,
  numeroDeComprobante,
  redondear,
  type ComprobanteFacturador,
  resolverAjuste,
  type AdicionalRecibo,
} from './calculos';
import {
  detectarComprobante,
  normalizarNumeroComprobante,
  textoDePdf,
  tipoComprobanteValido,
  tipoDeArchivo,
} from './leer-comprobante';
import { cuentaParaPortal } from './portal';
import { reciboConfirmado } from './unificar-recibos';

// Cuenta corriente de clientes y colaboradores. A diferencia de Vialto (donde el cargo nace de
// la factura), acá el cargo nace de las horas y los abonos del mes, y la factura o el recibo
// se emiten al imputar un pago, por lo cobrado.

const DIAS_VENCIMIENTO = 10;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function hoyArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

function sumarDias(ymd: string, dias: number) {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const monedaValida = (v: unknown): v is CcMoneda => v === 'USD' || v === 'ARS';

const CARPETA_ADJUNTOS = 'cuenta-corriente/comprobantes';
const PATH_ADJUNTO =
  /^cuenta-corriente\/comprobantes\/[0-9a-f-]{36}\.(pdf|png|jpg)$/;
const TIPO_POR_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
};

interface AdjuntoValidado {
  path: string;
  nombre: string | null;
  numero: string;
  tipo: string | null;
}

/** Comprobante adjunto de un cobro. El número es obligatorio; el archivo, solo uno ya subido. */
function adjuntoValido(valor: unknown): AdjuntoValidado | null {
  if (valor === undefined || valor === null) return null;
  const a = valor as Record<string, unknown>;
  if (typeof a.path !== 'string' || !PATH_ADJUNTO.test(a.path)) {
    throw new BadRequestException('Adjuntá el archivo del comprobante.');
  }
  const numero = normalizarNumeroComprobante(a.numero);
  if (!numero) {
    throw new BadRequestException(
      'El número de comprobante es obligatorio, con el formato 00001-00000012.',
    );
  }
  return {
    path: a.path,
    nombre: typeof a.nombre === 'string' ? a.nombre.slice(0, 200) : null,
    numero,
    tipo: tipoComprobanteValido(a.tipo) ? a.tipo : null,
  };
}

function importeValido(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException('Ingresá un importe mayor a cero.');
  }
  return redondear(n);
}

function fechaValida(v: unknown, campo = 'La fecha'): string {
  if (typeof v !== 'string' || !FECHA.test(v)) {
    throw new BadRequestException(`${campo} no es válida.`);
  }
  return v;
}

function tcOpcional(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException('El tipo de cambio no es válido.');
  }
  return n;
}

interface CargoCalculado {
  moneda: CcMoneda;
  importe: number;
  detalle: CcDetalle;
}

/**
 * Postgres no conserva el orden de las claves de un jsonb: comparar el texto daría siempre
 * distinto, y cada carga del listado reescribiría todos los cargos.
 */
function mismoDetalle(a: CcDetalle | null, b: CcDetalle) {
  const normal = (d: CcDetalle | null) =>
    JSON.stringify(
      (d?.lineas ?? []).map((l) => [
        l.descripcion,
        l.cantidad,
        l.importe,
        l.referencia ?? null,
      ]),
    );
  return normal(a) === normal(b);
}

export interface DatosMovimiento {
  side?: unknown;
  cuentaId?: unknown;
  tipo?: unknown;
  importe?: unknown;
  moneda?: unknown;
  fecha?: unknown;
  concepto?: unknown;
  fechaVencimiento?: unknown;
  formaPago?: unknown;
  referencia?: unknown;
  imputarACargoIds?: unknown;
  tipoCambio?: unknown;
  emitir?: unknown;
  fechaEmision?: unknown;
  /** Cargo en cuotas: `importe` es el de cada una y `fecha`, la de la primera. */
  cuotas?: unknown;
  /** Pago a un colaborador: horas extra o bonos que se agregan al recibo. `importe` los incluye. */
  adicionales?: unknown;
  /** Cobro de un cliente: comprobante emitido afuera, en vez de emitir uno desde acá. */
  adjunto?: unknown;
}

export interface DatosImputacion {
  pagoId?: unknown;
  cargoId?: unknown;
  importe?: unknown;
  tipoCambio?: unknown;
  /** false: no se emite comprobante (por ejemplo, el mes ya estaba facturado). */
  emitir?: unknown;
  fechaEmision?: unknown;
  /** Comprobante emitido afuera: se guarda con la imputación y no se emite nada. */
  adjunto?: unknown;
}

@Injectable()
export class CuentaCorrienteService {
  private readonly logger = new Logger(CuentaCorrienteService.name);

  constructor(
    @InjectRepository(CcConfigEntity)
    private readonly config: Repository<CcConfigEntity>,
    @InjectRepository(CcMovementEntity)
    private readonly movimientos: Repository<CcMovementEntity>,
    @InjectRepository(CcImputationEntity)
    private readonly imputaciones: Repository<CcImputationEntity>,
    @InjectRepository(CcInstallmentPlanEntity)
    private readonly planes: Repository<CcInstallmentPlanEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientes: Repository<ClientEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly colaboradores: Repository<CollaboratorEntity>,
    @InjectRepository(CollaboratorProjectRateEntity)
    private readonly tarifas: Repository<CollaboratorProjectRateEntity>,
    @InjectRepository(CollaboratorReceiptAcknowledgementEntity)
    private readonly recibosEnviados: Repository<CollaboratorReceiptAcknowledgementEntity>,
    @InjectRepository(TimeEntryEntity)
    private readonly horas: Repository<TimeEntryEntity>,
    private readonly facturacion: FacturacionService,
    private readonly facturador: FacturadorClient,
    private readonly tipoDeCambio: ExchangeRateService,
    private readonly recibosColaborador: CollaboratorReceiptService,
    private readonly envioRecibos: CollaboratorReceiptSenderService,
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: App,
  ) {}

  // ── Mes de arranque ──────────────────────────────────────────────────────

  async obtenerConfig() {
    const c = await this.config.findOneBy({ id: 1 });
    return { mesInicio: c?.startMonth ?? null };
  }

  /**
   * Cambiar el mes de arranque a uno posterior borra los cargos generados de antes (si ninguno
   * tiene imputaciones); a uno anterior, los genera la próxima vez que se abra cada cuenta.
   */
  async guardarConfig(mesInicio: unknown, email?: string) {
    if (typeof mesInicio !== 'string' || !MES.test(mesInicio)) {
      throw new BadRequestException('El mes debe tener formato yyyy-MM.');
    }
    if (mesInicio > hoyArgentina().slice(0, 7)) {
      throw new BadRequestException(
        'La cuenta corriente no puede arrancar en un mes futuro.',
      );
    }
    const anteriores = await this.movimientos
      .createQueryBuilder('m')
      .where(`m.origen = 'mes' AND m.month < :mes`, { mes: mesInicio })
      .getMany();
    if (anteriores.length) {
      const conImputacion = await this.imputaciones.existsBy({
        cargoId: In(anteriores.map((m) => m.id)),
      });
      if (conImputacion) {
        throw new ConflictException(
          'Hay cargos anteriores a ese mes con imputaciones: deshacelas primero.',
        );
      }
      await this.movimientos.delete({ id: In(anteriores.map((m) => m.id)) });
    }
    await this.config.save({
      id: 1,
      startMonth: mesInicio,
      updatedBy: email ?? null,
    });
    return { mesInicio };
  }

  // ── Cuenta: movimientos y saldos ─────────────────────────────────────────

  private validarCuenta(
    side: unknown,
    id: unknown,
  ): { side: CcSide; id: string } {
    if (side !== 'cliente' && side !== 'colaborador') {
      throw new BadRequestException('side debe ser cliente o colaborador.');
    }
    if (typeof id !== 'string' || !id) {
      throw new BadRequestException('Elegí la cuenta.');
    }
    return { side, id };
  }

  private async asegurarExiste(side: CcSide, id: string) {
    const existe =
      side === 'cliente'
        ? await this.clientes.existsBy({ id })
        : await this.colaboradores.existsBy({ id });
    if (!existe) throw new NotFoundException('Cuenta no encontrada.');
  }

  private dondeCuenta(side: CcSide, id: string) {
    return side === 'cliente' ? { clientId: id } : { collaboratorId: id };
  }

  /** Todas las cuentas de un lado con su saldo por moneda, para el listado de la pantalla. */
  async listarCuentas(sideRaw: unknown) {
    if (sideRaw !== 'cliente' && sideRaw !== 'colaborador') {
      throw new BadRequestException('side debe ser cliente o colaborador.');
    }
    const side: CcSide = sideRaw;
    const { mesInicio } = await this.obtenerConfig();
    const advertencias = mesInicio
      ? await this.generarCargosDelLado(side, mesInicio)
      : [];
    await this.generarCuotas({ side });

    const movimientos = await this.movimientos.findBy({ side });
    const ids = movimientos.map((m) => m.id);
    const imputaciones = ids.length
      ? await this.imputaciones.findBy({
          pagoId: In(ids),
          reversedAt: IsNull(),
        })
      : [];
    const porId = new Map(movimientos.map((m) => [m.id, m]));
    const cuentaDe = (m: CcMovementEntity) =>
      (m.clientId ?? m.collaboratorId) as string;
    const saldosDe = (cuentaId: string) => {
      const propios = movimientos.filter((m) => cuentaDe(m) === cuentaId);
      const pagos = new Set(propios.map((m) => m.id));
      const { finales } = calcularSaldos(
        propios.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          importe: Number(m.amount),
          moneda: m.currency,
          fecha: m.date,
          creado: m.createdAt.getTime(),
        })),
        imputaciones
          .filter((i) => pagos.has(i.pagoId))
          .map((i) => ({
            pagoId: i.pagoId,
            importeCargo: Number(i.amount),
            importePago: Number(i.paymentAmount),
            monedaCargo: porId.get(i.cargoId)!.currency,
            monedaPago: porId.get(i.pagoId)!.currency,
          })),
      );
      return Object.entries(finales)
        .filter(([, saldo]) => Math.abs(saldo) > EPS)
        .map(([moneda, saldo]) => ({ moneda, saldo }));
    };

    const conMovimientos = new Set(movimientos.map(cuentaDe));
    const cuentas: Array<{
      id: string;
      nombre: string;
      razonSocial: string | null;
      cuit: string | null;
    }> =
      side === 'cliente'
        ? (await this.clientes.find()).map((c) => {
            const d = datosCliente(c);
            return {
              id: c.id,
              nombre: c.name,
              razonSocial: d.razonSocial,
              cuit: d.cuit,
            };
          })
        : (await this.colaboradores.find())
            // Los clientes con usuario también están en esta tabla, con rol client: no son
            // colaboradores. Uno que ya no está solo aparece si tiene algo en su cuenta.
            .filter(
              (c) =>
                !c.roles?.includes(UserRole.CLIENT) &&
                (c.active || conMovimientos.has(c.id)),
            )
            .map((c) => ({
              id: c.id,
              nombre: c.name,
              razonSocial: null,
              cuit: null,
            }));

    const tcHoy = await this.tipoDeCambio.getUsdRate(
      hoyArgentina().slice(0, 7),
    );
    return {
      mesInicio,
      advertencias,
      tcHoy: { valor: tcHoy.rate, fijado: tcHoy.locked },
      cuentas: cuentas.map((c) => ({ ...c, saldos: saldosDe(c.id) })),
    };
  }

  /** La cuenta del cliente logueado, para el portal. El cliente sale del usuario, nunca del pedido. */
  async miCuenta(uid: string) {
    const cliente = await this.clientes.findOneBy({ userId: uid });
    if (!cliente) {
      throw new NotFoundException('Tu usuario no está asociado a un cliente.');
    }
    return cuentaParaPortal(await this.cuenta('cliente', cliente.id));
  }

  /**
   * Movimientos de la cuenta, con imputaciones, pendientes y saldo por moneda. Con `administracion`
   * también busca las facturas hechas por fuera: el portal no espera al Facturador.
   */
  async cuenta(
    sideRaw: unknown,
    idRaw: unknown,
    administracion?: { email?: string },
  ) {
    const { side, id } = this.validarCuenta(sideRaw, idRaw);
    await this.asegurarExiste(side, id);
    const { mesInicio } = await this.obtenerConfig();
    const advertencias = mesInicio
      ? await this.generarCargos(side, id, mesInicio)
      : [];
    await this.generarCuotas({ side, ...this.dondeCuenta(side, id) });

    const movimientos = await this.movimientos.find({
      where: this.dondeCuenta(side, id),
    });
    if (administracion) {
      await this.revisarComprobantes(movimientos, administracion.email);
    }
    const ids = movimientos.map((m) => m.id);
    const imputaciones = ids.length
      ? await this.imputaciones.find({
          where: [{ pagoId: In(ids) }, { cargoId: In(ids) }],
          order: { createdAt: 'ASC' },
        })
      : [];
    const vigentes = imputaciones.filter((i) => !i.reversedAt);
    const porId = new Map(movimientos.map((m) => [m.id, m]));

    const { porFila, finales } = calcularSaldos(
      movimientos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        importe: Number(m.amount),
        moneda: m.currency,
        fecha: m.date,
        creado: m.createdAt.getTime(),
      })),
      vigentes.map((i) => ({
        pagoId: i.pagoId,
        importeCargo: Number(i.amount),
        importePago: Number(i.paymentAmount),
        monedaCargo: porId.get(i.cargoId)!.currency,
        monedaPago: porId.get(i.pagoId)!.currency,
      })),
    );

    const meses = [
      ...new Set(movimientos.flatMap((m) => (m.month ? [m.month] : []))),
    ];
    const tcPorMes = new Map(
      await Promise.all(
        meses.map(
          async (mes) =>
            [mes, await this.tipoDeCambio.getUsdRate(mes)] as const,
        ),
      ),
    );
    const tcHoy = await this.tipoDeCambio.getUsdRate(
      hoyArgentina().slice(0, 7),
    );

    // Pagos cuyo recibo el colaborador ya confirmó desde el link del email.
    const acuses =
      side === 'colaborador'
        ? await this.recibosEnviados.findBy({ collaboratorId: id })
        : [];
    const pagosConfirmados = new Set(
      vigentes
        .filter((i) => {
          if (i.documento !== 'recibo') return false;
          const pago = porId.get(i.pagoId)!;
          const mes =
            porId.get(i.cargoId)!.month ??
            (i.fechaEmision ?? pago.date).slice(0, 7);
          // El recibo incluye sus adicionales.
          const total = vigentes
            .filter((x) => x.id === i.id || x.reciboDe === i.id)
            .reduce((t, x) => t + Number(x.paymentAmount), 0);
          return reciboConfirmado(acuses, mes, total, pago.currency);
        })
        .map((i) => i.pagoId),
    );

    return {
      mesInicio,
      advertencias,
      tcHoy: { valor: tcHoy.rate, fijado: tcHoy.locked },
      saldos: Object.entries(finales).map(([moneda, saldo]) => ({
        moneda,
        saldo,
      })),
      movimientos: movimientos
        .map((m) => {
          const tc = m.month ? tcPorMes.get(m.month) : undefined;
          return {
            ...this.presentarMovimiento(m, movimientos, imputaciones, porId),
            saldosAcumulados: porFila.get(m.id) ?? {},
            tcMes: tc ? { valor: tc.rate, fijado: tc.locked } : null,
            acuseConfirmado: pagosConfirmados.has(m.id),
          };
        })
        .sort(
          (a, b) =>
            b.fecha.localeCompare(a.fecha) ||
            b.creadoEn.getTime() - a.creadoEn.getTime(),
        ),
    };
  }

  private presentarMovimiento(
    m: CcMovementEntity,
    todos: CcMovementEntity[],
    imputaciones: CcImputationEntity[],
    porId: Map<string, CcMovementEntity>,
  ) {
    const importe = Number(m.amount);
    const propias = imputaciones.filter(
      (i) => i.cargoId === m.id || i.pagoId === m.id,
    );
    const vigentes = propias.filter((i) => !i.reversedAt);
    let pendiente = 0;
    if (m.tipo === 'cargo') {
      const creditos = todos
        .filter((x) => x.parentId === m.id && x.tipo === 'credito')
        .reduce((t, x) => t + Number(x.amount), 0);
      const imputado = vigentes.reduce((t, i) => t + Number(i.amount), 0);
      pendiente = Math.max(0, redondear(importe - creditos - imputado));
    } else if (m.tipo === 'pago') {
      const usado = vigentes.reduce((t, i) => t + Number(i.paymentAmount), 0);
      pendiente = Math.max(0, redondear(importe - usado));
    }
    return {
      id: m.id,
      side: m.side,
      tipo: m.tipo,
      origen: m.origen,
      mes: m.month,
      parentId: m.parentId,
      concepto: m.concept,
      importe,
      moneda: m.currency,
      monedaOrigen: m.sourceCurrency,
      fecha: m.date,
      fechaVencimiento: m.dueDate,
      formaPago: m.paymentMethod,
      referencia: m.reference,
      lineas: m.detail?.lineas ?? [],
      comprobantesPrevios: m.comprobantesPrevios ?? [],
      pendiente,
      creadoEn: m.createdAt,
      imputaciones: propias.map((i) => this.presentarImputacion(i, porId)),
    };
  }

  private presentarImputacion(
    i: CcImputationEntity,
    porId?: Map<string, CcMovementEntity>,
  ) {
    return {
      id: i.id,
      pagoId: i.pagoId,
      cargoId: i.cargoId,
      importe: Number(i.amount),
      importePago: Number(i.paymentAmount),
      tipoCambio: i.exchangeRate != null ? Number(i.exchangeRate) : null,
      monedaCargo: porId?.get(i.cargoId)?.currency,
      monedaPago: porId?.get(i.pagoId)?.currency,
      conceptoCargo: porId?.get(i.cargoId)?.concept,
      documento: i.documento,
      reciboDe: i.reciboDe,
      comprobanteId: i.comprobanteId,
      comprobanteTipo: i.comprobanteTipo,
      comprobanteNumero: i.comprobanteNumero,
      comprobanteEstado: i.comprobanteEstado,
      comprobanteError: i.comprobanteError,
      adjuntoNombre: i.adjuntoNombre,
      fechaEmision: i.fechaEmision,
      deshecha: Boolean(i.reversedAt),
      creadoEn: i.createdAt,
    };
  }

  // ── Cargos del mes ───────────────────────────────────────────────────────

  /**
   * Genera o actualiza los cargos de los meses cerrados de la cuenta (idempotente: se llama al
   * abrirla). Sin imputaciones, el cargo sigue a las horas; con imputaciones queda fijo y la
   * diferencia va en un ajuste aparte. Un mes que no se puede calcular no frena a los demás.
   */
  private async generarCargos(
    side: CcSide,
    id: string,
    mesInicio: string,
  ): Promise<string[]> {
    const advertencias: string[] = [];
    for (const mes of mesesCerrados(mesInicio, hoyArgentina())) {
      try {
        let calculados: CargoCalculado[];
        if (side === 'cliente') {
          const [r, entidad] = await Promise.all([
            this.facturacion.calcular(mes),
            this.clientes.findOneByOrFail({ id }),
          ]);
          calculados = this.calcularCargosCliente(entidad, r);
        } else {
          const { desde, hasta } = rangoMes(mes);
          const [colaborador, entradas, overrides] = await Promise.all([
            this.colaboradores.findOneByOrFail({ id }),
            this.horas.find({
              where: { collaboratorId: id, date: Between(desde, hasta) },
            }),
            this.tarifas.findBy({ collaboratorId: id }),
          ]);
          calculados = this.calcularCargosColaborador(
            colaborador,
            entradas,
            overrides,
          );
        }
        await this.aplicarCargos(side, id, mes, calculados);
      } catch (err) {
        this.logger.warn(
          `No se pudo calcular el cargo de ${mes} (${side} ${id}): ${(err as Error).message}`,
        );
        advertencias.push(
          `No se pudo calcular ${nombreMes(mes)}: ${(err as Error).message}`,
        );
      }
    }
    return advertencias;
  }

  /**
   * Lo mismo para todas las cuentas de un lado, para el listado con saldos: cada mes se calcula
   * una sola vez y lo existente se trae de una, así no hay consultas por cuenta si nada cambió.
   */
  private async generarCargosDelLado(
    side: CcSide,
    mesInicio: string,
  ): Promise<string[]> {
    const advertencias: string[] = [];
    const meses = mesesCerrados(mesInicio, hoyArgentina());
    if (!meses.length) return advertencias;

    const existentes = await this.movimientos.findBy({ side, origen: 'mes' });
    const cargoIds = existentes.map((m) => m.id);
    const imputados = cargoIds.length
      ? await this.imputaciones.findBy({ cargoId: In(cargoIds) })
      : [];
    const conImputaciones = new Set(imputados.map((i) => i.cargoId));
    const clientes = side === 'cliente' ? await this.clientes.find() : [];
    const colaboradores =
      side === 'colaborador' ? await this.colaboradores.find() : [];
    const overrides = side === 'colaborador' ? await this.tarifas.find() : [];
    const cuentaDe = (m: CcMovementEntity) => m.clientId ?? m.collaboratorId;

    for (const mes of meses) {
      try {
        const calcular =
          side === 'cliente'
            ? await this.calculadorDeClientes(mes, clientes)
            : await this.calculadorDeColaboradores(
                mes,
                colaboradores,
                overrides,
              );
        const delMes = existentes.filter((m) => m.month === mes);
        for (const id of [
          ...clientes.map((c) => c.id),
          ...colaboradores.map((c) => c.id),
        ]) {
          try {
            await this.aplicarCargos(side, id, mes, calcular(id), {
              existentes: delMes.filter((m) => cuentaDe(m) === id),
              conImputaciones,
            });
          } catch (err) {
            this.logger.warn(
              `No se pudo generar el cargo de ${mes} (${side} ${id}): ${(err as Error).message}`,
            );
            advertencias.push(
              `No se pudo actualizar una cuenta en ${nombreMes(mes)}: ${(err as Error).message}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo calcular ${mes} (${side}): ${(err as Error).message}`,
        );
        advertencias.push(
          `No se pudo calcular ${nombreMes(mes)}: ${(err as Error).message}`,
        );
      }
    }
    return [...new Set(advertencias)];
  }

  private async calculadorDeClientes(mes: string, clientes: ClientEntity[]) {
    const r = await this.facturacion.calcular(mes);
    const porId = new Map(clientes.map((c) => [c.id, c]));
    return (id: string) => this.calcularCargosCliente(porId.get(id)!, r);
  }

  private async calculadorDeColaboradores(
    mes: string,
    colaboradores: CollaboratorEntity[],
    overrides: CollaboratorProjectRateEntity[],
  ) {
    const { desde, hasta } = rangoMes(mes);
    const entradas = await this.horas.find({
      where: { date: Between(desde, hasta) },
    });
    const porId = new Map(colaboradores.map((c) => [c.id, c]));
    return (id: string) =>
      this.calcularCargosColaborador(
        porId.get(id)!,
        entradas.filter((e) => e.collaboratorId === id),
        overrides.filter((o) => o.collaboratorId === id),
      );
  }

  private calcularCargosCliente(
    entidad: ClientEntity,
    r: Awaited<ReturnType<FacturacionService['calcular']>>,
  ): CargoCalculado[] {
    const clienteId = entidad.id;
    const porMoneda = new Map<CcMoneda, CcLineaDetalle[]>();
    const grupo = (moneda: CcMoneda) => {
      if (!porMoneda.has(moneda)) porMoneda.set(moneda, []);
      return porMoneda.get(moneda)!;
    };
    for (const l of r.lineas) {
      if (l.clienteId !== clienteId || l.problema) continue;
      grupo(l.original ? 'USD' : 'ARS').push({
        descripcion: l.descripcion,
        cantidad: l.unidad === 'HORA' ? `${l.cantidad} h` : `${l.cantidad} mes`,
        importe: Number(l.original ? l.original.importe : l.importe),
        referencia: l.referencia,
      });
    }
    // Los conceptos fijos están en pesos si se le factura; en la moneda del cliente si es recibo.
    const c = datosCliente(entidad);
    for (const concepto of c.conceptos) {
      grupo(c.documento === 'recibo' ? c.moneda : 'ARS').push({
        descripcion: concepto.descripcion,
        cantidad: concepto.cantidad,
        importe: redondear(
          Number(concepto.cantidad) * Number(concepto.precioUnitario),
        ),
      });
    }
    return [...porMoneda].map(([moneda, lineas]) => ({
      moneda,
      importe: redondear(lineas.reduce((t, l) => t + l.importe, 0)),
      detalle: { lineas },
    }));
  }

  /** Lo mismo que arma el recibo del colaborador: horas del mes × valor hora, por proyecto. */
  private calcularCargosColaborador(
    colaborador: CollaboratorEntity,
    entradas: TimeEntryEntity[],
    overrides: CollaboratorProjectRateEntity[],
  ): CargoCalculado[] {
    const porProyecto = new Map<
      string,
      { nombre: string; horas: number; tarifa: number }
    >();
    for (const e of entradas) {
      const actual = porProyecto.get(e.projectId);
      if (actual) {
        actual.horas += Number(e.hours);
        continue;
      }
      const override = overrides.find((o) => o.projectId === e.projectId);
      porProyecto.set(e.projectId, {
        nombre: e.projectName,
        horas: Number(e.hours),
        tarifa: Number(override?.hourlyRate ?? colaborador.hourlyRate),
      });
    }
    const moneda: CcMoneda =
      colaborador.currency === BillingCurrency.ARS ? 'ARS' : 'USD';
    const lineas = [...porProyecto.values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({
        descripcion: `HS trabajadas en ${p.nombre} ($${p.tarifa} ${moneda}/h)`,
        cantidad: `${redondear(p.horas)} hs`,
        importe: redondear(p.horas * p.tarifa),
      }));
    if (!lineas.length) return [];
    return [
      {
        moneda,
        importe: redondear(lineas.reduce((t, l) => t + l.importe, 0)),
        detalle: { lineas },
      },
    ];
  }

  private async aplicarCargos(
    side: CcSide,
    cuentaId: string,
    mes: string,
    calculados: CargoCalculado[],
    /** Ya cargado por quien genera en lote: sin esto, se consulta por cuenta. */
    previo?: {
      existentes: CcMovementEntity[];
      conImputaciones: Set<string>;
    },
  ) {
    const donde = this.dondeCuenta(side, cuentaId);
    const existentes =
      previo?.existentes ??
      (await this.movimientos.find({
        where: { ...donde, origen: 'mes', month: mes },
      }));
    const monedas = new Set<CcMoneda>([
      ...calculados.map((c) => c.moneda),
      ...existentes.flatMap((e) =>
        e.sourceCurrency ? [e.sourceCurrency] : [],
      ),
    ]);
    const { hasta } = rangoMes(mes);

    for (const moneda of monedas) {
      const calculado = calculados.find((c) => c.moneda === moneda);
      const importe = calculado?.importe ?? 0;
      const existente = existentes.find((e) => e.sourceCurrency === moneda);

      if (!existente) {
        if (importe <= EPS) continue;
        // orIgnore: si dos pedidos generan a la vez, el índice único deja uno solo y no falla.
        await this.movimientos
          .createQueryBuilder()
          .insert()
          .values({
            side,
            ...donde,
            tipo: 'cargo',
            origen: 'mes',
            month: mes,
            concept: `${side === 'cliente' ? 'Servicios' : 'Honorarios'} ${nombreMes(mes)}`,
            amount: importe.toFixed(2),
            currency: moneda,
            sourceCurrency: moneda,
            sourceAmount: importe.toFixed(2),
            date: hasta,
            dueDate: sumarDias(hasta, DIAS_VENCIMIENTO),
            detail: calculado!.detalle,
          })
          .orIgnore()
          .execute();
        continue;
      }

      // Ya facturado por fuera, el cargo queda fijo igual que con imputaciones: la factura no cambia.
      const fijo =
        (existente.comprobantesPrevios?.length ?? 0) > 0 ||
        (previo
          ? previo.conImputaciones.has(existente.id)
          : await this.imputaciones.existsBy({ cargoId: existente.id }));
      if (!fijo) {
        if (importe <= EPS) {
          await this.movimientos.delete({ id: existente.id });
          continue;
        }
        const esperado = await this.enMonedaDelCargo(
          importe,
          moneda,
          existente.currency,
          mes,
        );
        if (
          Math.abs(esperado - Number(existente.amount)) > EPS ||
          !mismoDetalle(existente.detail, calculado!.detalle)
        ) {
          await this.movimientos.update(
            { id: existente.id },
            {
              amount: esperado.toFixed(2),
              sourceAmount: importe.toFixed(2),
              detail: calculado!.detalle,
            },
          );
        }
        continue;
      }

      const esperado = await this.enMonedaDelCargo(
        importe,
        moneda,
        existente.currency,
        mes,
      );
      await this.aplicarAjuste(existente, esperado);
    }
  }

  private async enMonedaDelCargo(
    importe: number,
    de: CcMoneda,
    a: CcMoneda,
    mes: string,
  ) {
    if (de === a) return redondear(importe);
    return convertir(importe, de, a, await this.tcUtil(mes));
  }

  /** TC del mes para convertir; el 1 que devuelve getUsdRate cuando no hay dato no sirve. */
  private async tcUtil(mes: string) {
    const { rate, locked } = await this.tipoDeCambio.getUsdRate(mes);
    if (!locked && rate <= 1) {
      throw new ServiceUnavailableException(
        'No se pudo obtener el tipo de cambio del día: fijá el del mes.',
      );
    }
    return rate;
  }

  private async aplicarAjuste(cargo: CcMovementEntity, esperado: number) {
    const hijos = await this.movimientos.findBy({ parentId: cargo.id });
    const ajustes = await Promise.all(
      hijos.map(async (h) => ({
        id: h.id,
        importe: h.tipo === 'cargo' ? Number(h.amount) : -Number(h.amount),
        imputado: await this.imputaciones.existsBy({ cargoId: h.id }),
      })),
    );
    const accion = resolverAjuste(esperado, Number(cargo.amount), ajustes);
    if (!accion) return;
    if (accion.accion === 'borrar') {
      await this.movimientos.delete({ id: accion.id });
      return;
    }
    const tipo = accion.importe > 0 ? ('cargo' as const) : ('credito' as const);
    const amount = Math.abs(accion.importe).toFixed(2);
    if (accion.accion === 'actualizar') {
      await this.movimientos.update({ id: accion.id }, { tipo, amount });
      return;
    }
    await this.movimientos.insert({
      side: cargo.side,
      clientId: cargo.clientId,
      collaboratorId: cargo.collaboratorId,
      tipo,
      origen: 'ajuste',
      month: cargo.month,
      parentId: cargo.id,
      concept: `Ajuste ${cargo.concept}`,
      amount,
      currency: cargo.currency,
      date: hoyArgentina(),
      detail: {
        lineas: [
          {
            descripcion: `Ajuste ${cargo.concept}: se cargaron horas o cambió el TC después de imputar`,
            cantidad: '',
            importe: Math.abs(accion.importe),
          },
        ],
      },
    });
  }

  // ── Cambiar la moneda de un cargo ────────────────────────────────────────

  /** Selector de moneda del cargo: por defecto la del proyecto; solo sin imputaciones. */
  async cambiarMoneda(id: string, monedaRaw: unknown, tipoCambio?: unknown) {
    if (!monedaValida(monedaRaw)) {
      throw new BadRequestException('moneda debe ser USD o ARS.');
    }
    const m = await this.movimientos.findOneBy({ id });
    if (!m) throw new NotFoundException('Movimiento no encontrado.');
    if (m.tipo !== 'cargo' || m.origen === 'ajuste') {
      throw new BadRequestException('Solo se elige la moneda de un cargo.');
    }
    if (await this.imputaciones.existsBy({ cargoId: id })) {
      throw new ConflictException(
        'El cargo ya tiene imputaciones: deshacelas para cambiar la moneda.',
      );
    }
    if (m.currency === monedaRaw) return { id, moneda: monedaRaw };
    const tc =
      tcOpcional(tipoCambio) ??
      (await this.tcUtil(m.month ?? hoyArgentina().slice(0, 7)));
    const importe =
      m.origen === 'mes' && m.sourceCurrency && m.sourceAmount != null
        ? convertir(Number(m.sourceAmount), m.sourceCurrency, monedaRaw, tc)
        : convertir(Number(m.amount), m.currency, monedaRaw, tc);
    await this.movimientos.update(
      { id },
      { currency: monedaRaw, amount: importe.toFixed(2) },
    );
    return { id, moneda: monedaRaw, importe };
  }

  // ── Movimientos a mano ───────────────────────────────────────────────────

  /** Saldo con el que arranca la cuenta: positivo es deuda, negativo es a favor. */
  async cargarSaldoInicial(
    dto: {
      side?: unknown;
      cuentaId?: unknown;
      importe?: unknown;
      moneda?: unknown;
    },
    email?: string,
  ) {
    const { side, id } = this.validarCuenta(dto?.side, dto?.cuentaId);
    await this.asegurarExiste(side, id);
    const { mesInicio } = await this.obtenerConfig();
    if (!mesInicio) {
      throw new BadRequestException('Primero elegí el mes de arranque.');
    }
    if (!monedaValida(dto.moneda)) {
      throw new BadRequestException('moneda debe ser USD o ARS.');
    }
    const n = Number(dto.importe);
    if (!Number.isFinite(n) || Math.abs(n) <= EPS) {
      throw new BadRequestException('Ingresá un saldo distinto de cero.');
    }
    const ya = await this.movimientos.existsBy({
      ...this.dondeCuenta(side, id),
      origen: 'saldo_inicial',
      currency: dto.moneda,
    });
    if (ya) {
      throw new ConflictException(
        `La cuenta ya tiene saldo inicial en ${dto.moneda}: eliminalo para cargar otro.`,
      );
    }
    const creado = await this.movimientos.save(
      this.movimientos.create({
        side,
        ...this.dondeCuenta(side, id),
        tipo: n > 0 ? 'cargo' : 'pago',
        origen: 'saldo_inicial',
        concept: 'Saldo inicial',
        amount: Math.abs(redondear(n)).toFixed(2),
        currency: dto.moneda,
        date: `${mesInicio}-01`,
        createdBy: email ?? null,
      }),
    );
    return { id: creado.id };
  }

  /**
   * Crea las cuotas de los planes que ya llegaron a su fecha (idempotente: se llama al abrir las
   * cuentas). Así la siguiente cuota aparece sola, sin que nadie tenga que cargarla.
   */
  private async generarCuotas(donde: {
    side: CcSide;
    clientId?: string;
    collaboratorId?: string;
  }) {
    const planes = await this.planes.findBy({ ...donde, canceledAt: IsNull() });
    if (!planes.length) return;
    const existentes = await this.movimientos.findBy({
      planId: In(planes.map((p) => p.id)),
    });
    const hoy = hoyArgentina();
    for (const plan of planes) {
      const numeros = existentes
        .filter((m) => m.planId === plan.id && m.cuotaNumero != null)
        .map((m) => m.cuotaNumero as number);
      for (const { numero, fecha } of cuotasAGenerar(plan, numeros, hoy)) {
        await this.movimientos
          .createQueryBuilder()
          .insert()
          .values({
            side: plan.side,
            clientId: plan.clientId,
            collaboratorId: plan.collaboratorId,
            tipo: 'cargo',
            origen: 'cuota',
            planId: plan.id,
            cuotaNumero: numero,
            concept: conceptoDeCuota(numero, plan.totalCuotas, plan.concept),
            amount: plan.amount,
            currency: plan.currency,
            date: fecha,
            dueDate: fecha,
            createdBy: plan.createdBy,
          })
          .orIgnore()
          .execute();
      }
    }
  }

  /** Crea un plan de cuotas. Reintentar con la misma clave no crea otro. */
  private async crearPlanCuotas(
    dto: DatosMovimiento,
    cuotas: number,
    side: CcSide,
    id: string,
    clave: string,
    email?: string,
  ) {
    const previo = await this.planes.findOneBy({ idempotencyKey: clave });
    if (previo) return { id: previo.id, imputaciones: [] };
    await this.asegurarExiste(side, id);
    if (!Number.isInteger(cuotas) || cuotas < 2 || cuotas > 60) {
      throw new BadRequestException(
        'La cantidad de cuotas debe ser un número entero entre 2 y 60.',
      );
    }
    if (dto.tipo !== 'cargo') {
      throw new BadRequestException('Solo un cargo puede ir en cuotas.');
    }
    if (!monedaValida(dto.moneda)) {
      throw new BadRequestException('moneda debe ser USD o ARS.');
    }
    const concepto =
      typeof dto.concepto === 'string' ? dto.concepto.trim() : '';
    if (!concepto) throw new BadRequestException('Poné el concepto del cargo.');
    const plan = await this.planes.save(
      this.planes.create({
        side,
        ...this.dondeCuenta(side, id),
        concept: concepto,
        amount: importeValido(dto.importe).toFixed(2),
        currency: dto.moneda,
        totalCuotas: cuotas,
        firstDate: fechaValida(dto.fecha),
        idempotencyKey: clave,
        createdBy: email ?? null,
      }),
    );
    await this.generarCuotas({ side, ...this.dondeCuenta(side, id) });
    return { id: plan.id, imputaciones: [] };
  }

  /**
   * Para el Panel de administración: lo cargado a mano y en cuotas a clientes suma a lo que se
   * cobra; los adicionales de los recibos de colaboradores, a lo que se paga.
   */
  async cargosDelMes(mes: unknown) {
    if (typeof mes !== 'string' || !MES.test(mes)) {
      throw new BadRequestException('El mes debe tener formato yyyy-MM.');
    }
    await this.generarCuotas({ side: 'cliente' });
    const { desde, hasta } = rangoMes(mes);
    const filas = await this.movimientos.findBy({
      side: 'cliente',
      tipo: 'cargo',
      origen: In(['manual', 'cuota']),
      date: Between(desde, hasta),
    });
    const adicionales = await this.movimientos.findBy({
      side: 'colaborador',
      tipo: 'cargo',
      origen: 'manual',
      date: Between(desde, hasta),
    });
    return {
      cargos: filas.map((m) => ({
        clienteId: m.clientId,
        importe: Number(m.amount),
        moneda: m.currency,
      })),
      adicionales: adicionales.map((m) => ({
        importe: Number(m.amount),
        moneda: m.currency,
      })),
    };
  }

  /** Cargo manual o pago. Un pago con `imputarACargoIds` se imputa del cargo más viejo al más nuevo. */
  async crearMovimiento(dto: DatosMovimiento, clave: string, email?: string) {
    const previo = await this.movimientos.findOneBy({ idempotencyKey: clave });
    const { side, id } = this.validarCuenta(dto?.side, dto?.cuentaId);
    if (dto.cuotas !== undefined && Number(dto.cuotas) > 1) {
      return this.crearPlanCuotas(
        dto,
        Number(dto.cuotas),
        side,
        id,
        clave,
        email,
      );
    }
    const cargoIds = Array.isArray(dto.imputarACargoIds)
      ? dto.imputarACargoIds.filter((x): x is string => typeof x === 'string')
      : [];
    const adicionales = adicionalesValidos(dto.adicionales);
    if (!adicionales) {
      throw new BadRequestException(
        'Cada adicional del recibo necesita descripción e importe mayor a cero.',
      );
    }
    if (adicionales.length && (side !== 'colaborador' || dto.tipo !== 'pago')) {
      throw new BadRequestException(
        'Los adicionales son para el recibo de un pago a un colaborador.',
      );
    }
    const totalAdicionales = adicionales.reduce((t, a) => t + a.importe, 0);
    // Antes de guardar el cobro: un comprobante inválido no tiene que dejarlo cargado a medias.
    if (dto.adjunto !== undefined && dto.adjunto !== null) {
      if (side !== 'cliente') {
        throw new BadRequestException(
          'El comprobante adjunto es para los cobros a clientes.',
        );
      }
      await this.adjuntoDe(dto.adjunto, id);
    }
    let mov = previo;
    if (!mov) {
      if (Number(dto.importe) < totalAdicionales - EPS) {
        throw new BadRequestException(
          'El pago tiene que cubrir al menos los adicionales del recibo.',
        );
      }
      await this.asegurarExiste(side, id);
      if (dto.tipo !== 'cargo' && dto.tipo !== 'pago') {
        throw new BadRequestException('tipo debe ser cargo o pago.');
      }
      if (!monedaValida(dto.moneda)) {
        throw new BadRequestException('moneda debe ser USD o ARS.');
      }
      const concepto =
        typeof dto.concepto === 'string' ? dto.concepto.trim() : '';
      if (dto.tipo === 'cargo' && !concepto) {
        throw new BadRequestException('Poné el concepto del cargo.');
      }
      const texto = (v: unknown) =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;
      mov = await this.movimientos.save(
        this.movimientos.create({
          side,
          ...this.dondeCuenta(side, id),
          tipo: dto.tipo,
          origen: 'manual',
          concept: concepto || (side === 'cliente' ? 'Cobro' : 'Pago'),
          amount: importeValido(dto.importe).toFixed(2),
          currency: dto.moneda,
          date: fechaValida(dto.fecha),
          dueDate: dto.fechaVencimiento
            ? fechaValida(dto.fechaVencimiento, 'El vencimiento')
            : null,
          paymentMethod: texto(dto.formaPago),
          reference: texto(dto.referencia),
          idempotencyKey: clave,
          createdBy: email ?? null,
        }),
      );
    }

    const resultados: Array<
      ReturnType<CuentaCorrienteService['presentarImputacion']>
    > = [];
    // Primero los adicionales: el pago los cubre seguro, y lo que queda va a los cargos elegidos.
    const imputacionesAdicionales =
      mov.tipo === 'pago' && adicionales.length
        ? await this.imputarAdicionales(mov, adicionales, clave, email)
        : [];
    if (mov.tipo === 'pago' && cargoIds.length) {
      const cargos = await this.movimientos.findBy({ id: In(cargoIds) });
      cargos.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (const cargo of cargos) {
        const r = await this.imputar(
          {
            pagoId: mov.id,
            cargoId: cargo.id,
            tipoCambio: dto.tipoCambio,
            emitir: dto.emitir,
            fechaEmision: dto.fechaEmision,
            adjunto: dto.adjunto,
          },
          `${clave}-${cargo.id.slice(0, 8)}`,
          email,
        ).catch((err: Error) => {
          // El cobro ya está guardado: lo que no se pudo imputar queda a cuenta y se informa.
          if (err instanceof BadRequestException) return null;
          throw err;
        });
        if (r) resultados.push(r);
      }
    }
    if (imputacionesAdicionales.length) {
      const principal = await this.unirAdicionalesAlRecibo(
        imputacionesAdicionales,
        resultados.filter((r) => r.documento === 'recibo').at(-1)?.id,
        dto.emitir !== false,
        typeof dto.fechaEmision === 'string' ? dto.fechaEmision : mov.date,
      );
      if (principal) resultados.push(principal);
    }
    return { id: mov.id, imputaciones: resultados };
  }

  /** Cada adicional queda en la cuenta como un cargo cubierto por este pago. Reintentar no los duplica. */
  private async imputarAdicionales(
    pago: CcMovementEntity,
    adicionales: AdicionalRecibo[],
    clave: string,
    email?: string,
  ) {
    const ids: string[] = [];
    for (const [n, a] of adicionales.entries()) {
      const claveCargo = `${clave}-x${n}`;
      const cargo =
        (await this.movimientos.findOneBy({ idempotencyKey: claveCargo })) ??
        (await this.movimientos.save(
          this.movimientos.create({
            side: pago.side,
            collaboratorId: pago.collaboratorId,
            tipo: 'cargo',
            origen: 'manual',
            concept: a.descripcion,
            amount: a.importe.toFixed(2),
            currency: pago.currency,
            date: pago.date,
            detail: {
              lineas: [
                {
                  descripcion: a.descripcion,
                  cantidad: '',
                  importe: a.importe,
                },
              ],
            },
            idempotencyKey: claveCargo,
            createdBy: email ?? null,
          }),
        ));
      const imputacion = await this.imputar(
        { pagoId: pago.id, cargoId: cargo.id, emitir: false },
        `${claveCargo}-i`,
        email,
      );
      ids.push(imputacion.id);
    }
    return ids;
  }

  /**
   * Un solo recibo por pago: los adicionales salen en el de la imputación principal. Si el pago era
   * solo por adicionales, el primero es el que lleva el recibo.
   */
  private async unirAdicionalesAlRecibo(
    ids: string[],
    principalId: string | undefined,
    emitir: boolean,
    fechaEmision: string,
  ) {
    if (!emitir) return null;
    let principal = principalId;
    let creada: CcImputationEntity | null = null;
    if (!principal) {
      creada = await this.imputaciones.findOneByOrFail({ id: ids[0] });
      creada.documento = 'recibo';
      creada.comprobanteTipo = 'RECIBO';
      creada.comprobanteEstado = 'EMITIDO';
      creada.fechaEmision = fechaEmision;
      await this.imputaciones.save(creada);
      principal = creada.id;
    }
    const resto = ids.filter((id) => id !== principal);
    if (resto.length) {
      await this.imputaciones.update(
        { id: In(resto) },
        { reciboDe: principal },
      );
    }
    return creada ? this.presentarImputacion(creada) : null;
  }

  /** Solo lo cargado a mano y sin comprobantes: lo fiscal se deshace, no se borra. */
  async eliminarMovimiento(id: string) {
    const m = await this.movimientos.findOneBy({ id });
    if (!m) throw new NotFoundException('Movimiento no encontrado.');
    if (
      m.origen !== 'manual' &&
      m.origen !== 'saldo_inicial' &&
      m.origen !== 'cuota'
    ) {
      throw new BadRequestException(
        'Los cargos del mes y sus ajustes se generan solos: no se eliminan a mano.',
      );
    }
    const propias = await this.imputaciones.find({
      where: [{ pagoId: id }, { cargoId: id }],
    });
    if (propias.some((i) => !i.reversedAt)) {
      throw new ConflictException('Primero deshacé sus imputaciones.');
    }
    if (propias.some((i) => i.comprobanteId || i.documento)) {
      throw new ConflictException(
        'Tiene comprobantes emitidos: queda en la cuenta como registro.',
      );
    }
    if (propias.length) {
      await this.imputaciones.delete({ id: In(propias.map((i) => i.id)) });
    }
    // Sin esto, la cuota borrada volvería a generarse sola: se frenan esta y las que faltan.
    if (m.planId) {
      await this.planes.update({ id: m.planId }, { canceledAt: new Date() });
    }
    await this.movimientos.delete({ id });
  }

  // ── Imputar ──────────────────────────────────────────────────────────────

  private comprobanteDelFacturador(id: string, email?: string) {
    return this.facturador.pedir<ComprobanteFacturador>(
      'GET',
      `/comprobantes/${encodeURIComponent(id)}`,
      { email },
    );
  }

  /**
   * Las facturas emitidas por fuera de esta pantalla quedan en el cargo del mes que cubren, para
   * mostrarlas y no emitir otra. Se buscan una sola vez por cargo, con el Facturador de este
   * ambiente. Si no responde, se corta acá y se reintenta la próxima vez que se abra la cuenta.
   */
  private async revisarComprobantes(
    movimientos: CcMovementEntity[],
    email?: string,
  ) {
    const sinRevisar = movimientos.filter(
      (m) =>
        m.side === 'cliente' && m.origen === 'mes' && !m.comprobanteRevisadoAt,
    );
    for (const cargo of sinRevisar) {
      try {
        const refs = (cargo.detail?.lineas ?? []).flatMap((l) =>
          l.referencia ? [l.referencia] : [],
        );
        const items = refs.length
          ? await this.facturacion.itemsPorReferencia(refs, email)
          : new Map<string, { estado: string; comprobanteId: string | null }>();
        const previos: CcComprobantePrevio[] = [];
        for (const id of facturasDeItems([...items.values()])) {
          const c = await this.comprobanteDelFacturador(id, email);
          if (facturaVigente(c)) previos.push(comprobantePrevioDe(c));
        }
        cargo.comprobantesPrevios = previos.length ? previos : null;
        cargo.comprobanteRevisadoAt = new Date();
        // Solo estas columnas: el resto del cargo pudo haberse regenerado recién.
        await this.movimientos.update(
          { id: cargo.id },
          {
            comprobantesPrevios: cargo.comprobantesPrevios,
            comprobanteRevisadoAt: cargo.comprobanteRevisadoAt,
          },
        );
      } catch (err) {
        this.logger.warn(
          `No se pudieron buscar las facturas del cargo ${cargo.id}: ${(err as Error).message}`,
        );
        return;
      }
    }
  }

  /** Lo que se haga con la factura desde su detalle vuelve al cargo: si se anuló, ya no lo cubre. */
  async sincronizarComprobantesPrevios(cargoId: string, email?: string) {
    const cargo = await this.movimientos.findOneBy({ id: cargoId });
    if (!cargo) throw new NotFoundException('Movimiento no encontrado.');
    const previos: CcComprobantePrevio[] = [];
    for (const p of cargo.comprobantesPrevios ?? []) {
      const c = await this.comprobanteDelFacturador(p.comprobanteId, email);
      if (facturaVigente(c)) previos.push(comprobantePrevioDe(c));
    }
    await this.movimientos.update(
      { id: cargoId },
      { comprobantesPrevios: previos.length ? previos : null },
    );
    return previos;
  }

  // ── Comprobante adjunto ──────────────────────────────────────────────────

  /**
   * Guarda el archivo y devuelve lo que se pudo leer de él. Una imagen o un PDF escaneado no se
   * leen: el número se carga a mano. El archivo queda fuera de la imputación hasta guardarla.
   */
  async subirComprobante(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá el archivo del comprobante.');
    }
    const tipo = tipoDeArchivo(file.buffer);
    if (!tipo) {
      throw new BadRequestException(
        'El comprobante tiene que ser PDF, PNG o JPG.',
      );
    }
    const detectado =
      tipo.extension === 'pdf'
        ? detectarComprobante(await textoDePdf(file.buffer))
        : { numero: null, tipo: null };
    const path = `${CARPETA_ADJUNTOS}/${randomUUID()}.${tipo.extension}`;
    // Sin token de descarga: el archivo no tiene URL pública.
    await getStorage(this.firebaseApp)
      .bucket()
      .file(path)
      .save(file.buffer, { contentType: tipo.contentType });
    return {
      path,
      // multer entrega el nombre en latin1.
      nombre: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      ...detectado,
    };
  }

  /** El adjunto de un cobro, validado. Un mismo número no puede estar en la cuenta de otro cliente. */
  private async adjuntoDe(valor: unknown, clienteId: string | null) {
    const adjunto = adjuntoValido(valor);
    if (!adjunto) return null;
    const mismoNumero = (
      await this.imputaciones.findBy({
        comprobanteNumero: adjunto.numero,
        reversedAt: IsNull(),
      })
    ).filter(
      (i) =>
        !i.comprobanteTipo ||
        !adjunto.tipo ||
        i.comprobanteTipo === adjunto.tipo,
    );
    if (mismoNumero.length) {
      const cargos = await this.movimientos.findBy({
        id: In(mismoNumero.map((i) => i.cargoId)),
      });
      if (cargos.some((c) => c.clientId !== clienteId)) {
        throw new ConflictException(
          `El comprobante ${adjunto.numero} ya está cargado en la cuenta de otro cliente.`,
        );
      }
    }
    return adjunto;
  }

  async archivoAdjunto(id: string) {
    const i = await this.cargarImputacion(id);
    if (!i.adjuntoPath) {
      throw new NotFoundException(
        'Esa imputación no tiene comprobante adjunto.',
      );
    }
    const [buffer] = await getStorage(this.firebaseApp)
      .bucket()
      .file(i.adjuntoPath)
      .download();
    return {
      buffer,
      tipo:
        TIPO_POR_EXTENSION[i.adjuntoPath.split('.').pop() ?? ''] ??
        'application/octet-stream',
    };
  }

  async imputar(dto: DatosImputacion, clave: string, email?: string) {
    const previa = await this.imputaciones.findOneBy({ idempotencyKey: clave });
    if (previa) return this.emitirSiFalta(previa, email);
    if (typeof dto?.pagoId !== 'string' || typeof dto?.cargoId !== 'string') {
      throw new BadRequestException('Elegí el pago y el cargo.');
    }
    const pagoId = dto.pagoId;
    const cargoId = dto.cargoId;
    const importe =
      dto.importe === undefined || dto.importe === null || dto.importe === ''
        ? undefined
        : importeValido(dto.importe);
    const fechaEmision = dto.fechaEmision
      ? fechaValida(dto.fechaEmision, 'La fecha de emisión')
      : hoyArgentina();

    const cargoInicial = await this.movimientos.findOneBy({ id: cargoId });
    if (!cargoInicial) throw new NotFoundException('Cargo no encontrado.');
    if (dto.adjunto && cargoInicial.side !== 'cliente') {
      throw new BadRequestException(
        'El comprobante adjunto es para los cobros a clientes.',
      );
    }
    const adjunto = await this.adjuntoDe(dto.adjunto, cargoInicial.clientId);
    // El TC del mes pudo haberse fijado recién: el cargo tiene que estar al día antes de imputar.
    if (cargoInicial.origen === 'mes') {
      const { mesInicio } = await this.obtenerConfig();
      if (mesInicio) {
        await this.generarCargos(
          cargoInicial.side,
          (cargoInicial.clientId ?? cargoInicial.collaboratorId)!,
          mesInicio,
        );
      }
      await this.revisarComprobantes([cargoInicial], email);
    }

    const emitirPedido = dto.emitir !== false;
    const tcPedido = tcOpcional(dto.tipoCambio);

    const imputacion = await this.movimientos.manager.transaction(
      async (tx) => {
        // Bloqueo en orden fijo: dos imputaciones a la vez no se pasan del saldo ni se trancan.
        const filas = await tx.find(CcMovementEntity, {
          where: { id: In([pagoId, cargoId]) },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
        const pago = filas.find((m) => m.id === pagoId);
        const cargo = filas.find((m) => m.id === cargoId);
        if (!pago || !cargo) {
          throw new NotFoundException('Pago o cargo no encontrado.');
        }
        if (pago.tipo !== 'pago' || cargo.tipo !== 'cargo') {
          throw new BadRequestException('Se imputa un pago a un cargo.');
        }
        if (
          pago.side !== cargo.side ||
          pago.clientId !== cargo.clientId ||
          pago.collaboratorId !== cargo.collaboratorId
        ) {
          throw new BadRequestException(
            'El pago y el cargo son de cuentas distintas.',
          );
        }

        const delPago = await tx.find(CcImputationEntity, {
          where: { pagoId },
        });
        const delCargo = await tx.find(CcImputationEntity, {
          where: { cargoId },
        });
        const creditos = await tx.find(CcMovementEntity, {
          where: { parentId: cargoId, tipo: 'credito' },
        });
        const vigente = (i: CcImputationEntity) => !i.reversedAt;
        const disponiblePago = redondear(
          Number(pago.amount) -
            delPago
              .filter(vigente)
              .reduce((t, i) => t + Number(i.paymentAmount), 0),
        );
        const pendienteCargo = redondear(
          Number(cargo.amount) -
            creditos.reduce((t, c) => t + Number(c.amount), 0) -
            delCargo.filter(vigente).reduce((t, i) => t + Number(i.amount), 0),
        );

        // Hace falta TC si pago y cargo difieren, o para pasar a pesos una factura de un pago en USD.
        // Con su factura previa, el cargo no suma otro comprobante, tampoco uno adjunto.
        const adjuntoDelCargo = cargo.comprobantesPrevios?.length
          ? null
          : adjunto;
        const documento = adjuntoDelCargo
          ? ('adjunto' as const)
          : await this.documentoDe(
              cargo,
              emitirPedido && !adjunto && pago.origen !== 'saldo_inicial',
            );
        const requiereTc =
          pago.currency !== cargo.currency ||
          (documento === 'factura' && pago.currency === 'USD');
        const tc = requiereTc
          ? (tcPedido ?? (await this.tcUtil(pago.date.slice(0, 7))))
          : tcPedido;

        const calculo = calcularImputacion({
          importe,
          pendienteCargo,
          disponiblePago,
          monedaCargo: cargo.currency,
          monedaPago: pago.currency,
          tc,
        });
        if (!calculo) {
          throw new BadRequestException(
            disponiblePago <= EPS
              ? 'El pago ya está imputado por completo.'
              : 'El cargo ya está cancelado.',
          );
        }
        return tx.save(
          tx.create(CcImputationEntity, {
            pagoId,
            cargoId,
            amount: calculo.importeCargo.toFixed(2),
            paymentAmount: calculo.importePago.toFixed(2),
            exchangeRate: tc != null ? tc.toFixed(4) : null,
            documento,
            // Un adjunto ya está emitido: no pasa por emitirSiFalta, y deshacerlo no anula nada.
            comprobanteEstado: adjuntoDelCargo
              ? 'EMITIDO'
              : documento
                ? 'PENDIENTE'
                : null,
            comprobanteTipo: adjuntoDelCargo?.tipo ?? null,
            comprobanteNumero: adjuntoDelCargo?.numero ?? null,
            adjuntoPath: adjuntoDelCargo?.path ?? null,
            adjuntoNombre: adjuntoDelCargo?.nombre ?? null,
            fechaEmision: documento ? fechaEmision : null,
            idempotencyKey: clave,
            createdBy: email ?? null,
          }),
        );
      },
    );

    return this.emitirSiFalta(imputacion, email);
  }

  /** Qué comprobante corresponde al imputar este cargo (null: ninguno). */
  private async documentoDe(cargo: CcMovementEntity, emitir: boolean) {
    if (!emitir) return null;
    if (cargo.side === 'colaborador') return 'recibo' as const;
    // Ya tiene su factura: el cobro se imputa sin emitir otra, y deshacerlo no la anula.
    if (cargo.comprobantesPrevios?.length) return null;
    const entidad = await this.clientes.findOneByOrFail({
      id: cargo.clientId!,
    });
    const documento = datosCliente(entidad).documento;
    // Sin saber si ya se facturó no se emite: podría salir una factura repetida.
    if (
      documento === 'factura' &&
      cargo.origen === 'mes' &&
      !cargo.comprobanteRevisadoAt
    ) {
      throw new ServiceUnavailableException(
        'No se pudo consultar el Facturador para ver si este mes ya tiene factura. Probá de nuevo en un momento.',
      );
    }
    return documento;
  }

  // ── Emitir el comprobante ────────────────────────────────────────────────

  /**
   * La imputación ya está guardada: si ARCA o el Facturador fallan, queda con el error a la vista
   * y se reintenta sin volver a imputar. La clave es fija por imputación e intento, así un
   * reintento no factura dos veces.
   */
  private async emitirSiFalta(i: CcImputationEntity, email?: string) {
    if (
      i.comprobanteEstado !== 'PENDIENTE' &&
      i.comprobanteEstado !== 'ERROR'
    ) {
      return this.presentarImputacion(i);
    }
    const [cargo, pago] = await Promise.all([
      this.movimientos.findOneByOrFail({ id: i.cargoId }),
      this.movimientos.findOneByOrFail({ id: i.pagoId }),
    ]);
    try {
      if (i.documento === 'factura') {
        await this.emitirFactura(i, cargo, pago, email);
      } else {
        await this.emitirRecibo(i, cargo, pago, email);
      }
      i.comprobanteError = null;
    } catch (err) {
      this.anotarError(i, err);
    }
    await this.imputaciones.save(i);
    return this.presentarImputacion(i);
  }

  private anotarError(i: CcImputationEntity, err: unknown) {
    const respuesta =
      err instanceof HttpException
        ? (err.getResponse() as { comprobante?: { id?: unknown } } | string)
        : null;
    const rechazado =
      respuesta && typeof respuesta === 'object'
        ? respuesta.comprobante?.id
        : undefined;
    i.comprobanteError = (err as Error).message.slice(0, 1000);
    if (typeof rechazado === 'string') {
      // ARCA lo rechazó: el comprobante existe, se corrige y se reintenta desde su detalle.
      i.comprobanteId = rechazado;
      i.comprobanteEstado = 'RECHAZADO';
      return;
    }
    i.comprobanteEstado = 'ERROR';
    // Un 4xx es definitivo: el próximo intento necesita otra clave. Un corte o un 5xx no dicen
    // si se emitió: se reusa la misma para que el Facturador devuelva el resultado.
    const status = err instanceof HttpException ? err.getStatus() : 0;
    if (status >= 400 && status < 500) i.intento += 1;
    this.logger.warn(`No se pudo emitir ${i.id}: ${i.comprobanteError}`);
  }

  private conceptoParcial(cargo: CcMovementEntity) {
    return `Pago a cuenta - ${cargo.concept}`;
  }

  private cancelaEntero(i: CcImputationEntity, cargo: CcMovementEntity) {
    return Math.abs(Number(i.amount) - Number(cargo.amount)) <= EPS;
  }

  private async emitirFactura(
    i: CcImputationEntity,
    cargo: CcMovementEntity,
    pago: CcMovementEntity,
    email?: string,
  ) {
    const totalArs =
      pago.currency === 'ARS'
        ? Number(i.paymentAmount)
        : convertir(
            Number(i.paymentAmount),
            'USD',
            'ARS',
            Number(i.exchangeRate),
          );
    const { puntoVentaId, conIva } = await this.facturacion.datosEmision(email);
    const lineas = lineasDelComprobante(
      cargo.detail?.lineas ?? [],
      totalArs,
      this.cancelaEntero(i, cargo),
      this.conceptoParcial(cargo),
    );
    const fechaEmision = i.fechaEmision ?? hoyArgentina();
    const periodo = rangoMes(cargo.month ?? fechaEmision.slice(0, 7));
    const creado = await this.facturacion.crearYEmitir(
      {
        clienteTrackerId: cargo.clientId,
        puntoVentaId,
        concepto: 'SERVICIOS',
        moneda: 'ARS',
        fechaEmision,
        fechaServicioDesde: periodo.desde,
        fechaServicioHasta: periodo.hasta,
        fechaVtoPago: sumarDias(fechaEmision, DIAS_VENCIMIENTO),
        lineas: lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: '1',
          unidad: 'SERVICIO',
          // El total del comprobante tiene que dar lo cobrado, con o sin IVA.
          precioUnitario: netoDeTotal(l.importe, conIva).toFixed(2),
          alicuotaIva: '21',
        })),
      },
      `cc-${i.id}-${i.intento}`,
      email,
    );
    this.anotarComprobante(i, creado);
  }

  private anotarComprobante(i: CcImputationEntity, c: ComprobanteConNumero) {
    i.comprobanteId = c.id;
    i.comprobanteEstado = c.estado;
    i.comprobanteTipo = c.tipo ?? i.comprobanteTipo;
    i.comprobanteNumero =
      c.numero != null
        ? numeroDeComprobante(c.puntoVenta, c.numero)
        : i.comprobanteNumero;
  }

  private async emitirRecibo(
    i: CcImputationEntity,
    cargo: CcMovementEntity,
    pago: CcMovementEntity,
    email?: string,
  ) {
    if (cargo.side === 'cliente') {
      const fecha = i.fechaEmision ?? hoyArgentina();
      await this.facturacion.registrarRecibo(
        cargo.clientId!,
        cargo.month ?? fecha.slice(0, 7),
        fecha,
        pago.currency,
        Number(i.paymentAmount).toFixed(2),
        email,
      );
    }
    i.comprobanteEstado = 'EMITIDO';
    i.comprobanteTipo = 'RECIBO';
  }

  private async cargarImputacion(id: string) {
    const i = await this.imputaciones.findOneBy({ id });
    if (!i) throw new NotFoundException('Imputación no encontrada.');
    return i;
  }

  /** Reintenta un comprobante que no se pudo emitir. */
  async reintentar(id: string, email?: string) {
    const i = await this.cargarImputacion(id);
    if (i.reversedAt) {
      throw new ConflictException('La imputación ya se deshizo.');
    }
    return this.emitirSiFalta(i, email);
  }

  /** Trae el estado real del Facturador (por si se verificó, corrigió o anuló desde su detalle). */
  async sincronizar(id: string, email?: string) {
    const i = await this.cargarImputacion(id);
    if (!i.comprobanteId) return this.presentarImputacion(i);
    const c = await this.facturador.pedir<
      ComprobanteConNumero & {
        notas?: Array<{ estado: string }>;
      }
    >('GET', `/comprobantes/${encodeURIComponent(i.comprobanteId)}`, { email });
    this.anotarComprobante(i, c);
    if (c.estado === 'EMITIDO') i.comprobanteError = null;
    const anulada =
      c.estado === 'ANULADO' ||
      (c.notas ?? []).some((n) => n.estado === 'EMITIDO');
    if (anulada && !i.reversedAt) {
      i.reversedAt = new Date();
      i.reversalReason = 'Anulada con nota de crédito desde el comprobante.';
    }
    await this.imputaciones.save(i);
    return this.presentarImputacion(i);
  }

  /**
   * Deshacer: una factura emitida no se puede borrar, se anula con nota de crédito. Si la nota no
   * sale, la imputación queda como estaba. La fila no se borra: es el rastro de lo emitido.
   */
  async deshacer(id: string, motivo: unknown, email?: string) {
    const i = await this.cargarImputacion(id);
    if (i.reversedAt) return this.presentarImputacion(i);
    if (
      i.comprobanteEstado === 'PENDIENTE_VERIFICACION' ||
      i.comprobanteEstado === 'EMITIENDO'
    ) {
      throw new ConflictException(
        'El comprobante todavía se está emitiendo: verificalo antes de deshacer.',
      );
    }
    if (
      i.documento === 'factura' &&
      i.comprobanteId &&
      i.comprobanteEstado === 'EMITIDO'
    ) {
      const nota = await this.facturacion.anular(
        i.comprobanteId,
        motivo,
        `cc-nc-${i.id}`,
        email,
      );
      if (nota.estado !== 'EMITIDO') {
        throw new ConflictException(
          `La nota de crédito quedó en estado ${nota.estado}: revisala antes de deshacer.`,
        );
      }
    }
    i.reversedAt = new Date();
    i.reversalReason =
      typeof motivo === 'string' && motivo.trim()
        ? motivo.trim().slice(0, 500)
        : null;
    await this.imputaciones.save(i);
    await this.eliminarAdicionales(i.id);
    return this.presentarImputacion(i);
  }

  /** Deshacer un recibo saca también sus adicionales: solo existían por ese recibo. */
  private async eliminarAdicionales(reciboId: string) {
    const adicionales = await this.imputaciones.findBy({ reciboDe: reciboId });
    if (!adicionales.length) return;
    await this.imputaciones.delete({ id: In(adicionales.map((a) => a.id)) });
    await this.movimientos.delete({
      id: In(adicionales.map((a) => a.cargoId)),
      origen: 'manual',
    });
  }

  // ── Recibos ──────────────────────────────────────────────────────────────

  private fechaTexto(ymd: string) {
    const [a, m, d] = ymd.split('-');
    return `${d}/${m}/${a}`;
  }

  private montoTexto(n: number, moneda: CcMoneda) {
    return `$ ${n.toLocaleString('es-AR', {
      minimumFractionDigits: moneda === 'ARS' ? 0 : 2,
      maximumFractionDigits: moneda === 'ARS' ? 0 : 2,
    })}`;
  }

  /** Mismo recibo que arma la pantalla de Colaboradores, con lo que se imputó. */
  private async datosReciboColaborador(i: CcImputationEntity): Promise<{
    dto: GenerateCollaboratorReceiptDto;
    colaborador: CollaboratorEntity;
  }> {
    const [cargo, pago] = await Promise.all([
      this.movimientos.findOneByOrFail({ id: i.cargoId }),
      this.movimientos.findOneByOrFail({ id: i.pagoId }),
    ]);
    const colaborador = await this.colaboradores.findOneByOrFail({
      id: cargo.collaboratorId!,
    });
    const total = Number(i.paymentAmount);
    const lineas = lineasDelComprobante(
      cargo.detail?.lineas ?? [],
      total,
      this.cancelaEntero(i, cargo),
      this.conceptoParcial(cargo),
    );
    const origen = cargo.detail?.lineas ?? [];
    const fecha = i.fechaEmision ?? hoyArgentina();
    const adicionales = await this.imputaciones.findBy({
      reciboDe: i.id,
      reversedAt: IsNull(),
    });
    const cargosAdicionales = adicionales.length
      ? await this.movimientos.findBy({
          id: In(adicionales.map((a) => a.cargoId)),
        })
      : [];
    const totalRecibo =
      total + adicionales.reduce((t, a) => t + Number(a.paymentAmount), 0);
    return {
      colaborador,
      dto: {
        date: this.fechaTexto(fecha),
        fullName: colaborador.name,
        monthYear: nombreMes(cargo.month ?? fecha.slice(0, 7)),
        paymentMethod: pago.paymentMethod ?? colaborador.paymentMethod ?? '',
        items: [
          ...lineas.map((l, n) => ({
            // En el recibo la cantidad va en su propia columna, no en la descripción.
            description:
              lineas.length === origen.length
                ? origen[n].descripcion
                : l.descripcion,
            quantity: lineas.length === origen.length ? origen[n].cantidad : '',
            amount: this.montoTexto(l.importe, pago.currency),
          })),
          ...adicionales.map((a) => ({
            description:
              cargosAdicionales.find((c) => c.id === a.cargoId)?.concept ?? '',
            quantity: '',
            amount: this.montoTexto(Number(a.paymentAmount), pago.currency),
          })),
        ],
        total: this.montoTexto(totalRecibo, pago.currency),
        currency: pago.currency,
      },
    };
  }

  async pdfRecibo(id: string, email?: string) {
    const i = await this.cargarImputacion(id);
    if (i.documento !== 'recibo') {
      throw new BadRequestException('Esa imputación no tiene recibo.');
    }
    const cargo = await this.movimientos.findOneByOrFail({ id: i.cargoId });
    if (cargo.side === 'colaborador') {
      const { dto } = await this.datosReciboColaborador(i);
      return {
        buffer: await this.recibosColaborador.generate(dto),
        tipo: 'application/pdf',
      };
    }
    const pago = await this.movimientos.findOneByOrFail({ id: i.pagoId });
    const total = Number(i.paymentAmount);
    const lineas = lineasDelComprobante(
      cargo.detail?.lineas ?? [],
      total,
      this.cancelaEntero(i, cargo),
      this.conceptoParcial(cargo),
    );
    const { pdf } = await this.facturacion.reciboPdf(
      {
        clienteTrackerId: cargo.clientId,
        mes: cargo.month ?? undefined,
        moneda: pago.currency,
        fecha: i.fechaEmision ?? hoyArgentina(),
        lineas: lineas.map((l) => ({
          descripcion: l.descripcion,
          cantidad: 1,
          unidad: 'SERVICIO',
          precioUnitario: l.importe,
        })),
      },
      email,
    );
    return { buffer: pdf.buffer, tipo: pdf.tipo };
  }

  /** Envío explícito: nunca sale un email solo por imputar. */
  async enviarRecibo(id: string, to: unknown) {
    const i = await this.cargarImputacion(id);
    if (i.documento !== 'recibo') {
      throw new BadRequestException('Esa imputación no tiene recibo.');
    }
    const cargo = await this.movimientos.findOneByOrFail({ id: i.cargoId });
    if (cargo.side !== 'colaborador') {
      throw new BadRequestException(
        'El envío por email es para recibos de colaboradores.',
      );
    }
    const { dto, colaborador } = await this.datosReciboColaborador(i);
    return this.envioRecibos.send(colaborador.id, {
      to: typeof to === 'string' ? to : '',
      receipt: dto,
    });
  }
}

interface ComprobanteConNumero extends ComprobantePublico {
  tipo?: string;
  numero?: number | null;
  puntoVenta?: number;
}
