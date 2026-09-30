// Qué hay para facturar en un mes, con la misma regla que Ingresos (IncomeManagement):
// - Proyecto por hora: horas facturables del mes × tarifa del proyecto.
// - Proyecto mensual (activo): 1 abono × tarifa del proyecto.
// Siempre en la moneda del proyecto. Función pura: no consulta la base ni el Facturador.

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
}

export interface ProyectoTracker {
  id: string;
  name: string;
  active: boolean;
  rate: number | null;
  currency: string | null;
  billingType: string | null;
  clientId: string | null;
}

/** Un registro de horas con sus horas facturables ya calculadas (BillableHoursService). */
export interface RegistroFacturable {
  date: string;
  billableHours: string;
  projectId: string;
}

export interface DatosCliente {
  id: string;
  nombre: string;
  razonSocial: string;
  cuit: string | null;
  condicionIva: string | null;
  email: string | null;
  domicilio: string | null;
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
  moneda: 'USD' | 'ARS';
  importe: string | null;
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
/** "12.50" → "12.5", "1.00" → "1". */
const limpio = (s: string) => String(Number(s));

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
    domicilio: c.address?.trim() || null,
  };
}

export function armarResumen(
  mes: string,
  registros: RegistroFacturable[],
  proyectos: ProyectoTracker[],
  clientes: ClienteTracker[],
): Resumen {
  const periodo = rangoMes(mes);
  const texto = nombreMes(mes);
  const clientePorId = new Map(clientes.map((c) => [c.id, c]));
  const advertencias: string[] = [];

  const horas = new Map<string, number>();
  for (const r of registros) {
    if (!r.date.startsWith(mes)) continue;
    horas.set(
      r.projectId,
      (horas.get(r.projectId) ?? 0) + Number(r.billableHours || 0),
    );
  }

  const lineas: LineaResumen[] = [];
  const sinCliente = new Set<string>();
  for (const p of proyectos) {
    const mensual = p.billingType === 'monthly';
    if (mensual ? !p.active : !horas.has(p.id)) continue;
    const cantidadHoras = dos(horas.get(p.id) ?? 0);
    if (!mensual && Number(cantidadHoras) <= 0) continue;
    const cliente = p.clientId ? clientePorId.get(p.clientId) : undefined;
    if (!cliente) {
      sinCliente.add(p.name);
      continue;
    }
    const tarifa = p.rate != null && p.rate > 0 ? p.rate : null;
    if (mensual && !tarifa) continue; // como Ingresos: un abono sin monto no se cobra
    const cantidad = mensual ? '1' : limpio(cantidadHoras);
    lineas.push({
      referencia: `tracker:${cliente.id}:${p.id}:${mes}`,
      clienteId: cliente.id,
      proyecto: {
        id: p.id,
        nombre: p.name,
        tipo: mensual ? 'monthly' : 'hourly',
      },
      descripcion: mensual
        ? `${p.name} - Abono ${texto}`
        : `${p.name} - Horas ${texto}`,
      cantidad,
      unidad: mensual ? 'MES' : 'HORA',
      precioUnitario: tarifa != null ? limpio(tarifa.toFixed(2)) : null,
      moneda: p.currency === 'ARS' ? 'ARS' : 'USD',
      importe: tarifa != null ? dos(Number(cantidad) * tarifa) : null,
      periodo,
      problema:
        tarifa == null
          ? 'El proyecto no tiene tarifa por hora en el tracker.'
          : null,
    });
  }
  if (sinCliente.size) {
    advertencias.push(
      `Proyectos sin cliente en el tracker (no se facturan): ${[...sinCliente].join(', ')}.`,
    );
  }

  lineas.sort(
    (a, b) =>
      a.clienteId.localeCompare(b.clienteId) ||
      a.proyecto.nombre.localeCompare(b.proyecto.nombre),
  );
  const ids = new Set(lineas.map((l) => l.clienteId));
  return {
    mes,
    clientes: clientes
      .filter((c) => ids.has(c.id))
      .map(datosCliente)
      .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial)),
    lineas,
    advertencias,
  };
}
