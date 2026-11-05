import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.collaborator_receipt_acknowledgements: un registro por cada recibo enviado por
 * email a un colaborador, para que pueda confirmar que recibió el dinero. El id (UUID v4
 * aleatorio) es también el token del link público del email.
 */
export class AddCollaboratorReceiptAcknowledgements1735752100000 implements MigrationInterface {
  name = 'AddCollaboratorReceiptAcknowledgements1735752100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.collaborator_receipt_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id TEXT NOT NULL REFERENCES tracker.collaborators(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  month_year TEXT NOT NULL,
  total TEXT NOT NULL,
  currency TEXT,
  recipient_email TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collaborator_receipt_acknowledgements_collaborator_idx
  ON tracker.collaborator_receipt_acknowledgements (collaborator_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.collaborator_receipt_acknowledgements;`);
  }
}
