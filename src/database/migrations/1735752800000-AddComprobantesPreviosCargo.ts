import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facturas emitidas por fuera de la cuenta corriente: quedan en el cargo del mes que cubren, y ese
 * cargo ya no emite otra. `comprobante_revisado_at` dice que ya se buscaron en el Facturador.
 * Solo agrega: correrla antes de desplegar el código que la usa.
 */
export class AddComprobantesPreviosCargo1735752800000 implements MigrationInterface {
  name = 'AddComprobantesPreviosCargo1735752800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_movements
  ADD COLUMN IF NOT EXISTS comprobantes_previos JSONB,
  ADD COLUMN IF NOT EXISTS comprobante_revisado_at TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_movements
  DROP COLUMN IF EXISTS comprobantes_previos,
  DROP COLUMN IF EXISTS comprobante_revisado_at;
    `);
  }
}
