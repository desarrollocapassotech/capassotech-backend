-- Modelo de datos relacional para Neon (Postgres)
-- Migración desde Firebase/Firestore (colecciones: users, colaboradores, clients, projects, timeEntries)
-- Un único schema: tracker
--
-- Este script es idempotente si se ejecuta contra una base nueva.
-- Aplicado en Neon: proyecto "timetracker" (id cold-bonus-40672060), branch "main", database "neondb".

CREATE SCHEMA IF NOT EXISTS tracker;

-- ============================================================
-- ENUMS (reflejan literal-unions existentes en el frontend)
-- ============================================================

-- AuthContext.tsx -> UserRole
CREATE TYPE tracker.user_role AS ENUM (
  'colaborador',
  'admin',
  'project_manager',
  'client',
  'contable',
  'analista_funcional',
  'qa_tester'
);

-- Ticketera
CREATE TYPE tracker.ticket_empresa AS ENUM ('vialto', 'capassotech');
CREATE TYPE tracker.ticket_priority AS ENUM ('baja', 'media', 'alta', 'urgente');
CREATE TYPE tracker.ticket_origin AS ENUM ('vialto_sso', 'capassotech_form', 'capassotech_login');
CREATE TYPE tracker.ticket_message_author AS ENUM ('cliente', 'agente');

