import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const schema = new URL('../../../db/schema.sql', import.meta.url);
const migrationV1toV2 = new URL('../../../db/migraciones/001_v1_a_v2.sql', import.meta.url);
export const APPLICATION_ID = 0x5a543032;
export const SCHEMA_VERSION = 2;

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
    if (applicationId !== APPLICATION_ID || version !== SCHEMA_VERSION) {
      throw new Error('Esquema incompatible; se requiere la base ZeroTouch v2.');
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

// Explicit, additive v1 -> v2 migration. Never runs on startup. Before changing anything it
// writes a consistent copy with SQLite's online backup API next to the database. No row is
// deleted or rewritten; a failure rolls back and leaves the original file as it was.
export async function migrateDatabase(filename, { now = new Date() } = {}) {
  const resolved = validateDatabasePath(filename);
  const db = new Database(resolved, { fileMustExist: true, timeout: 3000 });
  try {
    db.pragma('foreign_keys = ON');
    if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) throw new Error('No es una base ZeroTouch.');
    const version = db.pragma('user_version', { simple: true });
    if (version === SCHEMA_VERSION) return { migrated: false, version, backup: null };
    if (version !== 1) throw new Error(`Versión de esquema no soportada: ${version}.`);
    if (db.pragma('foreign_key_check').length) throw new Error('Integridad referencial inválida; no se migró.');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('La base no supera quick_check; no se migró.');
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const backup = `${resolved}.v1-${stamp}.ztbackup`;
    if (fs.existsSync(backup)) throw new Error('El archivo de respaldo ya existe; no se sobrescribe.');
    await db.backup(backup);
    const sql = fs.readFileSync(migrationV1toV2, 'utf8');
    db.transaction(() => {
      db.exec(sql);
      if (db.pragma('foreign_key_check').length) throw new Error('La migración produjo referencias inválidas.');
    }).immediate();
    if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) throw new Error('La migración no actualizó la versión.');
    return { migrated: true, version: SCHEMA_VERSION, backup };
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
  }
}
