import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// tracker.client_receipts: recibos sin validez fiscal generados desde Facturación. El PDF no
// se guarda (ni se numera): queda solo el registro de que se le hizo recibo al cliente por
// las horas de un (año, mes), para mostrarlo como ya emitido.
@Entity({ name: 'client_receipts', schema: 'tracker' })
export class ClientReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'text' })
  clientId: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  month: number;

  /** Fecha del recibo (yyyy-MM-dd). */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  currency: 'USD' | 'ARS';

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  total: string;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
