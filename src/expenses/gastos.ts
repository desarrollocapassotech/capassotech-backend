import { ExpensePeriodicity } from '../database/entities';
import { splitAmountIntoInstallments } from './installment.util';

/**
 * Si un gasto se paga en el mes (yyyy-MM). Espejo de `gastoDelMes` del frontend
 * (capassotech-timetracker-frontend/src/lib/gastos.ts), la misma regla que la pantalla Gastos:
 * - Mensual: todos los meses desde su fecha de inicio (sin fecha, todos).
 * - Único: solo el mes de su fecha.
 * - Anual: una vez por año, en el mes de su fecha, desde el año en que empieza.
 */
export function gastoDelMes(
  expense: { periodicity: ExpensePeriodicity; expenseDate: string | null },
  mes: string,
): boolean {
  const [year, month] = mes.split('-').map(Number);
  const [anio, mesGasto] = (expense.expenseDate ?? '').split('-').map(Number);
  const conFecha = Number.isFinite(anio) && Number.isFinite(mesGasto) && anio > 0;
  if (expense.periodicity === ExpensePeriodicity.MENSUAL) {
    return !conFecha || anio * 100 + mesGasto <= year * 100 + month;
  }
  if (!conFecha) return false;
  if (expense.periodicity === ExpensePeriodicity.ANUAL) return mesGasto === month && anio <= year;
  return anio === year && mesGasto === month;
}

/**
 * Lo que le toca a cada cliente que paga un gasto: partes iguales, sin perder centavos (los que
 * sobran van a los primeros, en el orden de los ids). Espejo de `parteDelGasto` del frontend.
 */
export function partesDelGasto(importe: number, clientIds: string[]): Map<string, number> {
  const ids = [...new Set(clientIds)].sort();
  if (ids.length === 0) return new Map();
  const partes = splitAmountIntoInstallments(importe, ids.length);
  return new Map(ids.map((id, i) => [id, partes[i]]));
}
