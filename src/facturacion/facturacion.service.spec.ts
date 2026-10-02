/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
   El Facturador falso trabaja con cuerpos JSON sin tipar. */
import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ClientEntity, ProjectEntity } from '../database/entities';
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

  const pedir = (
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
    if (metodo === 'POST' && ruta === '/items') {
      const cargados = (body.items as Array<Record<string, any>>).map((i) => {
        const previo = items.get(i.referenciaExterna);
        const item = {
          referenciaExterna: i.referenciaExterna,
          estado: previo?.estado ?? 'VALIDO',
          errores: [],
          cantidad: i.cantidad,
          precioUnitario: i.precioUnitario,
          moneda: i.moneda,
          comprobanteId: previo?.comprobanteId ?? null,
        };
        items.set(i.referenciaExterna, item);
        return item;
      });
      return { importacion: { advertencias: [] }, items: cargados };
    }
    if (metodo === 'POST' && ruta === '/comprobantes') {
      return { id: 'manual1', clienteId: body.clienteId };
    }
    if (metodo === 'POST' && ruta === '/comprobantes/borradores') {
      for (const r of body.referencias as string[]) {
        Object.assign(items.get(r)!, {
          estado: 'EN_BORRADOR',
          comprobanteId: 'cmp1',
        });
      }
      return { comprobantes: [{ id: 'cmp1' }] };
    }
    throw new Error(`Ruta no prevista: ${metodo} ${ruta}`);
  };
  return {
    llamadas,
    clientes,
    client: {
      configurado: true,
      pedir: jest.fn((m: string, r: string, o?: OpcionesFacturador) =>
        Promise.resolve().then(() => pedir(m, r, o)),
      ),
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
  } as unknown as Repository<ClientEntity>;
  const tipoDeCambio = {
    getUsdRate: jest.fn().mockResolvedValue(cotizacion),
  } as unknown as ExchangeRateService;
  return new FacturacionService(
    projects,
    clients,
    horas,
    f.client,
    tipoDeCambio,
  );
}

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

  it('facturar: da de alta los clientes (con el padrón si falta la condición), carga los ítems y arma los borradores', async () => {
    const f = facturadorFalso();
    const s = servicio(f);
    const r = await s.facturar(
      {
        mes: '2026-09',
        referencias: ['tracker:c1:p1:2026-09', 'tracker:c2:p2:2026-09'],
        fechaEmision: '2026-10-01',
      },
      EMAIL,
    );
    expect(r.comprobantes).toEqual([{ id: 'cmp1' }]);
    expect(f.clientes.map((c) => (c as any).alta)).toEqual([
      expect.objectContaining({
        razonSocial: 'Acme SA',
        condicionIva: 'RESPONSABLE_INSCRIPTO',
        email: 'pagos@acme.test',
        referenciaExterna: 'c1',
      }),
      // Razón social "-" en el tracker: se usa el nombre; la condición sale del padrón.
      expect.objectContaining({
        razonSocial: 'Beta',
        condicionIva: 'MONOTRIBUTO',
        domicilio: 'Calle 1',
        referenciaExterna: 'c2',
      }),
    ]);
    const carga = f.llamadas.find(
      (l) => l.ruta === '/items' && l.metodo === 'POST',
    )!;
    expect((carga.opciones.body as any).items).toEqual([
      expect.objectContaining({
        referenciaExterna: 'tracker:c1:p1:2026-09',
        cliente: { clienteId: 'fc1' },
        cantidad: '7.5',
        unidad: 'HORA',
        precioUnitario: '40000',
        moneda: 'ARS',
      }),
      expect.objectContaining({
        referenciaExterna: 'tracker:c2:p2:2026-09',
        cliente: { clienteId: 'fc2' },
        cantidad: '1',
        unidad: 'MES',
        precioUnitario: '100000',
        moneda: 'ARS',
      }),
    ]);
    const borradores = f.llamadas.find(
      (l) => l.ruta === '/comprobantes/borradores',
    )!;
    expect(borradores.opciones.body).toEqual({
      referencias: ['tracker:c1:p1:2026-09', 'tracker:c2:p2:2026-09'],
      agrupacion: 'cliente',
      fechaEmision: '2026-10-01',
    });

    // Facturar de nuevo el mismo mes no duplica: los ítems ya están en un borrador.
    const otra = await s.facturar(
      { mes: '2026-09', referencias: ['tracker:c1:p1:2026-09'] },
      EMAIL,
    );
    expect(otra).toMatchObject({
      comprobantes: [],
      omitidos: [
        { referencia: 'tracker:c1:p1:2026-09', estado: 'EN_BORRADOR' },
      ],
    });
    expect(f.clientes).toHaveLength(2);
  });

  it('un cliente sin CUIT no se factura hasta darlo de alta a mano; después queda asociado', async () => {
    const f = facturadorFalso();
    const s = servicio(f);
    await expect(
      s.facturar(
        { mes: '2026-09', referencias: ['tracker:c3:p3:2026-09'] },
        EMAIL,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
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
    const r = await s.facturar(
      { mes: '2026-09', referencias: ['tracker:c3:p3:2026-09'] },
      EMAIL,
    );
    expect(r.comprobantes).toHaveLength(1);
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

  it('no factura líneas que no están en el resumen (los importes nunca vienen del navegador)', async () => {
    const s = servicio(facturadorFalso());
    await expect(
      s.facturar(
        { mes: '2026-09', referencias: ['tracker:c1:inventado:2026-09'] },
        EMAIL,
      ),
    ).rejects.toThrow(/ya no están en el resumen/);
    await expect(
      s.facturar({ mes: '09-2026', referencias: ['x'] }, EMAIL),
    ).rejects.toThrow(/YYYY-MM/);
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
    ).resolves.toEqual({ id: 'manual1', clienteId: 'fc-acme' });
    // Beta todavía no estaba en el Facturador: se da de alta con el padrón y se usa ese id.
    await expect(
      s.crearBorrador({ clienteTrackerId: 'c2', lineas }, EMAIL),
    ).resolves.toEqual({ id: 'manual1', clienteId: 'fc1' });
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

  it('sin TC fijado y sin poder consultar el del día no factura (no usa 1 como cotización)', async () => {
    const s = servicio(facturadorFalso(), { rate: 1, locked: false });
    await expect(s.resumen('2026-09', EMAIL)).rejects.toThrow(/tipo de cambio/);
    await expect(
      s.facturar(
        { mes: '2026-09', referencias: ['tracker:c1:p1:2026-09'] },
        EMAIL,
      ),
    ).rejects.toThrow(/tipo de cambio/);
  });
});
