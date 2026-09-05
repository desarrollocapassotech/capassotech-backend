import { TaskBillingType } from '../database/entities';

// collaboradorName y projectName NO se aceptan como input: el backend los resuelve
// siempre desde el colaborador/proyecto real al momento de guardar (snapshot
// confiable, en vez de confiar en lo que mande el cliente).
export interface CreateTimeEntryDto {
  colaboradorId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  date: string;
  hours: number;
  comments?: string | null;
  taskBillingType?: TaskBillingType;
  /** Snapshot de "Story point estimate" traído de Jira al momento de cargar la hora; solo informativo. */
  storyPoints?: number | null;
}

export type UpdateTimeEntryDto = Partial<CreateTimeEntryDto>;
