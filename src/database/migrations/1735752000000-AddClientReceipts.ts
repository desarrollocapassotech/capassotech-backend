import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.client_receipts: registro de los recibos sin validez fiscal generados desde
 * Facturación (el PDF no se guarda), para mostrar a qué clientes ya se les hizo recibo en el mes.
 */
export class AddClientReceipts1735752000000 implements MigrationInterface {
  name = 'AddClientReceipts1735752000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.client_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  date DATE NOT NULL,
  currency TEXT NOT NULL,
  total NUMERIC(14, 2) NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_receipts_year_month_idx ON tracker.client_receipts (year, month);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.client_receipts;`);
  }
}
