import { buildEmailRowsTable, buildEmailShell } from '../common/email-template.util';

// Mismo diseño que se puede previsualizar pegando el HTML de ejemplo en el editor
// de templates de Resend (ver skeleton compartido en common/email-template.util.ts).
export function buildExpenseNotificationHtml(action: 'creado' | 'actualizado', rows: [string, string][]): string {
  return buildEmailShell({
    eyebrow: 'Gastos',
    title: `Gasto ${action}`,
    intro: 'Detalle del gasto:',
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${buildEmailRowsTable(rows)}</table>`,
  });
}
