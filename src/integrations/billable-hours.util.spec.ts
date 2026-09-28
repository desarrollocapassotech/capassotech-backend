import { readFileSync } from 'fs';
import { join } from 'path';
import {
  billableHoursForEntry,
  computeBillableHoursDetails,
} from './billable-hours.util';

// Casos generados corriendo computeBillableHoursDetails del FRONTEND
// (scripts/paridad-horas-facturables/generar.mjs). Si alguno falla, el backend
// ya no factura las mismas horas que muestra el tracker.

interface Caso {
  nombre: string;
  hours: number;
  project?: {
    id: string;
    rate?: number;
    currency?: string;
    billingType?: string;
  };
  collaborator?: {
    id: string;
    hourlyRate: number;
    currency: string;
    exchangeRate?: number;
    projectRates?: Array<{ projectId: string; hourlyRate: number }>;
  };
  usdRate: number;
  client: { billableConfig?: unknown } | null;
  task: string | null;
  esperado: {
    billableHours: number;
    baseBillableHours: number;
    appliedFactor: number;
    markupMultiplier: number;
    usedHourlyCalculation: boolean;
    pantalla: number;
  };
}

const paridad = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'paridad-horas-facturables.json'),
    'utf8',
  ),
) as {
  casos: Caso[];
};

describe('paridad de horas facturables con el frontend', () => {
  it.each(paridad.casos.map((c) => [c.nombre, c] as const))(
    '%s',
    (_nombre, c) => {
      const d = computeBillableHoursDetails(
        c.hours,
        c.project,
        c.collaborator,
        c.usdRate,
        c.client,
        c.task,
      );
      expect(d.billableHours).toBe(c.esperado.billableHours);
      expect(d.baseBillableHours).toBe(c.esperado.baseBillableHours);
      expect(d.appliedFactor).toBe(c.esperado.appliedFactor);
      expect(d.markupMultiplier).toBe(c.esperado.markupMultiplier);
      expect(d.usedHourlyCalculation).toBe(c.esperado.usedHourlyCalculation);
      expect(
        billableHoursForEntry(
          c.hours,
          c.project,
          c.collaborator,
          c.usdRate,
          c.client,
          c.task,
        ).billableHours,
      ).toBe(c.esperado.pantalla);
    },
  );
});
