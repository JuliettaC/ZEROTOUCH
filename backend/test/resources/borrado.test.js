import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { modeEtag, profileEtag } from '../../src/domain/etag.js';
import { createPerfilesRepository } from '../../src/repositories/perfilesRepository.js';
import { createModosRepository } from '../../src/repositories/modosRepository.js';

const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const vectors = JSON.parse(readFileSync(new URL('../../../contracts/etag-vectores.json', import.meta.url), 'utf8'));
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Pruebas borrado solamente 2026';

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
    return { status: response.status, body: text ? JSON.parse(text) : null, text, headers: response.headers };
  }
  async function account(name) {
    const credentials = { nombre_usuario: name, contrasena: password }, correo = `${name}@ejemplo.test`;
    assert.equal((await request('POST', '/auth/registro', { ...credentials, correo })).status, 202);
    assert.equal((await request('POST', '/auth/verificacion', { token: lastToken(mailer, correo) })).status, 200);
    const login = await request('POST', '/auth/login', credentials);
    assert.equal(login.status, 200);
    return { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.body.data.csrf_token };
  }
  const tag = async (route, session) => (await request('GET', route, undefined, session)).headers.get('etag');
  const remove = (route, session, etag) => request('DELETE', route, undefined, session, etag === undefined ? {} : { 'If-Match': etag });
  return { db, request, account, tag, remove };
}

async function seed(request, session, modes = 2) {
  const profile = (await request('POST', '/perfiles', { nombre: 'Casa' }, session)).body.data;
  const created = [];
  for (let i = 0; i < modes; i += 1) created.push((await request('POST', `/perfiles/${profile.id}/modos`, { nombre: `Modo ${i + 1}` }, session)).body.data);
  return { profile, modes: created };
}
const count = (db, table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;

test('los vectores compartidos fijan el algoritmo del ETag (lo contrasta también el cliente)', () => {
  assert.ok(vectors.vectores.length >= 8);
  for (const v of vectors.vectores) {
    const got = v.kind === 'modo' ? modeEtag(v.id, v.version) : profileEtag(v.id, v.version, v.modes);
    assert.equal(got, v.etag, v.nombre);
    assert.match(got, /^"[A-Za-z0-9_-]{32}"$/);
  }
  const byName = Object.fromEntries(vectors.vectores.map(v => [v.nombre, v.etag]));
  assert.equal(byName['perfil con tres modos'], byName['mismo perfil, modos en otro orden (mismo ETag)'], 'el orden de los modos no importa');
  assert.notEqual(byName['perfil con tres modos'], byName['un modo cambió de versión (ETag distinto)']);
  assert.notEqual(byName['perfil con tres modos'], byName['falta un modo (ETag distinto)']);
});

test('DELETE de modo: sin If-Match 428, inválido 400, obsoleto 412, vigente 204 y repetir 404', async t => {
  const { request, account, tag, remove, db } = await fixture(t);
  const session = await account('borra_modo');
  const { modes: [mode] } = await seed(request, session, 1);
  const route = `/modos/${mode.id}`;
  const current = await tag(route, session);
  assert.match(current, /^"[A-Za-z0-9_-]{32}"$/);

  const missing = await remove(route, session);
  assert.equal(missing.status, 428);
  assert.equal(missing.body.error, 'PRECONDICION_REQUERIDA');
  for (const bad of ['*', `W/${current}`, current.slice(1, -1), `${current}, ${current}`, '""', '"corto"']) {
    const r = await remove(route, session, bad);
    assert.equal(r.status, 400, `If-Match ${bad}`);
    assert.equal(r.body.error, 'DATOS_INVALIDOS');
  }
  const stale = await remove(route, session, modeEtag(mode.id, mode.version + 3));
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error, 'PRECONDICION_FALLIDA');
  assert.equal(count(db, 'modos_uso'), 1, 'ningún intento fallido borra');

  const ok = await remove(route, session, current);
  assert.equal(ok.status, 204);
  assert.equal(ok.text, '');
  assert.equal(count(db, 'modos_uso'), 0);
  assert.equal((await remove(route, session, current)).status, 404, 'repetir un borrado ya aplicado es idempotente: 404');
});

test('editar el modo o sus asignaciones (PATCH, PUT, PATCH de un gesto) invalida el ETag', async t => {
  const { request, account, tag, remove, db } = await fixture(t);
  const session = await account('invalida_modo');
  const { modes: [mode] } = await seed(request, session, 1);
  const route = `/modos/${mode.id}`;
  const seen = [await tag(route, session)];
  const bump = async (action, label) => {
    await action();
    const next = await tag(route, session);
    assert.ok(!seen.includes(next), `${label} debe cambiar el ETag`);
    seen.push(next);
  };
  await bump(() => request('PATCH', route, { sensibilidad_puntero: 20, version: 1 }, session), 'PATCH del modo');
  await bump(() => request('PUT', `${route}/gestos`, { version: 2, gestos: [{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: false }] }, session), 'PUT de asignaciones');
  await bump(() => request('PATCH', `${route}/gestos/dos_dedos`, { version: 3, accion_codigo: 'desplazar', habilitado: false }, session), 'PATCH de una asignación');
  for (const old of seen.slice(0, -1)) {
    assert.equal((await remove(route, session, old)).status, 412, 'un ETag anterior ya no sirve');
  }
  assert.equal(count(db, 'modos_uso'), 1);
  assert.equal(count(db, 'asignaciones_gestos') > 0, true, 'las asignaciones siguen intactas tras los rechazos');
  assert.equal((await remove(route, session, seen.at(-1))).status, 204);
  assert.equal(count(db, 'asignaciones_gestos'), 0, 'las asignaciones se van con el modo');
});

