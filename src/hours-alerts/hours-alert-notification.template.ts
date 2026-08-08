import { buildEmailRowsTable, buildEmailShell } from '../common/email-template.util';

export function buildHighHoursAlertHtml(rows: [string, string][]): string {
  return buildEmailShell({
    eyebrow: 'Horas',
    title: 'Horas facturables muy altas',
    intro: 'El avance de horas de este cliente superó el umbral de alerta este mes:',
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${buildEmailRowsTable(rows)}</table>`,
  });
}
