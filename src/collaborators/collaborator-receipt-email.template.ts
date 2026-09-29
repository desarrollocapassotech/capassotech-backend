import { buildEmailRowsTable, buildEmailShell } from '../common/email-template.util';
import type { GenerateCollaboratorReceiptDto } from './collaborator-receipt.dto';

export function buildCollaboratorReceiptEmailHtml(receipt: GenerateCollaboratorReceiptDto): string {
  const rows: [string, string][] = [
    ['Colaborador', receipt.fullName],
    ['Período', receipt.monthYear],
    ['Fecha', receipt.date],
  ];
  if (receipt.paymentMethod?.trim()) {
    rows.push(['Método de pago', receipt.paymentMethod.trim()]);
  }
  rows.push(['Total', `${receipt.total} ${receipt.currency ?? ''}`.trim()]);
  return buildEmailShell({
    eyebrow: 'Recibos',
    title: `Recibo de pago - ${receipt.monthYear}`,
    intro: 'Adjuntamos el recibo de pago en PDF. Resumen:',
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${buildEmailRowsTable(rows)}</table>`,
  });
}
