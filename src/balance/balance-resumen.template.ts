import { buildEmailShell, escapeHtml } from '../common/email-template.util';
import { nombreMes } from '../facturacion/resumen';
import type { Balance } from './balance';

// Resumen semanal del balance del mes en curso, en pesos al TC del mes (el que usa el Panel).

// Espacio que no se corta entre "$" y el número: algunos clientes de correo ignoran
// white-space:nowrap y partían el monto en dos renglones.
const NBSP = ' ';

const pesos = (usd: number, tc: number) => {
  const n = Math.abs(usd * tc) < 0.005 ? 0 : usd * tc;
  return `${n < 0 ? '-' : ''}$${NBSP}${Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const ROJO = '#b91c1c';
const VERDE = '#15803d';
const GRIS = '#6b7280';

const celda = 'padding:8px 6px; font-size:13px; color:#111827; border-bottom:1px solid #f3f4f6;';
const num = `${celda} text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;`;
const cabecera = `padding:8px 6px; font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${GRIS}; border-bottom:1px solid #e5e7eb;`;

function fechaTexto(ymd: string) {
  const [a, m, d] = ymd.split('-');
  return `${d}/${m}/${a}`;
}

export function balanceResumenSubject(b: Balance, hoy: string): string {
  return `Balance de ${nombreMes(b.mes)} al ${fechaTexto(hoy)}: ganancia ${pesos(b.totales.ganancia, b.usdRate)}`;
}

function tarjetas(b: Balance): string {
  const tc = b.usdRate;
  const tarjeta = (label: string, usd: number, color: string) => `
      <td width="25%" style="padding:12px; border:1px solid #e5e7eb; border-radius:8px; vertical-align:top;">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:${GRIS};">${escapeHtml(label)}</div>
        <div style="margin-top:4px; font-size:17px; font-weight:700; color:${color}; white-space:nowrap;">${escapeHtml(pesos(usd, tc))}</div>
      </td>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 -6px 20px;">
    <tr>
      ${tarjeta('Sueldos', b.totales.sueldos, ROJO)}
      ${tarjeta('Gastos', b.totales.gastos, ROJO)}
      ${tarjeta('Facturado', b.totales.facturado, VERDE)}
      ${tarjeta('Ganancia', b.totales.ganancia, b.totales.ganancia >= 0 ? VERDE : ROJO)}
    </tr>
  </table>`;
}

function fila(nombre: string, costo: number | null, gastos: number | null, paga: number | null, tc: number, estilo = ''): string {
  const ganancia = (paga ?? 0) - (costo ?? 0) - (gastos ?? 0);
  const monto = (v: number | null, color: string) =>
    `<td style="${num} color:${color}; ${estilo}">${v == null ? '' : escapeHtml(pesos(v, tc))}</td>`;
  return `
    <tr>
      <td style="${celda} ${estilo}">${escapeHtml(nombre)}</td>
      ${monto(costo, ROJO)}${monto(gastos, ROJO)}${monto(paga, VERDE)}
      <td style="${num} font-weight:600; color:${ganancia >= -0.005 ? VERDE : ROJO}; ${estilo}">${escapeHtml(pesos(ganancia, tc))}</td>
    </tr>`;
}

function encabezadoGrupo(nombre: string): string {
  return `
    <tr>
      <td colspan="5" style="padding:14px 6px 6px; font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${GRIS}; background-color:#f9fafb;">${escapeHtml(nombre)}</td>
    </tr>`;
}

function tabla(b: Balance): string {
  const tc = b.usdRate;
  const subtotal = 'color:#6b7280; font-size:12px;';
  const cuerpo = b.grupos
    .map((g) => {
      const filas = g.filas.map((f) => fila(f.name, f.costo, f.gastos, f.paga, tc)).join('');
      const sub =
        g.filas.length > 1
          ? fila(
              `Subtotal ${g.name}`,
              g.filas.reduce((s, f) => s + f.costo, 0),
              g.filas.reduce((s, f) => s + f.gastos, 0),
              g.filas.reduce((s, f) => s + f.paga, 0),
              tc,
              subtotal,
            )
          : '';
      return encabezadoGrupo(g.name) + filas + sub;
    })
    .join('');

  const sinCliente = b.sinCliente.length
    ? encabezadoGrupo('Sin cliente') +
      b.sinCliente
        .map((c) => {
          const tipo = { sueldos: 'Sueldos', gastos: 'Gastos', cobros: 'Cobros' }[c.tipo];
          const etiqueta = `${tipo} · ${c.label}${c.horas > 0 ? ` (${c.horas.toLocaleString('es-AR', { maximumFractionDigits: 1 })} h)` : ''}`;
          return fila(
            etiqueta,
            c.tipo === 'sueldos' ? c.usd : null,
            c.tipo === 'gastos' ? c.usd : null,
            c.tipo === 'cobros' ? c.usd : null,
            tc,
          );
        })
        .join('') +
      fila('Subtotal sin cliente', b.sinClienteTotales.sueldos, b.sinClienteTotales.gastos, b.sinClienteTotales.cobros, tc, subtotal)
    : '';

  const total = `
    <tr>
      <td style="padding:12px 6px; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#111827; border-top:2px solid #374151; background-color:#f3f4f6;">Total del mes</td>
      ${[
        [b.totales.sueldos, ROJO],
        [b.totales.gastos, ROJO],
        [b.totales.facturado, VERDE],
        [b.totales.ganancia, b.totales.ganancia >= 0 ? VERDE : ROJO],
      ]
        .map(
          ([v, color]) =>
            `<td style="padding:12px 6px; text-align:right; white-space:nowrap; font-size:14px; font-weight:700; color:${color}; border-top:2px solid #374151; background-color:#f3f4f6;">${escapeHtml(pesos(v as number, tc))}</td>`,
        )
        .join('')}
    </tr>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:24px;">
    <tr>
      <th align="left" style="${cabecera}">Cliente</th>
      <th align="right" style="${cabecera}">Sueldos</th>
      <th align="right" style="${cabecera}">Gastos</th>
      <th align="right" style="${cabecera}">Paga</th>
      <th align="right" style="${cabecera}">Ganancia</th>
    </tr>${cuerpo}${sinCliente}${total}
  </table>`;
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

export function buildBalanceResumenHtml(b: Balance, hoy: string, tcFijado: boolean, urlBase: string): string {
  return buildEmailShell({
    eyebrow: 'Balance',
    title: `Balance de ${nombreMes(b.mes)} al ${fechaTexto(hoy)}`,
    intro: '',
    bodyHtml: tipoDeCambio(b.usdRate, tcFijado) + tarjetas(b) + tabla(b) + boton(`${urlBase.replace(/\/+$/, '')}/admin`, 'Ver el Panel'),
  });
}

/** El TC del mes y si está fijado, en una línea: como ExchangeRateStatus en el tracker (candado o cruz). */
function tipoDeCambio(usdRate: number, fijado: boolean): string {
  const tc = usdRate.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const estado = fijado
    ? `<span style="display:inline-block; padding:2px 8px; border-radius:999px; background-color:#dcfce7; color:${VERDE}; font-size:12px; font-weight:600;">&#128274; Fijado</span>`
    : `<span style="display:inline-block; padding:2px 8px; border-radius:999px; background-color:#fef3c7; color:#b45309; font-size:12px; font-weight:600;">&#10005; Sin fijar</span>`;
  return `
  <p style="margin:0 0 16px; font-size:13px; color:${GRIS};">
    TC <strong style="color:#111827; white-space:nowrap;">1&nbsp;USD&nbsp;=&nbsp;$&nbsp;${escapeHtml(tc)}</strong>&nbsp;&nbsp;${estado}
  </p>`;
}
