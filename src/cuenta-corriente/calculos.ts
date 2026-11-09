// Reglas de la cuenta corriente, sin base ni Facturador: cuánto se imputa, cómo se reparten
// los saldos por moneda (nunca se suman entre sí) y qué líneas lleva el comprobante.

import type { CcComprobantePrevio } from '../database/entities/cuenta-corriente.entity';

export type Moneda = 'USD' | 'ARS';

export const EPS = 0.005;

export const redondear = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Pasa un importe de una moneda a la otra. `tc` son pesos por dólar. */
export function convertir(
  importe: number,
  de: Moneda,
  a: Moneda,
  tc: number | null | undefined,
): number {
  if (de === a) return redondear(importe);
  if (!tc || !(tc > 0)) {
    throw new Error('Hace falta un tipo de cambio para convertir.');
  }
  return redondear(de === 'USD' ? importe * tc : importe / tc);
}

export interface PedidoImputacion {
  /** Lo que se quiere imputar, en la moneda del cargo. Sin valor: todo lo posible. */
  importe?: number;
  pendienteCargo: number;
  disponiblePago: number;
  monedaCargo: Moneda;
  monedaPago: Moneda;
  tc?: number | null;
}

/**
 * Un importe mayor a lo pendiente o a lo disponible no es error (igual que en Vialto): se
 * imputa hasta el tope, lo que sobra del pago queda a cuenta y lo que falta, pendiente.
 */
export function calcularImputacion(p: PedidoImputacion) {
  const disponibleEnCargo = convertir(
    p.disponiblePago,
    p.monedaPago,
    p.monedaCargo,
    p.tc,
  );
  const deseado = p.importe ?? Number.POSITIVE_INFINITY;
  const importeCargo = redondear(
    Math.min(deseado, p.pendienteCargo, disponibleEnCargo),
  );
  if (!(importeCargo > EPS)) return null;
  // Si consume todo lo disponible se toma tal cual: reconvertir podría dejar un centavo suelto.
  const consumeTodo = Math.abs(importeCargo - disponibleEnCargo) <= EPS;
  const importePago = consumeTodo
    ? redondear(p.disponiblePago)
    : convertir(importeCargo, p.monedaCargo, p.monedaPago, p.tc);
  return { importeCargo, importePago };
}

export interface MovimientoSaldo {
  id: string;
  tipo: 'cargo' | 'pago' | 'credito';
  importe: number;
  moneda: Moneda;
  /** Orden del historial. */
  fecha: string;
  creado: number;
}

export interface ImputacionSaldo {
  pagoId: string;
  importeCargo: number;
  importePago: number;
  monedaCargo: Moneda;
  monedaPago: Moneda;
}

/**
 * Saldo después de cada movimiento, por moneda. Un pago en otra moneda cancela el cargo: en la
 * moneda del cargo baja lo imputado y en la del pago se devuelve lo que se tomó, así el saldo
 * de cada moneda queda en cero en vez de uno positivo y otro negativo.
 */
export function calcularSaldos(
  movimientos: MovimientoSaldo[],
  imputaciones: ImputacionSaldo[],
) {
  const acumulado: Record<string, number> = {};
  const suma = (moneda: Moneda, n: number) => {
    acumulado[moneda] = redondear((acumulado[moneda] ?? 0) + n);
  };
  const ordenados = [...movimientos].sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.creado - b.creado ||
      a.id.localeCompare(b.id),
  );
  const porFila = new Map<string, Record<string, number>>();
  for (const m of ordenados) {
    suma(m.moneda, m.tipo === 'cargo' ? m.importe : -m.importe);
    if (m.tipo === 'pago') {
      for (const i of imputaciones) {
        if (i.pagoId !== m.id || i.monedaCargo === i.monedaPago) continue;
        suma(i.monedaCargo, -i.importeCargo);
        suma(i.monedaPago, i.importePago);
      }
    }
    porFila.set(m.id, { ...acumulado });
  }
  return { porFila, finales: acumulado };
}

