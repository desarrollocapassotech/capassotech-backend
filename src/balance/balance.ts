// Balance del mes por cliente: espejo del "Balance por cliente" del Panel de administración
// (capassotech-timetracker-frontend/src/pages/AdminPanel.tsx, clientBalanceData y las tarjetas
// del mes). Tiene que dar lo mismo que el Panel para el mismo mes: si cambia una regla allá,
// cambiarla acá. Todo se calcula en USD con el TC del mes; el email lo pasa a pesos.

import type { BillableHoursCalculationConfig } from '../database/entities/client.entity';
import type { ProjectKind } from '../database/entities/project.entity';
import { gastoDelMes, partesDelGasto } from '../expenses/gastos';
import {
  billableHoursForEntry,
  getEffectiveHourlyRate,
  toUSD,
  type BillableCollaborator,
} from '../integrations/billable-hours.util';
import {
  clienteDeHora,
  condicionDelMes,
  proyectoFacturable,
  vigente,
  type CondicionCobro,
} from '../projects/condiciones';
import { ExpensePeriodicity } from '../database/entities/enums';

export interface DatosBalance {
  mes: string;
  usdRate: number;
  proyectos: Array<{
    id: string;
    name: string;
    active: boolean;
    kind: ProjectKind;
    clientId: string | null;
    billableConfig: BillableHoursCalculationConfig | null;
  }>;
  condiciones: CondicionCobro[];
  clientes: Array<{ id: string; name: string }>;
  horas: Array<{
    projectId: string;
    clientId: string | null;
    collaboratorId: string;
    hours: number;
    taskBillingType: string | null;
  }>;
  /** Por id y por uid de Firebase (en las horas puede venir cualquiera de los dos). */
  colaboradores: Map<string, BillableCollaborator & { name: string }>;
  gastos: Array<{
    id: string;
    description: string;
    amount: number;
    currency: string;
    periodicity: ExpensePeriodicity;
    expenseDate: string | null;
    category: string | null;
    projectIds: string[];
    clientIds: string[];
  }>;
  /** Cargos a mano y cuotas del mes de la Cuenta corriente (`cargosDelMes`). */
  cargos: Array<{ clienteId: string | null; proyectoId: string | null; importe: number; moneda: string }>;
  /** Horas extra y bonos de los recibos del mes. */
  adicionales: Array<{ importe: number; moneda: string }>;
}

export interface FilaBalance {
  clientId: string;
  name: string;
  costo: number;
  gastos: number;
  paga: number;
}

export interface ConceptoSinCliente {
  tipo: 'sueldos' | 'gastos' | 'cobros';
  label: string;
  usd: number;
  horas: number;
}

export interface Balance {
  mes: string;
  usdRate: number;
  totales: { sueldos: number; gastos: number; facturado: number; ganancia: number };
  grupos: Array<{ key: string; name: string; producto: boolean; filas: FilaBalance[] }>;
  sinCliente: ConceptoSinCliente[];
  sinClienteTotales: { sueldos: number; gastos: number; cobros: number };
}

const GRUPO_CLIENTES = 'clientes';

