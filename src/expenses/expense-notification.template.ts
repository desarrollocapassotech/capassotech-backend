import { readFileSync } from 'fs';
import { join } from 'path';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// Logo embebido como data URI: los clientes de correo no cargan imágenes de un
// frontend que puede no tener dominio propio/estable, así que se copia el mismo
// archivo que usa el frontend (ver nest-cli.json -> compilerOptions.assets, copia
// esta carpeta a dist/expenses/assets en el build) y se manda inline en el HTML.
// Si por algún motivo no está el archivo, el email se manda igual sin logo.
const LOGO_DATA_URI = (() => {
  try {
    const buffer = readFileSync(join(__dirname, 'assets', 'logo.png'));
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
})();

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

  const header = LOGO_DATA_URI
    ? `<img src="${LOGO_DATA_URI}" alt="CapassoTech" height="40" style="display:block; height:40px; width:auto;" />`
    : `<span style="color:#111827; font-size:16px; font-weight:600;">CapassoTech &middot; TimeTracker</span>`;

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background-color:#f4f5f7; padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
    <tr>
      <td style="background-color:#ffffff; padding:20px 32px; border-bottom:1px solid #e5e7eb;">
        ${header}
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
