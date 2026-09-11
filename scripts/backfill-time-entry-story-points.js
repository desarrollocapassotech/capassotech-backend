// Backfill único: completa tracker.time_entries.story_points para horas cargadas
// antes de que existiera la integración con Jira (ver src/jira/jira.service.ts).
// story_points es puramente informativo (no interviene en facturación), así que
// este script solo LEE de Jira y ESCRIBE en Postgres — nunca pisa un valor ya
// cargado (todo UPDATE lleva "AND story_points IS NULL").
//
// Uso:
//   DATABASE_URL=postgresql://... JIRA_CONNECTIONS='[...]' node scripts/backfill-time-entry-story-points.js [--dry-run]
//
// JIRA_CONNECTIONS: mismo formato que consume JiraService.parseConnections,
// un array JSON de { key, baseUrl, email, apiToken }.

require('dotenv').config();
const { Client } = require('pg');

// Mismos valores que src/jira/jira.service.ts (JiraService), duplicados acá
// porque este es un script Node plano, no se puede importar un provider de
// Nest sin bootstrapear toda la app.
const STORY_POINTS_CUSTOM_TYPES = ['com.pyxis.greenhopper.jira:jsw-story-points', 'com.pyxis.greenhopper.jira:gh-story-points'];
const STORY_POINTS_FIELD_NAMES = ['story point estimate', 'story points'];

const BATCH_SIZE = 100;
const MAX_RETRIES_PER_BATCH = 5;
// task_id es texto libre en la base (se podía cargar antes de que existiera la
// integración con Jira). Una sola key con formato inválido rompe el JQL de todo
// el lote ("key in (...)"), así que se filtran antes de mandarlas a Jira.
const JIRA_KEY_REGEX = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseConnections(raw) {
  const map = new Map();
  if (!raw?.trim()) return map;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JIRA_CONNECTIONS no es un JSON válido.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('JIRA_CONNECTIONS debe ser un array.');
  }
  for (const entry of parsed) {
    if (entry && typeof entry.key === 'string' && typeof entry.baseUrl === 'string' && typeof entry.email === 'string' && typeof entry.apiToken === 'string') {
      map.set(entry.key, entry);
    }
  }
  return map;
}

