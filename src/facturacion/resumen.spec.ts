import type { CondicionCobro } from '../projects/condiciones';
import {
  armarResumen,
  condicionIvaDeTexto,
  cuitValido,
  datosCliente,
  type ClienteTracker,
  type ProyectoTracker,
  type RegistroFacturable,
} from './resumen';

const cliente = (o: Partial<ClienteTracker> = {}): ClienteTracker => ({
  id: 'c1',
  name: 'Acme',
  razonSocial: 'Acme SA',
  cuit: '30-66834690-8',
  ivaCondition: 'Responsable Inscripto',
  email: null,
  address: null,
  ...o,
});

const proyecto = (o: Partial<ProyectoTracker> = {}): ProyectoTracker => ({
  id: 'p1',
  name: 'Web',
  active: true,
  clientId: 'c1',
  ...o,
});

let n = 0;
const condicion = (o: Partial<CondicionCobro> = {}): CondicionCobro => ({
  id: `t${++n}`,
  projectId: 'p1',
  clientId: 'c1',
  desde: '2025-01',
  hasta: null,
  currency: 'USD',
  monthlyAmount: null,
  hourlyRate: 40,
  ...o,
});

const hora = (
  date: string,
  billableHours: string,
  o: Partial<RegistroFacturable> = {},
): RegistroFacturable => ({
  date,
  billableHours,
  projectId: 'p1',
  clientId: 'c1',
  ...o,
});

