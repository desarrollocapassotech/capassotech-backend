import { buildEmailShell, escapeHtml } from '../common/email-template.util';
import type {
  CollaboratorReceiptHoursSummaryDto,
  GenerateCollaboratorReceiptDto,
  GenerateCollaboratorReceiptItemDto,
} from './collaborator-receipt.dto';

export const RECEIPT_CONTACT_EMAIL = 'contacto@capasso.tech';
export const RECEIPT_ACK_BUTTON_LABEL = '&#10003; Ya recibí el dinero';
// Verde a propósito: es la única acción del email y tiene que resaltar sobre los
// tonos carbón y celeste del resto del diseño.
export const RECEIPT_ACK_BUTTON_COLOR = '#15803d';

// Colores de marca del frontend (ver tailwind.config.ts: carbon, marca.suave, marca.oscuro).
const COLOR_CARBON = '#1a1a1a';
const COLOR_MARCA_SUAVE = '#a5dcf5';
const COLOR_MARCA_OSCURO = '#1f87bd';

const LABEL_STYLE =
  'font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#6b7280;';
const SECTION_TITLE_STYLE = `margin:0 0 4px; ${LABEL_STYLE}`;

function buildTotalCard(receipt: GenerateCollaboratorReceiptDto): string {
  const currency = receipt.currency?.trim();
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td style="background-color:${COLOR_CARBON}; border-radius:12px; padding:24px;">
          <p style="margin:0 0 6px; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${COLOR_MARCA_SUAVE};">Total del recibo</p>
          <p style="margin:0; font-size:32px; line-height:38px; font-weight:700; color:#ffffff;">${escapeHtml(receipt.total)}${
            currency ? ` <span style="font-size:15px; font-weight:600; color:#d1d5db;">${escapeHtml(currency)}</span>` : ''
          }</p>
          <p style="margin:6px 0 0; font-size:13px; color:#d1d5db;">${escapeHtml(receipt.monthYear)}</p>
        </td>
      </tr>
    </table>`;
}

function buildStatCard(label: string, value: string, detail?: string): string {
  return `
          <p style="margin:0 0 8px; ${LABEL_STYLE}">${escapeHtml(label)}</p>
          <p style="margin:0; font-size:18px; line-height:24px; font-weight:700; color:#111827; word-break:break-word;">${escapeHtml(value)}</p>
          ${detail ? `<p style="margin:4px 0 0; font-size:13px; color:${COLOR_MARCA_OSCURO}; font-weight:600;">${escapeHtml(detail)}</p>` : ''}`;
}

function buildAcknowledgeButton(acknowledgeUrl: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td align="center" bgcolor="${RECEIPT_ACK_BUTTON_COLOR}" style="background-color:${RECEIPT_ACK_BUTTON_COLOR}; border-radius:12px;">
          <a href="${escapeHtml(acknowledgeUrl)}" target="_blank" style="display:block; padding:20px 16px; font-size:19px; line-height:24px; font-weight:700; color:#ffffff; text-decoration:none;">${RECEIPT_ACK_BUTTON_LABEL}</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px; font-size:13px; line-height:20px; color:#6b7280; text-align:center;">Cuando te llegue el pago, tocá el botón para avisarnos.</p>`;
}

// Sin horas cargadas en el mes no se muestra el bloque: un "0 hs" sería engañoso
// en un recibo con conceptos cargados a mano.
function buildHoursCards(summary?: CollaboratorReceiptHoursSummaryDto): string {
  if (!summary) return '';
  const cellStyle = 'width:48%; background-color:#f3f9fd; border-radius:12px; padding:16px; vertical-align:top;';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="${cellStyle}">${buildStatCard('Horas trabajadas', summary.totalHours)}</td>
        <td style="width:4%; font-size:0; line-height:0;">&nbsp;</td>
        <td style="${cellStyle}">${buildStatCard('Proyecto principal', summary.topProjectName, summary.topProjectHours)}</td>
      </tr>
    </table>`;
}

function buildItemRow(item: GenerateCollaboratorReceiptItemDto): string {
  return `
      <tr>
        <td style="padding:12px 12px 12px 0; border-bottom:1px solid #f3f4f6; vertical-align:top;">
          <p style="margin:0; font-size:14px; line-height:20px; color:#111827;">${escapeHtml(item.description)}</p>
          ${item.quantity?.trim() ? `<p style="margin:2px 0 0; font-size:12px; color:#6b7280;">${escapeHtml(item.quantity)}</p>` : ''}
        </td>
        <td style="padding:12px 0; border-bottom:1px solid #f3f4f6; vertical-align:top; text-align:right; white-space:nowrap; font-size:14px; font-weight:600; color:#111827;">${escapeHtml(item.amount ?? '')}</td>
      </tr>`;
}

function buildDetails(receipt: GenerateCollaboratorReceiptDto): string {
  return `
    <p style="${SECTION_TITLE_STYLE}">Detalle</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:28px;">${receipt.items
      .map(buildItemRow)
      .join('')}
    </table>`;
}

function buildPaymentInfo(receipt: GenerateCollaboratorReceiptDto): string {
  const paymentMethod = receipt.paymentMethod?.trim();
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="vertical-align:top; padding-right:12px; ${paymentMethod ? 'width:35%;' : ''}">
          <p style="${SECTION_TITLE_STYLE}">Fecha</p>
          <p style="margin:0; font-size:14px; color:#111827;">${escapeHtml(receipt.date)}</p>
        </td>${
          paymentMethod
            ? `
        <td style="vertical-align:top;">
          <p style="${SECTION_TITLE_STYLE}">Método de pago</p>
          <p style="margin:0; font-size:14px; color:#111827; word-break:break-word;">${escapeHtml(paymentMethod)}</p>
        </td>`
            : ''
        }
      </tr>
    </table>`;
}

function buildClosing(): string {
  return `
    <p style="margin:0 0 8px; font-size:14px; line-height:22px; color:#374151;">¡Gracias por tu trabajo de este mes!</p>
    <p style="margin:0; font-size:13px; line-height:20px; color:#6b7280;">Si algo no te cierra, escribinos a <a href="mailto:${RECEIPT_CONTACT_EMAIL}" style="color:${COLOR_MARCA_OSCURO}; text-decoration:none; font-weight:600;">${RECEIPT_CONTACT_EMAIL}</a>.</p>`;
}

export function buildCollaboratorReceiptEmailHtml(
  receipt: GenerateCollaboratorReceiptDto,
  acknowledgeUrl: string,
  hoursSummary?: CollaboratorReceiptHoursSummaryDto,
): string {
  const firstName = receipt.fullName.trim().split(/\s+/)[0];
  return buildEmailShell({
    eyebrow: 'Recibos',
    title: `¡Hola, ${firstName}! 👋`,
    intro: `Ya está listo tu recibo de ${receipt.monthYear}. Te lo dejamos adjunto en PDF y acá tenés el resumen.`,
    bodyHtml: [
      buildTotalCard(receipt),
      buildAcknowledgeButton(acknowledgeUrl),
      buildHoursCards(hoursSummary),
      buildDetails(receipt),
      buildPaymentInfo(receipt),
      buildClosing(),
    ].join(''),
  });
}