export function calcularBalance(d: DatosBalance): Balance {
  const { mes, usdRate } = d;
  const proyectoPorId = new Map(d.proyectos.map((p) => [p.id, p]));
  const clientePorId = new Map(d.clientes.map((c) => [c.id, c]));
  const gastosDelMes = d.gastos.filter((g) => gastoDelMes(g, mes));
  const usd = (importe: number, moneda: string) => toUSD(importe, moneda, undefined, usdRate);

  const costoDeHora = (h: DatosBalance['horas'][number]) => {
    const colaborador = d.colaboradores.get(h.collaboratorId);
    if (!colaborador) return 0;
    const tarifa = toUSD(
      getEffectiveHourlyRate(colaborador, h.projectId),
      colaborador.currency,
      colaborador.exchangeRate,
      usdRate,
    );
    return h.hours * tarifa;
  };

  /** Lo que cobra un proyecto en el mes (todo, o solo lo de `clientId`), como `cobradoDelMes` del Panel. */
  const cobradoDelMes = (project: DatosBalance['proyectos'][number], clientId?: string) => {
    if (!project.active) return 0;
    let total = 0;
    for (const c of d.condiciones) {
      if (c.projectId !== project.id || !vigente(c, mes) || c.monthlyAmount == null) continue;
      if (clientId && c.clientId !== clientId) continue;
      total += usd(c.monthlyAmount, c.currency);
    }
    for (const h of d.horas) {
      if (h.projectId !== project.id) continue;
      const responsable = clienteDeHora(project.clientId, h.clientId);
      if (clientId && responsable !== clientId) continue;
      const facturable = proyectoFacturable(project.id, condicionDelMes(d.condiciones, project.id, responsable, mes));
      if (facturable.billingType !== 'hourly' || !facturable.rate) continue;
      const { billableHours } = billableHoursForEntry(
        h.hours,
        facturable,
        d.colaboradores.get(h.collaboratorId),
        usdRate,
        { billableConfig: project.billableConfig },
        h.taskBillingType,
      );
      const tarifa = usd(facturable.rate, facturable.currency || 'USD');
      if (tarifa > 0 && billableHours > 0) total += billableHours * tarifa;
    }
    return total;
  };

  // ── Tarjetas del mes ──
  const sueldos =
    d.horas.reduce((s, h) => s + costoDeHora(h), 0) + d.adicionales.reduce((s, a) => s + usd(a.importe, a.moneda), 0);
  const gastos = gastosDelMes.reduce((s, g) => s + usd(g.amount, g.currency), 0);
  const reintegros = gastosDelMes.reduce((s, g) => (g.clientIds.length ? s + usd(g.amount, g.currency) : s), 0);
  const facturado =
    d.proyectos.reduce((s, p) => s + cobradoDelMes(p), 0) +
    d.cargos.reduce((s, c) => s + usd(c.importe, c.moneda), 0) +
    reintegros;

  // ── Por grupo y cliente ──
  type Fila = FilaBalance;
  const grupos = new Map<string, { key: string; name: string; producto: boolean; filas: Map<string, Fila> }>();
  const grupoDe = (projectId: string | null | undefined) => {
    const p = projectId ? proyectoPorId.get(projectId) : undefined;
    return p?.kind === 'producto' ? p.id : GRUPO_CLIENTES;
  };
  const filaDe = (groupKey: string, clientId: string): Fila | null => {
    const cliente = clientePorId.get(clientId);
    if (!cliente) return null;
    let grupo = grupos.get(groupKey);
    if (!grupo) {
      const producto = groupKey !== GRUPO_CLIENTES;
      grupo = {
        key: groupKey,
        name: producto ? proyectoPorId.get(groupKey)?.name ?? 'Producto' : 'Proyectos de clientes',
        producto,
        filas: new Map(),
      };
      grupos.set(groupKey, grupo);
    }
    let fila = grupo.filas.get(clientId);
    if (!fila) {
      fila = { clientId, name: cliente.name, costo: 0, gastos: 0, paga: 0 };
      grupo.filas.set(clientId, fila);
    }
    return fila;
  };

  const sinCliente = new Map<string, ConceptoSinCliente>();
  const anotar = (tipo: ConceptoSinCliente['tipo'], key: string, label: string, monto: number, horas = 0) => {
    if (Math.abs(monto) <= 0) return;
    const k = `${tipo}:${key}`;
    const c = sinCliente.get(k) ?? { tipo, label, usd: 0, horas: 0 };
    c.usd += monto;
    c.horas += horas;
    sinCliente.set(k, c);
  };
  const nombreProyecto = (id: string | null | undefined) => (id ? proyectoPorId.get(id)?.name : undefined) ?? 'Proyecto eliminado';

  for (const project of d.proyectos) {
    if (project.kind === 'interno') continue;
    const groupKey = grupoDe(project.id);
    const clientIds = new Set<string>();
    if (project.clientId) clientIds.add(project.clientId);
    for (const c of d.condiciones) if (c.projectId === project.id && vigente(c, mes)) clientIds.add(c.clientId);
    for (const clientId of clientIds) {
      const fila = filaDe(groupKey, clientId);
      const monto = cobradoDelMes(project, clientId);
      if (fila) fila.paga += monto;
      else anotar('cobros', 'cliente-borrado', 'Cobros de clientes que ya no existen', monto);
    }
  }

  for (const cargo of d.cargos) {
    const fila = cargo.clienteId ? filaDe(grupoDe(cargo.proyectoId), cargo.clienteId) : null;
    const monto = usd(cargo.importe, cargo.moneda);
    if (fila) fila.paga += monto;
    else anotar('cobros', 'cliente-borrado', 'Cobros de clientes que ya no existen', monto);
  }

  const sinClientePorProducto = new Map<string, { usd: number; horas: number }>();
  for (const h of d.horas) {
    const project = proyectoPorId.get(h.projectId);
    if (!project) continue;
    const costo = costoDeHora(h);
    const clientId = clienteDeHora(project.clientId, h.clientId);
    if (!clientId) {
      if (project.kind === 'producto') {
        const actual = sinClientePorProducto.get(project.id) ?? { usd: 0, horas: 0 };
        actual.usd += costo;
        actual.horas += h.hours;
        sinClientePorProducto.set(project.id, actual);
      } else {
        anotar(
          'sueldos',
          `proyecto:${project.id}`,
          project.kind === 'interno' ? `Horas internas en ${project.name}` : `Horas en ${project.name} (sin cliente dueño)`,
          costo,
          h.hours,
        );
      }
      continue;
    }
    const fila = filaDe(grupoDe(project.id), clientId);
    if (fila) fila.costo += costo;
    else anotar('sueldos', 'cliente-borrado', 'Horas de clientes que ya no existen', costo, h.hours);
  }

  // Horas de un producto sin cliente marcado: entre sus clientes, según lo que paga cada uno.
  for (const [productId, { usd: monto, horas }] of sinClientePorProducto) {
    const filas = [...(grupos.get(productId)?.filas.values() ?? [])];
    if (filas.length === 0 || monto <= 0) {
      anotar('sueldos', `proyecto:${productId}`, `Horas en ${nombreProyecto(productId)} (producto sin clientes)`, monto, horas);
      continue;
    }
    const totalPaga = filas.reduce((s, f) => s + Math.max(f.paga, 0), 0);
    for (const fila of filas) {
      const share = totalPaga > 0 ? Math.max(fila.paga, 0) / totalPaga : 1 / filas.length;
      if (share > 0) fila.costo += monto * share;
    }
  }

  for (const gasto of gastosDelMes) {
    const montoGasto = usd(gasto.amount, gasto.currency);
    if (gasto.clientIds.length > 0) {
      const groupKey = grupoDe([...gasto.projectIds].sort()[0]);
      for (const [clientId, parte] of partesDelGasto(montoGasto, gasto.clientIds)) {
        const fila = filaDe(groupKey, clientId);
        if (!fila) {
          anotar('gastos', 'cliente-borrado', 'Gastos de clientes que ya no existen', parte);
          continue;
        }
        fila.gastos += parte;
        fila.paga += parte;
      }
      continue;
    }
    const projectIds = new Set(gasto.projectIds);
    if (projectIds.size === 0) {
      const categoria = gasto.category?.trim() || 'Sin categoría';
      anotar('gastos', `categoria:${categoria.toLowerCase()}`, `Generales: ${categoria}`, montoGasto);
      continue;
    }
    let pesos = new Map<string, { groupKey: string; clientId: string; peso: number }>();
    const sumarPeso = (groupKey: string, clientId: string, peso: number) => {
      const k = `${groupKey}:${clientId}`;
      pesos.set(k, { groupKey, clientId, peso: (pesos.get(k)?.peso ?? 0) + peso });
    };
    for (const h of d.horas) {
      if (!projectIds.has(h.projectId)) continue;
      const clientId = clienteDeHora(proyectoPorId.get(h.projectId)?.clientId, h.clientId);
      if (clientId) sumarPeso(grupoDe(h.projectId), clientId, h.hours);
    }
    const total = () => [...pesos.values()].reduce((a, b) => a + b.peso, 0);
    if (total() <= 0) {
      pesos = new Map();
      for (const id of projectIds) {
        const project = proyectoPorId.get(id);
        if (!project) continue;
        const groupKey = grupoDe(id);
        if (project.clientId) pesos.set(`${groupKey}:${project.clientId}`, { groupKey, clientId: project.clientId, peso: 1 });
        for (const c of d.condiciones) {
          if (c.projectId === id && vigente(c, mes)) pesos.set(`${groupKey}:${c.clientId}`, { groupKey, clientId: c.clientId, peso: 1 });
        }
      }
    }
    const totalPesos = total();
    if (totalPesos <= 0) {
      const nombres = [...projectIds].map(nombreProyecto).sort().join(', ');
      anotar('gastos', `proyectos:${nombres}`, `De ${nombres}`, montoGasto);
      continue;
    }
    for (const { groupKey, clientId, peso } of pesos.values()) {
      const parte = (montoGasto * peso) / totalPesos;
      const fila = filaDe(groupKey, clientId);
      if (fila) fila.gastos += parte;
      else anotar('gastos', 'cliente-borrado', 'Gastos de clientes que ya no existen', parte);
    }
  }

  for (const a of d.adicionales) {
    anotar('sueldos', 'adicionales', 'Horas extra y bonos de recibos', usd(a.importe, a.moneda));
  }

  const gruposOrdenados = [...grupos.values()]
    .map((g) => ({ key: g.key, name: g.name, producto: g.producto, filas: [...g.filas.values()].sort((a, b) => b.paga - a.paga) }))
    .sort((a, b) => (a.producto === b.producto ? a.name.localeCompare(b.name) : a.producto ? -1 : 1));

  // Lo que no quedó en ningún concepto (redondeos, un caso no previsto) va en "Otros", así
  // "Sin cliente" + los clientes siempre dan las tarjetas.
  const filas = gruposOrdenados.flatMap((g) => g.filas);
  const suma = (k: 'costo' | 'gastos' | 'paga') => filas.reduce((s, f) => s + f[k], 0);
  const sinClienteTotales = { sueldos: sueldos - suma('costo'), gastos: gastos - suma('gastos'), cobros: facturado - suma('paga') };
  const ordenTipo = { sueldos: 0, gastos: 1, cobros: 2 } as const;
  const conceptos = [...sinCliente.values()].sort((a, b) => ordenTipo[a.tipo] - ordenTipo[b.tipo] || b.usd - a.usd);
  for (const tipo of ['sueldos', 'gastos', 'cobros'] as const) {
    const resto = sinClienteTotales[tipo] - conceptos.filter((c) => c.tipo === tipo).reduce((s, c) => s + c.usd, 0);
    if (Math.abs(resto) > 0.01) conceptos.push({ tipo, label: 'Otros (sin detalle)', usd: resto, horas: 0 });
  }

  return {
    mes,
    usdRate,
    totales: { sueldos, gastos, facturado, ganancia: facturado - sueldos - gastos },
    grupos: gruposOrdenados,
    sinCliente: conceptos,
    sinClienteTotales,
  };
}
