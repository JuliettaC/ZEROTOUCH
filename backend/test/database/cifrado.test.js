import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3-multiple-ciphers';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encryptDatabase, migrateDatabase, openDatabase, validateDatabaseKey } from '../../src/config/database.js';
import { TEST_KEY, keyed } from '../helpers/clave.js';

// Cifrado en reposo de la base SQLite (SQLite3 Multiple Ciphers). Datos ficticios y bases temporales.
const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../fixtures/schema-v2.sql', import.meta.url), 'utf8');
const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url));
const hash = '$argon2id$v=19$m=65536,t=3,p=1$' + 'x'.repeat(70);
const OTHER_KEY = '0123456789abcdef'.repeat(4);
const SECRET = 'correo-secreto@ejemplo.test';
const HEADER = Buffer.from('SQLite format 3\0');

function directory(t, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const plaintextIn = file => {
  const bytes = readFileSync(file);
  return bytes.subarray(0, 16).equals(HEADER) || bytes.includes(SECRET) || bytes.includes('usuarios');
};
function addUser(db, nombre = 'cifrada') {
  const id = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,correo) VALUES(?,?,?,?)').run(id, nombre, hash, SECRET);
  return id;
}

test('la clave exige 64 caracteres hexadecimales y no acepta claves triviales', () => {
  assert.equal(validateDatabaseKey(TEST_KEY.toUpperCase()), TEST_KEY);
  for (const bad of [undefined, null, '', 'corta', TEST_KEY.slice(1), `${TEST_KEY}0`, 'g'.repeat(64), '0'.repeat(64), 'A'.repeat(64)]) {
    assert.throws(() => validateDatabaseKey(bad), /DATABASE_KEY/, String(bad));
  }
});

test('una base nueva queda cifrada: ni el archivo ni el WAL contienen datos legibles', t => {
  const filename = path.join(directory(t, 'zt-cifrado-'), 'base.sqlite');
  const db = openDatabase(filename, { key: TEST_KEY, initialize: true });
  addUser(db);
  assert.ok(existsSync(`${filename}-wal`), 'la base usa WAL');
  assert.equal(plaintextIn(`${filename}-wal`), false, 'el WAL está cifrado');
  db.close();
  assert.equal(plaintextIn(filename), false, 'sin cabecera SQLite ni texto en claro');
  const again = openDatabase(filename, { key: TEST_KEY });
  assert.equal(again.prepare('SELECT correo FROM usuarios').get().correo, SECRET);
  again.close();
});

test('sin la clave o con otra clave la base no se abre, y el mensaje no revela la clave', t => {
  const filename = path.join(directory(t, 'zt-cifrado-clave-'), 'base.sqlite');
  openDatabase(filename, { key: TEST_KEY, initialize: true }).close();
  assert.throws(() => openDatabase(filename), /DATABASE_KEY/);
  assert.throws(() => openDatabase(filename, { key: 'corta' }), /DATABASE_KEY/);
  assert.throws(() => openDatabase(filename, { key: OTHER_KEY }), error => {
    assert.equal(error.code, 'CLAVE_BASE_INVALIDA');
    assert.doesNotMatch(error.message, new RegExp(`${OTHER_KEY}|${TEST_KEY}`));
    return true;
  });
  const raw = new Database(filename, { fileMustExist: true });
  assert.throws(() => raw.prepare('SELECT count(*) FROM usuarios').get(), { code: 'SQLITE_NOTADB' }, 'SQLite sin clave no la lee');
  raw.close();
});

test('el respaldo de la migración también queda cifrado con la misma clave', async t => {
  const filename = path.join(directory(t, 'zt-cifrado-migra-'), 'v2.sqlite');
  const old = keyed(filename);
  old.exec(v2);
  addUser(old, 'usuario_v2');
  old.close();
  const result = await migrateDatabase(filename, { key: TEST_KEY, now: new Date('2026-11-25T10:00:00.000Z') });
  assert.equal(result.migrated, true);
  assert.equal(plaintextIn(result.backup), false, 'el respaldo no tiene texto en claro');
  const backup = keyed(result.backup, { readonly: true });
  assert.equal(backup.prepare('SELECT correo FROM usuarios').get().correo, SECRET);
  backup.close();
  await assert.rejects(migrateDatabase(filename, { key: OTHER_KEY }), { code: 'CLAVE_BASE_INVALIDA' });
});

