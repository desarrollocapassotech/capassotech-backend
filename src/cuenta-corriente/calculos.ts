// Reglas de la cuenta corriente, sin base ni Facturador: cuánto se imputa, cómo se reparten
// los saldos por moneda (nunca se suman entre sí) y qué líneas lleva el comprobante.

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
 * Meses cerrados desde el de arranque hasta el anterior a `hoy` (el mes en curso no genera
 * cargo: es lo mismo que excluye la deuda de clientes).
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

/**
 * Horas pagadas de un mes para la deuda de clientes (`client_payments`): proporcionales a lo
 * imputado de cada cargo. Con todo cancelado da las horas redondeadas que se le cobran.
 */
export function horasPagadasDelMes(
  cargos: Array<{ horas: number; importe: number; imputado: number }>,
): number {
  const conHoras = cargos.filter((c) => c.horas > 0 && c.importe > 0);
  const totalHoras = conHoras.reduce((t, c) => t + c.horas, 0);
  if (
    conHoras.length > 0 &&
    conHoras.every((c) => c.imputado >= c.importe - EPS)
  ) {
    return Math.round(totalHoras);
  }
  return redondear(
    conHoras.reduce(
      (t, c) => t + c.horas * Math.min(1, c.imputado / c.importe),
      0,
    ),
  );
}
