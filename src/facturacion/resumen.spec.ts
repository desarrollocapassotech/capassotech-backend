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
  it('por hora: suma las horas facturables del mes × tarifa del proyecto', () => {
    const r = armarResumen(
      '2026-09',
      [
        { date: '2026-09-02', billableHours: '1.466667', projectId: 'p1' },
        { date: '2026-09-20', billableHours: '2.5', projectId: 'p1' },
        { date: '2026-10-01', billableHours: '9', projectId: 'p1' },
      ],
      [proyecto()],
      [cliente()],
    );
    expect(r.lineas).toEqual([
      expect.objectContaining({
        referencia: 'tracker:c1:p1:2026-09',
        descripcion: 'Web - Horas Septiembre 2026',
        cantidad: '3.97',
        unidad: 'HORA',
        precioUnitario: '40',
        moneda: 'USD',
        importe: '158.80',
        periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
        problema: null,
      }),
    ]);
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
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({
      descripcion: 'Soporte - Abono Febrero 2026',
      cantidad: '1',
      unidad: 'MES',
      moneda: 'ARS',
      importe: '500000.00',
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
