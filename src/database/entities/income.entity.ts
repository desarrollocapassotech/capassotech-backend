import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BillingCurrency } from './enums';

// tracker.incomes: pagos únicos de proyectos, visible solo para admin/contable
// (ver IncomeController). Todo ingreso es un pago único (sin periodicidad ni
// cuotas, a diferencia de Gastos).
@Entity({ name: 'incomes', schema: 'tracker' })
export class IncomeEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: BillingCurrency, enumName: 'billing_currency', default: BillingCurrency.USD })
  currency: BillingCurrency;

  @Column({ name: 'payment_method', type: 'text' })
  paymentMethod: string;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
