export interface UpsertClientPaymentDto {
  year: number;
  month: number;
  hoursPaid: number;
  note?: string | null;
}

export interface ClientPaymentResponse {
  clientId: string;
  year: number;
  month: number;
  hoursPaid: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}
