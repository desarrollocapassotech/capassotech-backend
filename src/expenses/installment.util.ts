// Suma 1 mes calendario a una fecha "YYYY-MM-DD", igual criterio que usa
// cualquier billing mensual: si el día no existe en el mes destino (ej. 31 de
// enero + 1 mes), se ajusta al último día de ese mes en vez de desbordar a marzo.
export function addMonthsToDateString(dateStr: string, monthsToAdd: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const totalMonths = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  const mm = String(targetMonthIndex + 1).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

// Reparte un monto total entre N cuotas sin perder centavos por redondeo: cada
// cuota es el monto base (piso a 2 decimales), y los centavos sobrantes se
// reparten de a uno entre las primeras cuotas.
export function splitAmountIntoInstallments(totalAmount: number, installmentsCount: number): number[] {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / installmentsCount);
  const remainderCents = totalCents - baseCents * installmentsCount;

  return Array.from({ length: installmentsCount }, (_, index) => {
    const cents = baseCents + (index < remainderCents ? 1 : 0);
    return cents / 100;
  });
}
