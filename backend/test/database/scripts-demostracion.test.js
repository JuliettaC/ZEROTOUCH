import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/config/database.js';
import { TEST_KEY } from '../helpers/clave.js';

// Herramientas de la demostración del Hito 3: correo:enlace (enlace de confirmación guardado como archivo) y
// db:modos (lectura directa del archivo SQLite). Datos ficticios, base temporal fuera del repositorio.
const scripts = fileURLToPath(new URL('../../scripts/', import.meta.url));
const run = (name, args, env) => spawnSync(process.execPath, [path.join(scripts, name), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const hash = '$argon2id$v=19$m=65536,t=3,p=1$' + 'x'.repeat(70);
const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-';   // 43 caracteres del alfabeto del token

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-demo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'demo.sqlite');
  const outbox = path.join(directory, 'correo-saliente');
  mkdirSync(outbox);
  return { directory, database, outbox, env: { DATABASE_PATH: database, DATABASE_KEY: TEST_KEY, MAIL_OUTBOX_DIR: outbox, MAIL_TRANSPORT: 'archivo', NODE_ENV: 'development' } };
}

test('correo:enlace decodifica el enlace partido por quoted-printable y respeta el correo pedido', t => {
  const { outbox, env } = fixture(t);
  assert.equal(token.length, 43);
  const eml = to => [
    `To: ${to}`, 'Subject: Confirma tu correo', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    // En quoted-printable el signo = se escribe =3D y una línea larga termina en = (salto suave), como en los .eml reales.
    'Confirmar mi correo:', `http://127.0.0.1:3000/cuenta/verificar#token=3D${token.slice(0, 20)}=`, token.slice(20), '',
  ].join('\r\n');
  writeFileSync(path.join(outbox, '2026-11-25T00-00-00-000Z-a.eml'), eml('profesor@ejemplo.test'));
  writeFileSync(path.join(outbox, '2026-11-25T00-00-01-000Z-b.eml'), eml('otra@ejemplo.test').replace(token.slice(0, 20), 'ZZZZZZZZZZZZZZZZZZZZ'));
  const found = run('enlace-verificacion.js', ['profesor@ejemplo.test'], env);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, new RegExp(`^http://127\\.0\\.0\\.1:3000/cuenta/verificar#token=${token}$`, 'm'), 'el enlace sale completo, en una sola línea');
  const missing = run('enlace-verificacion.js', ['nadie@ejemplo.test'], env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No hay un correo de verificación para nadie@ejemplo\.test/);
});

test('correo:enlace solo funciona con el transporte de archivo', t => {
  const { env } = fixture(t);
  const smtp = run('enlace-verificacion.js', [], { ...env, NODE_ENV: 'production', MAIL_TRANSPORT: 'smtp', MAIL_SMTP_HOST: 'smtp.ejemplo.test', MAIL_SMTP_PORT: '587', MAIL_SMTP_USER: 'u', MAIL_SMTP_PASSWORD: 'p', MAIL_FROM: 'ZeroTouch <no-responder@ejemplo.test>', APP_ORIGIN: 'https://ejemplo.test', HOST: '127.0.0.1' });
  assert.equal(smtp.status, 1);
});

test('db:modos lee solo lectura los modos guardados y no muestra contraseñas, correos ni tokens', t => {
  const { database, env } = fixture(t);
  const db = openDatabase(database, { key: TEST_KEY, initialize: true });
  const user = randomUUID(), profile = randomUUID(), mode = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,correo) VALUES(?,?,?,?)').run(user, 'profesor_demo', hash, 'secreto@ejemplo.test');
  db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(profile, user, 'Perfil principal');
  db.prepare('INSERT INTO modos_uso(id,perfil_id,nombre,sensibilidad_puntero) VALUES(?,?,?,?)').run(mode, profile, 'Cocina y Taller', 55);
  const version = db.pragma('user_version', { simple: true });
  db.close();
  const result = run('leer-modos.js', ['profesor_demo'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cocina y Taller/);
  assert.match(result.stdout, /55/);
  assert.match(result.stdout, new RegExp(`esquema v${version}`));
  assert.doesNotMatch(result.stdout, /argon2|secreto@ejemplo\.test|token/i);
  const none = run('leer-modos.js', ['otra_cuenta'], env);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /todavía no tiene modos guardados/);
  const absent = run('leer-modos.js', [], { ...env, DATABASE_PATH: path.join(path.dirname(database), 'no-existe.sqlite') });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /No existe la base/);
});
