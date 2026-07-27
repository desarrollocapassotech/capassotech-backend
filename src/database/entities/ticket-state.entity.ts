import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// tracker.ticket_states: reemplaza al enum fijo tracker.ticket_state para que el
// panel de soporte pueda agregar columnas/estados nuevos sin tocar código.
@Entity({ name: 'ticket_states', schema: 'tracker' })
export class TicketStateEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text' })
  color: string;

  @Column({ type: 'int' })
  orden: number;

  @Column({ name: 'es_default', type: 'boolean', default: false })
  esDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
