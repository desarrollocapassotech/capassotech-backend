import { normalizeBillableConfig } from '../clients/billable-config.util';
import { BillableHoursCalculationConfig } from '../database/entities/client.entity';
import { BillableBaseFactorStrategy } from '../database/entities/enums';

// Port al backend de capassotech-timetracker-frontend/src/lib/utils.ts
// (computeBillableHoursDetails, toUSD, getEffectiveHourlyRate). Tiene que dar
// EXACTAMENTE lo mismo que el frontend: lo cubre billable-hours.util.spec.ts con
// casos generados corriendo la función del frontend. Si se cambia la fórmula en
// uno de los dos lados, cambiarla en el otro y regenerar los casos.
//
// El frontend la aplica por registro de horas (no por mes ni por proyecto): el
// mínimo y las horas fijas adicionales se suman a cada registro.

export interface BillableProject {
  id: string;
  rate?: number;
  currency?: string;
  billingType?: string;
}

export interface BillableCollaborator {
  id: string;
  hourlyRate: number;
  currency: string;
  exchangeRate?: number;
  projectRates?: Array<{ projectId: string; hourlyRate: number }>;
}

export interface BillableClient {
  billableConfig?: unknown;
}

export interface BillableHoursComputationResult {
  billableHours: number;
  baseBillableHours: number;
  appliedFactor: number;
  markupMultiplier: number;
  additionalFixedHours: number;
  minimumBillableHours: number | null;
  config: BillableHoursCalculationConfig;
  usedHourlyCalculation: boolean;
}

export function getEffectiveHourlyRate(
  collaborator:
    | Pick<BillableCollaborator, 'hourlyRate' | 'projectRates'>
    | undefined,
  projectId: string | undefined,
): number {
  if (!collaborator) return 0;
  const override = projectId
    ? collaborator.projectRates?.find((rate) => rate.projectId === projectId)
    : undefined;
  return override ? override.hourlyRate : collaborator.hourlyRate;
}

export function toUSD(
  amount: number,
  currency: string,
  rate?: number,
  defaultRate = 1,
): number {
  if (currency === 'USD') return amount;
  // Para ARS siempre se usa el TC recibido en defaultRate (igual que el frontend).
  const effectiveRate =
    currency === 'ARS' ? defaultRate : rate && rate > 0 ? rate : defaultRate;
  return amount / effectiveRate;
}

export function computeBillableHoursDetails(
  hours: number,
  project: BillableProject | undefined,
  collaborator: BillableCollaborator | undefined,
  usdRate: number,
  client?: BillableClient | null,
  taskBillingType?: string | null,
): BillableHoursComputationResult {
  const normalizedHours = Number.isFinite(hours) ? hours : 0;
  const config = normalizeBillableConfig(client?.billableConfig);

  const effectiveMarkup =
    taskBillingType === 'internal_bug' &&
    config.internalBugMarkupMultiplier != null &&
    config.internalBugMarkupMultiplier > 0
      ? config.internalBugMarkupMultiplier
      : config.markupMultiplier;

  const baseResult: BillableHoursComputationResult = {
    billableHours: normalizedHours,
    baseBillableHours: normalizedHours,
    appliedFactor: 1,
    markupMultiplier: effectiveMarkup,
    additionalFixedHours: config.additionalFixedHours,
    minimumBillableHours: config.minimumBillableHours,
    config,
    usedHourlyCalculation: false,
  };

  if (normalizedHours <= 0) {
    return { ...baseResult, billableHours: 0, baseBillableHours: 0 };
  }

  if (project?.billingType === 'hourly' && (!project.rate || !collaborator)) {
    return { ...baseResult, billableHours: 0, baseBillableHours: 0 };
  }

  if (project?.billingType === 'hourly' && project.rate && collaborator) {
    const projectRateUSD = toUSD(
      project.rate,
      project.currency || 'USD',
      undefined,
      usdRate,
    );

    if (!Number.isFinite(projectRateUSD) || projectRateUSD <= 0) {
      return { ...baseResult, billableHours: 0, baseBillableHours: 0 };
    }

    const collaboratorRateUSD = toUSD(
      getEffectiveHourlyRate(collaborator, project?.id),
      collaborator.currency,
      collaborator.exchangeRate,
      usdRate,
    );

    const factor = projectRateUSD / (collaboratorRateUSD || 1);

    const overrideFactor =
      collaborator?.id && config.collaboratorOverrides[collaborator.id]
        ? config.collaboratorOverrides[collaborator.id]
        : null;

    const chosenFactor =
      overrideFactor && Number.isFinite(overrideFactor)
        ? overrideFactor
        : config.baseFactorStrategy === BillableBaseFactorStrategy.CUSTOM &&
            config.customBaseFactor
          ? config.customBaseFactor
          : factor;

    const safeFactor =
      Number.isFinite(chosenFactor) && chosenFactor !== 0 ? chosenFactor : 1;
    const baseBillable = normalizedHours / safeFactor;
    const markupMultiplier = effectiveMarkup > 0 ? effectiveMarkup : 1;
    const additional = Number.isFinite(config.additionalFixedHours)
      ? config.additionalFixedHours
      : 0;
    const minimum = config.minimumBillableHours ?? null;

    let billableHours = baseBillable * markupMultiplier + additional;

    if (minimum !== null) {
      billableHours = Math.max(billableHours, minimum);
    }

    // Nunca facturar más horas de las trabajadas (regla de seguridad si factor/tarifas están mal).
    billableHours = Math.min(billableHours, normalizedHours);

    if (!Number.isFinite(billableHours) || billableHours <= 0) {
      return {
        ...baseResult,
        billableHours: 0,
        baseBillableHours: baseBillable,
        appliedFactor: safeFactor,
        markupMultiplier,
        additionalFixedHours: additional,
        minimumBillableHours: minimum,
        usedHourlyCalculation: true,
      };
    }

    return {
      billableHours,
      baseBillableHours: baseBillable,
      appliedFactor: safeFactor,
      markupMultiplier,
      additionalFixedHours: additional,
      minimumBillableHours: minimum,
      config,
      usedHourlyCalculation: true,
    };
  }

  return baseResult;
}

/**
 * Horas facturables de un registro como las muestran las pantallas del tracker
 * (ClientHistoryView, useClientDebt, ClientPanel): solo proyectos por hora y solo si
 * se usó el cálculo por tarifa; si no, 0.
 */
export function billableHoursForEntry(
  hours: number,
  project: BillableProject | undefined,
  collaborator: BillableCollaborator | undefined,
  usdRate: number,
  client: BillableClient | null | undefined,
  taskBillingType: string | null | undefined,
): { billableHours: number; details: BillableHoursComputationResult } {
  const details = computeBillableHoursDetails(
    hours,
    project,
    collaborator,
    usdRate,
    client,
    taskBillingType,
  );
  const billableHours =
    project?.billingType === 'hourly' && details.usedHourlyCalculation
      ? details.billableHours
      : 0;
  return { billableHours, details };
}
