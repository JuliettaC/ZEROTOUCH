// Endurecimiento tras la revisión de seguridad del 25-11-2026: cuotas por cuenta, tope de idempotencia,
// clave de cliente del limitador, borrado de sesiones vencidas y registro de errores internos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { createApp } from '../../src/app.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { clientKey, authLimiter, MAX_BUCKETS } from '../../src/security/rate-limit.js';
import { MAX_PERFILES_POR_USUARIO, MAX_MODOS_POR_PERFIL } from '../../src/domain/cuotas.js';
import { createIdempotenciaRepository } from '../../src/repositories/idempotenciaRepository.js';
import { createIdempotencyRunner } from '../../src/services/idempotencia.js';
import { errorHandler } from '../../src/middleware/errors.js';

const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Endurecimiento ficticio 2026';

async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(schema);
  const mailer = createMemoryMailer();
  const server = createApp({ db, config, mailer }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); });
  async function request(method, route, body, session) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  async function account(name) {
    const correo = `${name}@ejemplo.test`;
    assert.equal((await request('POST', '/api/v1/auth/registro', { nombre_usuario: name, contrasena: password, correo })).status, 202);
    assert.equal((await request('POST', '/api/v1/auth/verificacion', { token: lastToken(mailer, correo) })).status, 200);
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: name, contrasena: password }),
    });
    const data = (await result.json()).data;
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: data.csrf_token, user: data.usuario };
  }
  return { db, request, account };
}

test('cuota de perfiles por cuenta: el siguiente al máximo responde 409 LIMITE_RECURSOS', async t => {
  const { db, request, account } = await fixture(t);
  const session = await account('cuota_perfiles'), other = await account('otra_cuenta');
  const insert = db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)');
  for (let i = 1; i < MAX_PERFILES_POR_USUARIO; i++) insert.run(randomUUID(), session.user.id, `P${i}`);
  assert.equal((await request('POST', '/api/v1/perfiles', { nombre: 'Último' }, session)).status, 201);
  const over = await request('POST', '/api/v1/perfiles', { nombre: 'Sobra' }, session);
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'LIMITE_RECURSOS');
  assert.equal(db.prepare('SELECT count(*) FROM perfiles WHERE usuario_id=?').pluck().get(session.user.id), MAX_PERFILES_POR_USUARIO);
  // La cuota es por cuenta: otra cuenta sigue creando.
  assert.equal((await request('POST', '/api/v1/perfiles', { nombre: 'Libre' }, other)).status, 201);
});

test('cuota de modos por perfil: 409 en el perfil lleno, 404 en uno ajeno', async t => {
  const { db, request, account } = await fixture(t);
  const session = await account('cuota_modos'), other = await account('ajena');
  const perfil = (await request('POST', '/api/v1/perfiles', { nombre: 'Lleno' }, session)).body.data;
  const insert = db.prepare('INSERT INTO modos_uso(id,perfil_id,nombre) VALUES(?,?,?)');
  for (let i = 1; i < MAX_MODOS_POR_PERFIL; i++) insert.run(randomUUID(), perfil.id, `M${i}`);
  assert.equal((await request('POST', `/api/v1/perfiles/${perfil.id}/modos`, { nombre: 'Último' }, session)).status, 201);
  const over = await request('POST', `/api/v1/perfiles/${perfil.id}/modos`, { nombre: 'Sobra' }, session);
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'LIMITE_RECURSOS');
  const sobraConGestos = await request('POST', `/api/v1/perfiles/${perfil.id}/modos`, { nombre: 'Sobra2', gestos: [] }, session);
  assert.equal(sobraConGestos.status, 409);
  assert.equal((await request('POST', `/api/v1/perfiles/${perfil.id}/modos`, { nombre: 'Robo' }, other)).status, 404);
  // Otro perfil de la misma cuenta no comparte la cuota.
  const libre = (await request('POST', '/api/v1/perfiles', { nombre: 'Libre' }, session)).body.data;
  assert.equal((await request('POST', `/api/v1/perfiles/${libre.id}/modos`, { nombre: 'Uno' }, session)).status, 201);
});

