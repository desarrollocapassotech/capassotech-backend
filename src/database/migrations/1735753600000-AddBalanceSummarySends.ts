import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resúmenes semanales del balance ya mandados, uno por día de envío, para no repetirlos si el
 * cron corre dos veces. Solo agrega una tabla: se puede correr antes de desplegar el código.
 */
export class AddBalanceSummarySends1735753600000 implements MigrationInterface {
  name = 'AddBalanceSummarySends1735753600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.balance_summary_sends (
  send_date DATE NOT NULL PRIMARY KEY,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.balance_summary_sends;`);
  }
}
