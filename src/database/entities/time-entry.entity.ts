import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { TaskBillingType } from './enums';

// tracker.time_entries <- Firestore /timeEntries
// FKs a collaborators/projects usan ON DELETE RESTRICT (decisión deliberada, ver database/README.md).
@Entity({ name: 'time_entries', schema: 'tracker' })
export class TimeEntryEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'collaborator_id', type: 'text' })
  collaboratorId: string;

  // Snapshot denormalizado, igual que en Firestore.
  @Column({ name: 'collaborator_name', type: 'text' })
  collaboratorName: string;

  @Column({ name: 'task_id', type: 'text' })
  taskId: string;

  @Column({ name: 'task_title', type: 'text' })
  taskTitle: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId: string;

  // Snapshot denormalizado, igual que en Firestore.
  @Column({ name: 'project_name', type: 'text' })
  projectName: string;

  // Día calendario (medianoche local), no timestamp.
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  hours: string;

  @Column({ type: 'text', nullable: true })
  comments: string | null;

  // Snapshot de "Story point estimate" tomado de Jira al cargar la hora (ver
  // JiraService.getIssueForProject). Solo informativo: no interviene en
  // ningún cálculo de facturación.
  @Column({ name: 'story_points', type: 'numeric', precision: 6, scale: 2, nullable: true })
  storyPoints: string | null;

  @Column({
    name: 'task_billing_type',
    type: 'enum',
    enum: TaskBillingType,
    enumName: 'task_billing_type',
    default: TaskBillingType.FEATURE,
  })
  taskBillingType: TaskBillingType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Estado de sincronización con el Google Sheet de reporting (ver TimeEntriesService).
  @Column({ name: 'sheet_synced_at', type: 'timestamptz', nullable: true })
  sheetSyncedAt: Date | null;

  @Column({ name: 'sheet_sync_attempts', type: 'int', default: 0 })
  sheetSyncAttempts: number;

  @Column({ name: 'sheet_sync_last_error', type: 'text', nullable: true })
  sheetSyncLastError: string | null;
}
