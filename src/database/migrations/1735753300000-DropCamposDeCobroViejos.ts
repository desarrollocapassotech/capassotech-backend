import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina lo que reemplazaron las condiciones de cobro (AddCondicionesDeCobro):
 * - projects.rate, currency y billing_type (y el tipo project_billing_type).
 * - clients.billable_config, billable_hours_limit y jira_connection_key (pasaron al proyecto).
 *
 * Correrla DESPUÉS de desplegar el código que ya no tiene estas columnas en las entidades: el
 * backend anterior las lee en cada consulta y se rompería.
 *
 * down vuelve a crear las columnas vacías: los datos no se recuperan (están en las condiciones de
 * cobro y en la configuración de cada proyecto).
 */
export class DropCamposDeCobroViejos1735753300000 implements MigrationInterface {
  name = 'DropCamposDeCobroViejos1735753300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.projects
  DROP COLUMN IF EXISTS rate,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS billing_type;
DROP TYPE IF EXISTS tracker.project_billing_type;

ALTER TABLE tracker.clients
  DROP COLUMN IF EXISTS billable_config,
  DROP COLUMN IF EXISTS billable_hours_limit,
  DROP COLUMN IF EXISTS jira_connection_key;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE tracker.project_billing_type AS ENUM ('hourly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tracker.projects
  ADD COLUMN IF NOT EXISTS rate NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS currency tracker.billing_currency,
  ADD COLUMN IF NOT EXISTS billing_type tracker.project_billing_type;

ALTER TABLE tracker.clients
  ADD COLUMN IF NOT EXISTS billable_config JSONB,
  ADD COLUMN IF NOT EXISTS billable_hours_limit NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS jira_connection_key TEXT;
    `);
  }
}
