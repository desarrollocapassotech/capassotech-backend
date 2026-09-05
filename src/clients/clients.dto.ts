import { BillingCurrency } from '../database/entities';
import { BillableHoursCalculationConfig } from '../database/entities/client.entity';

export interface CreateClientDto {
  name: string;
  email?: string | null;
  password?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  floor?: string | null;
  razonSocial?: string | null;
  cuit?: string | null;
  ivaCondition?: string | null;
  billingCurrency?: BillingCurrency;
  billableConfig?: Partial<BillableHoursCalculationConfig> | null;
  analistaFuncionalIds?: string[];
  profileImageUrl?: string | null;
  billableHoursLimit?: number | null;
  jiraConnectionKey?: string | null;
}

// Todos los campos son opcionales: el set efectivo que se aplica depende del rol
// de quien hace la request (ver clients.service.ts -> resolveAllowedFields).
export type UpdateClientDto = Partial<CreateClientDto>;
