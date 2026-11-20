import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrateDatabase } from '../../src/config/database.js';

const v1 = readFileSync(new URL('../fixtures/schema-v1.sql', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../fixtures/schema-v2.sql', import.meta.url), 'utf8');   // esquema v2 congelado (antes de la idempotencia)
const v3 = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const hash = '$argon2id$v=19$m=65536,t=3,p=1$' + 'x'.repeat(70);
const structure = db => ({
  tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
  indexes: db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),
  usuarios: db.pragma('table_info(usuarios)'),
  tokens: db.pragma('table_info(tokens_cuenta)'),
  fks: db.pragma('foreign_key_list(tokens_cuenta)'),
  idempotencia: db.pragma('table_info(idempotencia)'),
  idempotenciaFks: db.pragma('foreign_key_list(idempotencia)'),
});

test('migración v1 -> v3: aditiva, con respaldo, idempotente y equivalente al esquema nuevo', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-migracion-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'v1.sqlite');
  const legacy = new Database(filename);
  legacy.exec(v1);
  const user = randomUUID(), profile = randomUUID(), mode = randomUUID();
  legacy.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'heredado', hash);
  legacy.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(profile, user, 'Perfil v1');
  legacy.prepare('INSERT INTO modos_uso(id,perfil_id,nombre,sensibilidad_puntero) VALUES(?,?,?,?)').run(mode, profile, 'Modo v1', 77);
  legacy.prepare("INSERT INTO sesiones(token_hash,usuario_id,creado_en,expira_en) VALUES(?,?,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").run('b'.repeat(64), user);
  legacy.close();

  assert.throws(() => openDatabase(filename), /db:migrate/);
  const result = await migrateDatabase(filename, { now: new Date('2026-11-10T12:00:00.000Z') });
  assert.equal(result.migrated, true);
  assert.equal(result.version, 3);
  assert.equal(result.from, 1);
  assert.ok(existsSync(result.backup));
  assert.match(path.basename(result.backup), /^v1\.sqlite\.v1-2026-11-10T12-00-00-000Z\.ztbackup$/);

  const backup = new Database(result.backup, { readonly: true });
  assert.equal(backup.pragma('user_version', { simple: true }), 1, 'el respaldo conserva la versión original');
  assert.equal(backup.prepare('SELECT count(*) n FROM modos_uso').get().n, 1);
  backup.close();

  const db = openDatabase(filename);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 3);
    const migrated = db.prepare('SELECT * FROM usuarios WHERE id=?').get(user);
    assert.equal(migrated.nombre_usuario, 'heredado');
    assert.equal(migrated.contrasena_hash, hash);
    assert.equal(migrated.correo, null);
    assert.equal(migrated.correo_verificado_en, null);
    assert.equal(db.prepare('SELECT sensibilidad_puntero s FROM modos_uso WHERE id=?').get(mode).s, 77);
    assert.equal(db.prepare('SELECT count(*) n FROM sesiones').get().n, 1, 'no se borran datos; el middleware rechaza la sesión');
    assert.equal(db.prepare('SELECT count(*) n FROM gestos').get().n, 13);
    const fresh = new Database(':memory:');
    fresh.exec(v3);
    assert.deepEqual(structure(db), structure(fresh));
    fresh.close();
  } finally { db.close(); }

  const again = await migrateDatabase(filename);
  assert.equal(again.migrated, false);
  assert.equal(readdirSync(directory).filter(name => name.endsWith('.ztbackup')).length, 1);
});

test('migración rechaza bases ajenas o versiones desconocidas sin modificarlas', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-migracion-ajena-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const foreign = path.join(directory, 'ajena.sqlite');
  const other = new Database(foreign);
  other.exec('CREATE TABLE datos(x); INSERT INTO datos VALUES (1);');
  other.close();
  await assert.rejects(migrateDatabase(foreign), /No es una base ZeroTouch/);
  const unknown = path.join(directory, 'v9.sqlite');
  const future = new Database(unknown);
  future.exec(v1);
  future.pragma('user_version = 9');
  future.close();
  await assert.rejects(migrateDatabase(unknown), /no soportada/);
  assert.equal(readdirSync(directory).filter(name => name.endsWith('.ztbackup')).length, 0);
  await assert.rejects(migrateDatabase('relativa.sqlite'), /absoluta/);
});

function legacyV2(directory, name = 'v2.sqlite') {
  const filename = path.join(directory, name);
  const old = new Database(filename);
  old.exec(v2);
  const user = randomUUID(), profile = randomUUID(), mode = randomUUID();
  old.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,correo,correo_verificado_en) VALUES(?,?,?,?,?)').run(user, 'usuario_v2', hash, 'v2@ejemplo.test', '2026-01-01T00:00:00.000Z');
  old.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(profile, user, 'Perfil v2');
  old.prepare('INSERT INTO modos_uso(id,perfil_id,nombre,sensibilidad_puntero) VALUES(?,?,?,?)').run(mode, profile, 'Modo v2', 31);
  old.prepare("INSERT INTO asignaciones_gestos(modo_id,gesto_codigo,accion_codigo,habilitado) VALUES(?,'micro_pinza','clic',0)").run(mode);
  old.close();
  return { filename, user, profile, mode };
}

