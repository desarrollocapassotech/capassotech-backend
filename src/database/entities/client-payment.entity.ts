import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// tracker.client_payments: cuántas horas facturables pagó un cliente en un
// (año, mes) puntual, cargado a mano por admin/contable. La deuda ("horas
// adeudadas") no se persiste: se calcula en el momento como horas facturables
// del mes (mismo cálculo que ClientHistoryView/AdminTimeManagement) menos lo
// que haya acá para ese (client_id, year, month). Sin fila = nada pagado.
@Entity({ name: 'client_payments', schema: 'tracker' })
export class ClientPaymentEntity {
  @PrimaryColumn({ name: 'client_id', type: 'text' })
  clientId: string;

  @PrimaryColumn({ type: 'int' })
  year: number;

  @PrimaryColumn({ type: 'int' })
  month: number;

  @Column({ name: 'hours_paid', type: 'numeric', precision: 12, scale: 2 })
  hoursPaid: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
