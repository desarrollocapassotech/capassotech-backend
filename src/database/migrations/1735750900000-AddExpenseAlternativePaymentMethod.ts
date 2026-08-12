import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpenseAlternativePaymentMethod1735750900000 implements MigrationInterface {
  name = 'AddExpenseAlternativePaymentMethod1735750900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.expenses ADD COLUMN IF NOT EXISTS alternative_payment_method TEXT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tracker.expenses DROP COLUMN IF EXISTS alternative_payment_method;`);
  }
}