-- Estados del ticket: tabla configurable (no enum) para que el tablero Kanban
-- del panel de soporte pueda agregar columnas/estados nuevos sin deploy.
-- Reemplaza al enum tracker.ticket_state que existía antes (ver migración
-- AddTicketStates). Seed inicial: nuevo, en_revision, en_progreso,
-- esperando_cliente, resuelto, cerrado, reabierto (orden 0..6, "nuevo" es
-- es_default = true).
CREATE TABLE tracker.ticket_states (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL,
  orden INT NOT NULL,
  es_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tracker.tickets (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  empresa tracker.ticket_empresa NOT NULL,
  sistema TEXT NOT NULL,
  asunto TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  prioridad tracker.ticket_priority NOT NULL,
  estado TEXT NOT NULL DEFAULT 'nuevo' REFERENCES tracker.ticket_states(id),
  origen tracker.ticket_origin NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  client_id TEXT NULL REFERENCES tracker.clients(id) ON DELETE SET NULL,
  asignado_a TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tickets_estado_idx ON tracker.tickets (estado);

CREATE TABLE tracker.ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tracker.tickets(id) ON DELETE CASCADE,
  autor tracker.ticket_message_author NOT NULL,
  autor_nombre TEXT NULL,
  mensaje TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tracker.ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tracker.tickets(id) ON DELETE CASCADE,
  nombre_archivo TEXT NOT NULL,
  url TEXT NOT NULL,
  tipo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DataContext.tsx -> SupportedBillingCurrency / normalizeCurrency (default USD)
CREATE TYPE tracker.billing_currency AS ENUM ('USD', 'ARS');

-- ProjectManagement.tsx -> Project.billingType ('hourly' | 'monthly')
CREATE TYPE tracker.project_billing_type AS ENUM ('hourly', 'monthly');

-- utils.ts -> TaskBillingType (afecta el markup de facturación)
CREATE TYPE tracker.task_billing_type AS ENUM (
  'feature',
  'internal_bug',
  'external_bug',
  'internal_meeting',
  'external_meeting'
);

-- utils.ts -> BillableBaseFactorStrategy (dentro de billable_config)
CREATE TYPE tracker.billable_base_factor_strategy AS ENUM ('rate_ratio', 'custom');

-- Rol de un colaborador dentro de un proyecto puntual (independiente de collaborators.roles,
-- que es el rol global del colaborador en el sistema).
CREATE TYPE tracker.project_collaborator_role AS ENUM ('manager', 'team_member');

-- ============================================================
-- app_users  <-  Firestore /users
-- Perfil liviano de auth/rol, keyed originalmente por Firebase Auth UID.
-- Lo lee AuthContext en cada login para resolver roles.
-- ============================================================
CREATE TABLE tracker.app_users (
  id            TEXT PRIMARY KEY,               -- Firebase Auth UID (se conserva para no romper la migración)
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  roles         tracker.user_role[] NOT NULL DEFAULT ARRAY['colaborador']::tracker.user_role[],
  hourly_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- collaborators  <-  Firestore /colaboradores
-- ============================================================
CREATE TABLE tracker.collaborators (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NULL REFERENCES tracker.app_users(id) ON DELETE SET NULL, -- Colaborador.uid (opcional)
  name                   TEXT NOT NULL,
  personal_email         TEXT NULL,
  work_email             TEXT NULL,
  password               TEXT NULL,              -- legacy, ver nota abajo
  hourly_rate            NUMERIC(12,2) NOT NULL,
  currency               tracker.billing_currency NOT NULL DEFAULT 'USD',
  exchange_rate          NUMERIC(12,4) NULL,
  active                 BOOLEAN NOT NULL DEFAULT true,
  started_date           DATE NOT NULL,
  birth_date             DATE NULL,
  payment_method         TEXT NULL,               -- texto libre, ej: "Transferencia bancaria"
  phone                  TEXT NULL,
  city                   TEXT NULL,
  address                TEXT NULL,
  floor                  TEXT NULL,
  province               TEXT NULL,
  postal_code            TEXT NULL,
  cbu_cvu                TEXT NULL,
  roles                  tracker.user_role[] NOT NULL DEFAULT ARRAY['colaborador']::tracker.user_role[],
  show_financial_values  BOOLEAN NOT NULL DEFAULT true,
  profile_image_url      TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Firebase Auth exige email único al crear la cuenta; se replica esa regla.
CREATE UNIQUE INDEX collaborators_work_email_key ON tracker.collaborators (work_email) WHERE work_email IS NOT NULL;

COMMENT ON COLUMN tracker.collaborators.password IS
  'Legacy: se guarda en texto plano igual que hoy en Firestore. Deuda técnica a resolver en una tarea de seguridad aparte; no usar para nuevos flujos de auth.';

-- ============================================================
-- clients  <-  Firestore /clients
-- ============================================================
CREATE TABLE tracker.clients (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NULL REFERENCES tracker.app_users(id) ON DELETE SET NULL, -- Client.uid (opcional)
  name                  TEXT NOT NULL,
  email                 TEXT NULL,
  phone                 TEXT NULL,
  address               TEXT NULL,
  city                  TEXT NULL,
  province              TEXT NULL,
  postal_code           TEXT NULL,
  floor                 TEXT NULL,
  razon_social          TEXT NULL,
  cuit                  TEXT NULL,
  iva_condition         TEXT NULL,                -- texto libre, ej: "Responsable Inscripto"
  password              TEXT NULL,                -- legacy, ver nota abajo
  billing_currency      tracker.billing_currency NOT NULL DEFAULT 'USD',
  billable_config       JSONB NOT NULL DEFAULT '{
    "baseFactorStrategy": "rate_ratio",
    "customBaseFactor": null,
    "markupMultiplier": 1.6,
    "internalBugMarkupMultiplier": null,
    "additionalFixedHours": 0,
    "minimumBillableHours": null,
    "collaboratorOverrides": {}
  }'::jsonb,
  profile_image_url     TEXT NULL,
  billable_hours_limit  NUMERIC(12,2) NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN tracker.clients.billable_config IS
  'BillableHoursCalculationConfig completo (incluye collaboratorOverrides como mapa colaboradorId->horas) igual que en Firestore, para no perder flexibilidad de la regla de negocio.';
COMMENT ON COLUMN tracker.clients.password IS
  'Legacy: se guarda en texto plano igual que hoy en Firestore. Deuda técnica a resolver en una tarea de seguridad aparte; no usar para nuevos flujos de auth.';

-- ============================================================
-- projects  <-  Firestore /projects
-- ============================================================
CREATE TABLE tracker.projects (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  rate                  NUMERIC(12,2) NULL,
  currency              tracker.billing_currency NULL,
  contract_end_date     DATE NULL,
  billing_type          tracker.project_billing_type NULL,
  client_id             TEXT NULL REFERENCES tracker.clients(id) ON DELETE SET NULL,
  jira_ids              TEXT[] NOT NULL DEFAULT '{}',   -- ids externos de Jira, no son FK a ninguna tabla local
  billable_hours_limit  NUMERIC(12,2) NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN tracker.projects.billing_type IS
  'Nullable para reflejar que hoy es opcional en Firestore; el frontend asume "hourly" cuando falta (misma regla que hoy, resuelta en la capa de app, no en la DB).';

CREATE INDEX projects_client_id_idx ON tracker.projects (client_id);

-- managerIds y teamMemberIds del Project se normalizan en UNA sola tabla puente,
-- diferenciando manager vs team_member por la columna "role" (rol propio de esa
-- asignación proyecto-colaborador, no el rol global de collaborators.roles).
CREATE TABLE tracker.project_collaborators (
  project_id       TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE CASCADE,
  collaborator_id  TEXT NOT NULL REFERENCES tracker.collaborators(id) ON DELETE CASCADE,
  role             tracker.project_collaborator_role NOT NULL,
  PRIMARY KEY (project_id, collaborator_id, role)
);

COMMENT ON TABLE tracker.project_collaborators IS
  'Reemplaza a project_managers y project_team_members. Project.managerIds -> filas con role=manager; Project.teamMemberIds -> filas con role=team_member.';

CREATE INDEX project_collaborators_collaborator_id_idx ON tracker.project_collaborators (collaborator_id);
CREATE INDEX project_collaborators_project_id_role_idx ON tracker.project_collaborators (project_id, role);

-- analistaFuncionalIds del Client, mismo patrón de tabla puente.
CREATE TABLE tracker.client_functional_analysts (
  client_id        TEXT NOT NULL REFERENCES tracker.clients(id) ON DELETE CASCADE,
  collaborator_id  TEXT NOT NULL REFERENCES tracker.collaborators(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, collaborator_id)
);

CREATE INDEX client_functional_analysts_collaborator_id_idx ON tracker.client_functional_analysts (collaborator_id);

-- ============================================================
-- time_entries  <-  Firestore /timeEntries
-- ============================================================
CREATE TABLE tracker.time_entries (
  id                  TEXT PRIMARY KEY,
  collaborator_id     TEXT NOT NULL REFERENCES tracker.collaborators(id) ON DELETE RESTRICT,
  collaborator_name   TEXT NOT NULL,   -- snapshot denormalizado, igual que en Firestore
  task_id             TEXT NOT NULL,   -- referencia externa (ej. Jira), texto libre, no es FK
  task_title          TEXT NOT NULL,
  project_id          TEXT NOT NULL REFERENCES tracker.projects(id) ON DELETE RESTRICT,
  project_name        TEXT NOT NULL,   -- snapshot denormalizado, igual que en Firestore
  date                DATE NOT NULL,   -- se guarda como día calendario (medianoche local), no timestamp
  hours               NUMERIC(6,2) NOT NULL,
  comments             TEXT NULL,
  task_billing_type   tracker.task_billing_type NOT NULL DEFAULT 'feature',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tracker.time_entries IS
  'FKs a collaborators/projects con ON DELETE RESTRICT: decisión deliberada para no poder borrar un colaborador o proyecto con horas cargadas (usar el flag "active" para desactivar). En Firestore hoy se puede borrar y las horas quedan huérfanas; este es un cambio de comportamiento acordado con el usuario.';

CREATE INDEX time_entries_collaborator_id_idx ON tracker.time_entries (collaborator_id);
CREATE INDEX time_entries_project_id_idx ON tracker.time_entries (project_id);
CREATE INDEX time_entries_date_idx ON tracker.time_entries (date);
