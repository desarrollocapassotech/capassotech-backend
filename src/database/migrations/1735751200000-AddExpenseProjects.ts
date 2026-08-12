import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza tracker.expenses.project_id (un solo proyecto por gasto) por
 * tracker.expense_projects: 0..N proyectos por gasto. Mismo patrón que
 * AddProjectDeliverables (contract_end_date -> project_deliverables): backfill
 * desde la columna vieja antes de borrarla, para no perder datos.
 */
export class AddExpenseProjects1735751200000 implements MigrationInterface {
  name = 'AddExpenseProjects1735751200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.expense_projects (
  expense_id  TEXT NOT NULL REFERENCES tracker.expenses(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, project_id)
);

CREATE INDEX IF NOT EXISTS expense_projects_project_id_idx ON tracker.expense_projects (project_id);

INSERT INTO tracker.expense_projects (expense_id, project_id)
SELECT id, project_id FROM tracker.expenses WHERE project_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE tracker.expenses DROP COLUMN project_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.expenses ADD COLUMN project_id TEXT NULL REFERENCES tracker.projects(id) ON DELETE SET NULL;

UPDATE tracker.expenses e
SET project_id = sub.project_id
FROM (
  SELECT DISTINCT ON (expense_id) expense_id, project_id
  FROM tracker.expense_projects
  ORDER BY expense_id, project_id
) sub
WHERE e.id = sub.expense_id;

DROP TABLE IF EXISTS tracker.expense_projects;
    `);
  }
}
