import { escapeHtml, LOGO_URL } from '../common/email-template.util';
import type { CollaboratorReceiptAcknowledgementEntity } from '../database/entities';
import {
  RECEIPT_ACK_BUTTON_COLOR,
  RECEIPT_ACK_BUTTON_EDGE_COLOR,
  RECEIPT_ACK_BUTTON_LABEL,
} from './collaborator-receipt-email.template';

function buildPage(content: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Recibo de pago - CapassoTech</title>
</head>
<body style="margin:0; padding:32px 16px; background-color:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <main style="max-width:480px; margin:0 auto; padding:32px; box-sizing:border-box; background-color:#ffffff; border:1px solid #e5e7eb; border-radius:12px; text-align:center;">
    <img src="${LOGO_URL}" alt="CapassoTech" height="40" style="height:40px; width:auto; margin-bottom:24px;" />
    ${content}
  </main>
</body>
</html>`;
}

function buildReceiptSummary(record: CollaboratorReceiptAcknowledgementEntity): string {
  return `<div style="margin:0 0 24px; padding:16px; background-color:#f3f9fd; border-radius:12px;">
      <p style="margin:0 0 4px; font-size:14px; color:#6b7280;">${escapeHtml(record.monthYear)}</p>
      <p style="margin:0; font-size:26px; font-weight:700; color:#111827;">${escapeHtml(`${record.total} ${record.currency ?? ''}`.trim())}</p>
    </div>`;
}

// El GET solo muestra este paso y la confirmación la hace el POST: los filtros
// antispam abren los links de los emails, y un GET que confirmara marcaría pagos
// como recibidos sin que nadie los haya tocado.
export function buildConfirmPage(record: CollaboratorReceiptAcknowledgementEntity): string {
  const firstName = record.fullName.split(/\s+/)[0];
  return buildPage(`
    <h1 style="margin:0 0 8px; font-size:22px; color:#111827;">¡Hola, ${escapeHtml(firstName)}!</h1>
    <p style="margin:0 0 24px; font-size:15px; line-height:22px; color:#6b7280;">Confirmá que ya recibiste el dinero de este recibo.</p>
    ${buildReceiptSummary(record)}
    <form method="post" style="margin:0;">
      <button type="submit" style="padding:16px 32px; border:0; border-bottom:4px solid ${RECEIPT_ACK_BUTTON_EDGE_COLOR}; border-radius:10px; box-shadow:0 4px 10px rgba(21,128,61,0.35); background-color:${RECEIPT_ACK_BUTTON_COLOR}; color:#ffffff; font-size:18px; font-weight:700; cursor:pointer;">${RECEIPT_ACK_BUTTON_LABEL}</button>
    </form>`);
}

export function buildAcknowledgedPage(record: CollaboratorReceiptAcknowledgementEntity): string {
  const date = record.acknowledgedAt?.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  return buildPage(`
    <div style="width:64px; height:64px; margin:0 auto 16px; border-radius:50%; background-color:${RECEIPT_ACK_BUTTON_COLOR}; color:#ffffff; font-size:34px; line-height:64px;">&#10003;</div>
    <h1 style="margin:0 0 8px; font-size:22px; color:#111827;">¡Gracias! Ya quedó registrado</h1>
    <p style="margin:0 0 24px; font-size:15px; line-height:22px; color:#6b7280;">Confirmaste que recibiste el dinero${date ? ` el ${escapeHtml(date)}` : ''}. Ya podés cerrar esta página.</p>
    ${buildReceiptSummary(record)}`);
}

export function buildNotFoundPage(): string {
  return buildPage(`
    <h1 style="margin:0 0 8px; font-size:22px; color:#111827;">No encontramos este recibo</h1>
    <p style="margin:0; font-size:15px; line-height:22px; color:#6b7280;">Revisá el link o escribinos a contacto@capasso.tech.</p>`);
}