test('tope de idempotencia por cuenta: 429 sin crear nada; las repeticiones siguen respondiendo', () => {
  const db = new Database(':memory:');
  db.exec(schema);
  const user = randomUUID();
  db.prepare("INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)").run(user, 'idem', `$argon2id$v=19$m=65536,t=3,p=1$${'a'.repeat(22)}$${'b'.repeat(43)}`);
  const now = Date.parse('2026-11-25T00:00:00Z');
  const clock = createIdempotencyRunner({ repository: createIdempotenciaRepository(db, user), enabled: true, maxPorUsuario: 2, now: () => now });
  let created = 0;
  const create = () => ({ id: randomUUID(), n: ++created });
  // Claves UUID v7 con la hora de `now`, para que no caduquen.
  const hex = now.toString(16).padStart(12, '0');
  const v7 = n => `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-${String(n).padStart(12, '0')}`;
  clock.run({ header: v7(1), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'A' }, create });
  clock.run({ header: v7(2), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'B' }, create });
  assert.throws(() => clock.run({ header: v7(3), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'C' }, create }),
    error => error.status === 429 && error.code === 'LIMITE_SOLICITUDES');
  assert.equal(created, 2);
  const replay = clock.run({ header: v7(1), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'A' }, create });
  assert.equal(replay.replayed, true);
  assert.equal(created, 2);
  db.close();
});

test('clave de cliente del limitador: IPv4 mapeada y agrupación IPv6 por /64', () => {
  assert.equal(clientKey('127.0.0.1'), '127.0.0.1');
  assert.equal(clientKey('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(clientKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(clientKey('::1'), '0:0:0:0::/64');
  assert.equal(clientKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  for (const bad of [undefined, '', 'no-es-ip']) assert.equal(clientKey(bad), 'desconocido');
});

test('limitador: ventana vencida vuelve a contar desde cero y el mapa lleno falla cerrado', () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const limit = authLimiter({});
    for (let i = 0; i < 3; i++) limit('prueba', 'x', 3);
    assert.throws(() => limit('prueba', 'x', 3), error => error.status === 429);
    now += 900001;
    assert.equal(limit('prueba', 'x', 3), true);
    const full = authLimiter({});
    for (let i = 0; i < MAX_BUCKETS; i++) full('lleno', i, 5);
    assert.equal(full('lleno', 'nuevo', 5, { silent: true }), false);
    assert.equal(full('lleno', 0, 5), true); // las claves ya registradas siguen contando
    now += 900001;
    assert.equal(full('lleno', 'nuevo', 5), true); // vencidas, se liberan
  } finally { Date.now = realNow; }
});

test('una sesión vencida se borra de la base al usarse', async t => {
  const { db, request, account } = await fixture(t);
  const session = await account('vencida');
  db.prepare("UPDATE sesiones SET creado_en='2000-01-01T00:00:00.000Z',expira_en='2000-01-02T00:00:00.000Z'").run();
  assert.equal((await request('GET', '/api/v1/auth/me', undefined, session)).status, 401);
  assert.equal(db.prepare('SELECT count(*) FROM sesiones').pluck().get(), 0);
});

test('un 500 queda en el registro con código y ruta, sin el mensaje del error', () => {
  const events = [];
  const req = { method: 'GET', originalUrl: '/api/v1/perfiles?x=secreto', app: { locals: { securityLog: (evento, fields) => events.push({ evento, ...fields }) } } };
  const res = { headersSent: false, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  errorHandler(Object.assign(new Error('fallo con dato@privado.test'), { code: 'ERR_PRUEBA' }), req, res, () => {});
  assert.equal(res.code, 500);
  assert.deepEqual(events, [{ evento: 'error_interno', codigo: 'ERR_PRUEBA', metodo: 'GET', ruta: '/api/v1/perfiles', usuario_id: undefined }]);
  assert.doesNotMatch(JSON.stringify(events), /privado|secreto/);
  events.length = 0;
  errorHandler(Object.assign(new Error('x'), { type: 'entity.too.large' }), req, res, () => {});
  assert.equal(events.length, 0); // los errores esperados no ensucian el registro
});
