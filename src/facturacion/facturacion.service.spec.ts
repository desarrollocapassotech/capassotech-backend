/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return --
   El Facturador falso trabaja con cuerpos JSON sin tipar. */
import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type {
  ClientEntity,
  ClientReceiptEntity,
  ProjectEntity,
} from '../database/entities';
import type { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import type { BillableHoursService } from '../integrations/billable-hours.service';
import type {
  FacturadorClient,
  OpcionesFacturador,
} from '../integrations/facturador.client';
import { FacturacionService } from './facturacion.service';

interface Llamada {
  metodo: string;
  ruta: string;
  opciones: OpcionesFacturador;
}

/** Facturador en memoria: responde lo mínimo que usa el servicio. */
function facturadorFalso(
  inicial: { vinculados?: Record<string, string> } = {},
) {
  const llamadas: Llamada[] = [];
  const vinculados = new Map(Object.entries(inicial.vinculados ?? {}));
  const clientes: Array<{
    id: string;
    razonSocial: string;
    numeroDocumento: string;
  }> = [];
  const items = new Map<string, Record<string, unknown>>();
  const comprobantes = new Map<string, Record<string, any>>();
  // Como el Facturador real: un POST repetido con la misma Idempotency-Key devuelve lo mismo.
  const respuestas = new Map<string, unknown>();
  /** Si se define, la emisión falla así (por ejemplo, un corte después de autorizar). */
  let fallaAlEmitir: Error | null = null;

  const pedir = (
    metodo: string,
    ruta: string,
    opciones: OpcionesFacturador = {},
  ) => {
    const clave = metodo === 'POST' ? opciones.idempotencyKey : undefined;
    if (clave && respuestas.has(clave)) {
      llamadas.push({ metodo, ruta, opciones });
      return JSON.parse(JSON.stringify(respuestas.get(clave)));
    }
    const r = responder(metodo, ruta, opciones);
    // Se guarda una copia, como el JSON que guarda el Facturador real.
    if (clave) respuestas.set(clave, JSON.parse(JSON.stringify(r)));
    return r;
  };

  const responder = (
    metodo: string,
    ruta: string,
    opciones: OpcionesFacturador = {},
  ) => {
    llamadas.push({ metodo, ruta, opciones });
    const body = opciones.body as Record<string, any>;
    const refs = ([] as string[]).concat(
      (opciones.query?.referencia as string[] | undefined) ?? [],
    );
    if (metodo === 'GET' && ruta === '/clientes/referencias') {
      return refs
        .filter((r) => vinculados.has(r))
        .map((r) => ({
          referenciaExterna: r,
          cliente: { id: vinculados.get(r), razonSocial: 'Vinculado' },
        }));
    }
    if (metodo === 'GET' && ruta === '/clientes') return clientes;
    if (metodo === 'GET' && ruta === '/configuracion') {
      return { puntosVenta: [{ id: 'pv1', numero: 1 }] };
    }
    if (metodo === 'GET' && ruta.startsWith('/clientes/padron/')) {
      return {
        cuit: ruta.split('/').pop(),
        razonSocial: 'X',
        domicilio: 'Calle 1',
        condicionIva: 'MONOTRIBUTO',
      };
    }
    if (metodo === 'POST' && ruta === '/clientes') {
      const numero = String(body.numeroDocumento).replace(/\D/g, '');
      if (clientes.some((c) => c.numeroDocumento === numero)) {
        throw new HttpException({ message: 'Ya existe' }, 409);
      }
      const c = {
        id: `fc${clientes.length + 1}`,
        razonSocial: body.razonSocial,
        numeroDocumento: numero,
        alta: body,
      };
      clientes.push(c);
      if (body.referenciaExterna) vinculados.set(body.referenciaExterna, c.id);
      return c;
    }
    if (metodo === 'POST' && ruta.endsWith('/referencias')) {
      vinculados.set(body.referenciaExterna, ruta.split('/')[2]);
      return {};
    }
    if (metodo === 'GET' && ruta === '/items') {
      return refs.filter((r) => items.has(r)).map((r) => items.get(r));
    }
    if (metodo === 'POST' && ruta === '/comprobantes') {
      const c = {
        ...body,
        id: 'manual1',
        clienteId: body.clienteId,
        estado: 'BORRADOR',
        version: 0,
      };
      comprobantes.set(c.id, c);
      return { ...c };
    }
    if (metodo === 'POST' && /^\/comprobantes\/[^/]+\/notas$/.test(ruta)) {
      const nota = {
        id: `nota${comprobantes.size}`,
        estado: 'BORRADOR',
        version: 0,
      };
      comprobantes.set(nota.id, nota);
      return { ...nota };
    }
    const [, , idCmp, accion] = ruta.split('/');
    const cmp = ruta.startsWith('/comprobantes/')
      ? comprobantes.get(idCmp)
      : undefined;
    if (cmp && metodo === 'GET' && !accion) return { ...cmp };
    if (cmp && metodo === 'PATCH' && !accion) {
      if (body.version !== cmp.version)
        throw new HttpException({ message: 'Cambió' }, 409);
      Object.assign(cmp, body, { version: cmp.version + 1 });
      return { ...cmp };
    }
    if (cmp && metodo === 'POST' && accion === 'emitir') {
      if (body.version !== cmp.version)
        throw new HttpException({ message: 'Cambió' }, 409);
      Object.assign(cmp, {
        estado: 'EMITIDO',
        numero: 1,
        version: cmp.version + 1,
      });
      if (fallaAlEmitir) throw fallaAlEmitir;
      return { ...cmp };
    }
    throw new Error(`Ruta no prevista: ${metodo} ${ruta}`);
  };
  return {
    llamadas,
    clientes,
    comprobantes,
    cortarAlEmitir(e: Error | null) {
      fallaAlEmitir = e;
    },
    client: {
      configurado: true,
      pedir: jest.fn((m: string, r: string, o?: OpcionesFacturador) =>
        Promise.resolve().then(() => pedir(m, r, o)),
      ),
      descargar: jest.fn((ruta: string, email?: string, body?: unknown) => {
        llamadas.push({
          metodo: body === undefined ? 'GET' : 'POST',
          ruta,
          opciones: { email, body },
        });
        return Promise.resolve({
          buffer: Buffer.from('%PDF'),
          tipo: 'application/pdf',
          disposition: 'attachment; filename="Recibo.pdf"',
        });
      }),
    } as unknown as FacturadorClient,
  };
}

const proyectos = [
  {
    id: 'p1',
    name: 'Web',
    active: true,
    rate: '40.00',
    currency: 'USD',
    billingType: 'hourly',
    clientId: 'c1',
  },
  {
    id: 'p2',
    name: 'Soporte',
    active: true,
    rate: '100000.00',
    currency: 'ARS',
    billingType: 'monthly',
    clientId: 'c2',
  },
  {
    id: 'p3',
    name: 'App',
    active: true,
    rate: '30.00',
    currency: 'USD',
    billingType: 'hourly',
    clientId: 'c3',
  },
];
const clientesTracker = [
  {
    id: 'c1',
    name: 'Acme',
    razonSocial: 'Acme SA',
    cuit: '30-66834690-8',
    ivaCondition: 'Responsable Inscripto',
    email: 'pagos@acme.test',
    address: null,
  },
  {
    id: 'c2',
    name: 'Beta',
    razonSocial: '-',
    cuit: '20-38442199-8',
    ivaCondition: null,
    email: null,
    address: null,
  },
  {
    id: 'c3',
    name: 'Sin CUIT',
    razonSocial: null,
    cuit: null,
    ivaCondition: null,
    email: null,
    address: null,
  },
];

function servicio(
  f: ReturnType<typeof facturadorFalso>,
  cotizacion = { rate: 1000, locked: true },
) {
  const horas = {
    listar: jest.fn().mockResolvedValue({
      entries: [
        { date: '2026-09-03', billableHours: '5.5', project: { id: 'p1' } },
        { date: '2026-09-04', billableHours: '2', project: { id: 'p1' } },
        { date: '2026-09-04', billableHours: '3', project: { id: 'p3' } },
      ],
    }),
  } as unknown as BillableHoursService;
  const projects = {
    find: jest.fn().mockResolvedValue(proyectos),
  } as unknown as Repository<ProjectEntity>;
  const clients = {
    find: jest.fn().mockResolvedValue(clientesTracker),
    existsBy: jest.fn(({ id }: { id: string }) =>
      Promise.resolve(clientesTracker.some((c) => c.id === id)),
    ),
    findOneBy: jest.fn(({ id }: { id: string }) =>
      Promise.resolve(clientesTracker.find((c) => c.id === id) ?? null),
    ),
    update: jest.fn(
      ({ id }: { id: string }, cambios: Record<string, unknown>) => {
        const c = clientesTracker.find((x) => x.id === id);
        if (c) Object.assign(c, cambios);
        return Promise.resolve({ affected: c ? 1 : 0 });
      },
    ),
  } as unknown as Repository<ClientEntity>;
  const tipoDeCambio = {
    getUsdRate: jest.fn(() => Promise.resolve({ ...cotizacion })),
  } as unknown as ExchangeRateService;
  const recibos = {
    find: jest.fn(({ where }: { where: { year: number; month: number } }) =>
      Promise.resolve(
        recibosGuardados.filter(
          (r) => r.year === where.year && r.month === where.month,
        ),
      ),
    ),
    insert: jest.fn((r: Record<string, unknown>) => {
      recibosGuardados.push(r);
      return Promise.resolve({});
    }),
  } as unknown as Repository<ClientReceiptEntity>;
  return new FacturacionService(
    projects,
    clients,
    horas,
    f.client,
    tipoDeCambio,
    recibos,
  );
}

const recibosGuardados: Array<Record<string, unknown>> = [];
beforeEach(() => {
  recibosGuardados.length = 0;
});

const EMAIL = 'contable@capasso.tech';

describe('FacturacionService', () => {
  it('resumen: líneas por cliente con cómo se resuelve cada cliente en el Facturador', async () => {
    const f = facturadorFalso({ vinculados: { c1: 'fc-acme' } });
    const r = await servicio(f).resumen('2026-09', EMAIL);
    expect(r.clientes.map((c) => [c.id, c.alta])).toEqual([
      ['c1', 'vinculado'],
      ['c2', 'padron'],
      ['c3', 'faltan-datos'],
    ]);
    const acme = r.clientes.find((c) => c.id === 'c1')!;
    expect(acme.facturador).toEqual({
      id: 'fc-acme',
      razonSocial: 'Vinculado',
    });
    expect(r.cotizacion).toEqual({ valor: 1000, fijada: true });
    expect(acme.lineas[0]).toMatchObject({
      cantidad: '7.5',
      precioUnitario: '40000',
      moneda: 'ARS',
      importe: '300000.00',
      original: { moneda: 'USD', precioUnitario: '40', importe: '300.00' },
      item: null,
      cambio: false,
    });
    expect(f.llamadas.every((l) => l.opciones.email === EMAIL)).toBe(true);
  });

  it('un cliente sin CUIT no se factura hasta darlo de alta a mano; después queda asociado', async () => {
    const f = facturadorFalso();
    const s = servicio(f);
    const datos = { clienteTrackerId: 'c3', lineas: [] };
    await expect(s.crearBorrador(datos, EMAIL)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await s.altaCliente(
      {
        clienteTrackerId: 'c3',
        razonSocial: 'Sin CUIT SRL',
        tipoDocumento: 'CUIT',
        numeroDocumento: '30-71234567-1',
        condicionIva: 'RESPONSABLE_INSCRIPTO',
      },
      EMAIL,
    );
    await expect(s.crearBorrador(datos, EMAIL)).resolves.toMatchObject({
      clienteId: 'fc1',
    });
  });

  it('el alta a mano de un cliente que ya existe en el Facturador lo asocia', async () => {
    const f = facturadorFalso();
    f.clientes.push({
      id: 'fc-viejo',
      razonSocial: 'Ya estaba',
      numeroDocumento: '30712345671',
    });
    const s = servicio(f);
    const r = await s.altaCliente(
      {
        clienteTrackerId: 'c3',
        razonSocial: 'X',
        tipoDocumento: 'CUIT',
        numeroDocumento: '30-71234567-1',
        condicionIva: 'RESPONSABLE_INSCRIPTO',
      },
      EMAIL,
    );
    expect(r).toMatchObject({ id: 'fc-viejo' });
    expect(
      f.llamadas.some((l) => l.ruta === '/clientes/fc-viejo/referencias'),
    ).toBe(true);
  });

  it('factura manual: lista los clientes del tracker y al crear el borrador resuelve (o da de alta) su cliente del Facturador', async () => {
    const f = facturadorFalso({ vinculados: { c1: 'fc-acme' } });
    const s = servicio(f);
    expect((await s.clientesTracker(EMAIL)).map((c) => [c.id, c.alta])).toEqual(
      [
        ['c1', 'vinculado'],
        ['c2', 'padron'],
        ['c3', 'faltan-datos'],
      ],
    );

    const lineas = [
      { descripcion: 'Extra', cantidad: '1', precioUnitario: '1000' },
    ];
    await expect(
      s.crearBorrador({ clienteTrackerId: 'c1', moneda: 'ARS', lineas }, EMAIL),
    ).resolves.toMatchObject({ id: 'manual1', clienteId: 'fc-acme' });
    // Beta todavía no estaba en el Facturador: se da de alta con el padrón y se usa ese id.
    await expect(
      s.crearBorrador({ clienteTrackerId: 'c2', lineas }, EMAIL),
    ).resolves.toMatchObject({ id: 'manual1', clienteId: 'fc1' });
    const creado = f.llamadas.filter(
      (l) => l.metodo === 'POST' && l.ruta === '/comprobantes',
    )[0];
    expect(creado.opciones.body).toEqual({
      moneda: 'ARS',
      lineas,
      clienteId: 'fc-acme',
    });

    await expect(
      s.crearBorrador({ clienteTrackerId: 'c3', lineas }, EMAIL),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(s.crearBorrador({ lineas }, EMAIL)).rejects.toThrow(
      /Elegí el cliente/,
    );
  });

  it('factura manual: se crea y se emite en un paso', async () => {
    const f = facturadorFalso({ vinculados: { c1: 'fc-acme' } });
    const r = await servicio(f).crearYEmitir(
      { clienteTrackerId: 'c1', lineas: [{ descripcion: 'x' }] },
      'clave-manual-1',
      EMAIL,
    );
    expect(r).toMatchObject({ id: 'manual1', estado: 'EMITIDO' });
    expect(
      f.llamadas.find((l) => l.ruta === '/comprobantes' && l.metodo === 'POST')!
        .opciones.idempotencyKey,
    ).toBe('clave-manual-1-borrador');
  });

  it('anular: crea la nota de crédito y la emite en un paso; reintentar no crea otra', async () => {
    const f = facturadorFalso({ vinculados: { c1: 'fc-acme' } });
    const s = servicio(f);
    await s.crearYEmitir(
      { clienteTrackerId: 'c1', lineas: [{ descripcion: 'x' }] },
      'clave-fac',
      EMAIL,
    );

    await expect(
      s.anular('manual1', '  ', 'clave-anular', EMAIL),
    ).rejects.toThrow('motivo');
    f.cortarAlEmitir(new Error('Se cortó'));
    await expect(
      s.anular('manual1', 'Horas de más', 'clave-anular', EMAIL),
    ).rejects.toThrow('Se cortó');
    f.cortarAlEmitir(null);
    const nota = await s.anular(
      'manual1',
      'Horas de más',
      'clave-anular',
      EMAIL,
    );
    expect(nota).toMatchObject({ id: 'nota1', estado: 'EMITIDO' });
    const pedidos = f.llamadas.filter(
      (l) => l.ruta === '/comprobantes/manual1/notas',
    );
    expect(pedidos.map((l) => l.opciones.idempotencyKey)).toEqual([
      'clave-anular-nota',
      'clave-anular-nota',
    ]);
    expect(pedidos[0].opciones.body).toEqual({
      clase: 'NOTA_CREDITO',
      motivo: 'Horas de más',
    });
    expect(f.comprobantes.size).toBe(2); // la factura y una sola nota
    expect(
      f.llamadas.filter((l) => l.ruta === '/comprobantes/nota1/emitir'),
    ).toHaveLength(1);
  });

  describe('conceptos fijos', () => {
    const acme = clientesTracker.find((c) => c.id === 'c1') as Record<
      string,
      unknown
    >;
    afterEach(() => {
      delete acme.billingConcepts;
    });
    const hosting = {
      descripcion: 'Hosting',
      cantidad: '1',
      unidad: 'MES',
      precioUnitario: '50000',
    };

    it('se guardan validados; una lista vacía los borra', async () => {
      const s = servicio(facturadorFalso());
      await expect(s.cambiarConceptos('c1', [hosting])).resolves.toMatchObject({
        conceptos: [hosting],
      });
      expect(acme.billingConcepts).toEqual([hosting]);
      await expect(
        s.cambiarConceptos('c1', [{ ...hosting, cantidad: '0' }]),
      ).rejects.toThrow('descripción, cantidad');
      await expect(s.cambiarConceptos('c1', 'x')).rejects.toThrow('lista');
      await s.cambiarConceptos('c1', []);
      expect(acme.billingConcepts).toBeNull();
    });

    it('el resumen trae los conceptos de cada cliente', async () => {
      acme.billingConcepts = [hosting];
      const f = facturadorFalso({ vinculados: { c1: 'fc-acme' } });
      const r = await servicio(f).resumen('2026-09', EMAIL);
      expect(r.clientes.find((c) => c.id === 'c1')?.conceptos).toEqual([
        hosting,
      ]);
    });
  });

  describe('clientes con recibo (sin validez fiscal)', () => {
    // El cliente sin CUIT (c3) pasa a recibo solo dentro de estos tests.
    const sinCuit = clientesTracker.find((c) => c.id === 'c3') as Record<
      string,
      unknown
    >;
    afterEach(() => {
      delete sinCuit.billingDocument;
      delete sinCuit.billingCurrency;
    });

    it('cambiar el documento lo guarda en el cliente del tracker y valida el valor', async () => {
      const s = servicio(facturadorFalso());
      await expect(s.cambiarDocumento('c3', 'recibo')).resolves.toEqual({
        clienteTrackerId: 'c3',
        documento: 'recibo',
      });
      expect(sinCuit.billingDocument).toBe('recibo');
      // Con moneda, también cambia la moneda de facturación (la del recibo por defecto).
      await expect(
        s.cambiarDocumento('c3', 'recibo', 'ARS'),
      ).resolves.toMatchObject({ moneda: 'ARS' });
      expect(sinCuit.billingCurrency).toBe('ARS');
      await expect(s.cambiarDocumento('c3', 'recibo', 'EUR')).rejects.toThrow(
        'moneda',
      );
      await expect(s.cambiarDocumento('c3', 'otro')).rejects.toThrow(
        'documento',
      );
      await expect(s.cambiarDocumento('nadie', 'factura')).rejects.toThrow(
        'no encontrado',
      );
    });

    it('el resumen lo muestra como "recibo" (sin CUIT ni alta en el Facturador)', async () => {
      sinCuit.billingDocument = 'recibo';
      const r = await servicio(facturadorFalso()).resumen('2026-09', EMAIL);
      expect(r.clientes.find((c) => c.id === 'c3')).toMatchObject({
        alta: 'recibo',
        facturador: null,
        documento: 'recibo',
        moneda: 'USD',
      });
    });

    it('no se le puede facturar en ARCA', async () => {
      sinCuit.billingDocument = 'recibo';
      const s = servicio(facturadorFalso());
      await expect(
        s.crearBorrador({ clienteTrackerId: 'c3', lineas: [] }, EMAIL),
      ).rejects.toThrow('recibo, no factura');
    });

    it('el recibo lo genera el Facturador con las líneas del modal, sin numerar', async () => {
      sinCuit.billingDocument = 'recibo';
      const f = facturadorFalso();
      const { pdf } = await servicio(f).reciboPdf(
        {
          clienteTrackerId: 'c3',
          fecha: '2026-10-26',
          observaciones: ' Gracias ',
          lineas: [
            {
              descripcion: 'App - Horas',
              cantidad: '35.5',
              unidad: 'HORA',
              precioUnitario: '30800',
            },
            {
              descripcion: 'Soporte',
              cantidad: '1',
              unidad: 'MES',
              precioUnitario: '100000.555',
            },
          ],
        },
        EMAIL,
      );
      expect(pdf.tipo).toBe('application/pdf');
      const pedido = f.llamadas.find((l) => l.ruta === '/recibos/pdf')!;
      expect(pedido.opciones.body).toEqual({
        tipo: 'COBRO',
        fecha: '2026-10-26',
        moneda: 'USD', // sin moneda en el pedido: la de facturación del cliente
        contraparte: { nombre: 'Sin CUIT' },
        items: [
          {
            descripcion: 'App - Horas',
            cantidad: '35,5 h',
            importe: '1093400.00',
          },
          { descripcion: 'Soporte', cantidad: '1 mes', importe: '100000.56' },
        ],
        total: '1193400.56',
        observaciones: 'Gracias',
      });
    });

    it('el resumen muestra los recibos hechos por el mes', async () => {
      sinCuit.billingDocument = 'recibo';
      const s = servicio(facturadorFalso());
      await s.registrarRecibo(
        'c3',
        '2026-09',
        '2026-10-02',
        'ARS',
        '1000.00',
        EMAIL,
      );
      const r = await s.resumen('2026-09', EMAIL);
      expect(r.clientes.find((c) => c.id === 'c3')?.recibos).toEqual([
        { fecha: '2026-10-02', moneda: 'ARS', total: '1000.00' },
      ]);
      expect(r.clientes.find((c) => c.id === 'c1')?.recibos).toEqual([]);
    });

    it('a un cliente de factura no se le hace recibo, y una línea incompleta se rechaza', async () => {
      const s = servicio(facturadorFalso());
      await expect(
        s.reciboPdf(
          {
            clienteTrackerId: 'c1',
            lineas: [{ descripcion: 'x', cantidad: '1', precioUnitario: '1' }],
          },
          EMAIL,
        ),
      ).rejects.toThrow('se le emite factura');
      sinCuit.billingDocument = 'recibo';
      await expect(
        s.reciboPdf(
          {
            clienteTrackerId: 'c3',
            lineas: [{ descripcion: '', cantidad: '1', precioUnitario: '1' }],
          },
          EMAIL,
        ),
      ).rejects.toThrow('descripción, cantidad y precio');
    });
  });

  it('sin TC fijado y sin poder consultar el del día no calcula (no usa 1 como cotización)', async () => {
    const s = servicio(facturadorFalso(), { rate: 1, locked: false });
    await expect(s.resumen('2026-09', EMAIL)).rejects.toThrow(/tipo de cambio/);
  });
});
