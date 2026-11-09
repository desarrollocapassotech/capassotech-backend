import { buildEmailShell, escapeHtml } from '../common/email-template.util';
import type { CcMoneda, CcSide } from '../database/entities';

export interface CargoQueVence {
  side: CcSide;
  cuentaId: string;
  cuenta: string;
  concepto: string;
  importe: number;
  pendiente: number;
  moneda: CcMoneda;
}

const dinero = (n: number, moneda: CcMoneda) =>
  `${moneda === 'USD' ? 'US$' : '$'} ${n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fechaTexto = (ymd: string) => {
  const [a, m, d] = ymd.split('-');
  return `${d}/${m}/${a}`;
};

export function vencimientosSubject(cargos: CargoQueVence[]): string {
  const cobros = cargos.filter((c) => c.side === 'cliente').length;
  const pagos = cargos.length - cobros;
  const partes = [
    cobros ? `${cobros} ${cobros === 1 ? 'cobro' : 'cobros'}` : '',
    pagos ? `${pagos} ${pagos === 1 ? 'pago' : 'pagos'}` : '',
  ].filter(Boolean);
  return `Hoy ${cargos.length === 1 ? 'vence' : 'vencen'} ${partes.join(' y ')} de la cuenta corriente`;
}

/** Pantalla Cuenta corriente; con `cuentaId`, abierta en esa cuenta (los mismos parámetros que usa la pantalla). */
export function urlCuentaCorriente(urlBase: string, side?: CcSide, cuentaId?: string): string {
  const params = new URLSearchParams();
  if (side === 'colaborador') params.set('lado', 'colaborador');
  if (cuentaId) params.set('cuenta', cuentaId);
  const query = params.toString();
  return `${urlBase.replace(/\/+$/, '')}/admin/cuenta-corriente${query ? `?${query}` : ''}`;
}

function boton(url: string, texto: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
    <tr>
      <td style="background-color:#111827; border-radius:8px;">
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">${escapeHtml(texto)}</a>
      </td>
    </tr>
  </table>`;
}

function seccion(titulo: string, cargos: CargoQueVence[], urlBase: string): string {
  if (!cargos.length) return '';
  const celda = 'padding:10px 8px; font-size:14px; color:#111827; border-bottom:1px solid #f3f4f6; vertical-align:top;';
  const cabecera = 'padding:8px; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb;';
  const filas = cargos
    .map(
      (c) => `
      <tr>
        <td style="${celda} font-weight:500;"><a href="${escapeHtml(urlCuentaCorriente(urlBase, c.side, c.cuentaId))}" target="_blank" style="color:#111827; text-decoration:underline;">${escapeHtml(c.cuenta)}</a></td>
        <td style="${celda}">${escapeHtml(c.concepto)}</td>
        <td style="${celda} text-align:right; white-space:nowrap; font-weight:600;">${escapeHtml(dinero(c.pendiente, c.moneda))}${
          c.pendiente < c.importe
            ? `<br/><span style="font-size:12px; font-weight:400; color:#6b7280;">de ${escapeHtml(dinero(c.importe, c.moneda))}</span>`
            : ''
        }</td>
      </tr>`,
    )
    .join('');
  return `
  <h2 style="margin:0 0 8px; font-size:15px; color:#111827;">${escapeHtml(titulo)}</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:24px;">
    <tr>
      <th align="left" style="${cabecera}">Cuenta</th>
      <th align="left" style="${cabecera}">Concepto</th>
      <th align="right" style="${cabecera}">Pendiente</th>
    </tr>${filas}
  </table>`;
}

export function buildVencimientosHtml(fecha: string, cargos: CargoQueVence[], urlBase: string): string {
  // Si todo es de colaboradores, el botón abre esa pestaña.
  const soloColaboradores = cargos.every((c) => c.side === 'colaborador');
  return buildEmailShell({
    eyebrow: 'Cuenta corriente',
    title: vencimientosSubject(cargos),
    intro: `Cargos que vencen hoy, ${fechaTexto(fecha)}, y siguen con saldo pendiente. Cada importe está en la moneda del cargo. Tocá el nombre de una cuenta para abrirla.`,
    bodyHtml:
      seccion('Cobros a clientes', cargos.filter((c) => c.side === 'cliente'), urlBase) +
      seccion('Pagos a colaboradores', cargos.filter((c) => c.side === 'colaborador'), urlBase) +
      boton(urlCuentaCorriente(urlBase, soloColaboradores ? 'colaborador' : undefined), 'Ver cuenta corriente'),
  });
}
