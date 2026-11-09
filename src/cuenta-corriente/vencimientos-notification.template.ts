import { buildEmailShell, escapeHtml } from '../common/email-template.util';
import type { CcMoneda, CcSide } from '../database/entities';

export interface CargoQueVence {
  side: CcSide;
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
  return `Hoy vencen ${partes.join(' y ')} de la cuenta corriente`;
}

function seccion(titulo: string, cargos: CargoQueVence[]): string {
  if (!cargos.length) return '';
  const celda = 'padding:10px 8px; font-size:14px; color:#111827; border-bottom:1px solid #f3f4f6; vertical-align:top;';
  const cabecera = 'padding:8px; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#6b7280; border-bottom:1px solid #e5e7eb;';
  const filas = cargos
    .map(
      (c) => `
      <tr>
        <td style="${celda} font-weight:500;">${escapeHtml(c.cuenta)}</td>
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

export function buildVencimientosHtml(fecha: string, cargos: CargoQueVence[]): string {
  return buildEmailShell({
    eyebrow: 'Cuenta corriente',
    title: vencimientosSubject(cargos),
    intro: `Cargos que vencen hoy, ${fechaTexto(fecha)}, y siguen con saldo pendiente. Cada importe está en la moneda del cargo.`,
    bodyHtml:
      seccion('Cobros a clientes', cargos.filter((c) => c.side === 'cliente')) +
      seccion('Pagos a colaboradores', cargos.filter((c) => c.side === 'colaborador')),
  });
}
