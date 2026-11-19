import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// tracker.balance_summary_sends: un registro por resumen semanal del balance ya mandado (el día
// del envío). Evita repetir el email si el cron corre dos veces, por ejemplo durante un deploy.
@Entity({ name: 'balance_summary_sends', schema: 'tracker' })
export class BalanceSummarySendEntity {
  @PrimaryColumn({ name: 'send_date', type: 'date' })
  sendDate: string;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
