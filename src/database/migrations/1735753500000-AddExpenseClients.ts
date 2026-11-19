import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los clientes que pagan un gasto (tracker.expense_clients). La empresa lo paga y se lo recobra a
 * cada uno en partes iguales, como una línea del cargo del mes en la Cuenta corriente. Sin filas,
 * el gasto es de la empresa (como hasta ahora). Se puede correr antes de desplegar: solo agrega
 * una tabla.
 */
export class AddExpenseClients1735753500000 implements MigrationInterface {
  name = 'AddExpenseClients1735753500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.expense_clients (
  expense_id  TEXT NOT NULL REFERENCES tracker.expenses(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, client_id)
);

CREATE INDEX IF NOT EXISTS expense_clients_client_id_idx ON tracker.expense_clients (client_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracker.expense_clients;`);
  }
}
