import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { bootstrapAdmin } from '../../src/services/adminService.js';
import { readConfig } from '../../src/config/env.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { tmpdir } from 'node:os';
import path from 'node:path';

const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Pruebas API solamente 2026';
async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(schema);
  const mailer = createMemoryMailer();
  const server = createApp({ db, config, mailer }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); });
  async function request(method, route, body, session, options = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...options.headers },
      ...(body === undefined ? {} : { body: options.raw ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, text, headers: response.headers };
  }
  async function account(name, admin = false) {
    const credentials = { nombre_usuario: name, contrasena: password }, correo = `${name}@ejemplo.test`;
    // Every account (admin included) confirms its email through the real endpoint before login.
    let token;
    if (admin) ({ token } = await bootstrapAdmin(db, name, password, correo));
    else {
      assert.equal((await request('POST', '/api/v1/auth/registro', { ...credentials, correo })).status, 202);
      token = lastToken(mailer, correo);
    }
    assert.equal((await request('POST', '/api/v1/auth/verificacion', { token })).status, 200);
    const result = await request('POST', '/api/v1/auth/login', credentials);
    assert.equal(result.status, 200);
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.body.data.csrf_token, user: result.body.data.usuario };
  }
  return { db, request, account };
}
test('contrato auth/me en app real: identidad, alias, CSRF y revocación', async t => {
  const { request, account, db } = await fixture(t);
  assert.equal((await request('GET', '/api/v1/auth/me')).status, 401);
  const session = await account('cliente_tauri');
  const current = await request('GET', '/api/v1/auth/me', undefined, session);
  assert.equal(current.status, 200);
  assert.deepEqual(current.body, { data: { usuario: session.user, csrf_token: session.csrf } });
  assert.equal(current.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await request('GET', '/api/v1/auth/sesion', undefined, session)).body, current.body);
  assert.equal((await request('GET', '/api/v1/auth/me', undefined, session,
    { headers: { Origin: 'https://otro.example' } })).status, 403);
  assert.equal((await request('POST', '/api/v1/auth/logout', undefined, session,
    { headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await request('GET', '/api/v1/auth/me', undefined, session)).status, 200);
  const logout = await request('POST', '/api/v1/auth/logout', undefined, session);
  assert.equal(logout.status, 204);
  assert.equal(logout.text, '');
  assert.match(logout.headers.get('set-cookie'), /zt_session=;/);
  assert.equal(db.prepare('SELECT count(*) n FROM sesiones').get().n, 0);
  for (const route of ['/auth/me', '/auth/sesion', '/perfiles']) {
    assert.equal((await request('GET', `/api/v1${route}`, undefined, session)).status, 401);
  }
});

test('dos CRUD completos, valores predeterminados, paginación y cascada', async t => {
  const { request, account, db } = await fixture(t), session = await account('propietario');
  const created = await request('POST', '/api/v1/perfiles', { nombre: ' Cocina ', descripcion: 'Recetas' }, session);
  assert.equal(created.status, 201);
  const p = created.body.data;
  assert.equal(p.nombre, 'Cocina'); assert.equal(p.version, 1);
  assert.equal(created.headers.get('location'), `/api/v1/perfiles/${p.id}`);
  assert.equal((await request('GET', `/api/v1/perfiles/${p.id}`, undefined, session)).body.data.id, p.id);
  assert.equal((await request('GET', '/api/v1/perfiles?limite=1&offset=0', undefined, session)).body.data.length, 1);
  assert.equal((await request('PATCH', `/api/v1/perfiles/${p.id}`, { nombre: 'Taller', version: 1 }, session)).body.data.version, 2);
  const result = await request('POST', `/api/v1/perfiles/${p.id}/modos`, { nombre: 'Manual', desk_rest_habilitado: true }, session);
  assert.equal(result.status, 201);
  const m = result.body.data;
  assert.equal(m.sensibilidad_puntero, 65); assert.equal(m.desk_rest_habilitado, true);
  assert.equal(m.asistencia_mirada_habilitada, false);
  assert.equal((await request('GET', `/api/v1/perfiles/${p.id}/modos`, undefined, session)).body.data[0].id, m.id);
  assert.equal((await request('GET', `/api/v1/modos/${m.id}`, undefined, session)).status, 200);
  assert.equal((await request('PATCH', `/api/v1/modos/${m.id}`, { sensibilidad_puntero: 20, version: 1 }, session)).body.data.version, 2);
  const modeTag = (await request('GET', `/api/v1/modos/${m.id}`, undefined, session)).headers.get('etag');
  const deleted = await request('DELETE', `/api/v1/modos/${m.id}`, undefined, session, { headers: { 'If-Match': modeTag } });
  assert.equal(deleted.status, 204); assert.equal(deleted.text, '');
  assert.equal((await request('GET', `/api/v1/modos/${m.id}`, undefined, session)).status, 404);
  const second = (await request('POST', `/api/v1/perfiles/${p.id}/modos`, { nombre: 'Segundo' }, session)).body.data;
  db.prepare("INSERT INTO asignaciones_gestos(modo_id,gesto_codigo,accion_codigo) VALUES(?,'micro_pinza','clic')").run(second.id);
  const profileTag = (await request('GET', `/api/v1/perfiles/${p.id}`, undefined, session)).headers.get('etag');
  assert.equal((await request('DELETE', `/api/v1/perfiles/${p.id}`, undefined, session, { headers: { 'If-Match': profileTag } })).status, 204);
  assert.equal(db.prepare('SELECT count(*) n FROM asignaciones_gestos').get().n, 0);
  assert.equal((await request('GET', `/api/v1/modos/${second.id}`, undefined, session)).status, 404);
});
test('usuario y admin no leen ni modifican recursos privados ajenos', async t => {
  const { request, account } = await fixture(t);
  const a = await account('cuentaa'), b = await account('cuentab'), admin = await account('administrador', true);
  const p = (await request('POST', '/api/v1/perfiles', { nombre: 'Privado' }, a)).body.data;
  const m = (await request('POST', `/api/v1/perfiles/${p.id}/modos`, { nombre: 'Modo' }, a)).body.data;
  for (const other of [b, admin]) {
    assert.deepEqual((await request('GET', '/api/v1/perfiles', undefined, other)).body.data, []);
    for (const [method, url, body] of [
      ['GET', `/perfiles/${p.id}`], ['PATCH', `/perfiles/${p.id}`, { nombre: 'Robo', version: 1 }], ['DELETE', `/perfiles/${p.id}`],
      ['GET', `/perfiles/${p.id}/modos`], ['POST', `/perfiles/${p.id}/modos`, { nombre: 'Robo' }],
      ['GET', `/modos/${m.id}`], ['PATCH', `/modos/${m.id}`, { nombre: 'Robo', version: 1 }], ['DELETE', `/modos/${m.id}`], ['GET', `/modos/${m.id}/gestos`],
    ]) assert.equal((await request(method, `/api/v1${url}`, body, other)).status, 404, `${method} ${url}`);
  }
  assert.equal((await request('GET', `/api/v1/perfiles/${p.id}`, undefined, a)).status, 200);
});
test('versiones concurrentes producen un éxito y un conflicto', async t => {
  const { request, account } = await fixture(t), session = await account('versiones');
  const p = (await request('POST', '/api/v1/perfiles', { nombre: 'Inicial' }, session)).body.data;
  const responses = await Promise.all(['Primero', 'Segundo'].map(nombre => request('PATCH', `/api/v1/perfiles/${p.id}`, { nombre, version: 1 }, session)));
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
  assert.equal((await request('GET', `/api/v1/perfiles/${p.id}`, undefined, session)).body.data.version, 2);
});
test('validación, duplicados y SQL como texto', async t => {
  const { request, account } = await fixture(t), session = await account('validaciones');
  const p = (await request('POST', '/api/v1/perfiles', { nombre: 'Cocina' }, session)).body.data;
  assert.equal((await request('POST', '/api/v1/perfiles', { nombre: ' cocina ' }, session)).status, 409);
  for (const body of [{}, [], { nombre: '' }, { nombre: 'x', usuario_id: session.user.id }, { nombre: 'x', version: 1 }]) {
    assert.equal((await request('POST', '/api/v1/perfiles', body, session)).status, 400);
  }
  for (const body of [{}, { version: 1 }, { nombre: 'x' }, { nombre: 'x', version: '1' }, { version: 1, usuario_id: randomUUID() }]) {
    assert.equal((await request('PATCH', `/api/v1/perfiles/${p.id}`, body, session)).status, 400);
  }
  for (const body of [{ nombre: 'x', sensibilidad_puntero: 1.2 }, { nombre: 'x', estabilizacion_puntero: 101 }, { nombre: 'x', tolerancia_micro_pinza: -1 }, { nombre: 'x', desk_rest_habilitado: 'true' }, { nombre: 'x', categoria: 'otra' }, { nombre: 'x', perfil_id: p.id }]) {
    assert.equal((await request('POST', `/api/v1/perfiles/${p.id}/modos`, body, session)).status, 400);
  }
  assert.equal((await request('GET', '/api/v1/perfiles/no-uuid', undefined, session)).status, 400);
  assert.equal((await request('GET', `/api/v1/perfiles/${randomUUID()}`, undefined, session)).status, 404);
  for (const query of ['limite=0', 'limite=101', 'offset=-1', 'otro=x', 'limite=1&limite=2']) assert.equal((await request('GET', `/api/v1/perfiles?${query}`, undefined, session)).status, 400);
  const payload = "'); DROP TABLE perfiles; --";
  assert.equal((await request('PATCH', `/api/v1/perfiles/${p.id}`, { descripcion: payload, version: 1 }, session)).body.data.descripcion, payload);
  assert.equal((await request('GET', '/api/v1/perfiles', undefined, session)).body.data.length, 1);
});
test('catálogos y configuración efectiva respetan overrides y propiedad', async t => {
  const { request, account, db } = await fixture(t), session = await account('catalogos');
  assert.equal((await request('GET', '/api/v1/gestos', undefined, session)).body.data.length, 13);
  assert.equal((await request('GET', '/api/v1/acciones', undefined, session)).body.data.length, 17);
  const p = (await request('POST', '/api/v1/perfiles', { nombre: 'Perfil' }, session)).body.data;
  const m = (await request('POST', `/api/v1/perfiles/${p.id}/modos`, { nombre: 'Modo' }, session)).body.data;
  let effective = (await request('GET', `/api/v1/modos/${m.id}/gestos`, undefined, session)).body.data;
  assert.equal(effective.formato_version, 1); assert.equal(effective.modo.id, m.id);
  assert.equal(effective.gestos.find(g => g.gesto_codigo === 'micro_pinza').accion_codigo, 'clic');
  db.prepare("INSERT INTO asignaciones_gestos(modo_id,gesto_codigo,accion_codigo,habilitado) VALUES(?,'micro_pinza','sin_accion',0)").run(m.id);
  effective = (await request('GET', `/api/v1/modos/${m.id}/gestos`, undefined, session)).body.data;
  assert.deepEqual(effective.gestos.find(g => g.gesto_codigo === 'micro_pinza'), { gesto_codigo: 'micro_pinza', nombre: 'Micro-pinza', accion_codigo: 'sin_accion', habilitado: false, asignacion_version: 1 });
});
test('parser, errores JSON, sesión y CSRF se aplican en la app real', async t => {
  const { request, account, db } = await fixture(t), session = await account('errores');
  assert.equal((await request('GET', '/api/v1/health')).status, 200);
  assert.equal((await request('GET', '/api/health')).status, 200);
  assert.equal((await request('GET', '/inexistente')).status, 404);
  assert.equal((await request('GET', '/api/v1/perfiles')).status, 401);
  assert.equal((await request('GET', '/api/v1/gestos')).status, 401);
  assert.equal((await request('POST', '/api/v1/perfiles', { nombre: 'x' }, { ...session, csrf: '' })).status, 403);
  assert.equal((await request('POST', '/api/v1/perfiles', '{', session, { raw: true })).status, 400);
  assert.equal((await request('POST', '/api/v1/perfiles', '{}', session, { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('POST', '/api/v1/perfiles', { nombre: 'x'.repeat(20000) }, session)).status, 413);
  db.close();
  const failure = await request('GET', '/api/v1/perfiles', undefined, session);
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, { error: 'ERROR_INTERNO', mensaje: 'No se pudo completar la operación.' });
});
test('configuración valida entorno, ubicación, origen y puerto', () => {
  const base = { DATABASE_PATH: path.join(tmpdir(), 'test.sqlite') };
  assert.equal(readConfig(base).sessionTtlSeconds, 28800);
  for (const change of [{ PORT: 'NaN' }, { PORT: '-1' }, { PORT: '65536' }, { HOST: '0.0.0.0' }, { NODE_ENV: 'otra' }, { SESSION_TTL_SECONDS: '0' }, { APP_ORIGIN: 'http://localhost/ruta' }, { DATABASE_PATH: 'relativa.sqlite' }, { NODE_ENV: 'production' }]) assert.throws(() => readConfig({ ...base, ...change }));
});
