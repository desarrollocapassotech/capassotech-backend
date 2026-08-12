// Reflejan 1:1 los tipos ENUM de Postgres definidos en database/schema.sql (schema "tracker").
// Ver database/README.md para el detalle de cada tabla.

export enum UserRole {
  COLABORADOR = 'colaborador',
  ADMIN = 'admin',
  PROJECT_MANAGER = 'project_manager',
  CLIENT = 'client',
  CONTABLE = 'contable',
  ANALISTA_FUNCIONAL = 'analista_funcional',
  QA_TESTER = 'qa_tester',
}

export enum BillingCurrency {
  USD = 'USD',
  ARS = 'ARS',
}

export enum ProjectBillingType {
  HOURLY = 'hourly',
  MONTHLY = 'monthly',
}

export enum TaskBillingType {
  FEATURE = 'feature',
  INTERNAL_BUG = 'internal_bug',
  EXTERNAL_BUG = 'external_bug',
  INTERNAL_MEETING = 'internal_meeting',
  EXTERNAL_MEETING = 'external_meeting',
}

export enum BillableBaseFactorStrategy {
  RATE_RATIO = 'rate_ratio',
  CUSTOM = 'custom',
}

export enum ProjectCollaboratorRole {
  MANAGER = 'manager',
  TEAM_MEMBER = 'team_member',
}

export enum ExpensePeriodicity {
  UNICO = 'unico',
  MENSUAL = 'mensual',
  ANUAL = 'anual',
}
