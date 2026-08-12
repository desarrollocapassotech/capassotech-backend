import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpensePaymentAccess1735751000000 implements MigrationInterface {
  name = 'AddExpensePaymentAccess1735751000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.expenses ADD COLUMN IF NOT EXISTS payment_access TEXT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tracker.expenses DROP COLUMN IF EXISTS payment_access;`);
  }
}
