import { calcularImputacion, EPS, type Moneda } from './calculos';

// Los recibos de colaboradores que se enviaban desde la pantalla de Colaboradores no dejaban
// rastro en la cuenta corriente. Acá se decide, sin tocar la base, qué pago e imputación le
// corresponde a cada uno. Solo un recibo enviado por email quedó registrado: un PDF que se
// descargó y nunca se envió no se puede unificar.

export interface ReciboEnviado {
  id: string;
  collaboratorId: string;
  /** "Octubre 2026". */
  monthYear: string;
  /** "$1.479.660", "$311,25": texto tal como salió en el recibo. */
  total: string;
  currency: string | null;
  /** yyyy-MM-dd. */
  fecha: string;
  destinatario: string;
}

export interface CargoColaborador {
  id: string;
  collaboratorId: string;
  month: string;
  currency: Moneda;
  importe: number;
  imputado: number;
}

export interface ReciboUnificado {
  reciboId: string;
  collaboratorId: string;
  cargoId: string;
  moneda: Moneda;
  /** Importe del pago: lo que dice el recibo. */
  total: number;
  importeCargo: number;
  importePago: number;
  tipoCambio: number | null;
  fecha: string;
  destinatario: string;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "Octubre 2026" → "2026-10". */
export function mesDeTexto(texto: string): string | null {
  const m = /^\s*(\p{L}+)\s+(\d{4})\s*$/u.exec(texto);
  if (!m) return null;
  const i = MESES.indexOf(m[1].toLowerCase());
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, '0')}`;
}

/** "$1.479.660" → 1479660; "$311,25" → 311.25. */
export function montoDeTexto(texto: string): number | null {
  const limpio = texto
    .replace(/[^\d,.]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(limpio);
  return limpio && Number.isFinite(n) && n > 0 ? n : null;
}

export function unificarRecibos(
  recibos: ReciboEnviado[],
  cargos: CargoColaborador[],
  /** TC fijado de cada mes (yyyy-MM). Sin TC fijado no se convierte: el recibo se informa. */
  tcPorMes: Map<string, number>,
) {
  const unificados: ReciboUnificado[] = [];
  const omitidos: Array<{ reciboId: string; motivo: string }> = [];
  const vistos = new Set<string>();
  const pendiente = new Map(
    cargos.map((c) => [c.id, c.importe - c.imputado] as const),
  );

  for (const r of recibos) {
    const mes = mesDeTexto(r.monthYear);
    const total = montoDeTexto(r.total);
    const moneda = r.currency;
    if (!mes || !total || (moneda !== 'USD' && moneda !== 'ARS')) {
      omitidos.push({ reciboId: r.id, motivo: 'Datos del recibo ilegibles' });
      continue;
    }
    // Reenviar el mismo recibo no es otro pago.
    const clave = `${r.collaboratorId}|${mes}|${moneda}|${total}`;
    if (vistos.has(clave)) {
      omitidos.push({ reciboId: r.id, motivo: 'Mismo recibo reenviado' });
      continue;
    }
    vistos.add(clave);

    const delMes = cargos.filter(
      (c) => c.collaboratorId === r.collaboratorId && c.month === mes,
    );
    const cargo =
      delMes.find(
        (c) => c.currency === moneda && (pendiente.get(c.id) ?? 0) > EPS,
      ) ?? delMes.find((c) => (pendiente.get(c.id) ?? 0) > EPS);
    if (!cargo) {
      omitidos.push({
        reciboId: r.id,
        motivo: delMes.length
          ? 'El cargo del mes ya está cancelado'
          : 'Sin cargo en la cuenta para ese mes',
      });
      continue;
    }
    const cruzado = cargo.currency !== moneda;
    const tc = cruzado ? (tcPorMes.get(mes) ?? null) : null;
    if (cruzado && !tc) {
      omitidos.push({ reciboId: r.id, motivo: 'El mes no tiene TC fijado' });
      continue;
    }
    const imputacion = calcularImputacion({
      pendienteCargo: pendiente.get(cargo.id) ?? 0,
      disponiblePago: total,
      monedaCargo: cargo.currency,
      monedaPago: moneda,
      tc,
    });
    if (!imputacion) {
      omitidos.push({ reciboId: r.id, motivo: 'Nada para imputar' });
      continue;
    }
    pendiente.set(
      cargo.id,
      (pendiente.get(cargo.id) ?? 0) - imputacion.importeCargo,
    );
    unificados.push({
      reciboId: r.id,
      collaboratorId: r.collaboratorId,
      cargoId: cargo.id,
      moneda,
      total,
      importeCargo: imputacion.importeCargo,
      importePago: imputacion.importePago,
      tipoCambio: tc,
      fecha: r.fecha,
      destinatario: r.destinatario,
    });
  }
  return { unificados, omitidos };
}
