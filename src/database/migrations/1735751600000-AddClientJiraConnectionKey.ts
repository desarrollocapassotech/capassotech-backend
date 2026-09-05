import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.clients.jira_connection_key: referencia (por key, no FK) a una entrada
 * del array JIRA_CONNECTIONS (env var) que define baseUrl/credenciales de un site
 * de Jira. Varios clientes pueden compartir la misma key cuando comparten Jira.
 */
export class AddClientJiraConnectionKey1735751600000 implements MigrationInterface {
  name = 'AddClientJiraConnectionKey1735751600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  ADD COLUMN IF NOT EXISTS jira_connection_key TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  DROP COLUMN IF EXISTS jira_connection_key;
    `);
  }
}
