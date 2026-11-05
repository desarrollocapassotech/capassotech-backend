import {
  mesDeTexto,
  montoDeTexto,
  unificarRecibos,
  type CargoColaborador,
  type ReciboEnviado,
} from './unificar-recibos';

const recibo = (extra: Partial<ReciboEnviado>): ReciboEnviado => ({
  id: 'r1',
  collaboratorId: 'c1',
  monthYear: 'Octubre 2026',
  total: '$87.360',
  currency: 'ARS',
  fecha: '2026-11-05',
  destinatario: 'a@b.com',
  ...extra,
});

const cargo = (extra: Partial<CargoColaborador>): CargoColaborador => ({
  id: 'k1',
  collaboratorId: 'c1',
  month: '2026-10',
  currency: 'USD',
  importe: 56,
  imputado: 0,
  ...extra,
});

const tc = new Map([['2026-10', 1560]]);

describe('textos del recibo', () => {
  it('lee el mes', () => {
    expect(mesDeTexto('Octubre 2026')).toBe('2026-10');
    expect(mesDeTexto('marzo 2025')).toBe('2025-03');
    expect(mesDeTexto('cualquier cosa')).toBeNull();
  });
  it('lee el monto en formato argentino', () => {
    expect(montoDeTexto('$1.479.660')).toBe(1479660);
    expect(montoDeTexto('$311,25')).toBe(311.25);
    expect(montoDeTexto('$ 5,50')).toBe(5.5);
    expect(montoDeTexto('$')).toBeNull();
  });
});

describe('unificarRecibos', () => {
  it('recibo en pesos contra cargo en dólares: cancela el cargo al TC del mes', () => {
    const { unificados, omitidos } = unificarRecibos(
      [recibo({})],
      [cargo({})],
      tc,
    );
    expect(omitidos).toEqual([]);
    expect(unificados[0]).toMatchObject({
      cargoId: 'k1',
      moneda: 'ARS',
      total: 87360,
      importeCargo: 56,
      importePago: 87360,
      tipoCambio: 1560,
    });
  });

  it('misma moneda: no usa TC', () => {
    const { unificados } = unificarRecibos(
      [recibo({ total: '$311,25', currency: 'USD' })],
      [cargo({ importe: 311.25 })],
      new Map(),
    );
    expect(unificados[0]).toMatchObject({
      importeCargo: 311.25,
      importePago: 311.25,
      tipoCambio: null,
    });
  });

  it('el mismo recibo reenviado cuenta una sola vez', () => {
    const { unificados, omitidos } = unificarRecibos(
      [
        recibo({ id: 'r1', total: '$5,50', currency: 'USD' }),
        recibo({ id: 'r2', total: '$5,50', currency: 'USD' }),
      ],
      [cargo({ importe: 5.5 })],
      tc,
    );
    expect(unificados.map((u) => u.reciboId)).toEqual(['r1']);
    expect(omitidos).toEqual([
      { reciboId: 'r2', motivo: 'Mismo recibo reenviado' },
    ]);
  });

  it('dos recibos distintos del mes son dos pagos, hasta cancelar', () => {
    const { unificados } = unificarRecibos(
      [
        recibo({ id: 'r1', total: '$30,00', currency: 'USD' }),
        recibo({ id: 'r2', total: '$26,00', currency: 'USD' }),
      ],
      [cargo({})],
      tc,
    );
    expect(unificados.map((u) => u.importeCargo)).toEqual([30, 26]);
  });

  it('no toca un cargo ya cancelado desde la cuenta', () => {
    const { unificados, omitidos } = unificarRecibos(
      [recibo({})],
      [cargo({ imputado: 56 })],
      tc,
    );
    expect(unificados).toEqual([]);
    expect(omitidos[0].motivo).toBe('El cargo del mes ya está cancelado');
  });

  it('informa lo que no puede unificar', () => {
    expect(unificarRecibos([recibo({})], [], tc).omitidos[0].motivo).toBe(
      'Sin cargo en la cuenta para ese mes',
    );
    expect(
      unificarRecibos([recibo({})], [cargo({})], new Map()).omitidos[0].motivo,
    ).toBe('El mes no tiene TC fijado');
    expect(
      unificarRecibos([recibo({ currency: null })], [cargo({})], tc).omitidos[0]
        .motivo,
    ).toBe('Datos del recibo ilegibles');
  });
});
