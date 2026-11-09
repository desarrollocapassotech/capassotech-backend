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
  /**
   * Solo en productos (Vialto, Faktia): a qué cliente se le cobra la hora. Tiene que tener tarifa
   * por hora vigente ese mes en el producto. Null o ausente = interna.
   */
  clientId?: string | null;
}

export type UpdateTimeEntryDto = Partial<CreateTimeEntryDto>;
