import { MigrationInterface, QueryRunner } from 'typeorm';

// Postgres no permite quitar un valor de un enum (no existe DROP VALUE), así que
// down() queda como no-op documentado en vez de un revert real: la migración es
// segura de aplicar en cualquier momento, pero no reversible sin recrear el tipo.
export class AddTaskBillingTypeSupport1735751500000 implements MigrationInterface {
  name = 'AddTaskBillingTypeSupport1735751500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE tracker.task_billing_type ADD VALUE IF NOT EXISTS 'support';`);
  }

  public async down(): Promise<void> {
    // No-op a propósito: Postgres no soporta DROP VALUE en un tipo ENUM.
  }
}
