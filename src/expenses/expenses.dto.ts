import { BillingCurrency, ExpensePeriodicity } from '../database/entities';

export interface CreateExpenseDto {
  description: string;
  amount: number;
  currency?: BillingCurrency;
  periodicity?: ExpensePeriodicity;
  projectId?: string | null;
  paymentMethod?: string | null;
  alternativePaymentMethod?: string | null;
  paymentAccess?: string | null;
  category?: string | null;
  expenseDate?: string | null;
  notes?: string | null;
}

// Todos los campos son opcionales: solo se aplican los que vienen en el body.
export type UpdateExpenseDto = Partial<CreateExpenseDto>;

// Alta de un gasto único pagado en cuotas: crea una fila de tracker.expenses por
// cuota (mismo concepto, monto = totalAmount / installmentsCount, fecha = la
// primera + N meses). Siempre periodicity = 'unico' (no aplica a mensuales).
export interface CreateExpenseInstallmentsDto {
  description: string;
  totalAmount: number;
  installmentsCount: number;
  firstInstallmentDate: string;
  currency?: BillingCurrency;
  projectId?: string | null;
  paymentMethod?: string | null;
  alternativePaymentMethod?: string | null;
  paymentAccess?: string | null;
  category?: string | null;
  notes?: string | null;
}
