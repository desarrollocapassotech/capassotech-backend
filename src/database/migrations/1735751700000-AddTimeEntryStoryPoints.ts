import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.time_entries.story_points: snapshot de "Story point estimate" tomado
 * de Jira al momento de cargar la hora (ver JiraService). Solo informativo, no
 * interviene en ningún cálculo de facturación.
 */
export class AddTimeEntryStoryPoints1735751700000 implements MigrationInterface {
  name = 'AddTimeEntryStoryPoints1735751700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.time_entries
  ADD COLUMN IF NOT EXISTS story_points NUMERIC(6,2);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.time_entries
  DROP COLUMN IF EXISTS story_points;
    `);
  }
}
