import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BillingCurrency, ExpensePeriodicity } from './enums';

// tracker.expenses: gastos de la empresa, visible solo para admin/contable
// (ver ExpensesController). Solo description y amount son obligatorios.
@Entity({ name: 'expenses', schema: 'tracker' })
export class ExpenseEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: BillingCurrency, enumName: 'billing_currency', default: BillingCurrency.USD })
  currency: BillingCurrency;

  @Column({ type: 'enum', enum: ExpensePeriodicity, enumName: 'expense_periodicity', default: ExpensePeriodicity.UNICO })
  periodicity: ExpensePeriodicity;

  @Column({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'alternative_payment_method', type: 'text', nullable: true })
  alternativePaymentMethod: string | null;

  // Cómo acceder al pago (ej: en qué cuenta/plataforma entrar, con qué usuario).
  @Column({ name: 'payment_access', type: 'text', nullable: true })
  paymentAccess: string | null;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ name: 'expense_date', type: 'date', nullable: true })
  expenseDate: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
