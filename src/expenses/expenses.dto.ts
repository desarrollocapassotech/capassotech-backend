import { BillingCurrency, ExpensePeriodicity } from '../database/entities';

export interface CreateExpenseDto {
  description: string;
  amount: number;
  currency?: BillingCurrency;
  periodicity?: ExpensePeriodicity;
  projectId?: string | null;
  paymentMethod?: string | null;
  alternativePaymentMethod?: string | null;
  category?: string | null;
  expenseDate?: string | null;
  notes?: string | null;
}

// Todos los campos son opcionales: solo se aplican los que vienen en el body.
export type UpdateExpenseDto = Partial<CreateExpenseDto>;
