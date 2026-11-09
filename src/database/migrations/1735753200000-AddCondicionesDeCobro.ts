import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Condiciones de cobro: qué le cobra cada proyecto a cada cliente (suscripción, tarifa por hora o
 * las dos), en vez del tipo, la tarifa y la moneda del proyecto. `projects.client_id` pasa a ser el
 * dueño (null = proyecto propio). `projects.kind` separa los proyectos de un cliente, los
 * productos propios que se venden a varios clientes (Vialto, Faktia) y los internos.
 *
 * Solo agrega y copia: las columnas viejas (`projects.rate`, `currency`, `billing_type` y
 * `clients.billable_config`, `billable_hours_limit`, `jira_connection_key`) quedan hasta una
 * migración posterior, que se corre después de desplegar y verificar.
 *
 * Cada proyecto con cliente se traduce a una condición equivalente, así los cargos dan lo mismo:
 * - hourly con tarifa → tarifa por hora.
 * - monthly activo con monto → suscripción. Un monthly inactivo hoy no cobra en ningún mes, así
 *   que no lleva condición.
 * La condición vale desde el primer mes del proyecto (alta o primera hora, lo que sea antes).
 */
export class AddCondicionesDeCobro1735753200000 implements MigrationInterface {
  name = 'AddCondicionesDeCobro1735753200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.project_billing_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE RESTRICT,
  desde TEXT NOT NULL CHECK (desde ~ '^[0-9]{4}-[0-9]{2}$'),
  hasta TEXT CHECK (hasta IS NULL OR (hasta ~ '^[0-9]{4}-[0-9]{2}$' AND hasta >= desde)),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'ARS')),
  monthly_amount NUMERIC(14, 2) CHECK (monthly_amount > 0),
  hourly_rate NUMERIC(12, 2) CHECK (hourly_rate > 0),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_billing_terms_monto_check
    CHECK (monthly_amount IS NOT NULL OR hourly_rate IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS project_billing_terms_cliente_idx
  ON tracker.project_billing_terms (client_id, project_id);
CREATE INDEX IF NOT EXISTS project_billing_terms_proyecto_idx
  ON tracker.project_billing_terms (project_id);

ALTER TABLE tracker.projects
  ADD COLUMN IF NOT EXISTS billable_config JSONB,
  ADD COLUMN IF NOT EXISTS jira_connection_key TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'cliente'
    CHECK (kind IN ('cliente', 'producto', 'interno'));

-- Los proyectos sin dueño quedan como internos; los productos (Vialto, Faktia) se marcan a mano.
UPDATE tracker.projects SET kind = 'interno' WHERE client_id IS NULL AND kind = 'cliente';

ALTER TABLE tracker.time_entries
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES tracker.clients(id) ON DELETE RESTRICT;

ALTER TABLE tracker.cc_movements
  ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES tracker.projects(id) ON DELETE RESTRICT;

ALTER TABLE tracker.cc_installment_plans
  ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES tracker.projects(id) ON DELETE RESTRICT;

-- La configuración de horas y Jira pasan del cliente dueño a cada proyecto.
UPDATE tracker.projects p
SET billable_config = c.billable_config,
    jira_connection_key = c.jira_connection_key
FROM tracker.clients c
WHERE c.id = p.client_id
  AND p.billable_config IS NULL;

-- Una condición por proyecto con cliente, equivalente a lo que cobra hoy.
INSERT INTO tracker.project_billing_terms
  (project_id, client_id, desde, currency, monthly_amount, hourly_rate, created_by)
SELECT
  p.id,
  p.client_id,
  to_char(LEAST(p.created_at::date, COALESCE(
    (SELECT min(t.date) FROM tracker.time_entries t WHERE t.project_id = p.id),
    p.created_at::date
  )), 'YYYY-MM'),
  CASE WHEN p.currency::text = 'ARS' THEN 'ARS' ELSE 'USD' END,
  CASE WHEN p.billing_type::text = 'monthly' THEN p.rate END,
  CASE WHEN p.billing_type::text = 'monthly' THEN NULL ELSE p.rate END,
  'migracion'
FROM tracker.projects p
WHERE p.client_id IS NOT NULL
  AND p.rate IS NOT NULL AND p.rate > 0
  -- Sin tipo, las horas facturables daban 0 (billable-hours.util): no cobraba nada.
  AND p.billing_type IS NOT NULL
  AND (p.billing_type::text = 'hourly' OR p.active)
  AND NOT EXISTS (
    SELECT 1 FROM tracker.project_billing_terms b WHERE b.project_id = p.id
  );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE tracker.cc_installment_plans DROP COLUMN IF EXISTS project_id;
ALTER TABLE tracker.cc_movements DROP COLUMN IF EXISTS project_id;
ALTER TABLE tracker.time_entries DROP COLUMN IF EXISTS client_id;
ALTER TABLE tracker.projects
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS jira_connection_key,
  DROP COLUMN IF EXISTS billable_config;
DROP TABLE IF EXISTS tracker.project_billing_terms;
    `);
  }
}
