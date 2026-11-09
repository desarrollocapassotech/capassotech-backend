// Cálculo de fechas de cumpleaños sobre strings yyyy-MM-dd, sin horas: así no
// importa en qué zona horaria corre el server (Render corre en UTC).

export const REMINDER_DAYS_BEFORE = [3, 2, 1, 0] as const;

export function todayInArgentina(now: Date = new Date()): string {
  // en-CA formatea como yyyy-MM-dd.
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const toUtc = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const pad = (value: number) => String(value).padStart(2, '0');

// Fecha del cumpleaños en un año dado. Los nacidos el 29/2 lo festejan el 28/2
// en los años no bisiestos.
function birthdayInYear(birthDate: string, year: number): string {
  const [, month, day] = birthDate.split('-').map(Number);
  const adjustedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${pad(month)}-${pad(adjustedDay)}`;
}

// Próximo cumpleaños a partir de hoy (incluido hoy) y cuántos días faltan.
export function nextBirthday(birthDate: string, today: string): { birthday: string; daysUntil: number; age: number } {
  const year = Number(today.slice(0, 4));
  let birthday = birthdayInYear(birthDate, year);
  if (toUtc(birthday) < toUtc(today)) {
    birthday = birthdayInYear(birthDate, year + 1);
  }
  const daysUntil = Math.round((toUtc(birthday) - toUtc(today)) / 86_400_000);
  const age = Number(birthday.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return { birthday, daysUntil, age };
}
