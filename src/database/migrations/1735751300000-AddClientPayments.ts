import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.client_payments: horas facturables que un cliente ya pagó en un
 * (año, mes) puntual, cargadas a mano por admin/contable (ver
 * ClientPaymentsService). La "deuda" no se persiste acá: se calcula al vuelo
 * como horas facturables del mes menos lo cargado en esta tabla; sin fila,
 * se asume 0 horas pagadas.
 */
export class AddClientPayments1735751300000 implements MigrationInterface {
  name = 'AddClientPayments1735751300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.client_payments (
  client_id    TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  hours_paid   NUMERIC(12,2) NOT NULL DEFAULT 0,
  note         TEXT,
  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, year, month)
);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.client_payments;`);
  }
}
