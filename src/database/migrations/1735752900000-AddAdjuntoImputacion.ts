import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comprobante emitido afuera y adjuntado al imputar un cobro: `documento` suma el valor 'adjunto' y
 * la imputación guarda dónde está el archivo. Solo amplía: correrla antes de desplegar el código.
 */
export class AddAdjuntoImputacion1735752900000 implements MigrationInterface {
  name = 'AddAdjuntoImputacion1735752900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_imputations
  ADD COLUMN IF NOT EXISTS adjunto_path TEXT,
  ADD COLUMN IF NOT EXISTS adjunto_nombre TEXT,
  DROP CONSTRAINT IF EXISTS cc_imputations_documento_check,
  ADD CONSTRAINT cc_imputations_documento_check
    CHECK (documento IN ('factura', 'recibo', 'adjunto'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_imputations
  DROP CONSTRAINT IF EXISTS cc_imputations_documento_check,
  DROP COLUMN IF EXISTS adjunto_path,
  DROP COLUMN IF EXISTS adjunto_nombre,
  ADD CONSTRAINT cc_imputations_documento_check
    CHECK (documento IN ('factura', 'recibo'));
    `);
  }
}
