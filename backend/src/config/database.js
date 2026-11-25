import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const schema = new URL('../../../db/schema.sql', import.meta.url);
const migrationV1toV2 = new URL('../../../db/migraciones/001_v1_a_v2.sql', import.meta.url);
const migrationV2toV3 = new URL('../../../db/migraciones/002_v2_a_v3.sql', import.meta.url);
const migrationV3toV4 = new URL('../../../db/migraciones/003_v3_a_v4.sql', import.meta.url);
export const APPLICATION_ID = 0x5a543032;
// Esquema más reciente (el que crea una base nueva). v3 agrega la idempotencia de POST; v4 retira del catálogo los
// gestos que la aplicación ya no ofrece. El backend sigue aceptando bases v2 (sin idempotencia) y v3 (con los gestos
// retirados, que ignora: el catálogo efectivo es el del contrato) hasta que se migren de forma explícita.
export const SCHEMA_VERSION = 4;
export const MIN_SCHEMA_VERSION = 2;

function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Same rules for the database and any other private local file (for example, the development
// mail outbox): absolute, local, outside the repository, OneDrive and network shares.
export function validatePrivateLocalPath(filename, label = 'DATABASE_PATH') {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || /^[\\/]{2}/.test(filename)) {
    throw new Error(`${label} debe ser una ruta absoluta local.`);
  }
  let ancestor = path.resolve(filename);
  const missing = [];
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Unidad de datos inexistente.');
    ancestor = parent;
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...missing);
  const roots = Object.entries(process.env)
    .filter(([key, value]) => /^onedrive/i.test(key) && value)
    .map(([, value]) => path.resolve(value));
  const repo = fs.realpathSync(repositoryRoot);
  for (const candidate of [path.resolve(filename), resolved]) {
    if (/^[\\/]{2}/.test(candidate) || /(^|[\\/])onedrive[^\\/]*([\\/]|$)/i.test(candidate)
      || roots.some(root => inside(candidate, root)) || inside(candidate, repo)) {
      throw new Error(`${label} debe estar fuera del repositorio, OneDrive y unidades de red.`);
    }
  }
  return resolved;
}

export function validateDatabasePath(filename) {
  return validatePrivateLocalPath(filename, 'DATABASE_PATH');
}

export function openDatabase(filename, { initialize = false } = {}) {
  const resolved = validateDatabasePath(filename);
  if (initialize) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    // Exclusive creation: never initialize, migrate or replace an existing file.
    fs.closeSync(fs.openSync(resolved, 'wx', 0o600));
  }
  const db = new Database(resolved, { fileMustExist: true, timeout: 3000 });
  try {
    db.pragma('foreign_keys = ON');
    if (initialize) db.exec(fs.readFileSync(schema, 'utf8'));
    const applicationId = db.pragma('application_id', { simple: true });
    const version = db.pragma('user_version', { simple: true });
    if (applicationId === APPLICATION_ID && version === 1) {
      throw new Error('Base ZeroTouch v1: ejecuta `npm run db:migrate --prefix backend` (crea un respaldo antes de migrar).');
    }
    if (applicationId !== APPLICATION_ID || version < MIN_SCHEMA_VERSION || version > SCHEMA_VERSION) {
      throw new Error(`Esquema incompatible; se requiere la base ZeroTouch v${MIN_SCHEMA_VERSION} o v${SCHEMA_VERSION}.`);
    }
    if (db.pragma('foreign_key_check').length) throw new Error('Integridad referencial inválida.');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    return db;
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}

// Explicit migration (v1 -> v2 -> v3 -> v4, only the steps still missing). Never runs on startup.
// Before changing anything it writes a consistent copy with SQLite's online backup API next to the
// database. v1->v2 and v2->v3 are additive; v3->v4 deletes only the catalog rows (and their per-mode
// assignments) of the retired gestures. All steps run in ONE transaction, so a failure rolls
// everything back and leaves the original file as it was.
export async function migrateDatabase(filename, { now = new Date() } = {}) {
  const resolved = validateDatabasePath(filename);
  const db = new Database(resolved, { fileMustExist: true, timeout: 3000 });
  try {
    db.pragma('foreign_keys = ON');
    if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) throw new Error('No es una base ZeroTouch.');
    const version = db.pragma('user_version', { simple: true });
    if (version === SCHEMA_VERSION) return { migrated: false, version, backup: null };
    if (![1, 2, 3].includes(version)) throw new Error(`Versión de esquema no soportada: ${version}.`);
    if (db.pragma('foreign_key_check').length) throw new Error('Integridad referencial inválida; no se migró.');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('La base no supera quick_check; no se migró.');
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const backup = `${resolved}.v${version}-${stamp}.ztbackup`;
    if (fs.existsSync(backup)) throw new Error('El archivo de respaldo ya existe; no se sobrescribe.');
    await db.backup(backup);
    const steps = [[1, migrationV1toV2], [2, migrationV2toV3], [3, migrationV3toV4]].filter(([from]) => from >= version).map(([, file]) => fs.readFileSync(file, 'utf8'));
    db.transaction(() => {
      for (const sql of steps) db.exec(sql);
      if (db.pragma('foreign_key_check').length) throw new Error('La migración produjo referencias inválidas.');
      if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) throw new Error('La migración no actualizó la versión.');
    }).immediate();
    return { migrated: true, from: version, version: SCHEMA_VERSION, backup };
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
  }
}