test('ETag de perfil = agregado: cambia al editar el perfil, añadir, quitar o editar modos y editar asignaciones', async t => {
  const { request, account, tag } = await fixture(t);
  const session = await account('agregado');
  const { profile, modes: [a, b] } = await seed(request, session, 2);
  const route = `/perfiles/${profile.id}`;
  const seen = [await tag(route, session)];
  const expectChange = async (action, label) => {
    await action();
    const next = await tag(route, session);
    assert.ok(!seen.includes(next), `${label} debe cambiar el ETag del perfil`);
    seen.push(next);
  };
  await expectChange(() => request('PATCH', route, { descripcion: 'nueva', version: 1 }, session), 'editar el perfil');
  await expectChange(() => request('POST', `${route}/modos`, { nombre: 'Tercero' }, session), 'crear un modo');
  await expectChange(() => request('PATCH', `/modos/${a.id}`, { sensibilidad_puntero: 33, version: 1 }, session), 'editar un modo');
  await expectChange(() => request('PUT', `/modos/${b.id}/gestos`, { version: 1, gestos: [{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: false }] }, session), 'editar las asignaciones de un modo');
  const afterB = await tag(`/modos/${b.id}`, session);
  assert.ok(afterB);
  await expectChange(async () => {
    const current = await tag(`/modos/${b.id}`, session);
    assert.equal((await request('DELETE', `/modos/${b.id}`, undefined, session, { 'If-Match': current })).status, 204);
  }, 'quitar un modo');
  assert.equal(await tag(route, session), seen.at(-1), 'sin cambios el ETag es estable');
});

test('borrar un perfil con ETag obsoleto no toca nada; con el vigente borra perfil, modos y asignaciones juntos', async t => {
  const { request, account, tag, remove, db } = await fixture(t);
  const session = await account('cascada');
  const { profile, modes: [a, b] } = await seed(request, session, 2);
  assert.equal((await request('PUT', `/modos/${a.id}/gestos`, { version: 1, gestos: [{ gesto_codigo: 'micro_pinza', accion_codigo: 'clic', habilitado: true }] }, session)).status, 200);
  const route = `/perfiles/${profile.id}`;
  const known = await tag(route, session);          // lo que el cliente conocía al decidir borrar

  // Otro equipo edita las asignaciones de un modo: la versión del PERFIL no cambia, el agregado sí.
  assert.equal((await request('PATCH', `/modos/${b.id}/gestos/dos_dedos`, { version: 1, accion_codigo: 'desplazar', habilitado: false }, session)).status, 200);
  const profileVersion = (await request('GET', route, undefined, session)).body.data.version;
  assert.equal(profileVersion, 1, 'la versión del perfil por sí sola NO detecta el cambio');
  const before = { perfiles: count(db, 'perfiles'), modos: count(db, 'modos_uso'), asignaciones: count(db, 'asignaciones_gestos') };
  const stale = await remove(route, session, known);
  assert.equal(stale.status, 412);
  assert.deepEqual({ perfiles: count(db, 'perfiles'), modos: count(db, 'modos_uso'), asignaciones: count(db, 'asignaciones_gestos') }, before, 'nada se borró');

  // Otro equipo añade un modo: también invalida un ETag vigente hasta ese momento.
  const fresh = await tag(route, session);
  assert.equal((await request('POST', `${route}/modos`, { nombre: 'Nuevo en otro equipo' }, session)).status, 201);
  assert.equal((await remove(route, session, fresh)).status, 412);
  assert.equal(count(db, 'modos_uso'), before.modos + 1);

  const latest = await tag(route, session);
  assert.equal((await remove(route, session, latest)).status, 204);
  assert.deepEqual({ perfiles: count(db, 'perfiles'), modos: count(db, 'modos_uso'), asignaciones: count(db, 'asignaciones_gestos') }, { perfiles: 0, modos: 0, asignaciones: 0 });
});

