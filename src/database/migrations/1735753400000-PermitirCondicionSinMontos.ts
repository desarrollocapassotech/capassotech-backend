import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una condición de cobro puede no tener montos: el cliente es cliente del producto pero no paga
 * nada recurrente (solo cargos sueltos, como un presupuesto). Ejemplo: Grupo Bressan en Vialto.
 * No genera cargos del mes. Se puede correr antes de desplegar: solo afloja una restricción.
 */
export class PermitirCondicionSinMontos1735753400000 implements MigrationInterface {
  name = 'PermitirCondicionSinMontos1735753400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.project_billing_terms DROP CONSTRAINT IF EXISTS project_billing_terms_monto_check;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DELETE FROM tracker.project_billing_terms WHERE monthly_amount IS NULL AND hourly_rate IS NULL;
ALTER TABLE tracker.project_billing_terms ADD CONSTRAINT project_billing_terms_monto_check
  CHECK (monthly_amount IS NOT NULL OR hourly_rate IS NOT NULL);
    `);
  }
}
