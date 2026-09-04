import { Entity, PrimaryColumn } from 'typeorm';

// tracker.income_projects: 0..N proyectos por ingreso (mismo patrón que expense_projects).
@Entity({ name: 'income_projects', schema: 'tracker' })
export class IncomeProjectEntity {
  @PrimaryColumn({ name: 'income_id', type: 'text' })
  incomeId: string;

  @PrimaryColumn({ name: 'project_id', type: 'text' })
  projectId: string;
}
