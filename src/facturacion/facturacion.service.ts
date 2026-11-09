import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ClientEntity,
  ClientReceiptEntity,
  ProjectBillingTermEntity,
  ProjectEntity,
} from '../database/entities';
import { condicionDeEntidad } from '../projects/condiciones';
import { BillingCurrency } from '../database/entities/enums';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { BillableHoursService } from '../integrations/billable-hours.service';
import { FacturadorClient } from '../integrations/facturador.client';
import {
  armarResumen,
  conceptosValidos,
  cuitValido,
  datosCliente,
  MES,
  nombreMes,
  rangoMes,
  type DatosCliente,
} from './resumen';

// Pantalla Facturación del tracker: arma lo facturable del mes con los datos del
// tracker (horas facturables × tarifa del proyecto) y lo manda al Facturador por su
// API pública. El Facturador no sabe nada del tracker: recibe ítems con precio.

export interface ClienteFacturador {
  id: string;
  razonSocial: string;
  tipoDocumento: string;
  numeroDocumento: string;
  condicionIva: string;
}

export interface ItemFacturador {
  referenciaExterna: string;
  estado: string;
  errores: Array<{ campo: string; mensaje: string }>;
  cantidad: string;
  precioUnitario: string;
  moneda: string;
  comprobanteId: string | null;
}

export interface Padron {
  cuit: string;
  razonSocial: string;
  domicilio: string | null;
  condicionIva: string | null;
}

/** Cómo se va a resolver el cliente del Facturador al facturar. */
export type EstadoAlta =
  | 'vinculado' // ya asociado a este cliente del tracker
  | 'existente' // hay un cliente con ese CUIT: se asocia
  | 'automatica' // se da de alta con los datos del tracker
  | 'padron' // se da de alta tomando la condición de IVA del padrón de ARCA
  | 'faltan-datos' // sin CUIT válido: hay que darlo de alta a mano
  | 'recibo'; // se le emite recibo sin validez fiscal: no pasa por el Facturador

export interface AltaClienteDto {
  clienteTrackerId: string;
  razonSocial: string;
  tipoDocumento: string;
  numeroDocumento: string;
  condicionIva: string;
  domicilio?: string;
  email?: string;
}

const lotes = <T>(xs: T[], n = 200): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  );

function validarMes(mes: string | undefined): string {
  if (!mes || !MES.test(mes)) {
    throw new BadRequestException('mes debe tener formato YYYY-MM.');
  }
  return mes;
}

