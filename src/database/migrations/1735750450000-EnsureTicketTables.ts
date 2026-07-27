import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill descubierto al armar el tablero Kanban: InitSchema1735750000000
 * crea tracker.tickets/ticket_messages/ticket_attachments con
 * "CREATE TABLE IF NOT EXISTS", pero esas tres tablas se agregaron al archivo
 * DESPUÉS de que esa migración ya estuviera marcada como ejecutada en algunos
 * entornos (ej. la rama "develop" de Neon) — TypeORM no vuelve a correr
 * up() de una migración ya aplicada, así que ahí las tablas nunca se crearon
 * (confirmado: `tracker.tickets` no existía al validar esta tarea contra
 * develop). Los tipos ENUM de ticketera (tracker.ticket_empresa y afines)
 * tampoco existían por el mismo motivo, así que también se backfillean acá,
 * con el mismo patrón DO $$ ... EXCEPTION duplicate_object que usa
 * InitSchema. Este migration es un backfill idempotente: mismo DDL que
 * InitSchema, no rompe entornos donde las tablas ya existen (ej. production).
 */
export class EnsureTicketTables1735750450000 implements MigrationInterface {
  name = 'EnsureTicketTables1735750450000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE tracker.ticket_empresa AS ENUM ('vialto', 'capassotech');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tracker.ticket_priority AS ENUM ('baja', 'media', 'alta', 'urgente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tracker.ticket_state AS ENUM (
    'nuevo','en_revision','en_progreso','esperando_cliente','resuelto','cerrado','reabierto'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tracker.ticket_origin AS ENUM ('vialto_sso', 'capassotech_form', 'capassotech_login');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tracker.ticket_message_author AS ENUM ('cliente', 'agente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tracker.tickets (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  empresa tracker.ticket_empresa NOT NULL,
  sistema TEXT NOT NULL,
  asunto TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  prioridad tracker.ticket_priority NOT NULL,
  estado tracker.ticket_state NOT NULL DEFAULT 'nuevo',
  origen tracker.ticket_origin NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  client_id TEXT NULL REFERENCES tracker.clients(id) ON DELETE SET NULL,
  asignado_a TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracker.ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tracker.tickets(id) ON DELETE CASCADE,
  autor tracker.ticket_message_author NOT NULL,
  autor_nombre TEXT NULL,
  mensaje TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracker.ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tracker.tickets(id) ON DELETE CASCADE,
  nombre_archivo TEXT NOT NULL,
  url TEXT NOT NULL,
  tipo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
    `);
  }

  public async down(): Promise<void> {
    // Intencionalmente no-op: no sabemos si estas tablas ya existían antes de
    // este backfill en el entorno donde se revierte (ej. production sí las
    // tenía desde antes). Un DROP acá podría borrar datos reales de tickets
    // que no fueron creados por esta migración.
  }
}
