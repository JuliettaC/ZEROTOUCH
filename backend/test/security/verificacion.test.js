import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { sessionHash } from '../../src/services/authService.js';
import { accountTokenHash } from '../../src/security/account-tokens.js';
import { createSecurityLog } from '../../src/security/audit-log.js';
import { readMailSettings, createMailer } from '../../src/security/mailer.js';
import { createMemoryMailer, lastToken, tokensIn, tokenFromOutbox } from '../helpers/correo.js';

const schema = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const secret = 'Verificacion de pruebas 2026!';
const PENDING = 'Si los datos son válidos, enviamos un enlace de verificación al correo indicado. Revisa tu bandeja de entrada y la carpeta de spam.';

async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(schema);
  const mailer = createMemoryMailer();
  const lines = [];
  const server = createApp({ db, config, mailer, securityLog: createSecurityLog({ write: line => lines.push(line) }) }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, route, body, session, headers = {}) {
    const response = await fetch(base + route, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* HTML pages */ }
    return { status: response.status, headers: response.headers, text, body: parsed };
  }
  const api = (method, route, body, session) => request(method, `/api/v1${route}`, body, session);
  const register = (name, correo, contrasena = secret) => api('POST', '/auth/registro', { nombre_usuario: name, correo, contrasena });
  const login = async (name, contrasena = secret) => {
    const response = await api('POST', '/auth/login', { nombre_usuario: name, contrasena });
    if (response.status !== 200) return { response };
    return { response, cookie: response.headers.get('set-cookie').split(';')[0], csrf: response.body.data.csrf_token };
  };
  const user = name => db.prepare('SELECT * FROM usuarios WHERE nombre_usuario=?').get(name);
  return { db, mailer, lines, request, api, register, login, user };
}

test('registro: cuenta no verificada, token hasheado, correo enviado y acceso bloqueado hasta verificar', async t => {
  const { db, mailer, api, register, login, user } = await fixture(t);
  const response = await register('ana_demo', 'Ana.Demo@Ejemplo.TEST');
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { data: { estado_verificacion: 'pendiente', mensaje: PENDING } });
  const stored = user('ana_demo');
  assert.equal(stored.correo, 'ana.demo@ejemplo.test');
  assert.equal(stored.correo_verificado_en, null);
  assert.equal(mailer.messages.length, 1);
  const raw = lastToken(mailer, 'ana.demo@ejemplo.test');
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(mailer.messages[0].text, /http:\/\/127\.0\.0\.1:3000\/cuenta\/verificar#token=/);
  assert.match(mailer.messages[0].html, /ana_demo/);
  const row = db.prepare('SELECT * FROM tokens_cuenta').get();
  assert.equal(row.token_hash, accountTokenHash(raw));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM tokens_cuenta').all()).includes(raw), 'el token original no se guarda');
  assert.equal(row.proposito, 'verificacion');
  const hours = (Date.parse(row.expira_en) - Date.parse(row.creado_en)) / 3600000;
  assert.equal(hours, 24);

  // Login: "confirm your email" only after a correct password; otherwise the generic 401.
  const unverified = (await login('ana_demo')).response;
  const wrong = (await login('ana_demo', 'Contrasena equivocada 2026')).response;
  const missing = (await login('no_existe')).response;
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.error, 'CUENTA_NO_VERIFICADA');
  for (const item of [unverified, wrong, missing]) assert.equal(item.headers.get('set-cookie'), null);
  for (const item of [wrong, missing]) assert.equal(item.status, 401);
  assert.deepEqual(wrong.body, missing.body);
  assert.equal((await login('nadie@ejemplo.test')).response.status, 401);

  // A session row for an unverified account (e.g. created before the v2 migration) is rejected.
  const legacy = randomBytes(32).toString('base64url'), now = Date.now();
  db.prepare('INSERT INTO sesiones(token_hash,usuario_id,creado_en,expira_en) VALUES(?,?,?,?)')
    .run(sessionHash(legacy), stored.id, new Date(now).toISOString(), new Date(now + 3600000).toISOString());
  assert.equal((await api('GET', '/perfiles', undefined, { cookie: `zt_session=${legacy}`, csrf: '' })).status, 401);
  assert.equal((await api('GET', '/auth/me', undefined, { cookie: `zt_session=${legacy}`, csrf: '' })).status, 401);

  const verified = await api('POST', '/auth/verificacion', { token: raw });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.verificado, true);
  assert.ok(user('ana_demo').correo_verificado_en);
  assert.equal(db.prepare('SELECT count(*) n FROM tokens_cuenta').get().n, 0);
  const session = await login('ana_demo');
  assert.equal(session.response.status, 200);
  assert.equal(session.response.body.data.usuario.correo_verificado, true);
  assert.equal((await api('GET', '/perfiles', undefined, session)).status, 200);
});

