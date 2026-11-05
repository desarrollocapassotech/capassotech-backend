import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuenta corriente de clientes y colaboradores:
 * - cc_config: mes desde el que arranca (una sola fila).
 * - cc_movements: cargos (Debe), pagos y créditos (Haber) de cada cuenta.
 * - cc_imputations: qué pago cancela qué cargo y el comprobante que se emitió al imputar.
 */
export class AddCuentaCorriente1735752200000 implements MigrationInterface {
  name = 'AddCuentaCorriente1735752200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.cc_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_month TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracker.cc_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  side TEXT NOT NULL CHECK (side IN ('cliente', 'colaborador')),
  client_id TEXT REFERENCES tracker.clients(id) ON DELETE RESTRICT,
  collaborator_id TEXT REFERENCES tracker.collaborators(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN ('cargo', 'pago', 'credito')),
  origen TEXT NOT NULL CHECK (origen IN ('mes', 'ajuste', 'saldo_inicial', 'manual')),
  month TEXT,
  parent_id UUID REFERENCES tracker.cc_movements(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'ARS')),
  source_currency TEXT CHECK (source_currency IN ('USD', 'ARS')),
  source_amount NUMERIC(14, 2),
  date DATE NOT NULL,
  due_date DATE,
  payment_method TEXT,
  reference TEXT,
  detail JSONB,
  idempotency_key TEXT UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cc_movements_cuenta_check CHECK (
    (side = 'cliente' AND client_id IS NOT NULL AND collaborator_id IS NULL)
    OR (side = 'colaborador' AND collaborator_id IS NOT NULL AND client_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS cc_movements_client_idx ON tracker.cc_movements (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cc_movements_collaborator_idx ON tracker.cc_movements (collaborator_id) WHERE collaborator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cc_movements_parent_idx ON tracker.cc_movements (parent_id) WHERE parent_id IS NOT NULL;
-- Un cargo del mes por cuenta y moneda de origen: generar los cargos dos veces no los duplica.
CREATE UNIQUE INDEX IF NOT EXISTS cc_movements_cargo_mes_cliente_uq
  ON tracker.cc_movements (client_id, month, source_currency) WHERE origen = 'mes' AND client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cc_movements_cargo_mes_colaborador_uq
  ON tracker.cc_movements (collaborator_id, month, source_currency) WHERE origen = 'mes' AND collaborator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tracker.cc_imputations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id UUID NOT NULL REFERENCES tracker.cc_movements(id) ON DELETE RESTRICT,
  cargo_id UUID NOT NULL REFERENCES tracker.cc_movements(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_amount NUMERIC(14, 2) NOT NULL CHECK (payment_amount > 0),
  exchange_rate NUMERIC(12, 4),
  documento TEXT CHECK (documento IN ('factura', 'recibo')),
  comprobante_id TEXT,
  comprobante_tipo TEXT,
  comprobante_numero TEXT,
  comprobante_estado TEXT,
  comprobante_error TEXT,
  fecha_emision DATE,
  intento INT NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_imputations_pago_idx ON tracker.cc_imputations (pago_id);
CREATE INDEX IF NOT EXISTS cc_imputations_cargo_idx ON tracker.cc_imputations (cargo_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS tracker.cc_imputations;
DROP TABLE IF EXISTS tracker.cc_movements;
DROP TABLE IF EXISTS tracker.cc_config;
    `);
  }
}
