import { BillingCurrency } from '../database/entities';

export interface CreateIncomeDto {
  description: string;
  amount: number;
  currency?: BillingCurrency;
  paymentMethod: string;
  paymentDate: string;
  projectIds?: string[];
  notes?: string | null;
}

// Todos los campos son opcionales: solo se aplican los que vienen en el body.
export type UpdateIncomeDto = Partial<CreateIncomeDto>;
