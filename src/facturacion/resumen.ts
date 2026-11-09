// Qué hay para facturar en un mes, según las condiciones de cobro vigentes de cada cliente:
// - Suscripción (proyecto activo): 1 mes × el monto.
// - Tarifa por hora: horas facturables del cliente en el proyecto (redondeadas para arriba a la
//   media hora) × la tarifa.
// Una condición puede tener las dos. Se factura siempre en pesos: lo que está en USD se pasa a
// ARS con el tipo de cambio del mes (el que recibe). Función pura: no consulta la base ni el
// Facturador. Los montos fijos únicos no pasan por acá: son cargos sueltos de la cuenta corriente.

import { vigente, type CondicionCobro } from '../projects/condiciones';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function nombreMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
}

export function rangoMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number);
  const hasta = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta };
}

/** Texto libre de condición IVA del tracker → condición del Facturador (o null si no se reconoce). */
export function condicionIvaDeTexto(
  texto: string | null | undefined,
): string | null {
  const t = (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t.trim()) return null;
  if (/monotrib/.test(t)) return 'MONOTRIBUTO';
  if (/inscript|\bri\b|responsable/.test(t)) return 'RESPONSABLE_INSCRIPTO';
  if (/exent/.test(t)) return 'EXENTO';
  if (/consumidor/.test(t)) return 'CONSUMIDOR_FINAL';
  if (/exterior/.test(t)) return 'CLIENTE_EXTERIOR';
  return null;
}

