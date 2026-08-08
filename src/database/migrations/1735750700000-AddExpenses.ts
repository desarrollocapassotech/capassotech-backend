import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.expenses: gastos de la empresa, visible solo para admin/contable
 * (ver ExpensesController). Todos los campos salvo descripción/monto son
 * opcionales porque no todo gasto tiene proyecto, periodicidad definida, etc.
 */
export class AddExpenses1735750700000 implements MigrationInterface {
  name = 'AddExpenses1735750700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE tracker.expense_periodicity AS ENUM ('unico', 'mensual');

CREATE TABLE IF NOT EXISTS tracker.expenses (
  id              TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  currency        tracker.billing_currency NOT NULL DEFAULT 'USD',
  periodicity     tracker.expense_periodicity NOT NULL DEFAULT 'unico',
  project_id      TEXT NULL REFERENCES tracker.projects(id) ON DELETE SET NULL,
  payment_method  TEXT NULL,
  category        TEXT NULL,
  expense_date    DATE NULL,
  notes           TEXT NULL,
  created_by      TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tracker.expenses IS
  'Gastos de la empresa cargados por admin/contable. Todos los campos salvo description/amount son opcionales (proyecto, periodicidad, medio de pago, categoría, fecha, notas).';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS tracker.expenses;
DROP TYPE IF EXISTS tracker.expense_periodicity;
    `);
  }
}
