import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TicketAttachmentEntity } from './ticket-attachment.entity';
import { TicketMessageEntity } from './ticket-message.entity';
import { TicketOrigin, TicketPriority, TicketEmpresa } from '../../tickets/ticket.enums';

@Entity({ name: 'tickets', schema: 'tracker' })
export class TicketEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text', unique: true })
  codigo: string;

  @Column({ type: 'enum', enum: TicketEmpresa, enumName: 'ticket_empresa' })
  empresa: TicketEmpresa;

  @Column({ type: 'text' })
  sistema: string;

  @Column({ type: 'text' })
  asunto: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'enum', enum: TicketPriority, enumName: 'ticket_priority' })
  prioridad: TicketPriority;

  // FK a tracker.ticket_states(id): reemplaza al enum fijo tracker.ticket_state
  // para que el panel de soporte pueda agregar estados/columnas nuevos sin deploy.
  @Column({ type: 'text', default: 'nuevo' })
  estado: string;

  @Column({ type: 'enum', enum: TicketOrigin, enumName: 'ticket_origin' })
  origen: TicketOrigin;

  @Column({ name: 'cliente_nombre', type: 'text' })
  clienteNombre: string;

  @Column({ name: 'cliente_email', type: 'text' })
  clienteEmail: string;

  @Column({ name: 'client_id', type: 'text', nullable: true })
  clientId: string | null;

  @Column({ name: 'asignado_a', type: 'text', nullable: true })
  asignadoA: string | null;

  @OneToMany(() => TicketMessageEntity, (message) => message.ticket, { cascade: true })
  mensajes: TicketMessageEntity[];

  @OneToMany(() => TicketAttachmentEntity, (attachment) => attachment.ticket, { cascade: true })
  adjuntos: TicketAttachmentEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