describe('armarResumen', () => {
  it.each([
    ['67.77', '68'],
    ['35.42', '35.5'],
    ['35.5', '35.5'],
    ['8', '8'],
    ['0.1', '0.5'],
  ])(
    'redondea las horas facturables para arriba a la media hora: %s → %s',
    (horas, cantidad) => {
      const r = armarResumen(
        '2026-09',
        [hora('2026-09-02', horas)],
        [proyecto()],
        [condicion()],
        [cliente()],
        1000,
      );
      expect(r.lineas[0].cantidad).toBe(cantidad);
    },
  );

  it('el ruido de sumar decimales no suma media hora', () => {
    const r = armarResumen(
      '2026-09',
      [
        hora('2026-09-02', '0.1'),
        hora('2026-09-03', '0.2'),
        hora('2026-09-04', '0.2'),
      ],
      [proyecto()],
      [condicion()],
      [cliente()],
      1000,
    );
    expect(r.lineas[0].cantidad).toBe('0.5');
  });

  it('por hora: suma las horas facturables del mes × tarifa de la condición, pasada a pesos', () => {
    const r = armarResumen(
      '2026-09',
      [
        hora('2026-09-02', '1.466667'),
        hora('2026-09-20', '2.5'),
        hora('2026-10-01', '9'),
      ],
      [proyecto()],
      [condicion()],
      [cliente()],
      1250.5,
    );
    expect(r.lineas).toEqual([
      expect.objectContaining({
        referencia: 'tracker:c1:p1:2026-09',
        descripcion: 'Web - Horas Septiembre 2026',
        cantidad: '4', // 3.97 h facturables, redondeadas para arriba
        unidad: 'HORA',
        precioUnitario: '50020',
        moneda: 'ARS',
        importe: '200080.00',
        original: { moneda: 'USD', precioUnitario: '40', importe: '160.00' },
        periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
        problema: null,
      }),
    ]);
  });

  it('el precio en pesos se redondea a centavos antes de multiplicar por la cantidad', () => {
    const r = armarResumen(
      '2026-09',
      [hora('2026-09-02', '3')],
      [proyecto()],
      [condicion({ hourlyRate: 20 })],
      [cliente()],
      1234.5678,
    );
    expect(r.lineas[0]).toMatchObject({
      precioUnitario: '24691.36',
      importe: '74074.08',
    });
  });

  it('suscripción: un abono aunque no haya horas; proyecto inactivo, nada', () => {
    const r = armarResumen(
      '2026-02',
      [],
      [
        proyecto({ id: 'm1', name: 'Soporte' }),
        proyecto({ id: 'm2', active: false }),
      ],
      [
        condicion({
          projectId: 'm1',
          currency: 'ARS',
          monthlyAmount: 500000,
          hourlyRate: null,
        }),
        condicion({ projectId: 'm2', monthlyAmount: 100, hourlyRate: null }),
      ],
      [cliente()],
      1000,
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({
      referencia: 'tracker:c1:m1:2026-02',
      descripcion: 'Soporte - Abono Febrero 2026',
      cantidad: '1',
      unidad: 'MES',
      moneda: 'ARS',
      importe: '500000.00',
      original: null,
      periodo: { desde: '2026-02-01', hasta: '2026-02-28' },
    });
  });

  it('suscripción y horas en la misma condición: dos líneas, la de horas con sufijo', () => {
    const r = armarResumen(
      '2026-09',
      [hora('2026-09-02', '5')],
      [proyecto()],
      [
        condicion({
          currency: 'ARS',
          monthlyAmount: 25000,
          hourlyRate: 10000,
        }),
      ],
      [cliente()],
      1000,
    );
    expect(r.lineas.map((l) => [l.referencia, l.unidad, l.importe])).toEqual([
      ['tracker:c1:p1:2026-09', 'MES', '25000.00'],
      ['tracker:c1:p1:2026-09:horas', 'HORA', '50000.00'],
    ]);
  });

  it('solo cuentan las condiciones vigentes en el mes', () => {
    const condiciones = [
      condicion({ desde: '2026-01', hasta: '2026-08', hourlyRate: 20 }),
      condicion({ desde: '2026-09', hourlyRate: 30 }),
    ];
    const horas = [hora('2026-08-10', '2'), hora('2026-09-10', '2')];
    const precio = (mes: string) =>
      armarResumen(mes, horas, [proyecto()], condiciones, [cliente()], 1)
        .lineas[0].original?.precioUnitario;
    expect(precio('2026-08')).toBe('20');
    expect(precio('2026-09')).toBe('30');
    expect(
      armarResumen(
        '2025-12',
        [hora('2025-12-01', '2')],
        [proyecto()],
        condiciones,
        [cliente()],
        1,
      ).lineas,
    ).toEqual([]);
  });

  it('proyecto propio: cada cliente paga su suscripción y las horas marcadas para él', () => {
    const vialto = proyecto({ id: 'v', name: 'Vialto', clientId: null });
    const r = armarResumen(
      '2026-11',
      [
        hora('2026-11-03', '4', { projectId: 'v', clientId: 'riedel' }),
        hora('2026-11-04', '9', { projectId: 'v', clientId: null }), // interna
      ],
      [vialto],
      [
        condicion({
          projectId: 'v',
          clientId: 'lsf',
          currency: 'ARS',
          monthlyAmount: 50000,
          hourlyRate: null,
        }),
        condicion({
          projectId: 'v',
          clientId: 'riedel',
          currency: 'ARS',
          monthlyAmount: 25000,
          hourlyRate: 8000,
        }),
      ],
      [
        cliente({ id: 'lsf', name: 'LSF', razonSocial: 'LSF Cargas SAS' }),
        cliente({ id: 'riedel', name: 'Riedel', razonSocial: 'Riedel SRL' }),
      ],
      1,
    );
    expect(r.lineas.map((l) => [l.clienteId, l.unidad, l.importe])).toEqual([
      ['lsf', 'MES', '50000.00'],
      ['riedel', 'MES', '25000.00'],
      ['riedel', 'HORA', '32000.00'],
    ]);
    expect(r.advertencias).toEqual([]);
  });

  it('horas de un proyecto propio marcadas para un cliente sin tarifa: advertencia, no se cobran', () => {
    const r = armarResumen(
      '2026-11',
      [hora('2026-11-03', '4', { projectId: 'v', clientId: 'lsf' })],
      [proyecto({ id: 'v', name: 'Vialto', clientId: null })],
      [
        condicion({
          projectId: 'v',
          clientId: 'lsf',
          currency: 'ARS',
          monthlyAmount: 50000,
          hourlyRate: null,
        }),
      ],
      [cliente({ id: 'lsf', name: 'LSF' })],
      1,
    );
    expect(r.lineas.map((l) => l.unidad)).toEqual(['MES']);
    expect(r.advertencias[0]).toMatch(/Vialto \(LSF\)/);
  });

  it('las horas de un dueño sin tarifa por hora no generan línea ni advertencia', () => {
    const r = armarResumen(
      '2026-09',
      [hora('2026-09-02', '3')],
      [proyecto()],
      [condicion({ currency: 'ARS', monthlyAmount: 25000, hourlyRate: null })],
      [cliente()],
      1,
    );
    expect(r.lineas.map((l) => l.unidad)).toEqual(['MES']);
    expect(r.advertencias).toEqual([]);
  });

  it('devuelve los clientes con algo para facturar o con un proyecto activo, aunque no tengan horas', () => {
    const r = armarResumen(
      '2026-09',
      [hora('2026-09-02', '2')],
      [
        proyecto(),
        proyecto({ id: 'p2', clientId: 'c2' }),
        proyecto({ id: 'p3', clientId: 'c3', active: false }),
        proyecto({ id: 'p4', clientId: null }),
      ],
      [condicion(), condicion({ projectId: 'p4', clientId: 'c5' })],
      [
        cliente(),
        cliente({ id: 'c2', name: 'Otro', razonSocial: 'Otro SA' }),
        cliente({ id: 'c3', name: 'Viejo', razonSocial: 'Viejo SA' }),
        cliente({
          id: 'c4',
          name: 'Sin proyectos',
          razonSocial: 'Sin proyectos SA',
        }),
        cliente({ id: 'c5', name: 'Suscripto', razonSocial: 'Suscripto SA' }),
      ],
      1000,
    );
    expect(r.clientes.map((c) => c.id)).toEqual(['c1', 'c2', 'c5']);
    expect(r.lineas.map((l) => l.clienteId)).toEqual(['c1']);
  });
});

describe('datosCliente', () => {
  it('normaliza CUIT y condición; razón social "-" usa el nombre', () => {
    expect(
      datosCliente(
        cliente({ razonSocial: '-', ivaCondition: 'Monotributista' }),
      ),
    ).toMatchObject({
      razonSocial: 'Acme',
      cuit: '30668346908',
      condicionIva: 'MONOTRIBUTO',
    });
  });

  it('el domicilio va completo (calle, ciudad, provincia) y sin los "-" de relleno', () => {
    expect(
      datosCliente(
        cliente({
          address: 'Tucuman 1031',
          city: 'Rosario',
          province: 'Santa Fe',
        }),
      ).domicilio,
    ).toBe('Tucuman 1031, Rosario, Santa Fe');
    expect(
      datosCliente(
        cliente({ address: 'Tucuman 1031', city: '-', province: ' ' }),
      ).domicilio,
    ).toBe('Tucuman 1031');
    expect(
      datosCliente(cliente({ address: '-', city: '-', province: '-' }))
        .domicilio,
    ).toBeNull();
  });
});

describe('conceptos fijos', () => {
  const hosting = {
    descripcion: 'Hosting',
    cantidad: '1',
    unidad: 'MES',
    precioUnitario: '50000',
  };

  it('un cliente sin proyectos activos pero con conceptos aparece en el resumen', () => {
    const r = armarResumen(
      '2026-09',
      [],
      [proyecto({ active: false })],
      [],
      [
        cliente(),
        cliente({ id: 'c2', name: 'Beta', billingConcepts: [hosting] }),
      ],
      1000,
    );
    expect(r.clientes.map((c) => [c.id, c.conceptos])).toEqual([
      ['c2', [hosting]],
    ]);
  });

  it('se descartan los conceptos mal formados', () => {
    const malos = [
      { ...hosting, descripcion: ' ' },
      { ...hosting, cantidad: '0' },
      { ...hosting, unidad: 'OTRA' },
      'x',
      null,
    ];
    expect(
      datosCliente(cliente({ billingConcepts: [hosting, ...malos] })).conceptos,
    ).toEqual([hosting]);
  });
});

describe('condicionIvaDeTexto y cuitValido', () => {
  it.each([
    ['Responsable Inscripto', 'RESPONSABLE_INSCRIPTO'],
    ['RI', 'RESPONSABLE_INSCRIPTO'],
    ['Exento', 'EXENTO'],
    ['Consumidor final', 'CONSUMIDOR_FINAL'],
    ['', null],
    ['algo raro', null],
  ])('%s → %s', (texto, esperado) => {
    expect(condicionIvaDeTexto(texto)).toBe(esperado);
  });

  it('valida el dígito verificador', () => {
    expect(cuitValido('30668346908')).toBe(true);
    expect(cuitValido('30668346907')).toBe(false);
    expect(cuitValido('123')).toBe(false);
  });
});
