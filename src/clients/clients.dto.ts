import { BillingCurrency } from '../database/entities';

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
  analistaFuncionalIds?: string[];
  profileImageUrl?: string | null;
}

// Todos los campos son opcionales: el set efectivo que se aplica depende del rol
// de quien hace la request (ver clients.service.ts -> resolveAllowedFields).
export type UpdateClientDto = Partial<CreateClientDto>;
