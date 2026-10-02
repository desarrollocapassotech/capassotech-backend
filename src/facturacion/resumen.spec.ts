import {
  armarResumen,
  condicionIvaDeTexto,
  cuitValido,
  datosCliente,
  type ClienteTracker,
  type ProyectoTracker,
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
  rate: 40,
  currency: 'USD',
  billingType: 'hourly',
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
        [{ date: '2026-09-02', billableHours: horas, projectId: 'p1' }],
        [proyecto()],
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
        { date: '2026-09-02', billableHours: '0.1', projectId: 'p1' },
        { date: '2026-09-03', billableHours: '0.2', projectId: 'p1' },
        { date: '2026-09-04', billableHours: '0.2', projectId: 'p1' },
      ],
      [proyecto()],
      [cliente()],
      1000,
    );
    expect(r.lineas[0].cantidad).toBe('0.5');
  });

  it('por hora: suma las horas facturables del mes × tarifa del proyecto, pasada a pesos', () => {
    const r = armarResumen(
      '2026-09',
      [
        { date: '2026-09-02', billableHours: '1.466667', projectId: 'p1' },
        { date: '2026-09-20', billableHours: '2.5', projectId: 'p1' },
        { date: '2026-10-01', billableHours: '9', projectId: 'p1' },
      ],
      [proyecto()],
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
      [{ date: '2026-09-02', billableHours: '3', projectId: 'p1' }],
      [proyecto({ rate: 20 })],
      [cliente()],
      1234.5678,
    );
    expect(r.lineas[0]).toMatchObject({
      precioUnitario: '24691.36',
      importe: '74074.08',
    });
  });

  it('mensual activo: un abono aunque no haya horas; inactivo o sin monto, nada', () => {
    const r = armarResumen(
      '2026-02',
      [],
      [
        proyecto({
          id: 'm1',
          name: 'Soporte',
          billingType: 'monthly',
          rate: 500000,
          currency: 'ARS',
        }),
        proyecto({ id: 'm2', billingType: 'monthly', active: false }),
        proyecto({ id: 'm3', billingType: 'monthly', rate: null }),
      ],
      [cliente()],
      1000,
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({
      descripcion: 'Soporte - Abono Febrero 2026',
      cantidad: '1',
      unidad: 'MES',
      moneda: 'ARS',
      importe: '500000.00',
      original: null,
      periodo: { desde: '2026-02-01', hasta: '2026-02-28' },
    });
  });

  it('proyecto por hora sin tarifa: aparece con el problema; sin cliente: advertencia', () => {
    const r = armarResumen(
      '2026-09',
      [
        { date: '2026-09-02', billableHours: '2', projectId: 'p1' },
        { date: '2026-09-02', billableHours: '3', projectId: 'p2' },
      ],
      [
        proyecto({ rate: null }),
        proyecto({ id: 'p2', name: 'Interno', clientId: null }),
      ],
      [cliente()],
      1000,
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({ precioUnitario: null, importe: null });
    expect(r.lineas[0].problema).toMatch(/tarifa/);
    expect(r.advertencias[0]).toMatch(/Interno/);
  });

  it('solo devuelve los clientes que tienen algo para facturar', () => {
    const r = armarResumen(
      '2026-09',
      [{ date: '2026-09-02', billableHours: '2', projectId: 'p1' }],
      [proyecto()],
      [cliente(), cliente({ id: 'c2', name: 'Otro' })],
      1000,
    );
    expect(r.clientes.map((c) => c.id)).toEqual(['c1']);
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
