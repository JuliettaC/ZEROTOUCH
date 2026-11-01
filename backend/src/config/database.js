import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const schema = new URL('../../../db/schema.sql', import.meta.url);
export const APPLICATION_ID = 0x5a543032;
export const SCHEMA_VERSION = 1;

function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateDatabasePath(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || /^[\\/]{2}/.test(filename)) {
    throw new Error('DATABASE_PATH debe ser una ruta absoluta local.');
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
      throw new Error('La base debe estar fuera del repositorio, OneDrive y unidades de red.');
    }
  }
  return resolved;
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
    if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID
      || db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
      throw new Error('Esquema incompatible; se requiere la base nueva de siete tablas.');
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
