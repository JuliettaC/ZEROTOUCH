import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, validateDatabasePath } from '../../src/config/database.js';
import { TEST_KEY } from '../helpers/clave.js';

const sql = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
// SQL fixture only: password validity is exercised with Argon2 in security tests.
const sqlHash = '$argon2id$v=19$m=65536,t=3,p=1$' + 'x'.repeat(70);
function fixture(t) {
  const db = new Database(':memory:');
  db.exec(sql);
  t.after(() => db.close());
  const user = randomUUID(), profile = randomUUID(), mode = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'prueba', sqlHash);
  db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(profile, user, 'Perfil');
  db.prepare('INSERT INTO modos_uso(id,perfil_id,nombre) VALUES(?,?,?)').run(mode, profile, 'Modo');
  return { db, user, profile, mode };
}
test('nueve tablas (v4), catálogos y restricciones de identidad/hash/roles/correo', t => {
  const { db, user } = fixture(t);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n, 9);
  assert.equal(db.pragma('user_version', { simple: true }), 4);
  const email = db.prepare('UPDATE usuarios SET correo=? WHERE id=?');
  for (const value of ['MAYUS@ejemplo.test', ' espacio@ejemplo.test', 'sin-arroba', '@ejemplo.test']) assert.throws(() => email.run(value, user));
  assert.throws(() => db.prepare("UPDATE usuarios SET correo=NULL, correo_verificado_en='2026-01-01T00:00:00.000Z' WHERE id=?").run(user));
  const token = db.prepare("INSERT INTO tokens_cuenta(token_hash,usuario_id,proposito,correo,creado_en,expira_en) VALUES(?,?,?,?,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z')");
  assert.throws(() => token.run('x'.repeat(64), user, 'verificacion', 'a@b.cl'));
  assert.throws(() => token.run('a'.repeat(64), user, 'otro', 'a@b.cl'));
  const other = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,correo) VALUES(?,?,?,?)').run(other, 'cascada', sqlHash, 'a@b.cl');
  token.run('a'.repeat(64), other, 'verificacion', 'a@b.cl');
  db.prepare('DELETE FROM usuarios WHERE id=?').run(other);
  assert.equal(db.prepare('SELECT count(*) n FROM tokens_cuenta').get().n, 0, 'los tokens se eliminan en cascada');
  assert.equal(db.prepare('SELECT count(*) n FROM gestos').get().n, 8);
  assert.equal(db.prepare('SELECT count(*) n FROM acciones').get().n, 17);
  const insert = db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,rol) VALUES(?,?,?,?)');
  for (const id of [null, '', 'incorrecto', '12345678-1234-1234-1234-123456789012']) {
    assert.throws(() => insert.run(id, 'nuevo', sqlHash, 'user'));
  }
  assert.throws(() => insert.run(randomUUID(), 'nuevo', 'x'.repeat(100), 'user'));
  assert.throws(() => insert.run(randomUUID(), 'nuevo', sqlHash, 'root'));
  assert.throws(() => insert.run(randomUUID(), 'PRUEBA', sqlHash, 'user'));
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
test('rechaza fracciones, rangos, booleanos y FK inválidas', t => {
  const { db, mode } = fixture(t);
  for (const value of [1.5, -1, 101, 'texto', null]) {
    assert.throws(() => db.prepare('UPDATE modos_uso SET sensibilidad_puntero=? WHERE id=?').run(value, mode));
  }
  assert.throws(() => db.prepare('UPDATE modos_uso SET desk_rest_habilitado=2 WHERE id=?').run(mode));
  assert.throws(() => db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(randomUUID(), randomUUID(), 'Ajeno'));
  assert.throws(() => db.prepare('UPDATE modos_uso SET version=0 WHERE id=?').run(mode));
});
test('sesiones rechazan hash nulo/no hexadecimal y vencimiento incoherente', t => {
  const { db, user } = fixture(t);
  const insert = db.prepare('INSERT INTO sesiones(token_hash,usuario_id,creado_en,expira_en) VALUES(?,?,?,?)');
  const start = '2026-01-01T00:00:00.000Z', end = '2026-01-01T01:00:00.000Z';
  for (const hash of [null, 'x'.repeat(64), 'a']) assert.throws(() => insert.run(hash, user, start, end));
  for (const date of [start, '2025-01-01', 'incorrecto']) assert.throws(() => insert.run('a'.repeat(64), user, start, date));
  insert.run('a'.repeat(64), user, start, end);
});
test('cascadas eliminan hijos y catálogos permanecen; SQL se trata como dato', t => {
  const { db, user, profile, mode } = fixture(t);
  const payload = "nombre'); DROP TABLE usuarios; --";
  db.prepare('UPDATE perfiles SET descripcion=? WHERE id=?').run(payload, profile);
  assert.equal(db.prepare('SELECT descripcion FROM perfiles WHERE id=?').get(profile).descripcion, payload);
  db.prepare("INSERT INTO asignaciones_gestos(modo_id,gesto_codigo,accion_codigo) VALUES(?,'micro_pinza','clic')").run(mode);
  assert.throws(() => db.prepare("DELETE FROM acciones WHERE codigo='clic'").run());
  db.prepare('DELETE FROM usuarios WHERE id=?').run(user);
  for (const table of ['perfiles', 'modos_uso', 'asignaciones_gestos']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM acciones').get().n, 17);
});
test('conexión exclusiva, persistencia, cierre y rechazo de esquema ajeno', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zerotouch-i1-db-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'test.sqlite');
  let db = openDatabase(filename, { key: TEST_KEY, initialize: true });
  const id = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(id, 'persistente', sqlHash);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.throws(() => openDatabase(filename, { key: TEST_KEY, initialize: true }), { code: 'EEXIST' });
  db.close();
  assert.equal(db.open, false);
  db = openDatabase(filename, { key: TEST_KEY });
  assert.equal(db.prepare('SELECT id FROM usuarios').get().id, id);
  db.close();
  const foreign = path.join(directory, 'foreign.sqlite');
  writeFileSync(foreign, '');
  assert.throws(() => openDatabase(foreign, { key: TEST_KEY }), /incompatible/);
  assert.throws(() => openDatabase(path.join(directory, 'missing.sqlite'), { key: TEST_KEY }));
});
test('rutas relativas, del repositorio y OneDrive rechazadas', () => {
  assert.throws(() => validateDatabasePath('datos.sqlite'));
  assert.throws(() => validateDatabasePath(fileURLToPath(new URL('../../../datos.sqlite', import.meta.url))));
  assert.throws(() => validateDatabasePath(path.join(tmpdir(), 'OneDrive', 'datos.sqlite')));
});