/**
 * El vencimiento más antiguo entre los cargos con algo pendiente (descontados créditos e
 * imputaciones), aunque ya haya pasado: una cuota vencida sin imputar es lo más urgente.
 */
export function proximoVencimientoSinImputar(
  movimientos: Array<{
    id: string;
    tipo: 'cargo' | 'pago' | 'credito';
    parentId: string | null;
    importe: number;
    vencimiento: string | null;
  }>,
  imputaciones: Array<{ cargoId: string; importeCargo: number }>,
): string | null {
  const cancelado = new Map<string, number>();
  const sumar = (cargoId: string, n: number) =>
    cancelado.set(cargoId, (cancelado.get(cargoId) ?? 0) + n);
  for (const i of imputaciones) sumar(i.cargoId, i.importeCargo);
  for (const m of movimientos) {
    if (m.tipo === 'credito' && m.parentId) sumar(m.parentId, m.importe);
  }
  let proximo: string | null = null;
  for (const m of movimientos) {
    if (m.tipo !== 'cargo' || !m.vencimiento) continue;
    if (redondear(m.importe - (cancelado.get(m.id) ?? 0)) <= EPS) continue;
    if (!proximo || m.vencimiento < proximo) proximo = m.vencimiento;
  }
  return proximo;
}

export interface LineaOrigen {
  descripcion: string;
  cantidad: string;
  importe: number;
}

/**
 * Líneas del comprobante por lo cobrado: si se cancela el cargo entero van con su detalle,
 * repartidas en proporción y con el redondeo en la última (la suma da justo el total). Un pago
 * parcial va en una sola línea: no se sabe qué horas puntuales cubre.
 */
export function lineasDelComprobante(
  lineas: LineaOrigen[],
  totalDocumento: number,
  cancelaCargoEntero: boolean,
  conceptoParcial: string,
): Array<{ descripcion: string; importe: number }> {
  const totalOrigen = lineas.reduce((t, l) => t + l.importe, 0);
  if (!cancelaCargoEntero || !(totalOrigen > 0)) {
    return [
      { descripcion: conceptoParcial, importe: redondear(totalDocumento) },
    ];
  }
  let asignado = 0;
  return lineas.map((l, i) => {
    const ultima = i === lineas.length - 1;
    const importe = ultima
      ? redondear(totalDocumento - asignado)
      : redondear((l.importe / totalOrigen) * totalDocumento);
    asignado = redondear(asignado + importe);
    return {
      descripcion: l.cantidad
        ? `${l.descripcion} (${l.cantidad})`
        : l.descripcion,
      importe,
    };
  });
}

/** Neto de una línea para que factura A o B dé justo lo cobrado con 21% de IVA. */
export const netoDeTotal = (total: number, conIva: boolean) =>
  redondear(conIva ? total / 1.21 : total);

/**
 * Meses cerrados desde el de arranque hasta el anterior a `hoy`: el mes en curso no genera
 * cargo.
 */
