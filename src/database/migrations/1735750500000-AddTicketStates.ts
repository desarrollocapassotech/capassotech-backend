import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza el enum fijo tracker.ticket_state por una tabla configurable
 * (tracker.ticket_states), para que el tablero Kanban del panel de soporte
 * pueda agregar estados/columnas nuevos sin deploy. Backfill: se seedean los
 * 7 estados que ya existían en el enum, con los mismos colores que ya estaban
 * hardcodeados en el frontend (tailwind.config.ts) para el badge/timeline de
 * estado, más "reabierto" que no tenía color asignado (se le da uno nuevo).
 */
export class AddTicketStates1735750500000 implements MigrationInterface {
  name = 'AddTicketStates1735750500000';

  private readonly seedStates: Array<{ id: string; nombre: string; color: string; orden: number; esDefault: boolean }> = [
    { id: 'nuevo', nombre: 'Nuevo', color: '#3b82f6', orden: 0, esDefault: true },
    { id: 'en_revision', nombre: 'En revisión', color: '#a855f7', orden: 1, esDefault: false },
    { id: 'en_progreso', nombre: 'En progreso', color: '#f59e0b', orden: 2, esDefault: false },
    { id: 'esperando_cliente', nombre: 'Esperando al cliente', color: '#ef4444', orden: 3, esDefault: false },
    { id: 'resuelto', nombre: 'Resuelto', color: '#22c55e', orden: 4, esDefault: false },
    { id: 'cerrado', nombre: 'Cerrado', color: '#6b7280', orden: 5, esDefault: false },
    { id: 'reabierto', nombre: 'Reabierto', color: '#f97316', orden: 6, esDefault: false },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS tracker.ticket_states (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  color       TEXT NOT NULL,
  orden       INT NOT NULL,
  es_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
    `);

    for (const state of this.seedStates) {
      await queryRunner.query(
        `INSERT INTO tracker.ticket_states (id, nombre, color, orden, es_default) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [state.id, state.nombre, state.color, state.orden, state.esDefault],
      );
    }

    await queryRunner.query(`ALTER TABLE tracker.tickets ADD COLUMN estado_new TEXT;`);
    await queryRunner.query(`UPDATE tracker.tickets SET estado_new = estado::text;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets ALTER COLUMN estado_new SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets DROP COLUMN estado;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets RENAME COLUMN estado_new TO estado;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets ALTER COLUMN estado SET DEFAULT 'nuevo';`);
    await queryRunner.query(
      `ALTER TABLE tracker.tickets ADD CONSTRAINT tickets_estado_fkey FOREIGN KEY (estado) REFERENCES tracker.ticket_states(id);`,
    );
    await queryRunner.query(`CREATE INDEX tickets_estado_idx ON tracker.tickets (estado);`);

    await queryRunner.query(`DROP TYPE IF EXISTS tracker.ticket_state;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE tracker.ticket_state AS ENUM (
  'nuevo',
  'en_revision',
  'en_progreso',
  'esperando_cliente',
  'resuelto',
  'cerrado',
  'reabierto'
);
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS tracker.tickets_estado_idx;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets DROP CONSTRAINT IF EXISTS tickets_estado_fkey;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets ADD COLUMN estado_old tracker.ticket_state;`);
    // Estados custom agregados después de la migración no existen en el enum viejo:
    // se degradan a 'nuevo' para poder revertir sin perder filas.
    await queryRunner.query(`
      UPDATE tracker.tickets
      SET estado_old = CASE
        WHEN estado IN ('nuevo','en_revision','en_progreso','esperando_cliente','resuelto','cerrado','reabierto')
        THEN estado::tracker.ticket_state
        ELSE 'nuevo'::tracker.ticket_state
      END;
    `);
    await queryRunner.query(`ALTER TABLE tracker.tickets ALTER COLUMN estado_old SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets ALTER COLUMN estado_old SET DEFAULT 'nuevo';`);
    await queryRunner.query(`ALTER TABLE tracker.tickets DROP COLUMN estado;`);
    await queryRunner.query(`ALTER TABLE tracker.tickets RENAME COLUMN estado_old TO estado;`);

    await queryRunner.query(`DROP TABLE IF EXISTS tracker.ticket_states;`);
  }
}
