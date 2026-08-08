import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// tracker.client_hours_alerts: un registro por (cliente, año, mes) ya notificado.
@Entity({ name: 'client_hours_alerts', schema: 'tracker' })
export class ClientHoursAlertEntity {
  @PrimaryColumn({ name: 'client_id', type: 'text' })
  clientId: string;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @PrimaryColumn({ type: 'int' })
  month: number;

  @CreateDateColumn({ name: 'notified_at', type: 'timestamptz' })
  notifiedAt: Date;
}
