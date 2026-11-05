import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina tracker.client_payments (horas pagadas cargadas a mano): la deuda ahora se ve solo en la
 * Cuenta corriente. Correrla DESPUÉS de desplegar el código que ya no usa la tabla: con el código
 * anterior, sin ella fallan el portal de clientes y las imputaciones.
 * El `down` recrea la tabla vacía: los datos no se recuperan.
 */
export class DropClientPayments1735752300000 implements MigrationInterface {
  name = 'DropClientPayments1735752300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.client_payments;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
}
