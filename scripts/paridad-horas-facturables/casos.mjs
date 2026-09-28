// Casos de paridad: se corren contra computeBillableHoursDetails del FRONTEND del tracker.
const P = (o) => ({ id: 'p1', rate: 30, currency: 'USD', billingType: 'hourly', ...o });
const C = (o) => ({ id: 'c1', hourlyRate: 10, currency: 'USD', projectRates: [], ...o });
const K = (cfg) => ({ billableConfig: cfg });

export const casos = [
  { nombre: 'default USD/USD', hours: 6, project: P(), collaborator: C(), usdRate: 1000, client: K(undefined), task: 'feature' },
  { nombre: 'colaborador ARS', hours: 8, project: P({ rate: 25 }), collaborator: C({ hourlyRate: 9000, currency: 'ARS' }), usdRate: 1200, client: K({}), task: 'feature' },
  { nombre: 'proyecto ARS', hours: 5.5, project: P({ rate: 40000, currency: 'ARS' }), collaborator: C({ hourlyRate: 12 }), usdRate: 1350.5, client: K(null), task: 'support' },
  { nombre: 'override por proyecto', hours: 7, project: P(), collaborator: C({ projectRates: [{ projectId: 'p1', hourlyRate: 15 }] }), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'override de otro proyecto', hours: 7, project: P(), collaborator: C({ projectRates: [{ projectId: 'otro', hourlyRate: 15 }] }), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'override de factor por colaborador', hours: 4, project: P(), collaborator: C(), usdRate: 1000, client: K({ collaboratorOverrides: { c1: 2.5 } }), task: 'feature' },
  { nombre: 'factor custom', hours: 4, project: P(), collaborator: C(), usdRate: 1000, client: K({ baseFactorStrategy: 'custom', customBaseFactor: '1,8' }), task: 'feature' },
  { nombre: 'custom sin factor cae a ratio', hours: 4, project: P(), collaborator: C(), usdRate: 1000, client: K({ baseFactorStrategy: 'custom' }), task: 'feature' },
  { nombre: 'markup custom', hours: 9, project: P(), collaborator: C(), usdRate: 1000, client: K({ markupMultiplier: 2 }), task: 'feature' },
  { nombre: 'markup bug interno', hours: 9, project: P(), collaborator: C(), usdRate: 1000, client: K({ internalBugMarkupMultiplier: 1.1 }), task: 'internal_bug' },
  { nombre: 'bug interno sin markup propio', hours: 9, project: P(), collaborator: C(), usdRate: 1000, client: K({}), task: 'internal_bug' },
  { nombre: 'horas fijas adicionales', hours: 2, project: P(), collaborator: C(), usdRate: 1000, client: K({ additionalFixedHours: 0.5 }), task: 'feature' },
  { nombre: 'mínimo facturable', hours: 3, project: P(), collaborator: C(), usdRate: 1000, client: K({ minimumBillableHours: 2 }), task: 'feature' },
  { nombre: 'tope en horas trabajadas', hours: 3, project: P({ rate: 5 }), collaborator: C({ hourlyRate: 20 }), usdRate: 1000, client: K({ markupMultiplier: 10 }), task: 'feature' },
  { nombre: 'horas fijas negativas', hours: 1, project: P(), collaborator: C(), usdRate: 1000, client: K({ additionalFixedHours: -5 }), task: 'feature' },
  { nombre: 'proyecto mensual', hours: 6, project: P({ billingType: 'monthly' }), collaborator: C(), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'proyecto sin tipo', hours: 6, project: P({ billingType: undefined }), collaborator: C(), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'proyecto sin tarifa', hours: 6, project: P({ rate: undefined }), collaborator: C(), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'sin colaborador', hours: 6, project: P(), collaborator: undefined, usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'cero horas', hours: 0, project: P(), collaborator: C(), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'colaborador tarifa 0', hours: 6, project: P(), collaborator: C({ hourlyRate: 0 }), usdRate: 1000, client: K({}), task: 'feature' },
  { nombre: 'usdRate inválido', hours: 6, project: P({ currency: 'ARS', rate: 30000 }), collaborator: C(), usdRate: 0, client: K({}), task: 'feature' },
  { nombre: 'config con strings', hours: 7.25, project: P(), collaborator: C({ exchangeRate: 900 }), usdRate: 1000, client: K({ markupMultiplier: '1,4', additionalFixedHours: '0.25', minimumBillableHours: '1' }), task: 'external_meeting' },
  { nombre: 'sin cliente', hours: 5, project: P(), collaborator: C(), usdRate: 1000, client: null, task: null },
];
