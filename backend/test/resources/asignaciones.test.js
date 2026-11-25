import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { capacidades } from '../../src/domain/capacidades.js';

const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Pruebas de asignaciones 2026';

async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(schema);
  const mailer = createMemoryMailer();
  const server = createApp({ db, config, mailer }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); });
  async function request(method, route, body, session, options = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...options.headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }
  async function account(name) {
    const credentials = { nombre_usuario: name, contrasena: password }, correo = `${name}@ejemplo.test`;
    assert.equal((await request('POST', '/api/v1/auth/registro', { ...credentials, correo })).status, 202);
    assert.equal((await request('POST', '/api/v1/auth/verificacion', { token: lastToken(mailer, correo) })).status, 200);
    const result = await request('POST', '/api/v1/auth/login', credentials);
    assert.equal(result.status, 200);
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.body.data.csrf_token, user: result.body.data.usuario };
  }
  async function mode(session) {
    const p = (await request('POST', '/api/v1/perfiles', { nombre: `Perfil ${randomUUID().slice(0, 8)}` }, session)).body.data;
    return (await request('POST', `/api/v1/perfiles/${p.id}/modos`, { nombre: 'Modo' }, session)).body.data;
  }
  return { db, request, account, mode };
}

const byCode = (list, code) => list.find(row => row.gesto_codigo === code);

test('el contrato de capacidades coincide con los catálogos sembrados en la base', async t => {
  const { db, request, account } = await fixture(t), session = await account('contrato');
  const gestos = db.prepare('SELECT codigo, accion_predeterminada FROM gestos ORDER BY codigo').all();
  const acciones = db.prepare('SELECT codigo FROM acciones ORDER BY codigo').all().map(row => row.codigo);
  assert.deepEqual(gestos.map(row => row.codigo), Object.keys(capacidades.gestos).sort());
  assert.deepEqual(acciones, Object.keys(capacidades.acciones).sort());
  for (const row of gestos) {
    assert.equal(capacidades.gestos[row.codigo].predeterminada, row.accion_predeterminada, row.codigo);
    assert.ok(capacidades.gestos[row.codigo].acciones.includes(row.accion_predeterminada), `la acción predeterminada de ${row.codigo} debe ser ejecutable por el motor`);
  }
  const served = await request('GET', '/api/v1/capacidades', undefined, session);
  assert.equal(served.status, 200);
  assert.deepEqual(served.body.data, { ...capacidades, servidor: { borrado_condicional: true, modo_con_asignaciones: true, idempotencia: { clave: 'uuid-v7', retencion_dias: 30 } } });
  assert.equal((await request('GET', '/api/v1/capacidades')).status, 401);
});

test('PUT reemplaza las asignaciones, sube la versión del modo y la exportación lo refleja', async t => {
  const { request, account, mode } = await fixture(t), session = await account('editor');
  const m = await mode(session);
  const put = await request('PUT', `/api/v1/modos/${m.id}/gestos`, {
    version: 1,
    gestos: [
      { gesto_codigo: 'palma_abierta', accion_codigo: 'multimedia_siguiente', habilitado: true },
      { gesto_codigo: 'dos_dedos', accion_codigo: 'desplazar', habilitado: false },
      { gesto_codigo: 'micro_pinza', accion_codigo: 'sin_accion', habilitado: true },
    ],
  }, session);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.data.formato_version, 1);
  assert.equal(put.body.data.modo.version, 2, 'una sola versión cubre modo y asignaciones');
  assert.deepEqual(byCode(put.body.data.gestos, 'palma_abierta'), { gesto_codigo: 'palma_abierta', nombre: 'Palma abierta', accion_codigo: 'multimedia_siguiente', habilitado: true, asignacion_version: 1 });
  assert.equal(byCode(put.body.data.gestos, 'dos_dedos').habilitado, false);
  assert.equal(byCode(put.body.data.gestos, 'puno_cerrado').accion_codigo, 'pausar', 'los gestos no enviados vuelven al catálogo');
  const read = await request('GET', `/api/v1/modos/${m.id}/gestos`, undefined, session);
  assert.deepEqual(read.body.data, put.body.data);
  assert.equal((await request('GET', `/api/v1/modos/${m.id}`, undefined, session)).body.data.version, 2);
  // Un segundo PUT con la versión antigua es un conflicto y no cambia nada.
  const stale = await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 1, gestos: [] }, session);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'VERSION_CONFLICTO');
  assert.equal(byCode((await request('GET', `/api/v1/modos/${m.id}/gestos`, undefined, session)).body.data.gestos, 'palma_abierta').accion_codigo, 'multimedia_siguiente');
  // Reemplazo vacío con la versión correcta: todo vuelve al catálogo.
  const reset = await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 2, gestos: [] }, session);
  assert.equal(reset.status, 200);
  assert.ok(reset.body.data.gestos.every(row => row.asignacion_version === null));
  assert.equal(reset.body.data.modo.version, 3);
});

