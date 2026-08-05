import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMonthlyExchangeRates1735750600000 implements MigrationInterface {
  name = 'AddMonthlyExchangeRates1735750600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.monthly_exchange_rates (
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  rate        NUMERIC(12,4) NOT NULL CHECK (rate > 0),
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

COMMENT ON TABLE tracker.monthly_exchange_rates IS
  'Tipo de cambio USD/ARS bloqueado manualmente por un admin/contable para un mes calendario. Si no hay fila para un (year, month), se usa el tipo de cambio del día (dolarapi.com) como antes.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.monthly_exchange_rates;`);
  }
}
