import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planes de cuotas de la cuenta corriente: cada cuota es un cargo que aparece solo cuando llega
 * su fecha. Solo agrega: el código anterior sigue funcionando. Correrla antes de desplegar el
 * código que usa estas columnas.
 */
export class AddCuotasCuentaCorriente1735752500000 implements MigrationInterface {
  name = 'AddCuotasCuentaCorriente1735752500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.cc_installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  side TEXT NOT NULL CHECK (side IN ('cliente', 'colaborador')),
  client_id TEXT REFERENCES tracker.clients(id) ON DELETE RESTRICT,
  collaborator_id TEXT REFERENCES tracker.collaborators(id) ON DELETE RESTRICT,
  concept TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'ARS')),
  total_cuotas INT NOT NULL CHECK (total_cuotas > 1),
  first_date DATE NOT NULL,
  canceled_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cc_installment_plans_cuenta_check CHECK (
    (side = 'cliente' AND client_id IS NOT NULL AND collaborator_id IS NULL)
    OR (side = 'colaborador' AND collaborator_id IS NOT NULL AND client_id IS NULL)
  )
);

ALTER TABLE tracker.cc_movements
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES tracker.cc_installment_plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cuota_numero INT;

ALTER TABLE tracker.cc_movements DROP CONSTRAINT IF EXISTS cc_movements_origen_check;
ALTER TABLE tracker.cc_movements ADD CONSTRAINT cc_movements_origen_check
  CHECK (origen IN ('mes', 'ajuste', 'saldo_inicial', 'manual', 'cuota'));

-- Generar las cuotas dos veces no las duplica.
CREATE UNIQUE INDEX IF NOT EXISTS cc_movements_plan_cuota_uq
  ON tracker.cc_movements (plan_id, cuota_numero) WHERE plan_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS tracker.cc_movements_plan_cuota_uq;
ALTER TABLE tracker.cc_movements DROP CONSTRAINT IF EXISTS cc_movements_origen_check;
ALTER TABLE tracker.cc_movements ADD CONSTRAINT cc_movements_origen_check
  CHECK (origen IN ('mes', 'ajuste', 'saldo_inicial', 'manual'));
ALTER TABLE tracker.cc_movements DROP COLUMN IF EXISTS cuota_numero, DROP COLUMN IF EXISTS plan_id;
DROP TABLE IF EXISTS tracker.cc_installment_plans;
    `);
  }
}