test('inicio de sesión con correo o con usuario; reenvío desde el login con el correo como identificador', async t => {
  const { mailer, api, register, login } = await fixture(t);
  await register('olga_demo', 'Olga@Ejemplo.test');
  // A pending account that signed in with its email can resend the link with the same credentials.
  const pending = await login('OLGA@ejemplo.test');
  assert.equal(pending.response.body.error, 'CUENTA_NO_VERIFICADA');
  const before = mailer.messages.length;
  const resend = await api('POST', '/auth/correo', { nombre_usuario: 'olga@ejemplo.test', contrasena: secret, correo: 'olga@ejemplo.test' });
  assert.equal(resend.status, 202);
  assert.equal(mailer.messages.length, before, 'enfriamiento de 60 s: aún no se reenvía');
  assert.equal((await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'olga@ejemplo.test') })).status, 200);
  for (const identifier of ['olga_demo', 'OLGA_DEMO', 'olga@ejemplo.test', ' Olga@Ejemplo.TEST ']) {
    const session = await login(identifier);
    assert.equal(session.response.status, 200, identifier);
    assert.equal(session.response.body.data.usuario.nombre_usuario, 'olga_demo');
  }
  const wrong = await login('olga@ejemplo.test', 'Contrasena equivocada 2026');
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.response.body.error, 'CREDENCIALES_INVALIDAS');
  for (const identifier of ['olga@', '@ejemplo.test', "x' OR 1=1 --"]) assert.equal((await login(identifier)).response.status, 400);
});

test('política de contraseñas: mínimo 8, sin contraseñas comunes ni iguales al usuario o correo', async t => {
  const { mailer, api, register, login } = await fixture(t);
  const rejected = [
    ['siete77', 'a1'], ['password', 'a2'], ['12345678', 'a3'], ['87654321', 'a4'], ['aaaaaaaa', 'a5'],
    ['qwertyuiop', 'a6'], ['Luciana_Demo', 'a7'], ['luciana.correo', 'a8'],
  ];
  for (const [contrasena, tag] of rejected) {
    const correo = tag === 'a8' ? 'luciana.correo@ejemplo.test' : `${tag}@ejemplo.test`;
    const response = await register('luciana_demo', correo, contrasena);
    assert.equal(response.status, 400, contrasena);
    assert.equal(response.body.error, 'DATOS_INVALIDOS');
    assert.ok(!response.text.includes(contrasena), 'el error no repite la contraseña');
  }
  // Ocho caracteres poco comunes son suficientes; espacios y frases también valen.
  assert.equal((await register('luciana_demo', 'luciana@ejemplo.test', 'gato2026')).status, 202);
  assert.equal((await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'luciana@ejemplo.test') })).status, 200);
  assert.equal((await login('luciana_demo', 'gato2026')).response.status, 200);
  assert.equal((await register('mateo_demo', 'mateo@ejemplo.test', 'mi gato duerme')).status, 202);

  // Restablecer: una contraseña rechazada no consume el enlace.
  await api('POST', '/auth/contrasena/olvido', { correo: 'luciana@ejemplo.test' });
  const raw = lastToken(mailer, 'luciana@ejemplo.test', 'restablecer');
  for (const contrasena of ['corta', '12345678', 'luciana_demo', 'LUCIANA']) {
    assert.equal((await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena })).status, 400, contrasena);
  }
  assert.equal((await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'perro_99' })).status, 200);
  assert.equal((await login('luciana_demo', 'perro_99')).response.status, 200);
});

