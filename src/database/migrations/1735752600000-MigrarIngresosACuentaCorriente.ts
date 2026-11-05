import { MigrationInterface, QueryRunner } from 'typeorm';

const CREADO_POR = 'migracion-ingresos';
const INGRESO_CUOTA_EPEFI = 'Cuota 1 Adicional de modulo de examenes';
const CLAVE_CUOTA_2_EPEFI = 'carga-epefi-cuota-2-3';
const CONCEPTO_PLAN_EPEFI = 'módulo de exámenes';

interface Ingreso {
  id: string;
  description: string;
  amount: string;
  currency: 'USD' | 'ARS';
  payment_method: string;
  payment_date: string;
  notes: string | null;
  clientes: string[] | null;
}

/**
 * Pasa los ingresos a la Cuenta corriente y elimina sus tablas. Cada ingreso queda como un cargo
 * con su cobro imputado, sin comprobante y con saldo cero: ya estaban cobrados. Los meses pasados
 * del Panel de administración no cambian, porque ahora suma esos cargos.
 *
 * Correrla DESPUÉS de desplegar el código que ya no usa Ingresos. Si un ingreso no se puede ubicar
 * en una cuenta, falla y no cambia nada: las tablas solo se borran con todos migrados.
 * El `down` recrea las tablas vacías: los datos quedan en la Cuenta corriente.
 */
export class MigrarIngresosACuentaCorriente1735752600000 implements MigrationInterface {
  name = 'MigrarIngresosACuentaCorriente1735752600000';

  public async up(q: QueryRunner): Promise<void> {
    const ingresos = (await q.query(`
      select i.id, i.description, i.amount, i.currency, i.payment_method,
             to_char(i.payment_date, 'YYYY-MM-DD') as payment_date, i.notes,
             (select array_agg(distinct p.client_id)
              from tracker.income_projects ip join tracker.projects p on p.id = ip.project_id
              where ip.income_id = i.id and p.client_id is not null) as clientes
      from tracker.incomes i
      order by i.payment_date`)) as Ingreso[];

    for (const ingreso of ingresos) {
      const cliente = await this.clienteDe(q, ingreso);
      const cuota = await this.planDeCuota(q, ingreso, cliente);
      const [cargo] = (await q.query(
        `insert into tracker.cc_movements
           (side, client_id, tipo, origen, concept, amount, currency, date, due_date, reference,
            plan_id, cuota_numero, idempotency_key, created_by)
         values ('cliente', $1, 'cargo', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          cliente,
          cuota ? 'cuota' : 'manual',
          cuota ? `Cuota 1/3 ${CONCEPTO_PLAN_EPEFI}` : ingreso.description,
          ingreso.amount,
          ingreso.currency,
          ingreso.payment_date,
          cuota ? ingreso.payment_date : null,
          ingreso.notes,
          cuota,
          cuota ? 1 : null,
          `income-${ingreso.id}-cargo`,
          CREADO_POR,
        ],
      )) as Array<{ id: string }>;
      const [pago] = (await q.query(
        `insert into tracker.cc_movements
           (side, client_id, tipo, origen, concept, amount, currency, date, payment_method,
            idempotency_key, created_by)
         values ('cliente', $1, 'pago', 'manual', 'Cobro', $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          cliente,
          ingreso.amount,
          ingreso.currency,
          ingreso.payment_date,
          ingreso.payment_method,
          `income-${ingreso.id}-pago`,
          CREADO_POR,
        ],
      )) as Array<{ id: string }>;
      await q.query(
        `insert into tracker.cc_imputations
           (pago_id, cargo_id, amount, payment_amount, idempotency_key, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          pago.id,
          cargo.id,
          ingreso.amount,
          ingreso.amount,
          `income-${ingreso.id}`,
          CREADO_POR,
        ],
      );
    }

    await q.query(`
      DROP TABLE tracker.income_projects;
      DROP TABLE tracker.incomes;
    `);
    console.log(`Ingresos migrados a la cuenta corriente: ${ingresos.length}.`);
  }

  /** El cliente del ingreso. El dominio de Glasshome no tenía cliente: se crea. */
  private async clienteDe(q: QueryRunner, ingreso: Ingreso): Promise<string> {
    const clientes = ingreso.clientes ?? [];
    if (clientes.length === 1) return clientes[0];
    if (!clientes.length && /glasshome/i.test(ingreso.description)) {
      const [existente] = (await q.query(
        `select id from tracker.clients where lower(name) = 'glasshome' limit 1`,
      )) as Array<{ id: string }>;
      if (existente) return existente.id;
      const [creado] = (await q.query(
        `insert into tracker.clients (id, name, billing_currency)
         values (gen_random_uuid()::text, 'Glasshome', 'ARS')
         returning id`,
      )) as Array<{ id: string }>;
      return creado.id;
    }
    throw new Error(
      `No se puede ubicar el ingreso "${ingreso.description}" (${clientes.length} clientes): no se migró nada.`,
    );
  }

  /** La cuota 1 del adicional de EPEFI arma el plan: suma la 2 ya cargada y deja que la 3 salga sola. */
  private async planDeCuota(
    q: QueryRunner,
    ingreso: Ingreso,
    cliente: string,
  ): Promise<string | null> {
    if (ingreso.description !== INGRESO_CUOTA_EPEFI) return null;
    const [cuota2] = (await q.query(
      `select id from tracker.cc_movements
       where idempotency_key = $1 and client_id = $2 and amount = $3`,
      [CLAVE_CUOTA_2_EPEFI, cliente, ingreso.amount],
    )) as Array<{ id: string }>;
    if (!cuota2) return null;
    const [plan] = (await q.query(
      `insert into tracker.cc_installment_plans
         (side, client_id, concept, amount, currency, total_cuotas, first_date, idempotency_key, created_by)
       values ('cliente', $1, $2, $3, $4, 3, $5, 'plan-epefi-modulo-examenes', $6)
       returning id`,
      [
        cliente,
        CONCEPTO_PLAN_EPEFI,
        ingreso.amount,
        ingreso.currency,
        ingreso.payment_date,
        CREADO_POR,
      ],
    )) as Array<{ id: string }>;
    await q.query(
      `update tracker.cc_movements
       set origen = 'cuota', plan_id = $1, cuota_numero = 2, due_date = date, updated_at = now()
       where id = $2`,
      [plan.id, cuota2.id],
    );
    return plan.id;
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
CREATE TABLE IF NOT EXISTS tracker.incomes (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency tracker.billing_currency NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  payment_date DATE NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracker.income_projects (
  income_id TEXT NOT NULL REFERENCES tracker.incomes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (income_id, project_id)
);
    `);
  }
}