/** Dígito verificador del CUIT (módulo 11). */
export function cuitValido(cuit: string | null | undefined): cuit is string {
  if (!cuit || !/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return dv === Number(cuit[10]);
}

export interface ClienteTracker {
  id: string;
  name: string;
  razonSocial: string | null;
  cuit: string | null;
  ivaCondition: string | null;
  email: string | null;
  address: string | null;
  city?: string | null;
  province?: string | null;
  billingDocument?: 'factura' | 'recibo' | null;
  billingCurrency?: string | null;
  billingConcepts?: unknown;
}

export const UNIDADES_CONCEPTO = ['HORA', 'UNIDAD', 'SERVICIO', 'MES'] as const;

/** Concepto fijo del cliente: se agrega solo a cada factura o recibo. */
export interface ConceptoFijo {
  descripcion: string;
  /** Decimal con punto ("1", "2.5"). */
  cantidad: string;
  unidad: (typeof UNIDADES_CONCEPTO)[number];
  /** En la moneda del documento del cliente (pesos si se le factura; la del recibo si es recibo). */
  precioUnitario: string;
}

/** Los conceptos guardados, sin los que estén mal formados (la columna es JSON libre). */
export function conceptosValidos(valor: unknown): ConceptoFijo[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((c: Record<string, unknown> | null) => {
    const cantidad = Number(c?.cantidad);
    const precio = Number(c?.precioUnitario);
    const unidad = c?.unidad;
    if (
      typeof c?.descripcion !== 'string' ||
      !c.descripcion.trim() ||
      !(cantidad > 0) ||
      !(precio >= 0) ||
      !UNIDADES_CONCEPTO.includes(unidad as ConceptoFijo['unidad'])
    ) {
      return [];
    }
    return [
      {
        descripcion: c.descripcion.trim().slice(0, 500),
        cantidad: String(cantidad),
        unidad: unidad as ConceptoFijo['unidad'],
        precioUnitario: String(precio),
      },
    ];
  });
}

export interface ProyectoTracker {
  id: string;
  name: string;
  active: boolean;
  /** Dueño; null = proyecto propio. */
  clientId: string | null;
}

/** Un registro de horas con sus horas facturables ya calculadas (BillableHoursService). */
export interface RegistroFacturable {
  date: string;
  billableHours: string;
  projectId: string;
  /** Cliente al que se le cobra la hora (el dueño o el marcado); null = interna. */
  clientId: string | null;
}

export interface DatosCliente {
  id: string;
  nombre: string;
  razonSocial: string;
  cuit: string | null;
  condicionIva: string | null;
  email: string | null;
  domicilio: string | null;
  /** Qué se le emite: factura en ARCA o recibo sin validez fiscal. */
  documento: 'factura' | 'recibo';
  /** Moneda de facturación del cliente en el tracker: la del recibo por defecto. */
  moneda: 'USD' | 'ARS';
  /** Conceptos que se agregan solos a cada factura o recibo. */
  conceptos: ConceptoFijo[];
}

export interface LineaResumen {
  /** Referencia estable del ítem en el Facturador: reenviar el mes no duplica. */
  referencia: string;
  clienteId: string;
  proyecto: { id: string; nombre: string; tipo: 'hourly' | 'monthly' };
  descripcion: string;
  cantidad: string;
  unidad: 'HORA' | 'MES';
  precioUnitario: string | null;
  moneda: 'ARS';
  importe: string | null;
  /** Tarifa e importe en dólares si el proyecto es en USD (solo de referencia: se factura en pesos). */
  original: { moneda: 'USD'; precioUnitario: string; importe: string } | null;
  periodo: { desde: string; hasta: string };
  /** Si no se puede facturar tal como está (ej. el proyecto no tiene tarifa). */
  problema: string | null;
}

export interface Resumen {
  mes: string;
  clientes: DatosCliente[];
  lineas: LineaResumen[];
  advertencias: string[];
}

const dos = (n: number) =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
/**
 * Las horas se facturan redondeadas para arriba a la media hora: 67.77 → 68, 35.42 → 35.5.
 * Antes se redondea a 4 decimales para que el ruido de sumar decimales (3.0000001) no sume media hora.
 */
const mediaHoraArriba = (n: number) =>
  (Math.ceil(Math.round(n * 10000) / 5000) / 2).toFixed(2);
/** "12.50" → "12.5", "1.00" → "1". */
const limpio = (s: string) => String(Number(s));

/** "Tucuman 1031, Rosario, Santa Fe": calle, ciudad y provincia (sin los "-" de relleno del tracker). */
export function domicilioCompleto(
  c: Pick<ClienteTracker, 'address' | 'city' | 'province'>,
): string | null {
  const partes = [c.address, c.city, c.province]
    .map((p) => p?.trim() ?? '')
    .filter((p) => /[A-Za-z0-9]/.test(p));
  return partes.length ? partes.join(', ') : null;
}

export function datosCliente(c: ClienteTracker): DatosCliente {
  const cuit = c.cuit?.replace(/\D/g, '') || null;
  return {
    id: c.id,
    nombre: c.name,
    // En el tracker hay razones sociales cargadas como "-": en ese caso sirve más el nombre.
    razonSocial: /[A-Za-z0-9]/.test(c.razonSocial ?? '')
      ? (c.razonSocial as string).trim()
      : c.name,
    cuit,
    condicionIva: condicionIvaDeTexto(c.ivaCondition),
    email: c.email?.trim() || null,
    domicilio: domicilioCompleto(c),
    documento: c.billingDocument === 'recibo' ? 'recibo' : 'factura',
    moneda: c.billingCurrency === 'ARS' ? 'ARS' : 'USD',
    conceptos: conceptosValidos(c.billingConcepts),
  };
}

export function armarResumen(
  mes: string,
  registros: RegistroFacturable[],
  proyectos: ProyectoTracker[],
  condiciones: CondicionCobro[],
  clientes: ClienteTracker[],
  /** Pesos por dólar con que se pasan a ARS las condiciones en USD. */
  cotizacionUsd: number,
): Resumen {
  const periodo = rangoMes(mes);
  const texto = nombreMes(mes);
  const clientePorId = new Map(clientes.map((c) => [c.id, c]));
  const proyectoPorId = new Map(proyectos.map((p) => [p.id, p]));
  const advertencias: string[] = [];

  // Horas facturables del mes por proyecto y cliente responsable.
  const clave = (proyectoId: string, clienteId: string) =>
    `${proyectoId}|${clienteId}`;
  const horas = new Map<string, number>();
  for (const r of registros) {
    if (!r.date.startsWith(mes) || !r.clientId) continue;
    const k = clave(r.projectId, r.clientId);
    horas.set(k, (horas.get(k) ?? 0) + Number(r.billableHours || 0));
  }

  const lineas: LineaResumen[] = [];
  const delMes = condiciones.filter((c) => vigente(c, mes));
  for (const c of delMes) {
    const p = proyectoPorId.get(c.projectId);
    const cliente = clientePorId.get(c.clientId);
    if (!p || !cliente) continue;
    const enUsd = c.currency !== 'ARS';
    const linea = (
      tipo: 'monthly' | 'hourly',
      cantidad: string,
      tarifa: number,
      referencia: string,
    ): LineaResumen => {
      const precioArs = dos(enUsd ? tarifa * cotizacionUsd : tarifa);
      return {
        referencia,
        clienteId: cliente.id,
        proyecto: { id: p.id, nombre: p.name, tipo },
        descripcion:
          tipo === 'monthly'
            ? `${p.name} - Abono ${texto}`
            : `${p.name} - Horas ${texto}`,
        cantidad,
        unidad: tipo === 'monthly' ? 'MES' : 'HORA',
        precioUnitario: limpio(precioArs),
        moneda: 'ARS',
        importe: dos(Number(cantidad) * Number(precioArs)),
        original: enUsd
          ? {
              moneda: 'USD',
              precioUnitario: limpio(tarifa.toFixed(2)),
              importe: dos(Number(cantidad) * tarifa),
            }
          : null,
        periodo,
        problema: null,
      };
    };
    // La primera línea de la condición conserva la referencia de siempre en el Facturador
    // (así se siguen encontrando las facturas hechas por fuera); la segunda lleva sufijo.
    const base = `tracker:${cliente.id}:${p.id}:${mes}`;
    // Como hasta ahora con el abono: un proyecto inactivo no cobra suscripción.
    if (c.monthlyAmount != null && p.active) {
      lineas.push(linea('monthly', '1', c.monthlyAmount, base));
    }
    if (c.hourlyRate != null) {
      const cantidad = mediaHoraArriba(horas.get(clave(p.id, cliente.id)) ?? 0);
      if (Number(cantidad) > 0) {
        lineas.push(
          linea(
            'hourly',
            limpio(cantidad),
            c.hourlyRate,
            c.monthlyAmount != null ? `${base}:horas` : base,
          ),
        );
      }
    }
  }

  // Horas marcadas para un cliente que no tiene tarifa por hora en ese proyecto: no se cobran.
  const sinTarifa = new Set<string>();
  for (const [k, h] of horas) {
    if (h <= 0) continue;
    const [proyectoId, clienteId] = k.split('|');
    const p = proyectoPorId.get(proyectoId);
    if (!p || p.clientId) continue; // en un proyecto con dueño, las horas sin tarifa son normales
    const c = delMes.find(
      (x) => x.projectId === proyectoId && x.clientId === clienteId,
    );
    if (c?.hourlyRate == null) {
      sinTarifa.add(
        `${p.name} (${clientePorId.get(clienteId)?.name ?? clienteId})`,
      );
    }
  }
  if (sinTarifa.size) {
    advertencias.push(
      `Horas marcadas para un cliente sin tarifa por hora en el proyecto (no se cobran): ${[...sinTarifa].join(', ')}.`,
    );
  }

  lineas.sort(
    (a, b) =>
      a.clienteId.localeCompare(b.clienteId) ||
      a.proyecto.nombre.localeCompare(b.proyecto.nombre) ||
      a.referencia.localeCompare(b.referencia),
  );
  const ids = new Set(lineas.map((l) => l.clienteId));
  // También los que tienen un proyecto activo, propio o con condición vigente, aunque no haya
  // horas (se factura con líneas a mano).
  for (const p of proyectos) if (p.active && p.clientId) ids.add(p.clientId);
  for (const c of delMes) {
    if (proyectoPorId.get(c.projectId)?.active) ids.add(c.clientId);
  }
  return {
    mes,
    // También los que no tienen proyectos activos pero sí conceptos fijos: se les factura igual.
    clientes: clientes
      .filter(
        (c) => ids.has(c.id) || conceptosValidos(c.billingConcepts).length > 0,
      )
      .map(datosCliente)
      .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial)),
    lineas,
    advertencias,
  };
}
