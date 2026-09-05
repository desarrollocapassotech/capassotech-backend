import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BillableBaseFactorStrategy, BillingCurrency } from './enums';

// Espejo de utils.ts -> BillableHoursCalculationConfig (se guarda tal cual en billable_config, JSONB)
export interface BillableHoursCalculationConfig {
  baseFactorStrategy: BillableBaseFactorStrategy;
  customBaseFactor: number | null;
  markupMultiplier: number;
  internalBugMarkupMultiplier: number | null;
  additionalFixedHours: number;
  minimumBillableHours: number | null;
  collaboratorOverrides: Record<string, number>;
}

export const DEFAULT_BILLABLE_CONFIG: BillableHoursCalculationConfig = {
  baseFactorStrategy: BillableBaseFactorStrategy.RATE_RATIO,
  customBaseFactor: null,
  markupMultiplier: 1.6,
  internalBugMarkupMultiplier: null,
  additionalFixedHours: 0,
  minimumBillableHours: null,
  collaboratorOverrides: {},
};

// tracker.clients <- Firestore /clients
@Entity({ name: 'clients', schema: 'tracker' })
export class ClientEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  province: string | null;

  @Column({ name: 'postal_code', type: 'text', nullable: true })
  postalCode: string | null;

  @Column({ type: 'text', nullable: true })
  floor: string | null;

  @Column({ name: 'razon_social', type: 'text', nullable: true })
  razonSocial: string | null;

  @Column({ type: 'text', nullable: true })
  cuit: string | null;

  @Column({ name: 'iva_condition', type: 'text', nullable: true })
  ivaCondition: string | null;

  // Legacy: texto plano igual que hoy en Firestore. Ver nota en database/README.md.
  @Column({ type: 'text', nullable: true })
  password: string | null;

  @Column({ name: 'billing_currency', type: 'enum', enum: BillingCurrency, enumName: 'billing_currency', default: BillingCurrency.USD })
  billingCurrency: BillingCurrency;

  @Column({ name: 'billable_config', type: 'jsonb', default: DEFAULT_BILLABLE_CONFIG })
  billableConfig: BillableHoursCalculationConfig;

  @Column({ name: 'profile_image_url', type: 'text', nullable: true })
  profileImageUrl: string | null;

  @Column({ name: 'billable_hours_limit', type: 'numeric', precision: 12, scale: 2, nullable: true })
  billableHoursLimit: string | null;

  // Key de una entrada del array JIRA_CONNECTIONS (env var): qué site/credenciales
  // de Jira usar para autocompletar tareas de este cliente. Null = sin Jira configurado.
  @Column({ name: 'jira_connection_key', type: 'text', nullable: true })
  jiraConnectionKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
