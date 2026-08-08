const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// URL pública y estable (Firebase Storage, mismo bucket que las fotos de perfil).
// Gmail y la mayoría de los webmail bloquean imágenes data: URI inline en emails
// recibidos (medida antispam), así que el logo tiene que ser una URL real en vez de
// ir embebido en base64.
const LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/capassotech-timetracker.firebasestorage.app/o/public%2Fexpense-notification-logo.png?alt=media&token=55fa7d1c-440a-44d5-8e21-7ee4fed23250';

export function buildEmailRowsTable(rows: [string, string][]): string {
  return rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 0; font-size:13px; color:#6b7280; width:150px; vertical-align:top; border-bottom:1px solid #f3f4f6;">${escapeHtml(label)}</td>
        <td style="padding:10px 0; font-size:14px; color:#111827; font-weight:500; vertical-align:top; border-bottom:1px solid #f3f4f6;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');
}

// Shell común (header con logo + footer) para todos los emails automáticos de
// TimeTracker. `eyebrow` es el label chico en mayúsculas a la derecha del logo
// (ej. "Gastos", "Horas"), `title`/`intro` son el h1 y el párrafo de debajo, y
// `bodyHtml` es el contenido específico de cada notificación (normalmente una
// tabla armada con buildEmailRowsTable).
export function buildEmailShell(options: { eyebrow: string; title: string; intro: string; bodyHtml: string }): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f5f7; padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
    <tr>
      <td style="background-color:#ffffff; padding:20px 32px; border-bottom:1px solid #e5e7eb;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              <img src="${LOGO_URL}" alt="CapassoTech" height="40" style="display:block; height:40px; width:auto;" />
            </td>
            <td style="vertical-align:middle; text-align:right;">
              <span style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af;">TimeTracker &middot; ${escapeHtml(options.eyebrow)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h1 style="margin:0 0 8px; font-size:20px; color:#111827;">${escapeHtml(options.title)}</h1>
        <p style="margin:0 0 24px; font-size:14px; color:#6b7280;">${escapeHtml(options.intro)}</p>
        ${options.bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 32px; background-color:#f9fafb; border-top:1px solid #e5e7eb;">
        <p style="margin:0; font-size:12px; color:#9ca3af;">Email automático de TimeTracker. No respondas a este mensaje.</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();
}
