const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// URL pública y estable (Firebase Storage, mismo bucket que las fotos de perfil).
// Gmail y la mayoría de los webmail bloquean imágenes data: URI inline en emails
// recibidos (medida antispam), así que el logo tiene que ser una URL real en vez de
// ir embebido en base64.
const LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/capassotech-timetracker.firebasestorage.app/o/public%2Fexpense-notification-logo.png?alt=media&token=55fa7d1c-440a-44d5-8e21-7ee4fed23250';

// Tabla HTML con estilos inline (nada de <style> ni clases: los clientes de correo
// ignoran/recortan hojas de estilo externas). Mismo diseño que se puede previsualizar
// pegando el HTML de ejemplo en el editor de templates de Resend.
export function buildExpenseNotificationHtml(action: 'creado' | 'actualizado', rows: [string, string][]): string {
  const rowsHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 0; font-size:13px; color:#6b7280; width:150px; vertical-align:top; border-bottom:1px solid #f3f4f6;">${escapeHtml(label)}</td>
        <td style="padding:10px 0; font-size:14px; color:#111827; font-weight:500; vertical-align:top; border-bottom:1px solid #f3f4f6;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');

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
              <span style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af;">TimeTracker &middot; Gastos</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h1 style="margin:0 0 8px; font-size:20px; color:#111827;">Gasto ${escapeHtml(action)}</h1>
        <p style="margin:0 0 24px; font-size:14px; color:#6b7280;">Detalle del gasto:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${rowsHtml}
        </table>
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
