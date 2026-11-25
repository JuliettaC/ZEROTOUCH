import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { createApp } from '../../src/app.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';
import { RETENCION_DIAS, RETENCION_MS, canonicalJson, fingerprint, keyTimestamp, parseIdempotencyKey } from '../../src/domain/idempotencia.js';
import { createIdempotenciaRepository } from '../../src/repositories/idempotenciaRepository.js';
import { createIdempotencyRunner } from '../../src/services/idempotencia.js';

const schemaV3 = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const schemaV2 = readFileSync(new URL('../fixtures/schema-v2.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const password = 'Pruebas idempotencia 2026';
const DAY = 24 * 60 * 60 * 1000;

/** UUID v7 con la hora indicada (48 bits de milisegundos + aleatorio). */
function uuidv7(ms = Date.now()) {
  const hex = ms.toString(16).padStart(12, '0');
  const r = randomBytes(10).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(0, 3)}-${((parseInt(r[3], 16) & 3) | 8).toString(16)}${r.slice(4, 7)}-${r.slice(7, 19)}`;
}

async function fixture(t, schema = schemaV3) {
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
  const count = table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
  return { db, request, account, count, post: (route, body, session, key) => request('POST', route, body, session, key === undefined ? {} : { 'Idempotency-Key': key }) };
}

test('funciones puras: clave UUID v7, hora incrustada, retención y huella canónica', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const key = uuidv7(now);
  assert.equal(keyTimestamp(key), now);
  assert.equal(parseIdempotencyKey(undefined, now), null, 'sin cabecera no hay idempotencia');
  assert.equal(parseIdempotencyKey(` ${key} `, now), key, 'se ignoran los espacios');
  assert.equal(parseIdempotencyKey(uuidv7(now - RETENCION_MS + 1000), now) !== null, true, 'justo dentro de la retención');
  const codeOf = fn => { try { fn(); } catch (error) { return `${error.status} ${error.code}`; } return 'sin error'; };
  assert.equal(codeOf(() => parseIdempotencyKey(uuidv7(now - RETENCION_MS - 1000), now)), '422 IDEMPOTENCIA_CLAVE_EXPIRADA');
  assert.equal(codeOf(() => parseIdempotencyKey(uuidv7(now + 10 * 60 * 1000), now)), '400 IDEMPOTENCIA_CLAVE_INVALIDA', 'hora en el futuro');
  assert.equal(codeOf(() => parseIdempotencyKey(uuidv7(now + 60 * 1000), now)), 'sin error', 'tolera 5 min de desfase de reloj');
  for (const bad of [randomUUID(), key.toUpperCase(), key.slice(1), '', 'abc', `${key}, ${key}`, `${key}x`, key.replace('-7', '-4'), 12345]) {
    assert.equal(codeOf(() => parseIdempotencyKey(bad, now)), '400 IDEMPOTENCIA_CLAVE_INVALIDA', String(bad));
  }
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 'x' }] }), '{"a":[2,{"c":"x","d":1}],"b":1}');
  const huella = fingerprint({ metodo: 'POST', ruta: '/perfiles', cuerpo: { nombre: 'A', descripcion: 'x' } });
  assert.equal(huella, fingerprint({ metodo: 'POST', ruta: '/perfiles', cuerpo: { descripcion: 'x', nombre: 'A' } }), 'el orden de las claves no importa');
  assert.notEqual(huella, fingerprint({ metodo: 'POST', ruta: '/perfiles', cuerpo: { nombre: 'A' } }));
  assert.notEqual(huella, fingerprint({ metodo: 'POST', ruta: '/perfiles/otro/modos', cuerpo: { nombre: 'A', descripcion: 'x' } }), 'la ruta cuenta');
  assert.equal(RETENCION_DIAS, 30);
});

test('perfil: repetir la misma clave y el mismo cuerpo devuelve la respuesta original sin crear otro', async t => {
  const { request, account, post, count } = await fixture(t);
  const session = await account('idem_perfil');
  const key = uuidv7();
  const first = await post('/perfiles', { nombre: 'Casa', descripcion: 'Cocina' }, session, key);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('idempotent-replayed'), null);
  assert.equal(first.headers.get('location'), `/api/v1/perfiles/${first.body.data.id}`);

  const second = await post('/perfiles', { nombre: 'Casa', descripcion: 'Cocina' }, session, key);
  assert.equal(second.status, 201, 'misma respuesta que la original');
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.equal(second.headers.get('location'), first.headers.get('location'));
  assert.deepEqual(second.body, first.body);
  assert.equal(count('perfiles'), 1, 'no se creó un segundo perfil');
  assert.equal(count('idempotencia'), 1);
  assert.equal((await request('GET', '/perfiles', undefined, session)).body.data.length, 1);

  // El cuerpo equivalente tras normalizar (espacios y NFC) es la misma solicitud.
  const normalized = await post('/perfiles', { descripcion: 'Cocina', nombre: '  Casa  ' }, session, key);
  assert.equal(normalized.status, 201);
  assert.equal(normalized.headers.get('idempotent-replayed'), 'true');
  assert.equal(count('perfiles'), 1);
});

test('modo: la repetición también es idempotente y la clave queda ligada al perfil padre', async t => {
  const { account, post, count } = await fixture(t);
  const session = await account('idem_modo');
  const casa = (await post('/perfiles', { nombre: 'Casa' }, session)).body.data;
  const taller = (await post('/perfiles', { nombre: 'Taller' }, session)).body.data;
  const key = uuidv7();
  const body = { nombre: 'Cocina', sensibilidad_puntero: 70, desk_rest_habilitado: true };
  const first = await post(`/perfiles/${casa.id}/modos`, body, session, key);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.desk_rest_habilitado, true, 'el DTO conserva los booleanos reales');
  const again = await post(`/perfiles/${casa.id}/modos`, body, session, key);
  assert.deepEqual([again.status, again.headers.get('idempotent-replayed'), again.body], [201, 'true', first.body]);
  assert.equal(count('modos_uso'), 1);
  // La misma clave contra OTRO perfil es otra solicitud: 409, y no crea nada.
  const other = await post(`/perfiles/${taller.id}/modos`, body, session, key);
  assert.deepEqual([other.status, other.body.error], [409, 'IDEMPOTENCIA_CONFLICTO']);
  assert.equal(count('modos_uso'), 1);
});

test('la misma clave con un cuerpo distinto es un conflicto (409) y no crea ni modifica nada', async t => {
  const { account, post, count, db } = await fixture(t);
  const session = await account('idem_conflicto');
  const key = uuidv7();
  const first = await post('/perfiles', { nombre: 'Original' }, session, key);
  const clash = await post('/perfiles', { nombre: 'Distinto' }, session, key);
  assert.deepEqual([clash.status, clash.body.error], [409, 'IDEMPOTENCIA_CONFLICTO']);
  assert.equal(count('perfiles'), 1);
  assert.equal(db.prepare('SELECT nombre FROM perfiles').get().nombre, 'Original');
  assert.equal((await post('/perfiles', { nombre: 'Original' }, session, key)).body.data.id, first.body.data.id, 'el original sigue repitiéndose');
  // Distinto método de contenido (campo extra) también cuenta como distinto.
  assert.equal((await post('/perfiles', { nombre: 'Original', descripcion: '' }, session, key)).status, 409);
});

test('claves inválidas o expiradas se rechazan sin crear nada; una clave expirada se rechaza aunque exista su fila', async t => {
  const { account, post, count, db } = await fixture(t);
  const session = await account('idem_claves');
  const bad = await post('/perfiles', { nombre: 'X' }, session, randomUUID());
  assert.deepEqual([bad.status, bad.body.error], [400, 'IDEMPOTENCIA_CLAVE_INVALIDA']);
  assert.equal((await post('/perfiles', { nombre: 'X' }, session, 'no-es-uuid')).status, 400);
  assert.equal((await post('/perfiles', { nombre: 'X' }, session, uuidv7(Date.now() + 3600 * 1000))).status, 400, 'hora futura');
  const old = uuidv7(Date.now() - (RETENCION_DIAS + 1) * DAY);
  const expired = await post('/perfiles', { nombre: 'X' }, session, old);
  assert.deepEqual([expired.status, expired.body.error], [422, 'IDEMPOTENCIA_CLAVE_EXPIRADA']);
  assert.match(expired.body.mensaje, /30 días/);
  assert.equal(count('perfiles'), 0);

  // Aunque la fila siga en la base (no se purgó aún), la clave expirada NO se acepta ni se repite: la regla de edad manda.
  const user = db.prepare('SELECT id FROM usuarios').get().id;
  db.prepare('INSERT INTO idempotencia(usuario_id,clave,huella,recurso_tipo,recurso_id,respuesta) VALUES(?,?,?,?,?,?)').run(user, old, 'a'.repeat(64), 'perfil', randomUUID(), '{"id":"x"}');
  assert.equal((await post('/perfiles', { nombre: 'X' }, session, old)).status, 422);
  // Un día antes del límite todavía vale.
  const edge = uuidv7(Date.now() - (RETENCION_DIAS - 1) * DAY);
  assert.equal((await post('/perfiles', { nombre: 'Borde' }, session, edge)).status, 201);
  assert.equal((await post('/perfiles', { nombre: 'Borde' }, session, edge)).headers.get('idempotent-replayed'), 'true');
});

test('sin cabecera todo sigue como antes (el segundo POST igual es un nombre duplicado)', async t => {
  const { account, post, count } = await fixture(t);
  const session = await account('idem_sin_clave');
  assert.equal((await post('/perfiles', { nombre: 'Igual' }, session)).status, 201);
  const dup = await post('/perfiles', { nombre: 'Igual' }, session);
  assert.deepEqual([dup.status, dup.body.error], [409, 'NOMBRE_DUPLICADO']);
  assert.equal(count('idempotencia'), 0, 'sin clave no se registra nada');
});

test('solo se registran las creaciones que terminaron bien: un error no deja rastro y la clave puede reutilizarse corregido', async t => {
  const { account, post, count } = await fixture(t);
  const session = await account('idem_errores');
  await post('/perfiles', { nombre: 'Existente' }, session);
  const key = uuidv7();
  const duplicate = await post('/perfiles', { nombre: 'Existente' }, session, key);
  assert.deepEqual([duplicate.status, duplicate.body.error], [409, 'NOMBRE_DUPLICADO']);
  assert.equal(count('idempotencia'), 0, 'el error no se registra');
  const invalid = await post('/perfiles', { nombre: '' }, session, key);
  assert.equal(invalid.status, 400);
  assert.equal(count('idempotencia'), 0);
  const fixed = await post('/perfiles', { nombre: 'Corregido' }, session, key);   // misma clave, cuerpo corregido
  assert.equal(fixed.status, 201);
  assert.equal(count('perfiles'), 2);
  assert.equal(count('idempotencia'), 1);
  const missing = await post(`/perfiles/${randomUUID()}/modos`, { nombre: 'Huérfano' }, session, uuidv7());
  assert.equal(missing.status, 404, 'un perfil padre inexistente sigue siendo 404');
  assert.equal(count('idempotencia'), 1);
});

test('la repetición devuelve la respuesta ORIGINAL aunque el recurso haya cambiado o ya no exista', async t => {
  const { account, post, request } = await fixture(t);
  const session = await account('idem_original');
  const key = uuidv7();
  const created = (await post('/perfiles', { nombre: 'Cambiante' }, session, key)).body.data;
  assert.equal((await request('PATCH', `/perfiles/${created.id}`, { nombre: 'Renombrado', version: 1 }, session)).status, 200);
  const replay = await post('/perfiles', { nombre: 'Cambiante' }, session, key);
  assert.deepEqual([replay.body.data.nombre, replay.body.data.version], ['Cambiante', 1], 'la respuesta original, no el estado actual');
  const tag = (await request('GET', `/perfiles/${created.id}`, undefined, session)).headers.get('etag');
  assert.equal((await request('DELETE', `/perfiles/${created.id}`, undefined, session, { 'If-Match': tag })).status, 204);
  const afterDelete = await post('/perfiles', { nombre: 'Cambiante' }, session, key);
  assert.deepEqual([afterDelete.status, afterDelete.headers.get('idempotent-replayed')], [201, 'true'], 'no se recrea un perfil borrado: se repite el resultado original');
  assert.equal((await request('GET', '/perfiles', undefined, session)).body.data.length, 0);
});

test('el ámbito es por cuenta: la misma clave en otra cuenta crea su propio recurso y no ve el ajeno', async t => {
  const { account, post, count, db } = await fixture(t);
  const a = await account('idem_cuenta_a'), b = await account('idem_cuenta_b');
  const key = uuidv7();
  const ofA = await post('/perfiles', { nombre: 'Mío' }, a, key);
  const ofB = await post('/perfiles', { nombre: 'Mío' }, b, key);
  assert.equal(ofB.status, 201);
  assert.equal(ofB.headers.get('idempotent-replayed'), null, 'no es una repetición: es otra cuenta');
  assert.notEqual(ofA.body.data.id, ofB.body.data.id);
  assert.equal(count('perfiles'), 2);
  assert.equal(count('idempotencia'), 2);
  assert.equal(db.prepare("SELECT count(*) n FROM idempotencia WHERE clave=?").get(key).n, 2);
  assert.equal((await post('/perfiles', { nombre: 'Mío' }, a, key)).body.data.id, ofA.body.data.id);
});

test('dos solicitudes simultáneas con la misma clave crean un solo recurso', async t => {
  const { account, post, count } = await fixture(t);
  const session = await account('idem_carrera');
  const key = uuidv7();
  const results = await Promise.all(Array.from({ length: 6 }, () => post('/perfiles', { nombre: 'Carrera' }, session, key)));
  assert.ok(results.every(r => r.status === 201));
  assert.equal(new Set(results.map(r => r.body.data.id)).size, 1);
  assert.equal(results.filter(r => r.headers.get('idempotent-replayed') === 'true').length, 5, 'una crea y cinco repiten');
  assert.equal(count('perfiles'), 1);
  assert.equal(count('idempotencia'), 1);
});

test('el recurso y su registro van en una sola transacción: si el registro falla, el recurso no queda creado', t => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schemaV3);
  t.after(() => db.close());
  const user = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'atomico', `$argon2id$v=19$${'x'.repeat(80)}`);
  const repository = createIdempotenciaRepository(db, user);
  const broken = { ...repository, insert: () => { throw new Error('fallo al registrar'); } };
  const runner = createIdempotencyRunner({ repository: broken, enabled: true });
  const create = () => {
    const id = randomUUID();
    db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(id, user, 'Fantasma');
    return { id };
  };
  assert.throws(() => runner.run({ header: uuidv7(), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'Fantasma' }, create }), /fallo al registrar/);
  assert.equal(db.prepare('SELECT count(*) n FROM perfiles').get().n, 0, 'el perfil se deshizo junto con el registro');
  // Y con el registro sano, ambos quedan.
  const ok = createIdempotencyRunner({ repository, enabled: true });
  const key = uuidv7();
  const first = ok.run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'Fantasma' }, create });
  const again = ok.run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'Fantasma' }, create });
  assert.deepEqual([first.replayed, again.replayed, again.data.id], [false, true, first.data.id]);
  assert.equal(db.prepare('SELECT count(*) n FROM perfiles').get().n, 1);
});

test('la purga elimina solo lo anterior a la retención, por lotes, y no toca lo reciente ni lo de otras cuentas', async t => {
  const { account, post, count, db } = await fixture(t);
  const session = await account('idem_purga');
  const user = db.prepare('SELECT id FROM usuarios').get().id;
  const insert = db.prepare("INSERT INTO idempotencia(usuario_id,clave,huella,recurso_tipo,recurso_id,respuesta,creado_en) VALUES(?,?,?,?,?,?,?)");
  const daysAgo = days => new Date(Date.now() - days * DAY).toISOString();
  for (let i = 0; i < 5; i += 1) insert.run(user, uuidv7(Date.now() - 40 * DAY), 'b'.repeat(64), 'perfil', randomUUID(), '{"id":"x"}', daysAgo(40));
  const recent = uuidv7(Date.now() - 2 * DAY);
  insert.run(user, recent, 'c'.repeat(64), 'perfil', randomUUID(), '{"id":"y"}', daysAgo(2));
  assert.equal(count('idempotencia'), 6);
  assert.equal((await post('/perfiles', { nombre: 'Dispara la purga' }, session, uuidv7())).status, 201);
  assert.equal(count('idempotencia'), 2, 'se purgaron las 5 antiguas; queda la reciente y la nueva');
  assert.ok(db.prepare('SELECT 1 FROM idempotencia WHERE clave=?').get(recent));
  // Invariante: una clave que la regla de edad acepta nunca ha sido purgada.
  assert.ok(Date.now() - keyTimestamp(recent) < RETENCION_MS);
});

test('el límite de tamaño de la respuesta guardada admite el perfil y el modo más grandes', async t => {
  const { account, post } = await fixture(t);
  const session = await account('idem_tamano');
  const big = await post('/perfiles', { nombre: 'ñ'.repeat(60), descripcion: '😀'.repeat(150) }, session, uuidv7());
  assert.equal(big.status, 201);
  const mode = await post(`/perfiles/${big.body.data.id}/modos`, { nombre: 'ñ'.repeat(60), categoria: 'personalizado', plataforma: 'pc' }, session, uuidv7());
  assert.equal(mode.status, 201);
});

test('base v2 (sin la tabla): sin clave todo funciona; con clave responde 501 y no crea; la capacidad no se anuncia', async t => {
  const { account, post, request, count } = await fixture(t, schemaV2);
  const session = await account('idem_v2');
  assert.equal((await post('/perfiles', { nombre: 'Sigue funcionando' }, session)).status, 201);
  const refused = await post('/perfiles', { nombre: 'Con clave' }, session, uuidv7());
  assert.deepEqual([refused.status, refused.body.error], [501, 'IDEMPOTENCIA_NO_DISPONIBLE']);
  assert.equal(count('perfiles'), 1, 'no se crea nada ni se ignora la clave en silencio');
  const capabilities = (await request('GET', '/capacidades', undefined, session)).body.data;
  assert.deepEqual(capabilities.servidor, { borrado_condicional: true, modo_con_asignaciones: true, idempotencia: false });
});

test('con la base v3 se anuncia la idempotencia con su formato y su retención', async t => {
  const { account, request } = await fixture(t);
  const session = await account('idem_capacidad');
  const capabilities = (await request('GET', '/capacidades', undefined, session)).body.data;
  assert.deepEqual(capabilities.servidor.idempotencia, { clave: 'uuid-v7', retencion_dias: 30 });
});

test('reloj del cliente adelantado: una clave aún aceptada nunca ha perdido su fila (la purga guarda un margen)', t => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schemaV3);
  t.after(() => db.close());
  const user = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'reloj_adelantado', `$argon2id$v=19$${'x'.repeat(80)}`);
  const repository = createIdempotenciaRepository(db, user);
  const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);
  const create = () => {
    const id = randomUUID();
    db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(id, user, `Perfil ${id.slice(0, 8)}`);
    return { id };
  };
  const body = { nombre: 'Con reloj adelantado' };
  const key = uuidv7(T0 + 4 * 60 * 1000); // el cliente va 4 minutos por delante del servidor (dentro de la tolerancia)
  const first = createIdempotencyRunner({ repository, enabled: true, now: () => T0 })
    .run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: body, create });
  assert.equal(first.replayed, false);
  // Instante en que la clave está a punto de expirar (RETENCION desde SU hora): aún se acepta, pero desde la creación
  // de la fila ya pasaron RETENCION + 4 min, el caso que antes dejaba la fila purgable.
  const late = T0 + 4 * 60 * 1000 + RETENCION_MS - 1000;
  assert.equal(parseIdempotencyKey(key, late), key, 'la clave todavía se acepta');
  const later = createIdempotencyRunner({ repository, enabled: true, now: () => late });
  later.run({ header: uuidv7(late), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'Dispara la purga' }, create }); // ejecuta la purga a ese instante
  const replay = later.run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: body, create });
  assert.equal(replay.replayed, true, 'la repetición devuelve el original: no se creó un duplicado');
  assert.equal(replay.data.id, first.data.id);
  assert.equal(db.prepare('SELECT count(*) n FROM perfiles').get().n, 2, 'solo el original y el que disparó la purga: ningún duplicado');
});

test('la purga ocurre DESPUÉS de confirmar la creación (fuera de la transacción) y su fallo no afecta a la creación', t => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schemaV3);
  t.after(() => db.close());
  const user = randomUUID();
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(user, 'purga_fuera', `$argon2id$v=19$${'x'.repeat(80)}`);
  const base = createIdempotenciaRepository(db, user);
  const create = () => {
    const id = randomUUID();
    db.prepare('INSERT INTO perfiles(id,usuario_id,nombre) VALUES(?,?,?)').run(id, user, `Perfil ${id.slice(0, 8)}`);
    return { id };
  };
  // 1. La purga se invoca con la transacción de creación ya cerrada (si estuviera dentro, db.inTransaction sería true).
  const seen = [];
  const spying = { ...base, purge: cutoff => { seen.push(db.inTransaction); return base.purge(cutoff); } };
  createIdempotencyRunner({ repository: spying, enabled: true }).run({ header: uuidv7(), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'A' }, create });
  assert.deepEqual(seen, [false], 'la purga corrió una vez y fuera de la transacción');
  // 2. Una repetición no purga (no hay creación nueva).
  const key = uuidv7();
  const runner = createIdempotencyRunner({ repository: spying, enabled: true });
  runner.run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'B' }, create });
  const purgesBeforeReplay = seen.length;
  assert.equal(runner.run({ header: key, tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'B' }, create }).replayed, true);
  assert.equal(seen.length, purgesBeforeReplay, 'repetir no dispara otra purga');
  // 3. Si la purga falla (base ocupada), la creación ya confirmada se devuelve y queda registrada.
  const failing = { ...base, purge: () => { throw new Error('SQLITE_BUSY simulado'); } };
  const result = createIdempotencyRunner({ repository: failing, enabled: true }).run({ header: uuidv7(), tipo: 'perfil', ruta: '/perfiles', cuerpo: { nombre: 'C' }, create });
  assert.equal(result.replayed, false);
  assert.ok(db.prepare('SELECT 1 FROM perfiles WHERE id=?').get(result.data.id), 'el perfil existe pese al fallo de la purga');
  assert.ok(db.prepare('SELECT 1 FROM idempotencia WHERE recurso_id=?').get(result.data.id), 'y su clave quedó registrada');
});
