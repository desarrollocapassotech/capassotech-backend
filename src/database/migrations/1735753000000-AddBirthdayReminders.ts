import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avisos de cumpleaños ya mandados (3, 2, 1 días antes y el mismo día), para no repetirlos.
 * Solo agrega una tabla: correrla antes de desplegar el código.
 */
export class AddBirthdayReminders1735753000000 implements MigrationInterface {
  name = 'AddBirthdayReminders1735753000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.birthday_reminders (
  collaborator_id TEXT NOT NULL REFERENCES tracker.collaborators(id) ON DELETE CASCADE,
  birthday        DATE NOT NULL,
  days_before     INT  NOT NULL CHECK (days_before BETWEEN 0 AND 3),
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collaborator_id, birthday, days_before)
);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.birthday_reminders;`);
  }
}
