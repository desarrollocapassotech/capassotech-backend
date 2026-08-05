import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// tracker.monthly_exchange_rates: tipo de cambio USD/ARS bloqueado a mano por un
// admin/contable para un mes calendario puntual (ej. para liquidar recibos o
// facturación de ese mes con un valor fijo en vez del TC del día). Si no hay fila
// para un (year, month), el caller (ver ExchangeRateService.getUsdRate) cae al TC
// en vivo de dolarapi.com, igual que antes de que existiera esta tabla.
@Entity({ name: 'monthly_exchange_rates', schema: 'tracker' })
export class MonthlyExchangeRateEntity {
  @PrimaryColumn({ type: 'int' })
  year: number;

  @PrimaryColumn({ type: 'int' })
  month: number;

  @Column({ type: 'numeric', precision: 12, scale: 4 })
  rate: string;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
