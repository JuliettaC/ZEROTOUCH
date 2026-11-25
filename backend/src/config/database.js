import Database from 'better-sqlite3-multiple-ciphers';
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

// Cifrado en reposo: SQLite3 Multiple Ciphers (ChaCha20-Poly1305) con una clave de 256 bits en hexadecimal
// (DATABASE_KEY). La base, su WAL y los respaldos quedan cifrados; sin la clave el archivo no se puede leer.
export const DATABASE_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export function validateDatabaseKey(key) {
  if (typeof key !== 'string' || !DATABASE_KEY_PATTERN.test(key)) {
    throw new Error('DATABASE_KEY debe tener 64 caracteres hexadecimales (256 bits). Genera una con `npm run db:clave --prefix backend`.');
  }
  if (new Set(key.toLowerCase()).size === 1) throw new Error('DATABASE_KEY no puede repetir un solo carácter.');
  return key.toLowerCase();
}

// Abre el archivo y aplica la clave antes de cualquier otra lectura. Si la clave no corresponde (o la base sigue
// sin cifrar) SQLite responde SQLITE_NOTADB; se traduce a un mensaje que no revela la clave.
function openWithKey(resolved, key, options = {}) {
  const hex = validateDatabaseKey(key);
  const db = new Database(resolved, { fileMustExist: true, timeout: 3000, ...options });
  try {
    db.pragma(`hexkey='${hex}'`);
    db.pragma('schema_version', { simple: true });
    return db;
  } catch (error) {
    db.close();
    if (error?.code === 'SQLITE_NOTADB') {
      const wrapped = new Error('No se pudo abrir la base con DATABASE_KEY: la clave no corresponde o la base aún no está cifrada (ejecuta `npm run db:cifrar --prefix backend`).');
      wrapped.code = 'CLAVE_BASE_INVALIDA';
      throw wrapped;
    }
    throw error;
  }
}

export function openDatabase(filename, { key, initialize = false, readonly = false } = {}) {
  const resolved = validateDatabasePath(filename);
  validateDatabaseKey(key);
  if (initialize) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    // Exclusive creation: never initialize, migrate or replace an existing file.
    fs.closeSync(fs.openSync(resolved, 'wx', 0o600));
  }
  const db = openWithKey(resolved, key, readonly ? { readonly: true } : {});
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
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
    }
    return db;
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}

// Explicit migration (v1 -> v2 -> v3 -> v4, only the steps still missing). Never runs on startup.
// Before changing anything it writes a consistent copy next to the database with VACUUM INTO (the
// copy is encrypted with the same key). v1->v2 and v2->v3 are additive; v3->v4 deletes only the
// catalog rows (and their per-mode assignments) of the retired gestures. All steps run in ONE transaction, so a failure rolls
// everything back and leaves the original file as it was.
export async function migrateDatabase(filename, { key, now = new Date() } = {}) {
  const resolved = validateDatabasePath(filename);
  const db = openWithKey(resolved, key);
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
    db.prepare('VACUUM INTO ?').run(backup);
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

function tableCounts(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
  return Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT count(*) FROM "${name.replaceAll('"', '""')}"`).pluck().get()]));
}

// Cifra una base ZeroTouch existente que todavía está en texto plano (bases creadas antes del cifrado). Nunca
// borra datos: 1) copia consistente con VACUUM INTO a un archivo nuevo; 2) cifra esa copia con la clave y comprueba
// que abre, supera quick_check y tiene las mismas filas por tabla; 3) renombra el original sin cifrar a
// `<base>.sin-cifrar-<fecha>.ztbackup` y pone la copia cifrada en su lugar. El original sin cifrar lo borra la persona
// operadora cuando haya comprobado que la aplicación funciona (contiene los datos en claro).
export function encryptDatabase(filename, { key, now = new Date() } = {}) {
  const resolved = validateDatabasePath(filename);
  const hex = validateDatabaseKey(key);
  if (!fs.existsSync(resolved)) throw new Error(`No existe la base ${resolved}.`);
  try {
    openWithKey(resolved, hex).close();
    return { encrypted: false, alreadyEncrypted: true, plaintextBackup: null };
  } catch (error) {
    if (error.code !== 'CLAVE_BASE_INVALIDA') throw error;
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const temporary = `${resolved}.cifrando-${stamp}`;
  const plaintextBackup = `${resolved}.sin-cifrar-${stamp}.ztbackup`;
  for (const target of [temporary, plaintextBackup]) {
    if (fs.existsSync(target)) throw new Error(`${target} ya existe; no se sobrescribe.`);
  }
  let expected;
  try {
    const plain = new Database(resolved, { fileMustExist: true, timeout: 3000 });
    try {
      try {
        plain.pragma('schema_version', { simple: true });
      } catch (error) {
        if (error?.code === 'SQLITE_NOTADB') throw new Error('La base ya está cifrada con otra clave (o no es SQLite); no se modificó.', { cause: error });
        throw error;
      }
      if (plain.pragma('application_id', { simple: true }) !== APPLICATION_ID) throw new Error('No es una base ZeroTouch; no se modificó.');
      if (plain.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('La base no supera quick_check; no se modificó.');
      expected = tableCounts(plain);
      plain.prepare('VACUUM INTO ?').run(temporary);
    } finally { plain.close(); }
    const copy = new Database(temporary, { fileMustExist: true });
    try {
      copy.pragma('journal_mode = DELETE');
      copy.pragma(`hexrekey='${hex}'`);
    } finally { copy.close(); }
    const check = openWithKey(temporary, hex, { readonly: true });
    try {
      if (check.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('La copia cifrada no supera quick_check; el original no se tocó.');
      if (JSON.stringify(tableCounts(check)) !== JSON.stringify(expected)) throw new Error('La copia cifrada no tiene las mismas filas; el original no se tocó.');
    } finally { check.close(); }
  } catch (error) {
    // La copia temporal es nuestra (nunca el original): se retira para no dejar otra copia de los datos.
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  fs.renameSync(resolved, plaintextBackup);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(resolved + suffix)) fs.renameSync(resolved + suffix, plaintextBackup + suffix);
  }
  fs.renameSync(temporary, resolved);
  return { encrypted: true, alreadyEncrypted: false, plaintextBackup };
}
