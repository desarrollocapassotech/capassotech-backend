import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.clients.billing_document: qué se le emite al cliente al facturar desde el tracker.
 * 'factura' (o null): factura electrónica en ARCA por el Facturador.
 * 'recibo': recibo sin validez fiscal (por ejemplo, clientes del exterior); no necesita CUIT
 * ni alta en el Facturador y no queda registrado.
 */
export class AddClientBillingDocument1735751800000 implements MigrationInterface {
  name = 'AddClientBillingDocument1735751800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  ADD COLUMN IF NOT EXISTS billing_document TEXT
  CHECK (billing_document IN ('factura', 'recibo'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  DROP COLUMN IF EXISTS billing_document;
    `);
  }
}