test('tokens: un solo uso, expiración, formato y vínculo con el correo', async t => {
  const { db, mailer, api, register } = await fixture(t);
  await register('beto_demo', 'beto@ejemplo.test');
  const raw = lastToken(mailer, 'beto@ejemplo.test');
  assert.equal((await api('POST', '/auth/verificacion', { token: raw })).status, 200);
  const reused = await api('POST', '/auth/verificacion', { token: raw });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error, 'TOKEN_INVALIDO');

  await register('caro_demo', 'caro@ejemplo.test');
  const expiring = lastToken(mailer, 'caro@ejemplo.test');
  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z', expira_en='2000-01-02T00:00:00.000Z'").run();
  const expired = await api('POST', '/auth/verificacion', { token: expiring });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, 'TOKEN_EXPIRADO');
  assert.equal((await api('POST', '/auth/verificacion', { token: expiring })).body.error, 'TOKEN_INVALIDO');
  assert.equal(db.prepare("SELECT correo_verificado_en FROM usuarios WHERE nombre_usuario='caro_demo'").get().correo_verificado_en, null);

  for (const token of ['', 'corto', 'x'.repeat(43) + '!', 'é'.repeat(43), 42, null]) {
    const response = await api('POST', '/auth/verificacion', { token });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'TOKEN_INVALIDO');
  }
  assert.equal((await api('POST', '/auth/verificacion', { token: expiring, extra: 1 })).status, 400);
  assert.equal((await api('POST', '/auth/verificacion', {})).status, 400);

  // Changing the address (allowed while unverified) invalidates links sent to the old one.
  await register('dani_demo', 'dani.viejo@ejemplo.test');
  const old = lastToken(mailer, 'dani.viejo@ejemplo.test');
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'dani_demo', contrasena: secret, correo: 'dani.nuevo@ejemplo.test' })).status, 202);
  // Cooldown: a token was issued less than 60 s ago, so no new email yet; the address is kept.
  assert.equal(lastToken(mailer, 'dani.nuevo@ejemplo.test'), undefined);
  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z' WHERE proposito='verificacion'").run();
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'dani_demo', contrasena: secret, correo: 'dani.nuevo@ejemplo.test' })).status, 202);
  const fresh = lastToken(mailer, 'dani.nuevo@ejemplo.test');
  assert.ok(fresh);
  assert.equal((await api('POST', '/auth/verificacion', { token: old })).body.error, 'TOKEN_INVALIDO');
  assert.equal((await api('POST', '/auth/verificacion', { token: fresh })).status, 200);
});

test('reenvío: respuesta idéntica, sin enumeración, enfriamiento y límite por IP', async t => {
  const { mailer, api, register } = await fixture(t);
  await register('eva_demo', 'eva@ejemplo.test');
  await register('fede_demo', 'fede@ejemplo.test');
  await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'fede@ejemplo.test') });
  const sent = mailer.messages.length;
  const responses = [];
  for (const correo of ['eva@ejemplo.test', 'fede@ejemplo.test', 'nadie@ejemplo.test']) responses.push(await api('POST', '/auth/verificacion/reenviar', { correo }));
  for (const response of responses) {
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, responses[0].body);
  }
  // Pending account within the 60 s cooldown: nothing is sent; verified/missing never receive one.
  assert.equal(mailer.messages.length, sent);
  assert.equal((await api('POST', '/auth/verificacion/reenviar', { correo: 'no-es-correo' })).status, 400);
  let last;
  for (let index = 0; index < 10; index++) last = await api('POST', '/auth/verificacion/reenviar', { correo: 'nadie@ejemplo.test' });
  assert.equal(last.status, 429);
});

