import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  unificarRecibos,
  type CargoColaborador,
  type ReciboEnviado,
} from '../../cuenta-corriente/unificar-recibos';

const CREADO_POR = 'unificacion-recibos';

/**
 * Pasa a la Cuenta corriente los recibos enviados desde la pantalla de Colaboradores: un pago y su
 * imputación por recibo, con el comprobante ya emitido, así el saldo refleja lo que ya se pagó. No
 * envía nada ni genera comprobantes nuevos. Se puede volver a correr: la clave de cada recibo no
 * deja crearlo dos veces. Correrla después de desplegar, cuando ya no se pueden emitir por fuera.
 */
export class UnificarRecibosColaboradores1735752400000 implements MigrationInterface {
  name = 'UnificarRecibosColaboradores1735752400000';

  public async up(q: QueryRunner): Promise<void> {
    const recibos = (await q.query(`
      select id, collaborator_id as "collaboratorId", month_year as "monthYear", total, currency,
             to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as fecha,
             recipient_email as destinatario
      from tracker.collaborator_receipt_acknowledgements
      order by created_at`)) as ReciboEnviado[];
    const cargos = (await q.query(`
      select m.id, m.collaborator_id as "collaboratorId", m.month, m.currency, m.amount::float as importe,
             coalesce((select sum(i.amount)::float from tracker.cc_imputations i
                       where i.cargo_id = m.id and i.reversed_at is null), 0) as imputado
      from tracker.cc_movements m
      where m.side = 'colaborador' and m.tipo = 'cargo' and m.origen = 'mes'
      order by m.month, m.id`)) as CargoColaborador[];
    const tcs = (await q.query(
      `select year, month, rate::float as rate from tracker.monthly_exchange_rates`,
    )) as Array<{ year: number; month: number; rate: number }>;
    const tcPorMes = new Map(
      tcs.map((t) => [`${t.year}-${String(t.month).padStart(2, '0')}`, t.rate]),
    );

    // Un recibo ya unificado no vuelve a contar: su pago ya bajó lo pendiente del cargo.
    const yaHechos = (await q.query(
      `select idempotency_key as clave from tracker.cc_movements where created_by = $1`,
      [CREADO_POR],
    )) as Array<{ clave: string }>;
    const hechos = new Set(yaHechos.map((h) => h.clave));
    const { unificados, omitidos } = unificarRecibos(
      recibos.filter((r) => !hechos.has(`ack-${r.id}`)),
      cargos,
      tcPorMes,
    );

    for (const u of unificados) {
      const clave = `ack-${u.reciboId}`;
      const [pago] = (await q.query(
        `insert into tracker.cc_movements
           (side, collaborator_id, tipo, origen, concept, amount, currency, date, reference, idempotency_key, created_by)
         values ('colaborador', $1, 'pago', 'manual', 'Pago', $2, $3, $4, $5, $6, $7)
         on conflict (idempotency_key) do nothing
         returning id`,
        [
          u.collaboratorId,
          u.total.toFixed(2),
          u.moneda,
          u.fecha,
          `Recibo enviado a ${u.destinatario}`,
          clave,
          CREADO_POR,
        ],
      )) as Array<{ id: string }>;
      if (!pago) continue;
      await q.query(
        `insert into tracker.cc_imputations
           (pago_id, cargo_id, amount, payment_amount, exchange_rate, documento, comprobante_tipo,
            comprobante_estado, fecha_emision, idempotency_key, created_by)
         values ($1, $2, $3, $4, $5, 'recibo', 'RECIBO', 'EMITIDO', $6, $7, $8)
         on conflict (idempotency_key) do nothing`,
        [
          pago.id,
          u.cargoId,
          u.importeCargo.toFixed(2),
          u.importePago.toFixed(2),
          u.tipoCambio != null ? u.tipoCambio.toFixed(4) : null,
          u.fecha,
          clave,
          CREADO_POR,
        ],
      );
    }
    console.log(
      `Recibos unificados: ${unificados.length}. Sin unificar: ${omitidos.length}.`,
    );
    for (const o of omitidos) console.log(`  ${o.reciboId}: ${o.motivo}`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`delete from tracker.cc_imputations where created_by = $1`, [
      CREADO_POR,
    ]);
    await q.query(`delete from tracker.cc_movements where created_by = $1`, [
      CREADO_POR,
    ]);
  }
}
