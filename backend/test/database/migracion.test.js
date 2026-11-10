import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrateDatabase } from '../../src/config/database.js';

const v1 = readFileSync(new URL('../fixtures/schema-v1.sql', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const hash = '$argon2id$v=19$m=65536,t=3,p=1$' + 'x'.repeat(70);
const structure = db => ({
  tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
  indexes: db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),
  usuarios: db.pragma('table_info(usuarios)'),
  tokens: db.pragma('table_info(tokens_cuenta)'),
  fks: db.pragma('foreign_key_list(tokens_cuenta)'),
});

test('migración v1 -> v2: aditiva, con respaldo, idempotente y equivalente al esquema nuevo', async t => {
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
  assert.equal(result.version, 2);
  assert.ok(existsSync(result.backup));
  assert.match(path.basename(result.backup), /^v1\.sqlite\.v1-2026-11-10T12-00-00-000Z\.ztbackup$/);

  const backup = new Database(result.backup, { readonly: true });
  assert.equal(backup.pragma('user_version', { simple: true }), 1, 'el respaldo conserva la versión original');
  assert.equal(backup.prepare('SELECT count(*) n FROM modos_uso').get().n, 1);
  backup.close();

  const db = openDatabase(filename);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    const migrated = db.prepare('SELECT * FROM usuarios WHERE id=?').get(user);
    assert.equal(migrated.nombre_usuario, 'heredado');
    assert.equal(migrated.contrasena_hash, hash);
    assert.equal(migrated.correo, null);
    assert.equal(migrated.correo_verificado_en, null);
    assert.equal(db.prepare('SELECT sensibilidad_puntero s FROM modos_uso WHERE id=?').get(mode).s, 77);
    assert.equal(db.prepare('SELECT count(*) n FROM sesiones').get().n, 1, 'no se borran datos; el middleware rechaza la sesión');
    assert.equal(db.prepare('SELECT count(*) n FROM gestos').get().n, 13);
    const fresh = new Database(':memory:');
    fresh.exec(v2);
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
