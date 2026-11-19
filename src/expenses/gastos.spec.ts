import { ExpensePeriodicity } from '../database/entities';
import { gastoDelMes, partesDelGasto } from './gastos';

describe('gastoDelMes', () => {
  it('mensual: desde su fecha en adelante', () => {
    const gasto = { periodicity: ExpensePeriodicity.MENSUAL, expenseDate: '2026-03-15' };
    expect(gastoDelMes(gasto, '2026-02')).toBe(false);
    expect(gastoDelMes(gasto, '2026-03')).toBe(true);
    expect(gastoDelMes(gasto, '2027-01')).toBe(true);
  });

  it('único: solo su mes; anual: su mes de cada año desde que empieza', () => {
    expect(gastoDelMes({ periodicity: ExpensePeriodicity.UNICO, expenseDate: '2026-03-01' }, '2026-03')).toBe(true);
    expect(gastoDelMes({ periodicity: ExpensePeriodicity.UNICO, expenseDate: '2026-03-01' }, '2026-04')).toBe(false);
    const anual = { periodicity: ExpensePeriodicity.ANUAL, expenseDate: '2026-03-01' };
    expect(gastoDelMes(anual, '2027-03')).toBe(true);
    expect(gastoDelMes(anual, '2027-04')).toBe(false);
    expect(gastoDelMes(anual, '2025-03')).toBe(false);
  });
});

describe('partesDelGasto', () => {
  it('reparte en partes iguales sin perder centavos', () => {
    const partes = partesDelGasto(100, ['c', 'a', 'b']);
    expect([...partes.entries()]).toEqual([
      ['a', 33.34],
      ['b', 33.33],
      ['c', 33.33],
    ]);
  });

  it('sin clientes, nada', () => {
    expect(partesDelGasto(100, []).size).toBe(0);
  });
});