function plaintextBase(dir) {
  const filename = path.join(dir, 'antigua.sqlite');
  const db = new Database(filename);
  db.exec(schema);
  db.pragma('journal_mode = WAL');
  const user = addUser(db, 'antes_del_cifrado');
  db.close();
  return { filename, user };
}

test('db:cifrar convierte una base sin cifrar sin perder filas y conserva el original como respaldo', t => {
  const dir = directory(t, 'zt-cifrado-conv-');
  const { filename, user } = plaintextBase(dir);
  assert.equal(plaintextIn(filename), true, 'punto de partida: base en claro');
  assert.throws(() => openDatabase(filename, { key: TEST_KEY }), { code: 'CLAVE_BASE_INVALIDA' }, 'el servidor no abre una base sin cifrar');

  const result = encryptDatabase(filename, { key: TEST_KEY, now: new Date('2026-11-25T11:00:00.000Z') });
  assert.deepEqual([result.encrypted, result.alreadyEncrypted], [true, false]);
  assert.match(path.basename(result.plaintextBackup), /^antigua\.sqlite\.sin-cifrar-2026-11-25T11-00-00-000Z\.ztbackup$/);
  assert.equal(plaintextIn(filename), false, 'la base quedó cifrada');
  const original = new Database(result.plaintextBackup, { readonly: true });
  assert.equal(original.prepare('SELECT nombre_usuario FROM usuarios WHERE id=?').get(user).nombre_usuario, 'antes_del_cifrado', 'el original no se borra');
  original.close();
  const db = openDatabase(filename, { key: TEST_KEY });
  try {
    assert.equal(db.prepare('SELECT correo FROM usuarios WHERE id=?').get(user).correo, SECRET);
    assert.equal(db.prepare('SELECT count(*) n FROM gestos').get().n, 8);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  } finally { db.close(); }
  assert.deepEqual(readdirSync(dir).filter(name => name.includes('cifrando')), [], 'no queda la copia temporal');

  const again = encryptDatabase(filename, { key: TEST_KEY });
  assert.deepEqual([again.encrypted, again.alreadyEncrypted], [false, true], 'repetir no cambia nada');
  assert.throws(() => encryptDatabase(filename, { key: OTHER_KEY }), /otra clave/);
});

test('db:cifrar rechaza archivos que no son de ZeroTouch sin tocarlos', t => {
  const dir = directory(t, 'zt-cifrado-ajena-');
  const foreign = path.join(dir, 'ajena.sqlite');
  const other = new Database(foreign);
  other.exec('CREATE TABLE datos(x); INSERT INTO datos VALUES (1);');
  other.close();
  const before = readFileSync(foreign);
  assert.throws(() => encryptDatabase(foreign, { key: TEST_KEY }), /No es una base ZeroTouch/);
  assert.deepEqual(readFileSync(foreign), before);
  assert.deepEqual(readdirSync(dir), ['ajena.sqlite']);
  assert.throws(() => encryptDatabase(path.join(dir, 'no-existe.sqlite'), { key: TEST_KEY }), /No existe/);
});

test('los comandos db:clave y db:cifrar funcionan de punta a punta', t => {
  const dir = directory(t, 'zt-cifrado-cli-');
  const generated = spawnSync(process.execPath, [path.join(scripts, 'generar-clave.js')], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const key = generated.stdout.trim().match(/^DATABASE_KEY=([0-9a-f]{64})$/)?.[1];
  assert.ok(key, 'imprime una línea DATABASE_KEY lista para el .env');
  assert.equal(validateDatabaseKey(key), key);

  const { filename } = plaintextBase(dir);
  const run = env => spawnSync(process.execPath, [path.join(scripts, 'cifrar-db.js')], { env: { ...process.env, DATABASE_PATH: filename, ...env }, encoding: 'utf8' });
  const missing = run({ DATABASE_KEY: '' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DATABASE_KEY/);
  const done = run({ DATABASE_KEY: key });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /SIN CIFRAR/);
  assert.doesNotMatch(done.stdout + done.stderr, new RegExp(key), 'la clave no se imprime');
  assert.equal(plaintextIn(filename), false);
  openDatabase(filename, { key }).close();
});
