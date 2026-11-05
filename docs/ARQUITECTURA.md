# Arquitectura del backend

Este documento describe cómo funciona el backend hoy, después de migrar toda la
orquestación de datos desde Firebase (Firestore) hacia NestJS + Neon (Postgres).
Para el detalle de tablas/columnas ver [`database/README.md`](../database/README.md).

## Qué reemplaza este backend

Antes, el frontend hablaba directo con Firebase: Firestore para todos los datos de
negocio (colaboradores, clientes, proyectos, horas), el SDK de Firebase Auth para
login/sesión, y el SDK de Firebase Storage para subir fotos de perfil. Ese modelo se
reemplazó por:

- **Neon (Postgres)** como base de datos de negocio (schema `tracker`), vía TypeORM.
- **NestJS** como capa de API entre el frontend y Neon/Firebase, con reglas de
  permisos resueltas en el servidor (antes vivían en reglas de seguridad de
  Firestore + validaciones sueltas en el frontend).
- **Firebase Auth y Firebase Storage se mantienen**, pero orquestados desde el
  backend (Admin SDK + REST de Identity Toolkit) en vez de que el frontend hable
  directo con esos SDKs. Ver la sección "Qué de Firebase sigue en pie" más abajo.

El frontend (`capassotech-timetracker-frontend`) ya no importa ningún SDK de
Firebase: todo pasa por `lib/api.ts` (`apiFetch` / `apiUploadFile`) contra este
backend.

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `auth/` | Login/logout/refresh/forgot-password/change-password contra Firebase Auth (Admin SDK + Identity Toolkit REST), resolución del perfil autenticado (roles, nombre, tarifa), subida de imágenes de perfil a Firebase Storage. |
| `collaborators/` | CRUD de colaboradores en `tracker.collaborators`, con permisos por campo según rol (ver más abajo). |
| `clients/` | CRUD de clientes en `tracker.clients`, mismo patrón de permisos por campo. |
| `projects/` | CRUD de proyectos en `tracker.projects` + asignaciones (`tracker.project_collaborators`), con `create`/`update` transaccionales. |
| `time-entries/` | Alta/edición/baja de horas cargadas (`tracker.time_entries`), incluye el volcado best-effort a Google Sheets. |
| `exchange-rate/` | Proxy con cache de 5 minutos a la cotización del dólar oficial (antes la consumía el frontend directo). |
| `health/` | `GET /health/db`: escribe, lee y borra un registro de prueba contra Neon, para confirmar que la conexión real funciona en cada entorno. |
| `database/` | Entidades TypeORM, migraciones (`synchronize: false` siempre), configuración de conexión. |
| `users/` | Controller vacío, sin rutas activas. No se usa hoy (candidato a limpieza futura, fuera de alcance de esta tarea). |

## Autenticación y autorización

1. El frontend loguea contra `POST /auth/login` (email + password), que reenvía
   las credenciales a la API REST de Identity Toolkit de Firebase (mismo mecanismo
   que usaba el SDK de cliente, pero ejecutado server-side). Devuelve `idToken` +
   `refreshToken`, que el frontend guarda (`lib/authTokenStorage.ts`).
2. Cada request autenticado manda `Authorization: Bearer <idToken>`.
   `FirebaseAuthGuard` (`src/auth/guards/firebase-auth.guard.ts`) verifica ese
   token contra Firebase Auth (`verifyIdToken`) y puebla `request.user = { uid,
   email }`.
3. Cuando un endpoint tiene `@Roles(...)`, `RolesGuard`
   (`src/auth/guards/roles.guard.ts`) resuelve el perfil completo (roles, nombre,
   tarifa) llamando a `AuthService.getProfile()` y valida que el usuario tenga
   alguno de los roles requeridos.
4. `AuthService.resolveUserProfile()` (el corazón de la resolución de identidad)
   busca, **en este orden**:
   1. `tracker.collaborators` por `user_id` (uid de Firebase Auth).
   2. `tracker.clients` por `user_id`.
   3. Si no aparece en ninguna, cae a un fallback de **solo lectura** contra
      Firestore `/users/{uid}` (`resolveUserProfileFromFirestore`) — nunca escribe
      ahí. Si tampoco existe en Firestore, devuelve un perfil por defecto en
      memoria (`roles: ['colaborador']`, sin nombre ni tarifa).

   Este fallback es la única lectura de Firestore que queda en el runtime del
   backend (fuera de los scripts de migración, que son de un solo uso). Ver la
   sección "Estado de Firestore" para el detalle de qué tan seguido se dispara hoy.

