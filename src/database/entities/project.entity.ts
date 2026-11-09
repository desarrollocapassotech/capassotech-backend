import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { BillableHoursCalculationConfig } from './client.entity';

export type ProjectKind = 'cliente' | 'producto' | 'interno';
export const PROJECT_KINDS: ProjectKind[] = ['cliente', 'producto', 'interno'];

// tracker.projects <- Firestore /projects
@Entity({ name: 'projects', schema: 'tracker' })
export class ProjectEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // cliente: de un cliente (tiene dueño). producto: propio, se vende a varios clientes por
  // suscripción (Vialto, Faktia). interno: propio, no se le cobra a nadie.
  @Column({ type: 'text', default: 'cliente' })
  kind: ProjectKind;

  // Dueño del proyecto: ve sus horas en el portal y recibe las alertas. Null en productos e
  // internos (horas propias). Lo que se cobra no sale de acá sino de project_billing_terms.
  @Column({ name: 'client_id', type: 'text', nullable: true })
  clientId: string | null;

  // Espejo de utils.ts -> BillableHoursCalculationConfig. Null = la configuración por defecto.
  @Column({ name: 'billable_config', type: 'jsonb', nullable: true })
  billableConfig: BillableHoursCalculationConfig | null;

  // Key de una entrada de JIRA_CONNECTIONS: qué site de Jira usar para este proyecto.
  @Column({ name: 'jira_connection_key', type: 'text', nullable: true })
  jiraConnectionKey: string | null;

  @Column({ name: 'jira_ids', type: 'text', array: true, default: '{}' })
  jiraIds: string[];

  @Column({ name: 'billable_hours_limit', type: 'numeric', precision: 12, scale: 2, nullable: true })
  billableHoursLimit: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
