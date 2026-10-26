import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.clients.billing_concepts: conceptos que se agregan solos a cada factura o recibo del
 * cliente (por ejemplo, un mantenimiento fijo). Array JSON de
 * { descripcion, cantidad, unidad, precioUnitario }; el precio está en la moneda del documento
 * del cliente (pesos si se le factura, la moneda del recibo si se le hace recibo).
 */
export class AddClientBillingConcepts1735751900000 implements MigrationInterface {
  name = 'AddClientBillingConcepts1735751900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  ADD COLUMN IF NOT EXISTS billing_concepts JSONB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.clients
  DROP COLUMN IF EXISTS billing_concepts;
    `);
  }
}