## Permisos por campo (colaboradores y clientes)

`CollaboratorsService` y `ClientsService` comparten el mismo patrón
(`resolveAllowedFields()`): según el rol del que hace la request, se calcula un
`Set` de campos editables/visibles antes de aplicar cualquier `PATCH`:

- **`ADMIN_FIELDS`**: acceso total (rol `admin`).
- **`ACCOUNTANT_RATE_FIELDS`** / **`ACCOUNTANT_FIELDS`**: subconjunto para
  `contable` (tarifas, medios de cobro, datos de facturación, sin datos
  personales sensibles).
- **`SELF_FIELDS`**: lo que un colaborador/cliente puede editar sobre sí mismo
  (usado en `UserProfile.tsx`, "Mi Perfil").

`ProjectsService` y `TimeEntriesService` no tienen esta granularidad por campo:
usan checks binarios por rol (ver comentarios en cada controller para el detalle
exacto de qué rol puede hacer qué).

## Qué de Firebase sigue en pie (y por qué)

Esta migración **no reemplaza** Firebase Auth ni Firebase Storage — decisión
explícita del proyecto. Lo que cambió es que el frontend ya no habla con esos
SDKs directo, sino que el backend los orquesta:

- **Firebase Auth**: sigue siendo el proveedor de identidad. El backend usa el
  Admin SDK (`firebase-admin/auth`) para crear/actualizar usuarios y revocar
  tokens, y la API REST de Identity Toolkit para el login/refresh basados en
  password (`src/auth/identity-toolkit.client.ts`).
- **Firebase Storage**: sigue siendo donde viven las fotos de perfil. El backend
  las sube con el Admin SDK (`AuthService.uploadProfileImage`) y arma a mano la
  URL de descarga con el mismo formato que generaba el SDK de cliente
  (`firebaseStorageDownloadTokens`), para que sean indistinguibles de las fotos
  subidas antes de la migración. El frontend sigue mostrando esas imágenes con un
  `<img src="https://firebasestorage.googleapis.com/...">` normal — no hay SDK de
  por medio, es una URL pública como cualquier otra.
- **Firestore**: es lo único candidato a baja. Ver la sección siguiente.

## Estado de Firestore

Firestore ya no es la fuente de datos de negocio (colaboradores, clientes,
proyectos, horas viven en Neon). Las únicas dos formas en que el backend todavía
toca Firestore hoy:

1. **Fallback de solo lectura** en `AuthService.resolveUserProfile()` (ver arriba)
   — se dispara solo para un `uid` de Firebase Auth que no tiene colaborador ni
   cliente en Neon. El backend **nunca escribe** en Firestore (verificado, no hay
   ningún `.set()`/`.update()`/`.add()` contra Firestore en todo el código de
   runtime).
2. **Scripts de migración** (`scripts/migrate-*-from-firestore.js`), de un solo
   uso, también de solo lectura.

Antes de dar de baja Firestore hay que asegurarse de que ningún usuario real siga
dependiendo de ese fallback. Para eso existe
[`scripts/audit-firebase-users-vs-neon.js`](../scripts/audit-firebase-users-vs-neon.js):
compara todos los usuarios de Firebase Auth contra `tracker.collaborators` /
`tracker.clients` en Neon y lista los que quedarían huérfanos (dependiendo del
fallback, o de un perfil vacío si Firestore ya no estuviera). Correrlo antes de
cualquier baja:

```bash
node scripts/audit-firebase-users-vs-neon.js
```