test('reenvío fuera del enfriamiento emite un token nuevo e invalida el anterior', async t => {
  const { db, mailer, api, register } = await fixture(t);
  await register('gabi_demo', 'gabi@ejemplo.test');
  const first = lastToken(mailer, 'gabi@ejemplo.test');
  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await api('POST', '/auth/verificacion/reenviar', { correo: 'GABI@ejemplo.test' })).status, 202);
  const second = lastToken(mailer, 'gabi@ejemplo.test');
  assert.notEqual(second, first);
  assert.equal(db.prepare('SELECT count(*) n FROM tokens_cuenta').get().n, 1);
  assert.equal((await api('POST', '/auth/verificacion', { token: first })).body.error, 'TOKEN_INVALIDO');
  assert.equal((await api('POST', '/auth/verificacion', { token: second })).status, 200);
});

test('registro con un correo ya usado: misma respuesta, sin reasignar y aviso al dueño', async t => {
  const { mailer, api, register, user, login } = await fixture(t);
  const first = await register('hugo_demo', 'hugo@ejemplo.test');
  await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'hugo@ejemplo.test') });
  const second = await register('intruso_demo', 'HUGO@ejemplo.test');
  assert.equal(second.status, first.status);
  assert.deepEqual(second.body, first.body);
  assert.equal(user('intruso_demo').correo, null);
  assert.equal(user('hugo_demo').correo, 'hugo@ejemplo.test');
  const notice = mailer.messages.at(-1);
  assert.equal(notice.to, 'hugo@ejemplo.test');
  assert.match(notice.text, /ya pertenece a una cuenta/);
  assert.match(notice.text, /hugo_demo/);
  assert.deepEqual(tokensIn(notice.text), [], 'el aviso no contiene tokens');
  // Same answer for this account (no email) as for any pending account: whoever registered it
  // cannot learn whether hugo@ejemplo.test was already taken.
  await register('pendiente_demo', 'pendiente@ejemplo.test');
  assert.deepEqual((await login('intruso_demo')).response.body, (await login('pendiente_demo')).response.body);
  assert.equal((await login('intruso_demo')).response.status, 403);
  // The new account can still link an address it controls.
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'intruso_demo', contrasena: secret, correo: 'propio@ejemplo.test' })).status, 202);
  assert.equal((await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'propio@ejemplo.test') })).status, 200);
  assert.equal((await login('intruso_demo')).response.status, 200);
});

test('vincular correo: cuentas heredadas sin correo, contraseña obligatoria y cuenta ya verificada', async t => {
  const { db, mailer, api, register, login } = await fixture(t);
  await register('ines_demo', 'ines@ejemplo.test');
  await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'ines@ejemplo.test') });
  // Simulate an account migrated from schema v1 (no email).
  const hash = db.prepare("SELECT contrasena_hash h FROM usuarios WHERE nombre_usuario='ines_demo'").get().h;
  db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash) VALUES(?,?,?)').run(randomUUID(), 'heredada', hash);
  assert.equal((await login('heredada')).response.body.error, 'CUENTA_NO_VERIFICADA');
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'heredada', contrasena: 'Contrasena equivocada 2026', correo: 'h@ejemplo.test' })).status, 401);
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'heredada', contrasena: secret })).status, 400);
  assert.equal((await api('POST', '/auth/correo', { nombre_usuario: 'heredada', contrasena: secret, correo: 'h@ejemplo.test' })).status, 202);
  assert.equal((await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'h@ejemplo.test') })).status, 200);
  assert.equal((await login('heredada')).response.status, 200);
  const verified = await api('POST', '/auth/correo', { nombre_usuario: 'ines_demo', contrasena: secret, correo: 'otra@ejemplo.test' });
  assert.equal(verified.status, 409);
  assert.equal(verified.body.error, 'CUENTA_YA_VERIFICADA');
  assert.equal(db.prepare("SELECT correo FROM usuarios WHERE nombre_usuario='ines_demo'").get().correo, 'ines@ejemplo.test');
});

