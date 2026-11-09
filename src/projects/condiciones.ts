// Condiciones de cobro: qué le cobra un proyecto a un cliente en un mes. Funciones puras que
// comparten las horas facturables, el resumen del mes y la cuenta corriente, para que todos
// decidan igual de quién es una hora y a qué tarifa se cobra.

import type { ProjectBillingTermEntity } from '../database/entities/project-billing-term.entity';
import type { BillableProject } from '../integrations/billable-hours.util';

export interface CondicionCobro {
  id: string;
  projectId: string;
  clientId: string;
  desde: string;
  hasta: string | null;
  currency: 'USD' | 'ARS';
  monthlyAmount: number | null;
  hourlyRate: number | null;
}

const positivo = (v: string | number | null | undefined): number | null => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function condicionDeEntidad(
  e: ProjectBillingTermEntity,
): CondicionCobro {
  return {
    id: e.id,
    projectId: e.projectId,
    clientId: e.clientId,
    desde: e.desde,
    hasta: e.hasta,
    currency: e.currency === 'ARS' ? 'ARS' : 'USD',
    monthlyAmount: positivo(e.monthlyAmount),
    hourlyRate: positivo(e.hourlyRate),
  };
}

/** Vigente en el mes (yyyy-MM). */
export function vigente(
  c: Pick<CondicionCobro, 'desde' | 'hasta'>,
  mes: string,
): boolean {
  return c.desde <= mes && (c.hasta == null || c.hasta >= mes);
}

/**
 * De qué cliente es una hora: en un proyecto con dueño, del dueño; en un proyecto propio, del
 * cliente al que se marcó (null = interna, no se le cobra a nadie).
 */
export function clienteDeHora(
  dueñoDelProyecto: string | null | undefined,
  clienteDeLaHora: string | null | undefined,
): string | null {
  return dueñoDelProyecto ?? clienteDeLaHora ?? null;
}

/** La condición de un proyecto y un cliente vigente en el mes (las vigencias no se superponen). */
export function condicionDelMes(
  condiciones: CondicionCobro[],
  projectId: string,
  clientId: string | null,
  mes: string,
): CondicionCobro | undefined {
  if (!clientId) return undefined;
  return condiciones.find(
    (c) =>
      c.projectId === projectId && c.clientId === clientId && vigente(c, mes),
  );
}

/**
 * El proyecto como lo espera el cálculo de horas facturables (billable-hours.util, espejo del
 * frontend): con la tarifa por hora de la condición si se cobran horas; si no, como un proyecto
 * que no cobra horas (sus horas facturables dan 0).
 */
export function proyectoFacturable(
  projectId: string,
  condicion: CondicionCobro | undefined,
): BillableProject {
  if (condicion?.hourlyRate != null) {
    return {
      id: projectId,
      rate: condicion.hourlyRate,
      currency: condicion.currency,
      billingType: 'hourly',
    };
  }
  return { id: projectId, billingType: 'monthly' };
}

/** Error de validación de una condición nueva o editada, o null si está bien. */
export function errorDeCondicion(
  c: Pick<
    CondicionCobro,
    'desde' | 'hasta' | 'currency' | 'monthlyAmount' | 'hourlyRate'
  >,
  otras: Array<Pick<CondicionCobro, 'id' | 'desde' | 'hasta'>>,
): string | null {
  const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!MES.test(c.desde)) return 'El mes de inicio debe tener formato YYYY-MM.';
  if (c.hasta != null && !MES.test(c.hasta))
    return 'El mes de fin debe tener formato YYYY-MM.';
  if (c.hasta != null && c.hasta < c.desde)
    return 'El mes de fin no puede ser anterior al de inicio.';
  if (c.currency !== 'USD' && c.currency !== 'ARS')
    return 'La moneda debe ser USD o ARS.';
  if (c.monthlyAmount == null && c.hourlyRate == null)
    return 'Cargá una suscripción mensual, una tarifa por hora o las dos.';
  const fin = c.hasta ?? '9999-12';
  const pisada = otras.find(
    (o) => o.desde <= fin && (o.hasta ?? '9999-12') >= c.desde,
  );
  if (pisada)
    return `Ya hay una condición para este proyecto y cliente que vale desde ${pisada.desde}${pisada.hasta ? ` hasta ${pisada.hasta}` : ''}. Cerrala antes de crear otra.`;
  return null;
}
