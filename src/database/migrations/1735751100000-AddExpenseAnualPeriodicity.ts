import { MigrationInterface, QueryRunner } from 'typeorm';

// Postgres no permite quitar un valor de un enum (no existe DROP VALUE), así que
// down() queda como no-op documentado en vez de un revert real: la migración es
// segura de aplicar en cualquier momento, pero no reversible sin recrear el tipo.
export class AddExpenseAnualPeriodicity1735751100000 implements MigrationInterface {
  name = 'AddExpenseAnualPeriodicity1735751100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE tracker.expense_periodicity ADD VALUE IF NOT EXISTS 'anual';`);
  }

  public async down(): Promise<void> {
    // No-op a propósito: Postgres no soporta DROP VALUE en un tipo ENUM.
  }
}
