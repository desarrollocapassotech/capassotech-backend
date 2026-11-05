import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// tracker.collaborator_receipt_acknowledgements: recibos enviados por email a un colaborador
// y si ya confirmó que recibió el dinero. Los montos se guardan tal como salieron en el recibo
// (texto ya formateado), porque el recibo en sí no se persiste.
@Entity({ name: 'collaborator_receipt_acknowledgements', schema: 'tracker' })
export class CollaboratorReceiptAcknowledgementEntity {
  // También es el token del link público del email.
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'collaborator_id', type: 'text' })
  collaboratorId: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ name: 'month_year', type: 'text' })
  monthYear: string;

  @Column({ type: 'text' })
  total: string;

  @Column({ type: 'text', nullable: true })
  currency: string | null;

  @Column({ name: 'recipient_email', type: 'text' })
  recipientEmail: string;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
