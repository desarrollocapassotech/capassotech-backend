import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avisos de vencimiento de la cuenta corriente ya mandados, uno por cargo y fecha de vencimiento,
 * para no repetirlos. Solo agrega una tabla: correrla antes de desplegar el código.
 */
export class AddCcDueReminders1735753100000 implements MigrationInterface {
  name = 'AddCcDueReminders1735753100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.cc_due_reminders (
  movement_id UUID NOT NULL REFERENCES tracker.cc_movements(id) ON DELETE CASCADE,
  due_date    DATE NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (movement_id, due_date)
);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.cc_due_reminders;`);
  }
}