test('recuperación: respuesta genérica, token de 30 min, un uso, revoca sesiones y avisa', async t => {
  const { db, mailer, api, register, login } = await fixture(t);
  await register('juan_demo', 'juan@ejemplo.test');
  await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'juan@ejemplo.test') });
  const session = await login('juan_demo');
  const known = await api('POST', '/auth/contrasena/olvido', { correo: 'juan@ejemplo.test' });
  const unknown = await api('POST', '/auth/contrasena/olvido', { correo: 'nadie@ejemplo.test' });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, unknown.body);
  const raw = lastToken(mailer, 'juan@ejemplo.test', 'restablecer');
  assert.ok(raw);
  assert.match(mailer.messages.at(-1).text, /juan_demo/);
  const row = db.prepare("SELECT * FROM tokens_cuenta WHERE proposito='recuperacion'").get();
  assert.equal((Date.parse(row.expira_en) - Date.parse(row.creado_en)) / 60000, 30);
  assert.equal(row.token_hash, accountTokenHash(raw));
  // A verification token cannot be used as a reset token and vice versa.
  assert.equal((await api('POST', '/auth/verificacion', { token: raw })).body.error, 'TOKEN_INVALIDO');
  assert.equal((await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'corta' })).status, 400);
  assert.equal((await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'Nueva frase segura de juan 2026', extra: true })).status, 400);
  const reset = await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'Nueva frase segura de juan 2026' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.restablecida, true);
  assert.equal((await api('GET', '/auth/me', undefined, session)).status, 401, 'las sesiones se revocan');
  assert.equal((await login('juan_demo')).response.status, 401, 'la contraseña anterior ya no sirve');
  assert.equal((await login('juan_demo', 'Nueva frase segura de juan 2026')).response.status, 200);
  const reused = await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'Otra frase segura de juan 2026' });
  assert.equal(reused.body.error, 'TOKEN_INVALIDO');
  const notice = mailer.messages.at(-1);
  assert.equal(notice.subject, 'Tu contraseña de ZeroTouch cambió');
  assert.equal(db.prepare('SELECT count(*) n FROM tokens_cuenta').get().n, 0);

  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z'").run();
  await api('POST', '/auth/contrasena/olvido', { correo: 'juan@ejemplo.test' });
  const late = lastToken(mailer, 'juan@ejemplo.test', 'restablecer');
  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z', expira_en='2000-01-01T00:30:00.000Z'").run();
  const expired = await api('POST', '/auth/contrasena/restablecer', { token: late, contrasena: 'Frase que no se guardara 2026' });
  assert.equal(expired.body.error, 'TOKEN_EXPIRADO');
  assert.equal((await login('juan_demo', 'Nueva frase segura de juan 2026')).response.status, 200);
});

test('recuperación sobre una cuenta pendiente la verifica; suspendida no recibe enlace', async t => {
  const { db, mailer, api, register, login } = await fixture(t);
  await register('kati_demo', 'kati@ejemplo.test');
  db.prepare("UPDATE tokens_cuenta SET creado_en='2000-01-01T00:00:00.000Z'").run();
  await api('POST', '/auth/contrasena/olvido', { correo: 'kati@ejemplo.test' });
  const raw = lastToken(mailer, 'kati@ejemplo.test', 'restablecer');
  assert.equal((await api('POST', '/auth/contrasena/restablecer', { token: raw, contrasena: 'Clave nueva de kati 2026!!' })).status, 200);
  assert.equal((await login('kati_demo', 'Clave nueva de kati 2026!!')).response.status, 200);

  await register('luis_demo', 'luis@ejemplo.test');
  await api('POST', '/auth/verificacion', { token: lastToken(mailer, 'luis@ejemplo.test') });
  db.prepare("UPDATE usuarios SET estado='suspendido' WHERE nombre_usuario='luis_demo'").run();
  const before = mailer.messages.length;
  assert.equal((await api('POST', '/auth/contrasena/olvido', { correo: 'luis@ejemplo.test' })).status, 202);
  assert.equal(mailer.messages.length, before);
});

