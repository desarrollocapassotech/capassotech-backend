import { buildEmailRowsTable, buildEmailShell } from '../common/email-template.util';

export function birthdayReminderSubject(name: string, daysUntil: number): string {
  if (daysUntil === 0) return `Hoy cumple años ${name}`;
  if (daysUntil === 1) return `Mañana cumple años ${name}`;
  return `En ${daysUntil} días cumple años ${name}`;
}

export function buildBirthdayReminderHtml(name: string, daysUntil: number, rows: [string, string][]): string {
  const intro =
    daysUntil === 0
      ? `Hoy es el cumpleaños de ${name}.`
      : `Faltan ${daysUntil} ${daysUntil === 1 ? 'día' : 'días'} para el cumpleaños de ${name}.`;
  return buildEmailShell({
    eyebrow: 'Cumpleaños',
    title: birthdayReminderSubject(name, daysUntil),
    intro,
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${buildEmailRowsTable(rows)}</table>`,
  });
}