test('PATCH edita una asignación y conserva las demás', async t => {
  const { request, account, mode } = await fixture(t), session = await account('parche');
  const m = await mode(session);
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 1, gestos: [{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: false }] }, session)).status, 200);
  const patched = await request('PATCH', `/api/v1/modos/${m.id}/gestos/palma_abierta`, { accion_codigo: 'precision', version: 2 }, session);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(byCode(patched.body.data.gestos, 'palma_abierta').accion_codigo, 'precision');
  assert.equal(byCode(patched.body.data.gestos, 'micro_pinza').habilitado, false, 'la asignación anterior se conserva');
  assert.equal(patched.body.data.modo.version, 3);
  const toggled = await request('PATCH', `/api/v1/modos/${m.id}/gestos/palma_abierta`, { habilitado: false, version: 3 }, session);
  assert.deepEqual([byCode(toggled.body.data.gestos, 'palma_abierta').accion_codigo, byCode(toggled.body.data.gestos, 'palma_abierta').habilitado, byCode(toggled.body.data.gestos, 'palma_abierta').asignacion_version], ['precision', false, 2]);
  assert.equal((await request('PATCH', `/api/v1/modos/${m.id}/gestos/palma_abierta`, { habilitado: true, version: 3 }, session)).status, 409);
  assert.equal((await request('PATCH', `/api/v1/modos/${m.id}/gestos/gesto_inventado`, { habilitado: true, version: 4 }, session)).status, 404);
  assert.equal((await request('PATCH', `/api/v1/modos/${m.id}/gestos/palma_abierta`, { version: 4 }, session)).status, 400);
});

test('solo se guardan asignaciones habilitadas que el motor puede ejecutar', async t => {
  const { request, account, mode } = await fixture(t), session = await account('compat');
  const m = await mode(session);
  const cases = [
    [[{ gesto_codigo: 'micro_pinza', accion_codigo: 'arrastrar', habilitado: true }], 400, 'ACCION_NO_COMPATIBLE'],
    [[{ gesto_codigo: 'palma_abierta', accion_codigo: 'clic', habilitado: true }], 400, 'ACCION_NO_COMPATIBLE'],
    [[{ gesto_codigo: 'trazo_airswipe', accion_codigo: 'confirmar', habilitado: true }], 400, 'ACCION_NO_COMPATIBLE'],
    [[{ gesto_codigo: 'palma_abierta', accion_codigo: 'calculadora', habilitado: true }], 400, 'DATOS_INVALIDOS'],
    [[{ gesto_codigo: 'cmd', accion_codigo: 'clic', habilitado: true }], 400, 'DATOS_INVALIDOS'],
    [[{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: 'true' }], 400, 'DATOS_INVALIDOS'],
    [[{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: true, shell: 'calc' }], 400, 'DATOS_INVALIDOS'],
    [[{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: true }, { gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: false }], 400, 'DATOS_INVALIDOS'],
  ];
  for (const [gestos, status, code] of cases) {
    const result = await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 1, gestos }, session);
    assert.equal(result.status, status, JSON.stringify(gestos));
    assert.equal(result.body.error, code);
  }
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, { gestos: [] }, session)).status, 400);
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 1, gestos: [], extra: 1 }, session)).status, 400);
  // Deshabilitada, una combinación no ejecutable se acepta y queda inactiva; sin_accion siempre vale.
  const ok = await request('PUT', `/api/v1/modos/${m.id}/gestos`, { version: 1, gestos: [
    { gesto_codigo: 'micro_pinza', accion_codigo: 'arrastrar', habilitado: false },
    { gesto_codigo: 'dos_dedos', accion_codigo: 'sin_accion', habilitado: true },
  ] }, session);
  assert.equal(ok.status, 200);
  assert.equal((await request('GET', `/api/v1/modos/${m.id}`, undefined, session)).body.data.version, 2, 'la versión del modo refleja el cambio');
});

test('propiedad, CSRF y recursos inexistentes', async t => {
  const { request, account, mode } = await fixture(t);
  const a = await account('duenia'), b = await account('otra');
  const m = await mode(a);
  const body = { version: 1, gestos: [{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: false }] };
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, body, b)).status, 404);
  assert.equal((await request('PATCH', `/api/v1/modos/${m.id}/gestos/micro_pinza`, { habilitado: false, version: 1 }, b)).status, 404);
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, body, { ...a, csrf: '' })).status, 403);
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, body)).status, 401);
  assert.equal((await request('PUT', `/api/v1/modos/${randomUUID()}/gestos`, body, a)).status, 404);
  assert.equal((await request('PUT', '/api/v1/modos/no-uuid/gestos', body, a)).status, 400);
  assert.equal((await request('PUT', `/api/v1/modos/${m.id}/gestos`, body, a)).status, 200);
  assert.equal((await request('GET', `/api/v1/modos/${m.id}/gestos`, undefined, b)).status, 404);
});