**Última corrida (2026-07-03, rama `develop`)**: 3 de 27 usuarios de Firebase Auth
quedaron huérfanos — los tres son cuentas viejas/duplicadas, superadas por otra
cuenta del mismo dueño que sí está bien vinculada en Neon (ver detalle y
recomendación en el reporte de la tarea "Pruebas integrales y puesta en
producción"). Antes de dar de baja Firestore en cualquier entorno hay que volver a
correr este script contra ese entorno puntual y resolver lo que aparezca.

## Servicios externos que ahora dispara el backend (antes el frontend)

| Servicio | Antes | Ahora |
|---|---|---|
| Cotización dólar oficial (`dolarapi.com`) | `fetch` directo desde `DataContext.tsx` | `GET /exchange-rate/usd`, con cache en memoria de 5 min y fallback al último valor conocido si `dolarapi` falla. |
| Google Sheets (webhook de reporting de horas) | `fetch` directo desde `DataContext.tsx` (`mode: no-cors`, sin poder leer la respuesta) | `TimeEntriesService.create()` dispara el mismo POST server-side, best-effort (no bloquea la carga de horas si falla), con el offset de fecha fijado a Argentina (`-03:00`) porque el servidor corre en UTC. |

## Endpoints

Todos (salvo `GET /` y `GET /health/db`) requieren `Authorization: Bearer
<idToken>`.

| Método | Ruta | Notas |
|---|---|---|
| POST | `/auth/login` | |
| POST | `/auth/refresh-token` | |
| POST | `/auth/forgot-password` | |
| POST | `/auth/logout` | Revoca refresh tokens del uid. |
| POST | `/auth/change-password` | Solo colaboradores. |
| GET | `/auth/me` | Perfil del usuario autenticado. |
| GET/POST/PATCH/DELETE | `/collaborators`, `/collaborators/:id` | Permisos por campo (ver arriba). |
| POST | `/collaborators/:id/profile-image` | Multipart, máx. 5MB. |
| GET/POST/PATCH/DELETE | `/clients`, `/clients/:id` | Permisos por campo. |
| POST | `/clients/:id/profile-image` | Multipart, máx. 5MB. |
| GET/POST/PATCH/DELETE | `/projects`, `/projects/:id` | Lectura abierta a cualquier autenticado; mutaciones admin-only; `create`/`update` transaccionales. |
| GET/POST/PATCH/DELETE | `/time-entries`, `/time-entries/:id` | Alta: cualquiera para sí mismo, admin/contable para cualquiera. Edición: admin/contable. |
| GET | `/exchange-rate/usd` | |
| GET | `/health/db` | Sin auth. |
| GET/POST | `/public/receipt-acknowledgements/:id` | Sin auth (el id del link del email es el acceso). GET muestra la página de confirmación del recibo y POST registra que el colaborador recibió el dinero. |

## Variables de entorno

Ver [`.env.example`](../.env.example). Resumen:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Connection string de Neon (rama según entorno, ver tabla de abajo). |
| `FIREBASE_API_KEY` | Público, usado para las llamadas REST a Identity Toolkit. |
| `FIREBASE_PROJECT_ID` | |
| `FIREBASE_STORAGE_BUCKET` | Bucket de Firebase Storage para fotos de perfil. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Ruta al JSON de la service account del Admin SDK (no se commitea). |
| `GOOGLE_SHEETS_TIME_ENTRIES_WEBHOOK_URL` | Webhook de Apps Script para el reporting de horas. Si falta, `TimeEntriesService` simplemente no lo dispara (no rompe la carga de horas). |
| `BACKEND_PUBLIC_URL` | URL pública del backend para el link de confirmación de los recibos. En Render no hace falta: se usa `RENDER_EXTERNAL_URL`, salvo que quieras otro dominio. Sin ninguna de las dos, el envío del recibo falla con un error. |

## Entornos y deploy

| Entorno | Frontend | Backend | Rama GitHub | Rama Neon |
|---|---|---|---|---|
| Producción | Firebase Hosting | Render | `main` | `production` |
| QA | Render | Render | `develop` | `develop` |
| Local | `npm run dev` (Vite) | `npm run start:dev` (Nest) | cualquiera | `develop` (recomendado) |

Las variables de entorno de Render se configuran desde su dashboard, no desde
archivos commiteados (`.env` está en `.gitignore` en ambos repos). El comando de
arranque en Render para el backend debe ser `npm run start:prod` (`node
dist/main`) — **no** `npm run start` (que corre `nest start`, pensado para
desarrollo, compila en memoria vía webpack y puede agotar la memoria del dyno).

## Scripts útiles

Todos viven en `scripts/`, son de solo lectura contra Firestore (nunca escriben
ahí) e idempotentes contra Neon:

- `migrate-collaborators-from-firestore.js`
- `migrate-clients-from-firestore.js`
- `migrate-projects-from-firestore.js`
- `migrate-time-entries-from-firestore.js`
- `audit-firebase-users-vs-neon.js` — auditoría de cuentas huérfanas (ver arriba).

Todos aceptan `DATABASE_URL=... node scripts/<script>.js` (y los de migración,
`--dry-run`).
