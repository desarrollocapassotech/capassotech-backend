import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * tracker.client_hours_alerts: registra qué (cliente, año, mes) ya disparó el
 * email de "horas muy altas" a los PM, para no reenviarlo cada vez que el
 * dashboard del PM recalcula el estado "en rojo" (ver HoursAlertsService).
 */
export class AddClientHoursAlerts1735750800000 implements MigrationInterface {
  name = 'AddClientHoursAlerts1735750800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.client_hours_alerts (
  client_id    TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  notified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, year, month)
);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.client_hours_alerts;`);
  }
}