@Injectable()
export class FacturacionService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ClientEntity)
    private readonly clients: Repository<ClientEntity>,
    private readonly horas: BillableHoursService,
    private readonly facturador: FacturadorClient,
    private readonly tipoDeCambio: ExchangeRateService,
    @InjectRepository(ClientReceiptEntity)
    private readonly recibos: Repository<ClientReceiptEntity>,
    @InjectRepository(ProjectBillingTermEntity)
    private readonly condiciones: Repository<ProjectBillingTermEntity>,
  ) {}

  // ── Resumen del mes ──────────────────────────────────────────────────────

  /** TC del mes del tracker (el fijado a mano o, si no hay, el oficial del día). */
  private async cotizacion(mes: string) {
    const { rate, locked } = await this.tipoDeCambio.getUsdRate(mes);
    // Si no hay TC fijado y no se pudo consultar el del día, getUsdRate devuelve 1: no sirve para facturar.
    if (!locked && rate <= 1) {
      throw new ServiceUnavailableException(
        'No se pudo obtener el tipo de cambio del día: fijá el del mes para poder facturar.',
      );
    }
    return { valor: rate, fijada: locked };
  }

  /** Lo facturable del mes: las líneas de Facturación son también los cargos de la cuenta corriente. */
  async calcular(mes: string) {
    const { desde, hasta } = rangoMes(mes);
    const [horas, proyectos, condiciones, clientes, cotizacion] =
      await Promise.all([
        this.horas.listar(desde, hasta),
        this.projects.find(),
        this.condiciones.find(),
        this.clients.find(),
        this.cotizacion(mes),
      ]);
    const r = armarResumen(
      mes,
      horas.entries.map((e) => ({
        date: e.date,
        billableHours: e.billableHours,
        projectId: e.project.id,
        clientId: e.client?.id ?? null,
      })),
      proyectos.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        clientId: p.clientId,
      })),
      condiciones.map(condicionDeEntidad),
      clientes,
      cotizacion.valor,
    );
    return { ...r, cotizacion };
  }

  /** Datos del Facturador para emitir sin pasar por el modal: punto de venta y si la factura lleva IVA. */
  async datosEmision(email?: string) {
    const config = await this.facturador.pedir<{
      emisor?: { condicionIva?: string };
      puntosVenta?: Array<{ id: string }>;
    }>('GET', '/configuracion', { email });
    const puntoVentaId = config.puntosVenta?.[0]?.id;
    if (!puntoVentaId) {
      throw new UnprocessableEntityException(
        'No hay puntos de venta activos en el Facturador.',
      );
    }
    return {
      puntoVentaId,
      conIva: config.emisor?.condicionIva === 'RESPONSABLE_INSCRIPTO',
    };
  }

  /** Cliente del Facturador para cada cliente del tracker (o cómo se va a resolver). */
  private async estadoClientes(clientes: DatosCliente[], email?: string) {
    const vinculados = new Map<string, ClienteFacturador>();
    for (const lote of lotes(clientes.map((c) => c.id))) {
      const r = await this.facturador.pedir<
        Array<{ referenciaExterna: string; cliente: ClienteFacturador }>
      >('GET', '/clientes/referencias', { query: { referencia: lote }, email });
      for (const v of r) vinculados.set(v.referenciaExterna, v.cliente);
    }
    const faltan = clientes.filter(
      (c) => !vinculados.has(c.id) && c.documento !== 'recibo',
    );
    const porCuit = new Map<string, ClienteFacturador>();
    if (faltan.some((c) => cuitValido(c.cuit))) {
      const todos = await this.facturador.pedir<ClienteFacturador[]>(
        'GET',
        '/clientes',
        { email },
      );
      for (const c of todos) porCuit.set(c.numeroDocumento, c);
    }
    return new Map<
      string,
      { alta: EstadoAlta; facturador: ClienteFacturador | null }
    >(
      clientes.map((c) => {
        if (c.documento === 'recibo')
          return [c.id, { alta: 'recibo' as EstadoAlta, facturador: null }];
        const vinculado = vinculados.get(c.id);
        if (vinculado)
          return [
            c.id,
            { alta: 'vinculado' as EstadoAlta, facturador: vinculado },
          ];
        if (!cuitValido(c.cuit))
          return [
            c.id,
            { alta: 'faltan-datos' as EstadoAlta, facturador: null },
          ];
        const existente = porCuit.get(c.cuit);
        if (existente)
          return [
            c.id,
            { alta: 'existente' as EstadoAlta, facturador: existente },
          ];
        return [
          c.id,
          {
            alta: (c.condicionIva ? 'automatica' : 'padron') as EstadoAlta,
            facturador: null,
          },
        ];
      }),
    );
  }

  async itemsPorReferencia(refs: string[], email?: string) {
    const items = new Map<string, ItemFacturador>();
    for (const lote of lotes(refs)) {
      const r = await this.facturador.pedir<ItemFacturador[]>('GET', '/items', {
        query: { referencia: lote },
        email,
      });
      for (const i of r) items.set(i.referenciaExterna, i);
    }
    return items;
  }

  async resumen(mesRaw: string | undefined, email?: string) {
    const mes = validarMes(mesRaw);
    const r = await this.calcular(mes);
    const [anio, numeroMes] = mes.split('-').map(Number);
    const [estados, items, recibos] = await Promise.all([
      this.estadoClientes(r.clientes, email),
      this.itemsPorReferencia(
        r.lineas.map((l) => l.referencia),
        email,
      ),
      this.recibos.find({
        where: { year: anio, month: numeroMes },
        order: { createdAt: 'ASC' },
      }),
    ]);
    return {
      mes,
      periodo: nombreMes(mes),
      cotizacion: r.cotizacion,
      advertencias: r.advertencias,
      clientes: r.clientes.map((c) => {
        const estado = estados.get(c.id)!;
        return {
          ...c,
          alta: estado.alta,
          // Recibos ya hechos por el mes (no pasan por el Facturador: quedan registrados acá).
          recibos: recibos
            .filter((x) => x.clientId === c.id)
            .map((x) => ({
              fecha: x.date,
              moneda: x.currency,
              total: x.total,
            })),
          facturador: estado.facturador
            ? {
                id: estado.facturador.id,
                razonSocial: estado.facturador.razonSocial,
              }
            : null,
          lineas: r.lineas
            .filter((l) => l.clienteId === c.id)
            .map((l) => {
              const item = items.get(l.referencia);
              return {
                ...l,
                item: item
                  ? {
                      estado: item.estado,
                      comprobanteId: item.comprobanteId,
                      cantidad: item.cantidad,
                      precioUnitario: item.precioUnitario,
                    }
                  : null,
                // Ya enviado, pero el tracker hoy dice otra cosa (se cargaron horas después).
                cambio:
                  !!item &&
                  (Number(item.cantidad) !== Number(l.cantidad) ||
                    Number(item.precioUnitario) !==
                      Number(l.precioUnitario ?? 0) ||
                    item.moneda !== l.moneda),
              };
            }),
        };
      }),
    };
  }

  // ── Facturar ─────────────────────────────────────────────────────────────

  /** Resuelve (y si hace falta da de alta) el cliente del Facturador. */
  private async resolverCliente(
    c: DatosCliente,
    estado: { alta: EstadoAlta; facturador: ClienteFacturador | null },
    email?: string,
  ): Promise<string> {
    if (estado.alta === 'vinculado') return estado.facturador!.id;
    if (estado.alta === 'existente') {
      await this.vincular(estado.facturador!.id, c.id, email);
      return estado.facturador!.id;
    }
    let condicionIva = c.condicionIva;
    let domicilio = c.domicilio;
    if (!condicionIva) {
      const padron = await this.padron(c.cuit!, email).catch(() => null);
      condicionIva = padron?.condicionIva ?? null;
      domicilio = domicilio ?? padron?.domicilio ?? null;
      if (!condicionIva) {
        throw new UnprocessableEntityException({
          message: `No se sabe la condición de IVA de ${c.razonSocial}: dalo de alta a mano.`,
          clientes: [c.id],
        });
      }
    }
    const creado = await this.facturador.pedir<ClienteFacturador>(
      'POST',
      '/clientes',
      {
        email,
        body: {
          razonSocial: c.razonSocial,
          tipoDocumento: 'CUIT',
          numeroDocumento: c.cuit,
          condicionIva,
          ...(domicilio ? { domicilio } : {}),
          ...(c.email ? { email: c.email } : {}),
          referenciaExterna: c.id,
        },
      },
    );
    return creado.id;
  }

  // ── Clientes ─────────────────────────────────────────────────────────────

  padron(cuit: string, email?: string) {
    return this.facturador.pedir<Padron>(
      'GET',
      `/clientes/padron/${encodeURIComponent(cuit.replace(/\D/g, ''))}`,
      { email },
    );
  }

  vincular(
    clienteFacturadorId: string,
    clienteTrackerId: string,
    email?: string,
  ) {
    return this.facturador.pedir(
      'POST',
      `/clientes/${encodeURIComponent(clienteFacturadorId)}/referencias`,
      {
        email,
        body: { referenciaExterna: clienteTrackerId },
      },
    );
  }

  /** Alta a mano (cliente sin CUIT en el tracker, o para corregir datos): queda asociado. */
  async altaCliente(dto: AltaClienteDto, email?: string) {
    if (
      !dto?.clienteTrackerId ||
      !(await this.clients.existsBy({ id: dto.clienteTrackerId }))
    ) {
      throw new NotFoundException('Cliente del tracker no encontrado.');
    }
    const { clienteTrackerId, ...datos } = dto;
    try {
      return await this.facturador.pedir<ClienteFacturador>(
        'POST',
        '/clientes',
        {
          email,
          body: { ...datos, referenciaExterna: clienteTrackerId },
        },
      );
    } catch (err) {
      // Ya existe en el Facturador con ese documento: se usa ese.
      if (!(err instanceof HttpException) || err.getStatus() !== 409) throw err;
      const numero = String(datos.numeroDocumento ?? '').replace(/\D/g, '');
      const [existente] = (
        await this.facturador.pedir<ClienteFacturador[]>('GET', '/clientes', {
          query: { q: numero },
          email,
        })
      ).filter((c) => c.numeroDocumento === numero);
      if (!existente)
        throw new ConflictException(
          'Ya existe un cliente con ese documento en el Facturador.',
        );
      await this.vincular(existente.id, clienteTrackerId, email);
      return existente;
    }
  }

  // ── Factura manual ───────────────────────────────────────────────────────

  /** Clientes del tracker para la factura manual, con cómo se resuelve cada uno en el Facturador. */
  async clientesTracker(email?: string) {
    const clientes = (await this.clients.find())
      .map(datosCliente)
      .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial));
    const estados = await this.estadoClientes(clientes, email);
    return clientes.map((c) => ({ ...c, alta: estados.get(c.id)!.alta }));
  }

  /**
   * Factura manual a un cliente del tracker: se resuelve su cliente del Facturador (asociándolo
   * o dándolo de alta, como al facturar el mes) y se crea el borrador con ese id.
   */
  async crearBorrador(
    body: Record<string, unknown>,
    email?: string,
    clave?: string,
  ) {
    const { clienteTrackerId, ...resto } = body ?? {};
    if (typeof clienteTrackerId !== 'string' || !clienteTrackerId) {
      throw new BadRequestException('Elegí el cliente.');
    }
    const entidad = await this.clients.findOneBy({ id: clienteTrackerId });
    if (!entidad)
      throw new NotFoundException('Cliente del tracker no encontrado.');
    const c = datosCliente(entidad);
    if (c.documento === 'recibo') {
      throw new BadRequestException(
        `A ${c.razonSocial} se le emite recibo, no factura.`,
      );
    }
    const estado = (await this.estadoClientes([c], email)).get(c.id)!;
    if (estado.alta === 'faltan-datos') {
      throw new UnprocessableEntityException(
        `${c.razonSocial} no tiene CUIT válido en el tracker: completá sus datos para facturar.`,
      );
    }
    const clienteId = await this.resolverCliente(c, estado, email);
    return this.facturador.pedir<ComprobantePublico>('POST', '/comprobantes', {
      body: { ...resto, clienteId },
      email,
      idempotencyKey: clave && `${clave}-borrador`,
    });
  }

  // ── Conceptos fijos ──────────────────────────────────────────────────────

  /** Conceptos que se agregan solos a cada factura o recibo del cliente (lista vacía = ninguno). */
  async cambiarConceptos(clienteTrackerId: string, conceptos: unknown) {
    if (!Array.isArray(conceptos)) {
      throw new BadRequestException('conceptos debe ser una lista.');
    }
    if (conceptos.length > 50) {
      throw new BadRequestException('Como mucho 50 conceptos.');
    }
    const validos = conceptosValidos(conceptos);
    if (validos.length !== conceptos.length) {
      throw new BadRequestException(
        'Cada concepto necesita descripción, cantidad mayor a cero, unidad y precio.',
      );
    }
    const r = await this.clients.update(
      { id: clienteTrackerId },
      { billingConcepts: validos.length ? validos : null },
    );
    if (!r.affected)
      throw new NotFoundException('Cliente del tracker no encontrado.');
    return { clienteTrackerId, conceptos: validos };
  }

  // ── Factura o recibo ─────────────────────────────────────────────────────

  /**
   * Qué se le emite al cliente al facturar: factura en ARCA o recibo sin validez fiscal.
   * Con `moneda` también se cambia su moneda de facturación (la del recibo por defecto).
   */
  async cambiarDocumento(
    clienteTrackerId: string,
    documento: unknown,
    moneda?: unknown,
  ) {
    if (documento !== 'factura' && documento !== 'recibo') {
      throw new BadRequestException('documento debe ser "factura" o "recibo".');
    }
    if (moneda !== undefined && moneda !== 'USD' && moneda !== 'ARS') {
      throw new BadRequestException('moneda debe ser "USD" o "ARS".');
    }
    const r = await this.clients.update(
      { id: clienteTrackerId },
      {
        billingDocument: documento,
        ...(moneda ? { billingCurrency: moneda as BillingCurrency } : {}),
      },
    );
    if (!r.affected)
      throw new NotFoundException('Cliente del tracker no encontrado.');
    return { clienteTrackerId, documento, ...(moneda ? { moneda } : {}) };
  }

  /** Deja constancia de que se le hizo recibo al cliente por ese mes (el PDF no se guarda). */
  async registrarRecibo(
    clienteId: string,
    mes: string,
    fecha: string,
    moneda: 'USD' | 'ARS',
    total: string,
    email?: string,
  ) {
    const [anio, numeroMes] = mes.split('-').map(Number);
    await this.recibos.insert({
      clientId: clienteId,
      year: anio,
      month: numeroMes,
      date: fecha,
      currency: moneda,
      total,
      createdBy: email ?? null,
    });
  }

  /** Genera el PDF del recibo en el Facturador, sin registrar nada. */
  async reciboPdf(dto: DatosRecibo, email?: string) {
    if (typeof dto?.clienteTrackerId !== 'string' || !dto.clienteTrackerId) {
      throw new BadRequestException('Elegí el cliente.');
    }
    const entidad = await this.clients.findOneBy({ id: dto.clienteTrackerId });
    if (!entidad)
      throw new NotFoundException('Cliente del tracker no encontrado.');
    const c = datosCliente(entidad);
    if (c.documento !== 'recibo') {
      throw new BadRequestException(
        `A ${c.razonSocial} se le emite factura: el recibo es para los clientes marcados como "Recibo".`,
      );
    }
    const fecha =
      typeof dto.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dto.fecha)
        ? dto.fecha
        : new Date().toISOString().slice(0, 10);
    const lineas = Array.isArray(dto.lineas) ? dto.lineas : [];
    const items = lineas.map((l) => {
      const cantidad = Number(l?.cantidad);
      const precio = Number(l?.precioUnitario);
      if (
        typeof l?.descripcion !== 'string' ||
        !l.descripcion.trim() ||
        !(cantidad > 0) ||
        !(precio >= 0)
      ) {
        throw new BadRequestException(
          'Cada línea necesita descripción, cantidad y precio.',
        );
      }
      const centavos = Math.round(cantidad * precio * 100);
      return {
        descripcion: l.descripcion.trim(),
        cantidad: textoCantidad(cantidad, l.unidad),
        centavos,
      };
    });
    if (!items.length)
      throw new BadRequestException('El recibo necesita al menos una línea.');
    const total = items.reduce((t, i) => t + i.centavos, 0);
    const pesos = (centavos: number) => (centavos / 100).toFixed(2);
    const moneda =
      dto.moneda === 'USD' || dto.moneda === 'ARS' ? dto.moneda : c.moneda;
    const pdf = await this.facturador.descargar('/recibos/pdf', email, {
      tipo: 'COBRO',
      fecha,
      moneda,
      contraparte: {
        nombre: c.razonSocial,
        ...(c.cuit ? { documento: `CUIT ${formatearCuit(c.cuit)}` } : {}),
        ...(c.domicilio ? { domicilio: c.domicilio } : {}),
      },
      items: items.map((i) => ({
        descripcion: i.descripcion,
        ...(i.cantidad ? { cantidad: i.cantidad } : {}),
        importe: pesos(i.centavos),
      })),
      total: pesos(total),
      ...(typeof dto.observaciones === 'string' && dto.observaciones.trim()
        ? { observaciones: dto.observaciones.trim().slice(0, 1000) }
        : {}),
    });
    return {
      pdf,
      clienteId: entidad.id,
      fecha,
      moneda: moneda,
      total: pesos(total),
    };
  }

  /**
   * Anular una factura emitida: se crea la nota de crédito por el total y se emite en el mismo
   * pedido (sin borrador de por medio). Con la misma clave, reintentar no crea otra nota.
   */
  async anular(
    facturaId: string,
    motivo: unknown,
    clave: string,
    email?: string,
  ) {
    if (typeof motivo !== 'string' || !motivo.trim()) {
      throw new BadRequestException('Poné el motivo de la anulación.');
    }
    const nota = await this.facturador.pedir<ComprobantePublico>(
      'POST',
      `/comprobantes/${encodeURIComponent(facturaId)}/notas`,
      {
        email,
        body: { clase: 'NOTA_CREDITO', motivo: motivo.trim().slice(0, 500) },
        idempotencyKey: `${clave}-nota`,
      },
    );
    return this.emitirCreado(nota, clave, email);
  }

  /** Se crea el comprobante con todos sus datos y se emite. */
  async crearYEmitir(
    body: Record<string, unknown>,
    clave: string,
    email?: string,
  ) {
    const creado = await this.crearBorrador(body, email, clave);
    return this.emitirCreado(creado, clave, email);
  }

  /** En un reintento el comprobante puede estar ya emitido: se devuelve como está. */
  private async emitirCreado(
    creado: ComprobantePublico,
    clave: string,
    email?: string,
  ) {
    const ruta = `/comprobantes/${encodeURIComponent(creado.id)}`;
    const actual = await this.facturador.pedir<ComprobantePublico>(
      'GET',
      ruta,
      { email },
    );
    if (!['BORRADOR', 'RECHAZADO'].includes(actual.estado)) return actual;
    return this.facturador.pedir<ComprobantePublico>('POST', `${ruta}/emitir`, {
      email,
      body: { version: actual.version },
      idempotencyKey: clave,
    });
  }
}

export interface ComprobantePublico {
  id: string;
  estado: string;
  version: number;
}

export interface DatosRecibo {
  clienteTrackerId?: unknown;
  /** Mes de las horas (yyyy-MM): el recibo queda registrado como hecho para ese mes. */
  mes?: unknown;
  /** USD o ARS (los precios de las líneas vienen en esa moneda). Sin valor: la del cliente. */
  moneda?: unknown;
  fecha?: unknown;
  observaciones?: unknown;
  lineas?: Array<{
    descripcion?: unknown;
    cantidad?: unknown;
    unidad?: unknown;
    precioUnitario?: unknown;
  }>;
}

/** "68 h", "35,5 h", "1 mes": lo que va en la columna Cantidad del recibo. */
function textoCantidad(cantidad: number, unidad: unknown): string {
  const n = cantidad.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  if (unidad === 'HORA') return `${n} h`;
  if (unidad === 'MES') return `${n} ${cantidad === 1 ? 'mes' : 'meses'}`;
  return n;
}

function formatearCuit(cuit: string) {
  const d = cuit.replace(/\D/g, '');
  return d.length === 11
    ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
    : cuit;
}
