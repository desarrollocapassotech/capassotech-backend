import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity, ProjectEntity } from '../database/entities';
import { BillableHoursService } from '../integrations/billable-hours.service';
import { FacturadorClient } from '../integrations/facturador.client';
import {
  armarResumen,
  cuitValido,
  MES,
  nombreMes,
  rangoMes,
  type DatosCliente,
  type LineaResumen,
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
  | 'faltan-datos'; // sin CUIT válido: hay que darlo de alta a mano

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
  ) {}

  // ── Resumen del mes ──────────────────────────────────────────────────────

  private async calcular(mes: string) {
    const { desde, hasta } = rangoMes(mes);
    const [horas, proyectos, clientes] = await Promise.all([
      this.horas.listar(desde, hasta),
      this.projects.find(),
      this.clients.find(),
    ]);
    return armarResumen(
      mes,
      horas.entries.map((e) => ({
        date: e.date,
        billableHours: e.billableHours,
        projectId: e.project.id,
      })),
      proyectos.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        rate: p.rate != null ? Number(p.rate) : null,
        currency: p.currency,
        billingType: p.billingType,
        clientId: p.clientId,
      })),
      clientes,
    );
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
    const faltan = clientes.filter((c) => !vinculados.has(c.id));
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

  private async itemsPorReferencia(refs: string[], email?: string) {
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
    const [estados, items] = await Promise.all([
      this.estadoClientes(r.clientes, email),
      this.itemsPorReferencia(
        r.lineas.map((l) => l.referencia),
        email,
      ),
    ]);
    return {
      mes,
      periodo: nombreMes(mes),
      advertencias: r.advertencias,
      clientes: r.clientes.map((c) => {
        const estado = estados.get(c.id)!;
        return {
          ...c,
          alta: estado.alta,
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

  async facturar(
    dto: { mes?: string; referencias?: unknown; fechaEmision?: unknown },
    email?: string,
  ) {
    const mes = validarMes(dto.mes);
    const refs = Array.isArray(dto.referencias)
      ? dto.referencias.filter((x): x is string => typeof x === 'string')
      : [];
    if (!refs.length) throw new BadRequestException('Elegí qué facturar.');
    const fechaEmision =
      typeof dto.fechaEmision === 'string' && dto.fechaEmision
        ? dto.fechaEmision
        : undefined;

    // Los importes se recalculan acá: nunca se toman del navegador.
    const r = await this.calcular(mes);
    const elegidas = r.lineas.filter((l) => refs.includes(l.referencia));
    if (elegidas.length !== new Set(refs).size) {
      throw new BadRequestException(
        'Algunas líneas ya no están en el resumen: recargalo.',
      );
    }
    const conProblema = elegidas.find((l) => l.problema);
    if (conProblema) {
      throw new BadRequestException(
        `${conProblema.descripcion}: ${conProblema.problema}`,
      );
    }

    const clientes = r.clientes.filter((c) =>
      elegidas.some((l) => l.clienteId === c.id),
    );
    const estados = await this.estadoClientes(clientes, email);
    const sinDatos = clientes.filter(
      (c) => estados.get(c.id)!.alta === 'faltan-datos',
    );
    if (sinDatos.length) {
      throw new UnprocessableEntityException({
        message: `Falta dar de alta en el Facturador: ${sinDatos.map((c) => c.razonSocial).join(', ')} (no tienen CUIT válido en el tracker).`,
        clientes: sinDatos.map((c) => c.id),
      });
    }
    const idFacturador = new Map<string, string>();
    for (const c of clientes) {
      idFacturador.set(
        c.id,
        await this.resolverCliente(c, estados.get(c.id)!, email),
      );
    }

    const carga = await this.facturador.pedir<{
      importacion: { advertencias: Array<{ mensaje: string }> };
      items: ItemFacturador[];
    }>('POST', '/items', {
      email,
      body: {
        descripcion: `Tracker - ${nombreMes(mes)}`,
        confirmar: true,
        items: elegidas.map((l) =>
          this.item(l, idFacturador.get(l.clienteId)!),
        ),
      },
    });

    const validos = carga.items.filter((i) => i.estado === 'VALIDO');
    const errores = carga.items
      .filter((i) => i.estado === 'CON_ERRORES')
      .map((i) => ({
        referencia: i.referenciaExterna,
        mensajes: i.errores.map((e) => e.mensaje),
      }));
    const omitidos = carga.items
      .filter((i) => i.estado === 'EN_BORRADOR' || i.estado === 'FACTURADO')
      .map((i) => ({
        referencia: i.referenciaExterna,
        estado: i.estado,
        comprobanteId: i.comprobanteId,
      }));

    const borradores = validos.length
      ? await this.facturador.pedir<{ comprobantes: unknown[] }>(
          'POST',
          '/comprobantes/borradores',
          {
            email,
            body: {
              referencias: validos.map((i) => i.referenciaExterna),
              agrupacion: 'cliente',
              ...(fechaEmision ? { fechaEmision } : {}),
            },
          },
        )
      : { comprobantes: [] };

    return {
      comprobantes: borradores.comprobantes,
      errores,
      omitidos,
      advertencias: carga.importacion.advertencias.map((a) => a.mensaje),
    };
  }

  private item(l: LineaResumen, clienteId: string) {
    return {
      referenciaExterna: l.referencia,
      cliente: { clienteId },
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precioUnitario: l.precioUnitario,
      moneda: l.moneda,
      alicuotaIva: '21',
      periodo: l.periodo,
      metadatos: { proyectoId: l.proyecto.id, clienteTrackerId: l.clienteId },
    };
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
}
