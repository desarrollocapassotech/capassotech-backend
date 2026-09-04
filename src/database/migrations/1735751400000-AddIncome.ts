import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.incomes: pagos únicos de proyectos, visible solo para admin/contable
 * (ver IncomeController). A diferencia de tracker.expenses, todo ingreso es un
 * pago único (sin periodicidad ni cuotas), y payment_method/payment_date son
 * obligatorios desde el arranque (evita registros sin fecha, invisibles en el
 * balance mensual — lección aprendida con tracker.expenses).
 */
export class AddIncome1735751400000 implements MigrationInterface {
  name = 'AddIncome1735751400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.incomes (
  id              TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  currency        tracker.billing_currency NOT NULL DEFAULT 'USD',
  payment_method  TEXT NOT NULL,
  payment_date    DATE NOT NULL,
  notes           TEXT NULL,
  created_by      TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tracker.incomes IS
  'Pagos únicos de proyectos cargados por admin/contable, para que el balance mensual refleje ingresos reales más allá de la tarifa recurrente del proyecto.';

CREATE TABLE IF NOT EXISTS tracker.income_projects (
  income_id   TEXT NOT NULL REFERENCES tracker.incomes(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (income_id, project_id)
);

CREATE INDEX IF NOT EXISTS income_projects_project_id_idx ON tracker.income_projects (project_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS tracker.income_projects;
DROP TABLE IF EXISTS tracker.incomes;
    `);
  }
}