function authHeader(connection) {
  const basicAuth = Buffer.from(`${connection.email}:${connection.apiToken}`).toString('base64');
  return { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' };
}

async function resolveStoryPointsFieldId(connection) {
  const url = `${connection.baseUrl.replace(/\/+$/, '')}/rest/api/3/field`;
  const response = await fetch(url, { headers: authHeader(connection) });
  if (!response.ok) {
    throw new Error(`No se pudo obtener /field (status ${response.status})`);
  }
  const allFields = await response.json();
  const match = allFields.find(
    (f) => (f.schema?.custom && STORY_POINTS_CUSTOM_TYPES.includes(f.schema.custom)) || STORY_POINTS_FIELD_NAMES.includes((f.name ?? '').toLowerCase()),
  );
  return match?.id ?? null;
}

// Busca un lote de keys vía POST /search (evita el límite de longitud de URL
// que tendría un GET con jql como query param). Devuelve { withPoints, foundWithoutPoints }:
// - withPoints: Map key -> story points, para issues que sí tienen un valor numérico cargado.
// - foundWithoutPoints: Set de keys que Jira encontró pero sin valor en el campo de story
//   points (issue real, simplemente nunca se estimó) — distinto de una key que no existe.
async function searchBatch(connection, storyPointsFieldId, keys) {
  // /rest/api/3/search fue retirado por Atlassian (devuelve 410 Gone); el
  // reemplazo es /rest/api/3/search/jql (mismo body, paginación por
  // nextPageToken en vez de startAt — no la necesitamos: pedimos <=100 keys
  // y maxResults=100).
  const url = `${connection.baseUrl.replace(/\/+$/, '')}/rest/api/3/search/jql`;
  const jql = `key in (${keys.join(',')})`;
  const body = JSON.stringify({ jql, fields: ['key', storyPointsFieldId], maxResults: keys.length });

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_BATCH; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader(connection), 'Content-Type': 'application/json' },
      body,
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const waitSeconds = retryAfterHeader ? Number(retryAfterHeader) : 2 ** attempt;
      console.warn(`  [${connection.key}] 429 recibido, esperando ${waitSeconds}s (intento ${attempt}/${MAX_RETRIES_PER_BATCH})...`);
      await sleep(waitSeconds * 1000);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(`Credenciales rechazadas (status ${response.status})`), { fatal: true });
    }

    if (!response.ok) {
      throw new Error(`Jira respondió con status ${response.status} para un lote de ${keys.length} keys`);
    }

    const data = await response.json();
    const withPoints = new Map();
    const foundWithoutPoints = new Set();
    for (const issue of data.issues ?? []) {
      const raw = storyPointsFieldId ? issue.fields?.[storyPointsFieldId] : null;
      if (typeof raw === 'number') {
        withPoints.set(issue.key, raw);
      } else {
        foundWithoutPoints.add(issue.key);
      }
    }
    return { withPoints, foundWithoutPoints };
  }

  throw new Error(`Se agotaron los reintentos por rate limit para un lote de ${keys.length} keys`);
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL en el entorno.');
  }
  const connectionsByKey = parseConnections(process.env.JIRA_CONNECTIONS);
  if (connectionsByKey.size === 0) {
    throw new Error('JIRA_CONNECTIONS está vacío o no configurado.');
  }

  const pgClient = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const candidatesResult = await pgClient.query(`
    SELECT DISTINCT te.task_id AS "taskId", c.jira_connection_key AS "jiraConnectionKey"
    FROM tracker.time_entries te
    JOIN tracker.projects p ON p.id = te.project_id
    LEFT JOIN tracker.clients c ON c.id = p.client_id
    WHERE te.story_points IS NULL
  `);

  const taskIdsByConnectionKey = new Map();
  let sinConexion = 0;
  const invalidFormat = [];
  for (const row of candidatesResult.rows) {
    if (!row.jiraConnectionKey || !connectionsByKey.has(row.jiraConnectionKey)) {
      sinConexion += 1;
      continue;
    }
    if (!JIRA_KEY_REGEX.test(row.taskId)) {
      invalidFormat.push(`${row.jiraConnectionKey}: "${row.taskId}"`);
      continue;
    }
    if (!taskIdsByConnectionKey.has(row.jiraConnectionKey)) {
      taskIdsByConnectionKey.set(row.jiraConnectionKey, []);
    }
    taskIdsByConnectionKey.get(row.jiraConnectionKey).push(row.taskId);
  }

  console.log(
    `Tareas candidatas: ${candidatesResult.rows.length}. Sin conexión Jira configurada: ${sinConexion}. Con formato inválido (no es una key de Jira): ${invalidFormat.length}.\n`,
  );

  const resolved = new Map(); // taskId -> storyPoints
  const notFound = [];
  const foundWithoutEstimate = [];
  const connectionErrors = [];

  for (const [connectionKey, taskIds] of taskIdsByConnectionKey) {
    const connection = connectionsByKey.get(connectionKey);
    console.log(`Conexión "${connectionKey}": ${taskIds.length} tareas a resolver.`);

    let storyPointsFieldId;
    try {
      storyPointsFieldId = await resolveStoryPointsFieldId(connection);
    } catch (error) {
      console.error(`  No se pudo resolver el campo de story points: ${error.message}`);
      connectionErrors.push({ connectionKey, error: error.message });
      continue;
    }
    if (!storyPointsFieldId) {
      console.warn(`  El site no tiene un campo de story points reconocible, se saltea toda la conexión.`);
      connectionErrors.push({ connectionKey, error: 'Sin campo de story points' });
      continue;
    }

    // Jira devuelve la key en formato canónico (ej: "EPEFI-123"), pero el
    // task_id cargado por el colaborador puede tener otro casing (ej:
    // "epefi-123"). Se agrupa por key en mayúsculas para no perder esos
    // registros ni pedirle a Jira la misma key dos veces en el mismo lote.
    const originalsByUpperKey = new Map();
    for (const taskId of taskIds) {
      const upperKey = taskId.toUpperCase();
      if (!originalsByUpperKey.has(upperKey)) originalsByUpperKey.set(upperKey, []);
      originalsByUpperKey.get(upperKey).push(taskId);
    }
    const uniqueUpperKeys = [...originalsByUpperKey.keys()];

    const batches = chunk(uniqueUpperKeys, BATCH_SIZE);
    let fatal = false;
    for (const [index, batch] of batches.entries()) {
      try {
        const { withPoints, foundWithoutPoints } = await searchBatch(connection, storyPointsFieldId, batch);
        for (const upperKey of batch) {
          const originals = originalsByUpperKey.get(upperKey);
          if (withPoints.has(upperKey)) {
            for (const taskId of originals) resolved.set(taskId, withPoints.get(upperKey));
          } else if (foundWithoutPoints.has(upperKey)) {
            for (const taskId of originals) foundWithoutEstimate.push(`${connectionKey}: ${taskId}`);
          } else {
            for (const taskId of originals) notFound.push(`${connectionKey}: ${taskId}`);
          }
        }
        console.log(`  Lote ${index + 1}/${batches.length}: ${withPoints.size}/${batch.length} resueltos.`);
      } catch (error) {
        if (error.fatal) {
          console.error(`  ${error.message} — se saltea el resto de esta conexión.`);
          connectionErrors.push({ connectionKey, error: error.message });
          fatal = true;
          break;
        }
        console.error(`  Lote ${index + 1}/${batches.length} falló: ${error.message}`);
        for (const upperKey of batch) {
          for (const taskId of originalsByUpperKey.get(upperKey)) notFound.push(`${connectionKey}: ${taskId} (error de request)`);
        }
      }
    }
    if (fatal) continue;
  }

  console.log(
    `\nResueltos: ${resolved.size}. Encontrados en Jira pero sin estimar: ${foundWithoutEstimate.length}. No encontrados en Jira: ${notFound.length}. Formato inválido: ${invalidFormat.length}. Sin conexión: ${sinConexion}.`,
  );
  if (connectionErrors.length) {
    console.log('\nErrores por conexión:');
    connectionErrors.forEach(({ connectionKey, error }) => console.log(` - ${connectionKey}: ${error}`));
  }
  if (foundWithoutEstimate.length) {
    console.log('\nMuestra de encontrados sin estimar (hasta 20) — el issue existe pero nunca se le cargó story points en Jira:');
    foundWithoutEstimate.slice(0, 20).forEach((entry) => console.log(' -', entry));
  }
  if (notFound.length) {
    console.log('\nMuestra de no encontrados (hasta 20) — no existen o no son visibles para el token configurado:');
    notFound.slice(0, 20).forEach((entry) => console.log(' -', entry));
  }
  if (invalidFormat.length) {
    console.log('\nMuestra de formato inválido (hasta 20):');
    invalidFormat.slice(0, 20).forEach((entry) => console.log(' -', entry));
  }

  if (dryRun) {
    console.log('\nDRY RUN: no se escribió nada en la base.');
    await pgClient.end();
    return;
  }

  console.log(`\nAplicando ${resolved.size} actualizaciones...`);
  await pgClient.query('BEGIN');
  try {
    let updated = 0;
    for (const [taskId, storyPoints] of resolved) {
      const result = await pgClient.query(
        `UPDATE tracker.time_entries SET story_points = $1 WHERE task_id = $2 AND story_points IS NULL`,
        [storyPoints, taskId],
      );
      updated += result.rowCount;
    }
    await pgClient.query('COMMIT');
    console.log(`Listo. Filas de time_entries actualizadas: ${updated}.`);
  } catch (error) {
    await pgClient.query('ROLLBACK');
    throw error;
  } finally {
    await pgClient.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
