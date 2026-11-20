import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { capacidades } from '../../src/domain/capacidades.js';
import { validateAssignmentList } from '../../src/services/asignacionesValidation.js';
import { validateBody } from '../../src/services/resourceValidation.js';

// Mutación conjunta: `gestos` dentro de POST /perfiles/{id}/modos y PATCH /modos/{id}. El modo y sus asignaciones
// se escriben en UNA transacción, con UNA sola subida de versión; si algo falla no queda nada a medias.
const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Pruebas mutacion conjunta 2026';
const GESTOS = Object.keys(capacidades.gestos).sort();

/** UUID v7 con la hora actual (claves de idempotencia). */
function uuidv7() {
  const hex = Date.now().toString(16).padStart(12, '0');
  const r = randomBytes(10).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 18)}`;
}
/** Las 13 asignaciones con su acción predeterminada, salvo las indicadas. */
const full = (overrides = {}) => GESTOS.map(code => ({
  gesto_codigo: code,
  accion_codigo: overrides[code]?.accion ?? capacidades.gestos[code].predeterminada,
  habilitado: overrides[code]?.habilitado ?? true,
}));
/** Una acción permitida para ese gesto distinta de la predeterminada (o la propia si no hay otra). */
const otherAction = code => capacidades.gestos[code].acciones.find(a => a !== capacidades.gestos[code].predeterminada && a !== 'sin_accion') ?? 'sin_accion';

async function fixture(t) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const mailer = createMemoryMailer();
  const server = createApp({ db, config, mailer }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); });
  async function request(method, route, body, session, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }
  async function account(name) {
    const credentials = { nombre_usuario: name, contrasena: password }, correo = `${name}@ejemplo.test`;
    assert.equal((await request('POST', '/auth/registro', { ...credentials, correo })).status, 202);
    assert.equal((await request('POST', '/auth/verificacion', { token: lastToken(mailer, correo) })).status, 200);
    const login = await request('POST', '/auth/login', credentials);
    assert.equal(login.status, 200);
    return { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.body.data.csrf_token };
  }
  async function profile(session, nombre = `Perfil ${randomUUID().slice(0, 8)}`) {
    return (await request('POST', '/perfiles', { nombre }, session)).body.data;
  }
  const rows = modeId => db.prepare('SELECT gesto_codigo, accion_codigo, habilitado, version FROM asignaciones_gestos WHERE modo_id=? ORDER BY gesto_codigo').all(modeId);
  const modeRow = id => db.prepare('SELECT * FROM modos_uso WHERE id=?').get(id);
  const count = table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
  return { db, request, account, profile, rows, modeRow, count };
}

test('POST con gestos: el modo y sus 13 asignaciones nacen juntos, en la versión 1', async t => {
  const { request, account, profile, rows, count } = await fixture(t);
  const session = await account('conj_crear'), p = await profile(session);
  // Tres gestos que NO coinciden con el catálogo: otra acción, otra acción deshabilitada y la acción predeterminada deshabilitada.
  const custom = full({
    deslizamiento_derecha: { accion: otherAction('deslizamiento_derecha') },
    deslizamiento_izquierda: { accion: otherAction('deslizamiento_izquierda'), habilitado: false },
    micro_pinza: { accion: capacidades.gestos.micro_pinza.predeterminada, habilitado: false },
  });
  assert.notDeepEqual(custom, full(), 'la prueba solo vale si difiere de los predeterminados');
  assert.notEqual(otherAction('deslizamiento_derecha'), capacidades.gestos.deslizamiento_derecha.predeterminada);
  const created = await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Conjunto', sensibilidad_puntero: 77, gestos: custom }, session);
  assert.equal(created.status, 201);
  assert.equal(created.body.data.version, 1, 'una sola creación: versión 1 (antes eran dos pasos y quedaba en 2)');
  assert.equal(created.body.data.sensibilidad_puntero, 77);
  assert.equal(created.body.data.gestos, undefined, 'la respuesta sigue siendo el modo');
  assert.equal(count('asignaciones_gestos'), 13);
  assert.deepEqual(rows(created.body.data.id).map(({ gesto_codigo, accion_codigo, habilitado }) => ({ gesto_codigo, accion_codigo, habilitado: Boolean(habilitado) })), custom);
  assert.ok(rows(created.body.data.id).every(row => row.version === 1));
  const effective = (await request('GET', `/modos/${created.body.data.id}/gestos`, undefined, session)).body.data;
  assert.equal(effective.modo.version, 1);
  assert.deepEqual(effective.gestos.map(({ gesto_codigo, accion_codigo, habilitado }) => ({ gesto_codigo, accion_codigo, habilitado })), custom);
});

test('POST sin gestos sigue como antes: ninguna fila de asignaciones y los valores predeterminados del catálogo', async t => {
  const { request, account, profile, count } = await fixture(t);
  const session = await account('conj_sin'), p = await profile(session);
  const created = await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Solo modo' }, session);
  assert.equal(created.status, 201);
  assert.equal(count('asignaciones_gestos'), 0);
  const effective = (await request('GET', `/modos/${created.body.data.id}/gestos`, undefined, session)).body.data;
  assert.ok(effective.gestos.every(g => g.asignacion_version === null));
});

test('POST con gestos inválidos: 400 y NO se crea el modo (nada a medias)', async t => {
  const { request, account, profile, count } = await fixture(t);
  const session = await account('conj_crear_mal'), p = await profile(session);
  const good = full();
  const incompatible = capacidades.gestos[GESTOS[0]].acciones.length < Object.keys(capacidades.acciones).length
    ? Object.keys(capacidades.acciones).find(a => a !== 'sin_accion' && !capacidades.gestos[GESTOS[0]].acciones.includes(a)) : null;
  const cases = [
    ['gesto desconocido', [{ gesto_codigo: 'no_existe', accion_codigo: 'sin_accion', habilitado: true }], 'DATOS_INVALIDOS'],
    ['gesto repetido', [good[0], good[0]], 'DATOS_INVALIDOS'],
    ['acción fuera del catálogo', [{ ...good[0], accion_codigo: 'borrar_todo' }], 'DATOS_INVALIDOS'],
    ['campo extra', [{ ...good[0], extra: 1 }], 'DATOS_INVALIDOS'],
    ['habilitado no booleano', [{ ...good[0], habilitado: 'si' }], 'DATOS_INVALIDOS'],
    ['no es una lista', { gesto_codigo: good[0].gesto_codigo }, 'DATOS_INVALIDOS'],
    ['demasiadas', [...good, good[0]], 'DATOS_INVALIDOS'],
    ...(incompatible ? [['acción no compatible con el gesto', [{ ...good[0], accion_codigo: incompatible }], 'ACCION_NO_COMPATIBLE']] : []),
  ];
  for (const [label, gestos, code] of cases) {
    const response = await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'No debe existir', gestos }, session);
    assert.deepEqual([label, response.status, response.body.error], [label, 400, code]);
  }
  assert.equal(count('modos_uso'), 0, 'ningún intento dejó un modo');
  assert.equal(count('asignaciones_gestos'), 0);
});

test('PATCH con campos y gestos: una sola subida de versión y todo aplicado junto', async t => {
  const { request, account, profile, rows, modeRow } = await fixture(t);
  const session = await account('conj_patch'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Original', sensibilidad_puntero: 50 }, session)).body.data;
  const next = full({ [GESTOS[0]]: { accion: capacidades.gestos[GESTOS[0]].predeterminada, habilitado: false } });
  const patched = await request('PATCH', `/modos/${mode.id}`, { version: mode.version, nombre: 'Renombrado', sensibilidad_puntero: 90, gestos: next }, session);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.version, mode.version + 1, 'UNA subida, no dos (antes PATCH + PUT daban +2)');
  assert.equal(patched.body.data.nombre, 'Renombrado');
  assert.equal(patched.body.data.sensibilidad_puntero, 90);
  assert.equal(modeRow(mode.id).version, mode.version + 1);
  assert.deepEqual(rows(mode.id).map(({ gesto_codigo, accion_codigo, habilitado }) => ({ gesto_codigo, accion_codigo, habilitado: Boolean(habilitado) })), next);
  const effective = (await request('GET', `/modos/${mode.id}/gestos`, undefined, session)).body.data;
  assert.equal(effective.modo.version, mode.version + 1);
  // El ETag (que cubre la versión) cambia una sola vez.
  const tag = (await request('GET', `/modos/${mode.id}`, undefined, session)).headers.get('etag');
  assert.match(tag, /^"[A-Za-z0-9_-]{32}"$/);
});

test('PATCH solo con gestos (y version) es válido; gestos [] devuelve los predeterminados; sin gestos no toca las asignaciones', async t => {
  const { request, account, profile, rows, count } = await fixture(t);
  const session = await account('conj_solo'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Modo', gestos: full() }, session)).body.data;
  assert.equal(count('asignaciones_gestos'), 13);
  const onlyGestures = await request('PATCH', `/modos/${mode.id}`, { version: 1, gestos: full({ [GESTOS[1]]: { accion: capacidades.gestos[GESTOS[1]].predeterminada, habilitado: false } }) }, session);
  assert.equal(onlyGestures.status, 200);
  assert.equal(onlyGestures.body.data.version, 2);
  assert.equal(rows(mode.id).find(r => r.gesto_codigo === GESTOS[1]).habilitado, 0);
  // Un PATCH sin gestos conserva las asignaciones exactamente como estaban.
  const before = JSON.stringify(rows(mode.id));
  const fieldsOnly = await request('PATCH', `/modos/${mode.id}`, { version: 2, nombre: 'Solo campos' }, session);
  assert.equal(fieldsOnly.body.data.version, 3);
  assert.equal(JSON.stringify(rows(mode.id)), before);
  // gestos: [] borra los reemplazos (vuelven al catálogo), con una sola subida.
  const reset = await request('PATCH', `/modos/${mode.id}`, { version: 3, gestos: [] }, session);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.version, 4);
  assert.equal(count('asignaciones_gestos'), 0);
  // Un PATCH sin ningún cambio sigue siendo inválido.
  assert.equal((await request('PATCH', `/modos/${mode.id}`, { version: 4 }, session)).status, 400);
});

test('PATCH conjunto inválido o con versión obsoleta: nada cambia (ni campos, ni versión, ni asignaciones)', async t => {
  const { request, account, profile, rows, modeRow } = await fixture(t);
  const session = await account('conj_nada'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Estable', sensibilidad_puntero: 40, gestos: full() }, session)).body.data;
  const snapshot = () => JSON.stringify({ modo: modeRow(mode.id), asignaciones: rows(mode.id) });
  const before = snapshot();
  const bad = await request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'Cambio', sensibilidad_puntero: 99, gestos: [{ gesto_codigo: 'no_existe', accion_codigo: 'sin_accion', habilitado: true }] }, session);
  assert.deepEqual([bad.status, bad.body.error], [400, 'DATOS_INVALIDOS']);
  assert.equal(snapshot(), before, 'los campos válidos de un PATCH inválido tampoco se aplicaron');
  const stale = await request('PATCH', `/modos/${mode.id}`, { version: 7, nombre: 'Cambio', sensibilidad_puntero: 99, gestos: full({ [GESTOS[0]]: { accion: capacidades.gestos[GESTOS[0]].predeterminada, habilitado: false } }) }, session);
  assert.deepEqual([stale.status, stale.body.error], [409, 'VERSION_CONFLICTO']);
  assert.equal(snapshot(), before, 'con versión obsoleta tampoco se tocaron las asignaciones');
  const ok = await request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'Ahora sí', gestos: full() }, session);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.version, 2);
});

test('dos PATCH conjuntos con la misma versión: uno gana (200) y el otro recibe 409 sin aplicar nada', async t => {
  const { request, account, profile, rows } = await fixture(t);
  const session = await account('conj_carrera'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Disputado', gestos: full() }, session)).body.data;
  const a = full({ [GESTOS[0]]: { accion: capacidades.gestos[GESTOS[0]].predeterminada, habilitado: false } });
  const b = full({ [GESTOS[2]]: { accion: capacidades.gestos[GESTOS[2]].predeterminada, habilitado: false } });
  const results = await Promise.all([
    request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'A', gestos: a }, session),
    request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'B', gestos: b }, session),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.find(r => r.status === 200).body.data;
  const expected = winner.nombre === 'A' ? a : b;
  assert.deepEqual(rows(mode.id).map(({ gesto_codigo, accion_codigo, habilitado }) => ({ gesto_codigo, accion_codigo, habilitado: Boolean(habilitado) })), expected, 'las asignaciones son las del ganador, no una mezcla');
});

test('atomicidad ante un fallo de la base: si falla escribir una asignación no queda el modo ni el cambio', async t => {
  const { db, request, account, profile, rows, modeRow, count } = await fixture(t);
  const session = await account('conj_fallo'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Intacto', sensibilidad_puntero: 30, gestos: full() }, session)).body.data;
  const before = JSON.stringify({ modo: modeRow(mode.id), asignaciones: rows(mode.id) });
  // Falla la 5.ª escritura de asignaciones: las anteriores de la misma operación se escribieron y deben deshacerse.
  db.exec(`CREATE TABLE contador(n INTEGER); INSERT INTO contador VALUES(0);
    CREATE TRIGGER falla_a_la_quinta BEFORE INSERT ON asignaciones_gestos BEGIN
      UPDATE contador SET n=n+1; SELECT CASE WHEN (SELECT n FROM contador)=5 THEN RAISE(ABORT,'fallo inyectado') END; END;`);
  const patch = await request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'Cambiado', sensibilidad_puntero: 99, gestos: full({ [GESTOS[0]]: { accion: capacidades.gestos[GESTOS[0]].predeterminada, habilitado: false } }) }, session);
  assert.equal(patch.status, 500);
  assert.equal(JSON.stringify({ modo: modeRow(mode.id), asignaciones: rows(mode.id) }), before, 'PATCH: ni campos, ni versión, ni asignaciones');
  db.exec('UPDATE contador SET n=0');
  const modesBefore = count('modos_uso');
  const post = await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Fantasma', gestos: full() }, session);
  assert.equal(post.status, 500);
  assert.equal(count('modos_uso'), modesBefore, 'POST: el modo tampoco se creó');
  db.exec('DROP TRIGGER falla_a_la_quinta');
  assert.equal((await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Fantasma', gestos: full() }, session)).status, 201, 'sin el fallo, el mismo cuerpo funciona');
});

test('propiedad: no se pueden tocar los modos de otra cuenta ni crear bajo un perfil ajeno', async t => {
  const { request, account, profile, rows, count } = await fixture(t);
  const mine = await account('conj_mia'), other = await account('conj_otra');
  const p = await profile(mine);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Mio', gestos: full() }, mine)).body.data;
  const before = JSON.stringify(rows(mode.id));
  assert.equal((await request('PATCH', `/modos/${mode.id}`, { version: 1, nombre: 'Robado', gestos: [] }, other)).status, 404);
  assert.equal((await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Intruso', gestos: full() }, other)).status, 404);
  assert.equal(JSON.stringify(rows(mode.id)), before);
  assert.equal(count('modos_uso'), 1);
});

test('`gestos` solo existe en los modos: un perfil lo rechaza', async t => {
  const { request, account, profile } = await fixture(t);
  const session = await account('conj_perfil');
  assert.equal((await request('POST', '/perfiles', { nombre: 'X', gestos: [] }, session)).status, 400);
  const p = await profile(session);
  assert.equal((await request('PATCH', `/perfiles/${p.id}`, { version: 1, gestos: [] }, session)).status, 400);
});

test('con Idempotency-Key: repetir el POST conjunto devuelve el original; otra lista o el mismo contenido reordenado se distinguen bien', async t => {
  const { request, account, profile, count, rows } = await fixture(t);
  const session = await account('conj_idem'), p = await profile(session);
  const key = uuidv7();
  const body = { nombre: 'Idempotente', gestos: full() };
  const first = await request('POST', `/perfiles/${p.id}/modos`, body, session, { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  const again = await request('POST', `/perfiles/${p.id}/modos`, { ...body, gestos: [...body.gestos].reverse() }, session, { 'Idempotency-Key': key });
  assert.equal(again.status, 201, 'la misma lista en otro orden es la misma solicitud');
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  assert.equal(again.body.data.id, first.body.data.id);
  assert.equal(count('modos_uso'), 1);
  assert.equal(count('asignaciones_gestos'), 13);
  const changed = await request('POST', `/perfiles/${p.id}/modos`, { ...body, gestos: full({ [GESTOS[0]]: { accion: capacidades.gestos[GESTOS[0]].predeterminada, habilitado: false } }) }, session, { 'Idempotency-Key': key });
  assert.deepEqual([changed.status, changed.body.error], [409, 'IDEMPOTENCIA_CONFLICTO']);
  assert.equal(rows(first.body.data.id).every(r => r.habilitado === 1), true, 'el conflicto no modificó las asignaciones');
});

test('PUT /gestos y PATCH /gestos/{gesto} siguen funcionando igual (misma validación y misma subida de versión)', async t => {
  const { request, account, profile } = await fixture(t);
  const session = await account('conj_compat'), p = await profile(session);
  const mode = (await request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Compat' }, session)).body.data;
  const put = await request('PUT', `/modos/${mode.id}/gestos`, { version: 1, gestos: full() }, session);
  assert.equal(put.status, 200);
  assert.equal(put.body.data.modo.version, 2);
  const one = await request('PATCH', `/modos/${mode.id}/gestos/${GESTOS[0]}`, { version: 2, habilitado: false }, session);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.modo.version, 3);
  const bad = await request('PUT', `/modos/${mode.id}/gestos`, { version: 3, gestos: [{ gesto_codigo: 'no_existe', accion_codigo: 'sin_accion', habilitado: true }] }, session);
  assert.deepEqual([bad.status, bad.body.error], [400, 'DATOS_INVALIDOS']);
});

test('validateAssignmentList: normaliza y ordena, y es la misma validación que el PUT', () => {
  const shuffled = [...full()].reverse().map(row => ({ habilitado: row.habilitado, accion_codigo: row.accion_codigo, gesto_codigo: row.gesto_codigo }));
  assert.deepEqual(validateAssignmentList(shuffled), full());
  assert.deepEqual(validateAssignmentList([]), []);
  assert.equal(validateBody('modo', { nombre: ' Modo ', gestos: shuffled }).gestos.length, 13);
  assert.throws(() => validateBody('modo', { nombre: 'X', gestos: 'no' }), /lista/);
  assert.throws(() => validateBody('perfil', { nombre: 'X', gestos: [] }), /no permitido/);
});
