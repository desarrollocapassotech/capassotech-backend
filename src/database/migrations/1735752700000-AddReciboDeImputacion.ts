import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adicionales de un recibo de colaborador (horas extra, bonos): son cargos con su propia imputación,
 * pero salen impresos en el recibo de otra. `recibo_de` apunta a esa imputación principal.
 * Solo agrega: correrla antes de desplegar el código que la usa.
 */
export class AddReciboDeImputacion1735752700000 implements MigrationInterface {
  name = 'AddReciboDeImputacion1735752700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_imputations
  ADD COLUMN IF NOT EXISTS recibo_de UUID REFERENCES tracker.cc_imputations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cc_imputations_recibo_de_idx
  ON tracker.cc_imputations (recibo_de) WHERE recibo_de IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS tracker.cc_imputations_recibo_de_idx;
ALTER TABLE tracker.cc_imputations DROP COLUMN IF EXISTS recibo_de;
    `);
  }
}