test('registro de eventos sin secretos ni datos personales; fallos de correo no rompen el registro', async t => {
  const db = new Database(':memory:');
  db.exec(schema);
  const lines = [];
  const failing = { send: () => Promise.reject(new Error('SMTP caído con detalle sensible')) };
  const server = createApp({ db, config, mailer: failing, securityLog: createSecurityLog({ write: line => lines.push(line) }) }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/auth/registro', { nombre_usuario: 'mara_demo', correo: 'mara@ejemplo.test', contrasena: secret })).status, 202);
  await post('/auth/login', { nombre_usuario: 'mara_demo', contrasena: 'Una clave incorrecta 2026' });
  await new Promise(resolve => setImmediate(resolve));
  const log = lines.join('');
  for (const forbidden of ['mara_demo', 'mara@ejemplo.test', secret, 'Una clave incorrecta', 'SMTP caído', 'token', 'zt_session']) {
    assert.ok(!log.includes(forbidden), `el registro no contiene ${forbidden}`);
  }
  const events = lines.map(line => JSON.parse(line).evento);
  for (const expected of ['registro', 'correo_fallido', 'login_rechazado', 'acceso_rechazado']) assert.ok(events.includes(expected), expected);
  assert.ok(lines.every(line => JSON.parse(line).tipo === 'seguridad'));
});

test('páginas de cuenta: CSP estricta, sin token en el HTML y cabeceras de seguridad', async t => {
  const { request } = await fixture(t);
  for (const route of ['/cuenta/verificar', '/cuenta/restablecer']) {
    const page = await request('GET', route);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(page.text, /<script>(?!<\/script>)/, 'sin scripts en línea');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  }
  const script = await request('GET', '/cuenta/cuenta.js');
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  assert.match(script.text, /location\.hash/);
  assert.equal((await request('GET', '/cuenta/../src/app.js')).status, 404);
  assert.equal((await request('GET', '/cuenta/otra')).status, 404);
});

test('configuración de correo: smtp en producción, rutas privadas y valores seguros', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zt-correo-'));
  try {
    const databasePath = path.join(dir, 'base.sqlite');
    const local = readMailSettings({}, { nodeEnv: 'development', databasePath });
    assert.equal(local.transport, 'archivo');
    assert.equal(local.outboxDir, path.join(dir, 'correo-saliente'));
    assert.throws(() => readMailSettings({}, { nodeEnv: 'production', databasePath }), /smtp/);
    assert.throws(() => readMailSettings({ MAIL_TRANSPORT: 'archivo' }, { nodeEnv: 'production', databasePath }), /smtp/);
    assert.throws(() => readMailSettings({ MAIL_TRANSPORT: 'smtp', MAIL_SMTP_HOST: 'smtp.ejemplo.test' }, { nodeEnv: 'production', databasePath }), /MAIL_FROM/);
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    assert.throws(() => readMailSettings({ MAIL_OUTBOX_DIR: path.join(repo, 'correo') }, { nodeEnv: 'development', databasePath }), /MAIL_OUTBOX_DIR/);
    assert.throws(() => readMailSettings({ MAIL_FROM: 'a@b.cl\r\nBcc: x@y.cl' }, { nodeEnv: 'development', databasePath }), /MAIL_FROM/);
    assert.throws(() => readMailSettings({ MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'a@b.cl', MAIL_SMTP_HOST: 'h.test', MAIL_SMTP_USER: 'u' }, { nodeEnv: 'development', databasePath }), /juntos/);
    const smtp = readMailSettings({ MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'ZeroTouch <a@b.cl>', MAIL_SMTP_HOST: 'smtp.ejemplo.test', MAIL_SMTP_PORT: '465' }, { nodeEnv: 'production', databasePath });
    assert.equal(smtp.smtp.secure, true);
    assert.equal(createMailer(smtp).description, 'smtp');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('transporte archivo escribe .eml fuera del repositorio con el enlace completo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zt-buzon-'));
  try {
    const mailer = createMailer(readMailSettings({ MAIL_OUTBOX_DIR: dir }, { nodeEnv: 'test', databasePath: path.join(dir, 'x.sqlite') }));
    const token = randomBytes(32).toString('base64url');
    await mailer.send({ to: 'nora@ejemplo.test', subject: 'Prueba', text: `Enlace: http://127.0.0.1:3000/cuenta/verificar#token=${token}` });
    assert.equal(await tokenFromOutbox(dir, 'nora@ejemplo.test'), token);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