test('el backend sigue abriendo una base v2 (sin idempotencia) y migrarla a v3 es explícito, con respaldo y sin perder datos', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-migracion-v3-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { filename, user, profile, mode } = legacyV2(directory);

  // Abrir NO migra: una base v2 sigue funcionando tal cual.
  const before = openDatabase(filename);
  assert.equal(before.pragma('user_version', { simple: true }), 2);
  assert.equal(before.prepare("SELECT count(*) n FROM sqlite_master WHERE name='idempotencia'").get().n, 0, 'abrir no crea la tabla');
  before.close();
  assert.equal(readdirSync(directory).filter(name => name.endsWith('.ztbackup')).length, 0, 'abrir no genera respaldos');

  const result = await migrateDatabase(filename, { now: new Date('2026-11-12T09:30:00.000Z') });
  assert.deepEqual([result.migrated, result.from, result.version], [true, 2, 3]);
  assert.match(path.basename(result.backup), /^v2\.sqlite\.v2-2026-11-12T09-30-00-000Z\.ztbackup$/);
  const backup = new Database(result.backup, { readonly: true });
  assert.equal(backup.pragma('user_version', { simple: true }), 2, 'el respaldo conserva la versión original');
  assert.equal(backup.prepare("SELECT count(*) n FROM sqlite_master WHERE name='idempotencia'").get().n, 0);
  backup.close();

  const db = openDatabase(filename);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 3);
    assert.equal(db.prepare('SELECT nombre_usuario, correo FROM usuarios WHERE id=?').get(user).correo, 'v2@ejemplo.test');
    assert.equal(db.prepare('SELECT nombre FROM perfiles WHERE id=?').get(profile).nombre, 'Perfil v2');
    assert.equal(db.prepare('SELECT sensibilidad_puntero s FROM modos_uso WHERE id=?').get(mode).s, 31);
    assert.equal(db.prepare('SELECT habilitado h FROM asignaciones_gestos WHERE modo_id=?').get(mode).h, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM idempotencia').get().n, 0, 'la tabla nueva empieza vacía');
    const fresh = new Database(':memory:');
    fresh.exec(v3);
    assert.deepEqual(structure(db), structure(fresh), 'la base migrada es idéntica a una base nueva v3');
    fresh.close();
  } finally { db.close(); }

  const again = await migrateDatabase(filename);
  assert.equal(again.migrated, false);
  assert.equal(readdirSync(directory).filter(name => name.endsWith('.ztbackup')).length, 1, 'repetir no crea otro respaldo');
});

test('una migración que falla no cambia nada: ni la versión ni las tablas (una sola transacción)', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-migracion-fallo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { filename } = legacyV2(directory);
  // Una tabla ajena con el mismo nombre hace fallar la migración a mitad de camino.
  const conflicting = new Database(filename);
  conflicting.exec('CREATE TABLE idempotencia (x)');
  conflicting.close();
  await assert.rejects(migrateDatabase(filename), /already exists|existe/i);
  const check = new Database(filename, { readonly: true });
  assert.equal(check.pragma('user_version', { simple: true }), 2, 'la versión no cambió');
  assert.deepEqual(check.pragma('table_info(idempotencia)').map(c => c.name), ['x'], 'la tabla ajena quedó como estaba');
  check.close();
  assert.equal(readdirSync(directory).filter(name => name.endsWith('.ztbackup')).length, 1, 'el respaldo previo sí existe');
});

test('la tabla de idempotencia solo admite claves UUID v7, huellas SHA-256 y respuestas JSON acotadas, y cae con el usuario', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(v3);
  const user = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'idem', hash);
  const key = '0194f3a2-8c11-7abc-8def-0123456789ab', fingerprint = 'a'.repeat(64);
  const insert = (overrides = {}) => {
    const row = { usuario: user, clave: key, huella: fingerprint, tipo: 'perfil', recurso: randomUUID(), respuesta: '{"data":{}}', ...overrides };
    return db.prepare('INSERT INTO idempotencia(usuario_id,clave,huella,recurso_tipo,recurso_id,respuesta) VALUES(?,?,?,?,?,?)')
      .run(row.usuario, row.clave, row.huella, row.tipo, row.recurso, row.respuesta);
  };
  insert();
  assert.throws(() => insert(), /UNIQUE|PRIMARY/i, 'la misma clave del mismo usuario no se repite');
  const other = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(other, 'otra', hash);
  insert({ usuario: other });   // otra cuenta puede usar la misma clave: el ámbito es por usuario
  const fresh = '0194f3a2-8c11-7abc-8def-0123456789ac';
  for (const bad of [{ clave: fresh.replace('-7abc-', '-4abc-') }, { clave: fresh.toUpperCase() }, { clave: 'corta' }, { huella: 'z'.repeat(64) }, { huella: 'a'.repeat(63) }, { tipo: 'otro' }, { respuesta: 'no es json' }, { respuesta: JSON.stringify({ x: 'y'.repeat(5000) }) }, { usuario: randomUUID() }]) {
    assert.throws(() => insert({ clave: fresh, ...bad }), /CHECK|FOREIGN|constraint/i, JSON.stringify(bad).slice(0, 50));
  }
  db.prepare('DELETE FROM usuarios WHERE id=?').run(user);
  assert.equal(db.prepare('SELECT count(*) n FROM idempotencia WHERE usuario_id=?').get(user).n, 0, 'las claves caen con la cuenta');
  assert.equal(db.prepare('SELECT count(*) n FROM idempotencia').get().n, 1);
  db.close();
});