export function mesesCerrados(desde: string, hoy: string): string[] {
  const actual = hoy.slice(0, 7);
  const meses: string[] = [];
  let [a, m] = desde.split('-').map(Number);
  for (;;) {
    const mes = `${a}-${String(m).padStart(2, '0')}`;
    if (mes >= actual) return meses;
    meses.push(mes);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
}

export interface ComprobanteFacturador {
  id: string;
  tipo?: string;
  estado?: string;
  ambiente?: string;
  puntoVenta?: number;
  numero?: number | null;
  moneda?: string;
  importes?: { total?: string };
  notas?: Array<{ estado: string }>;
}

/** "00001-00000012". */
export const numeroDeComprobante = (
  puntoVenta: number | undefined,
  numero: number,
) =>
  `${String(puntoVenta ?? 0).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;

/**
 * Las facturas en las que ya se emitieron las líneas de un cargo. Cada línea es un ítem y varias
 * suelen estar en la misma factura. Un borrador no cuenta: todavía no es un comprobante.
 */
export function facturasDeItems(
  items: Array<{ estado: string; comprobanteId: string | null }>,
): string[] {
  return [
    ...new Set(
      items.flatMap((i) =>
        i.estado === 'FACTURADO' && i.comprobanteId ? [i.comprobanteId] : [],
      ),
    ),
  ];
}

/** Emitida y sin una nota de crédito que la anule. */
export const facturaVigente = (c: ComprobanteFacturador) =>
  c.estado === 'EMITIDO' &&
  !(c.notas ?? []).some((n) => n.estado === 'EMITIDO');

export function comprobantePrevioDe(
  c: ComprobanteFacturador,
): CcComprobantePrevio {
  const total = Number(c.importes?.total);
  return {
    comprobanteId: c.id,
    tipo: c.tipo ?? null,
    numero:
      c.numero != null ? numeroDeComprobante(c.puntoVenta, c.numero) : null,
    total: Number.isFinite(total) ? total : null,
    moneda: c.moneda ?? null,
    ambiente: c.ambiente ?? null,
  };
}

export interface AdicionalRecibo {
  descripcion: string;
  importe: number;
}

/** Adicionales del recibo que llegan del formulario. `null`: hay alguno mal cargado. */
export function adicionalesValidos(valor: unknown): AdicionalRecibo[] | null {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) return null;
  const resultado: AdicionalRecibo[] = [];
  for (const item of valor as Array<Record<string, unknown> | null>) {
    const descripcion =
      typeof item?.descripcion === 'string' ? item.descripcion.trim() : '';
    const importe = Number(item?.importe);
    if (!descripcion || !Number.isFinite(importe) || importe <= 0) return null;
    resultado.push({
      descripcion: descripcion.slice(0, 200),
      importe: redondear(importe),
    });
  }
  return resultado;
}

/** Fecha de la cuota `numero` (desde 1): mismo día de cada mes, o el último si ese mes no lo tiene. */
export function fechaDeCuota(primera: string, numero: number): string {
  const [a, m, d] = primera.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m - 1 + numero, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 2 + numero, Math.min(d, ultimoDia)))
    .toISOString()
    .slice(0, 10);
}

export const conceptoDeCuota = (
  numero: number,
  total: number,
  concepto: string,
) => `Cuota ${numero}/${total} ${concepto}`;

/** Cuotas de un plan que ya llegaron a su fecha y todavía no existen. */
export function cuotasAGenerar(
  plan: { totalCuotas: number; firstDate: string },
  existentes: number[],
  hoy: string,
): Array<{ numero: number; fecha: string }> {
  const resultado: Array<{ numero: number; fecha: string }> = [];
  for (let numero = 1; numero <= plan.totalCuotas; numero += 1) {
    const fecha = fechaDeCuota(plan.firstDate, numero);
    if (fecha <= hoy && !existentes.includes(numero)) {
      resultado.push({ numero, fecha });
    }
  }
  return resultado;
}

export interface AjusteActual {
  id: string;
  /** Con signo: cargo suma, crédito resta. */
  importe: number;
  imputado: boolean;
}

/**
 * Cargo ya imputado cuyas horas cambiaron: la diferencia va en un ajuste aparte. Si hay uno sin
 * imputar se corrige ese; se devuelve qué hacer (`null`: ya coincide).
 */
export function resolverAjuste(
  esperado: number,
  importeCargo: number,
  ajustes: AjusteActual[],
):
  | { accion: 'crear'; importe: number }
  | { accion: 'actualizar'; id: string; importe: number }
  | { accion: 'borrar'; id: string }
  | null {
  const actual = ajustes.reduce((t, a) => t + a.importe, importeCargo);
  const diferencia = redondear(esperado - actual);
  if (Math.abs(diferencia) <= EPS) return null;
  const libre = ajustes.find((a) => !a.imputado);
  if (!libre) return { accion: 'crear', importe: diferencia };
  const nuevo = redondear(libre.importe + diferencia);
  if (Math.abs(nuevo) <= EPS) return { accion: 'borrar', id: libre.id };
  return { accion: 'actualizar', id: libre.id, importe: nuevo };
}
