import { Entity, PrimaryColumn } from 'typeorm';

// tracker.expense_projects: 0..N proyectos por gasto (reemplaza expenses.project_id).
@Entity({ name: 'expense_projects', schema: 'tracker' })
export class ExpenseProjectEntity {
  @PrimaryColumn({ name: 'expense_id', type: 'text' })
  expenseId: string;

  @PrimaryColumn({ name: 'project_id', type: 'text' })
  projectId: string;
}
