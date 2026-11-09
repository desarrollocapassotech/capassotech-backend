import type { BillableHoursCalculationConfig } from '../database/entities/client.entity';
import type { ProjectKind } from '../database/entities/project.entity';

// Lo que se cobra no va acá: son las condiciones de cobro (billing-terms.service.ts).
export interface CreateProjectDto {
  name: string;
  active?: boolean;
  /** cliente (con dueño), producto (Vialto, Faktia) o interno. Por defecto, cliente. */
  kind?: ProjectKind;
  /** Dueño del proyecto: obligatorio en los de cliente, vacío en productos e internos. */
  clientId?: string | null;
  billableConfig?: Partial<BillableHoursCalculationConfig> | null;
  jiraConnectionKey?: string | null;
  jiraIds?: string[];
  billableHoursLimit?: number | null;
  managerIds?: string[];
  teamMemberIds?: string[];
}

// Todos los campos son opcionales: solo se aplican los que vienen en el body.
export type UpdateProjectDto = Partial<CreateProjectDto>;

// Entregable de un proyecto: 0..N por proyecto, cada uno con su propia fecha.
export interface ProjectDeliverableDto {
  name: string;
  dueDate: string;
}

export interface ReplaceProjectDeliverablesDto {
  deliverables: ProjectDeliverableDto[];
}