test('otra cuenta recibe 404 aunque conozca un ETag válido, y no se borra nada', async t => {
  const { request, account, tag, remove, db } = await fixture(t);
  const owner = await account('duena'), other = await account('intrusa');
  const { profile, modes: [mode] } = await seed(request, owner, 1);
  const profileTag = await tag(`/perfiles/${profile.id}`, owner), modeTag = await tag(`/modos/${mode.id}`, owner);
  assert.equal((await remove(`/perfiles/${profile.id}`, other, profileTag)).status, 404);
  assert.equal((await remove(`/modos/${mode.id}`, other, modeTag)).status, 404);
  assert.equal((await remove(`/perfiles/${profile.id}`, other)).status, 404, 'ni siquiera revela el 428 de un recurso ajeno');
  assert.deepEqual([count(db, 'perfiles'), count(db, 'modos_uso')], [1, 1]);
  assert.equal((await remove(`/perfiles/${profile.id}`, owner, profileTag)).status, 204);
});

test('el borrado exige sesión y CSRF como el resto de escrituras', async t => {
  const { request, account, tag } = await fixture(t);
  const session = await account('seguridad_borrado');
  const { profile } = await seed(request, session, 0);
  const etag = await tag(`/perfiles/${profile.id}`, session);
  assert.equal((await request('DELETE', `/perfiles/${profile.id}`, undefined, undefined, { 'If-Match': etag })).status, 401);
  assert.equal((await request('DELETE', `/perfiles/${profile.id}`, undefined, session, { 'If-Match': etag, 'X-CSRF-Token': 'otro' })).status, 403);
  assert.equal((await request('GET', `/perfiles/${profile.id}`, undefined, session)).status, 200, 'el perfil sigue ahí');
});

test('comprobar y borrar ocurren dentro de una transacción; si la fila cambió de versión no se declara borrada', t => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  t.after(() => db.close());
  const userId = 'a1b2c3d4-0000-4000-8000-000000000001';
  // Hash de relleno con el formato que exige el esquema; este usuario nunca inicia sesión.
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(userId, 'directo', `$argon2id$v=19$${'x'.repeat(80)}`);
  const profileId = 'a1b2c3d4-0000-4000-8000-000000000002', modeId = 'a1b2c3d4-0000-4000-8000-000000000003';
  db.prepare('INSERT INTO perfiles(id,usuario_id,nombre,descripcion) VALUES(?,?,?,?)').run(profileId, userId, 'P', '');
  db.prepare('INSERT INTO modos_uso(id,perfil_id,nombre) VALUES(?,?,?)').run(modeId, profileId, 'M');

  // 1. El DELETE se ejecuta con una transacción abierta (la comprobación y el borrado no se separan).
  const observed = [];
  const spy = {
    transaction: fn => db.transaction(fn),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!/^DELETE/.test(sql)) return statement;
      return { run: (...args) => { observed.push(db.inTransaction); return statement.run(...args); } };
    },
  };
  const profiles = createPerfilesRepository(spy, userId);
  const profileRow = db.prepare('SELECT * FROM perfiles WHERE id=?').get(profileId);
  const etag = profileEtag(profileId, profileRow.version, [{ id: modeId, version: 1 }]);

  // 2. Defensa en profundidad: una escritura que cambie la versión justo antes del DELETE lo deja en 0 filas.
  const racing = {
    transaction: fn => db.transaction(fn),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!/^DELETE/.test(sql)) return statement;
      return { run: (...args) => { db.prepare('UPDATE perfiles SET version=version+1 WHERE id=?').run(profileId); return statement.run(...args); } };
    },
  };
  assert.equal(createPerfilesRepository(racing, userId).deleteIfMatch(profileId, etag), 'stale');
  assert.equal(db.prepare('SELECT count(*) n FROM perfiles').get().n, 1, 'no se borró');
  assert.equal(db.prepare('SELECT count(*) n FROM modos_uso').get().n, 1);

  // Con el estado real vigente, el borrado procede y ocurrió dentro de una transacción.
  const real = db.prepare('SELECT * FROM perfiles WHERE id=?').get(profileId);
  assert.equal(profiles.deleteIfMatch(profileId, profileEtag(profileId, real.version, [{ id: modeId, version: 1 }])), 'deleted');
  assert.deepEqual(observed, [true]);
  assert.equal(db.prepare('SELECT count(*) n FROM modos_uso').get().n, 0, 'cascada en la misma operación');

  // Lo mismo para modos.
  db.prepare('INSERT INTO perfiles(id,usuario_id,nombre,descripcion) VALUES(?,?,?,?)').run(profileId, userId, 'P', '');
  db.prepare('INSERT INTO modos_uso(id,perfil_id,nombre) VALUES(?,?,?)').run(modeId, profileId, 'M');
  const raceMode = {
    transaction: fn => db.transaction(fn),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!/^DELETE/.test(sql)) return statement;
      return { run: (...args) => { db.prepare('UPDATE modos_uso SET version=version+1 WHERE id=?').run(modeId); return statement.run(...args); } };
    },
  };
  assert.equal(createModosRepository(raceMode, userId).deleteIfMatch(modeId, modeEtag(modeId, 1)), 'stale');
  assert.equal(db.prepare('SELECT count(*) n FROM modos_uso').get().n, 1);
  assert.equal(createModosRepository(db, userId).deleteIfMatch(modeId, modeEtag(modeId, 2)), 'deleted');
});
