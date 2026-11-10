import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createAuthRouter } from '../../src/routes/authRoutes.js';
import { createAdminRouter } from '../../src/routes/adminRoutes.js';
import { createAuthMiddleware } from '../../src/middleware/auth.js';
import { authErrorHandler } from '../../src/security/auth-errors.js';
import { bootstrapAdmin } from '../../src/services/adminService.js';
import { verifyPassword } from '../../src/security/passwords.js';
import { csrfToken } from '../../src/middleware/csrf.js';
import { authConfig } from '../../src/security/auth-config.js';
import { publicUser } from '../../src/services/authService.js';
import { createMemoryMailer, lastToken } from '../helpers/correo.js';

const sql = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8');
const secret = 'Solo pruebas locales 2026!';
const config = { nodeEnv: 'test', appOrigin: 'http://127.0.0.1:3000', sessionTtlSeconds: 28800 };
const mailOf = name => `${name.toLowerCase()}@ejemplo.test`;
async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(sql);
  const mailer = createMemoryMailer();
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/v1/auth', createAuthRouter({ db, config, mailer }));
  app.use('/api/v1/admin', createAdminRouter({ db, config }));
  // Test-only identity observation; no fixture endpoint is shipped in production.
  app.get('/api/v1/test-identidad', createAuthMiddleware({ db, config }), (req, res) => res.json({ usuarioId: req.auth.usuarioId, rol: req.auth.rol }));
  app.use(authErrorHandler);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'INTERNO', mensaje: 'Error interno.' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  async function request(method, route, body, session, extra = {}) {
    const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...extra };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${route}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
  }
  async function verify(token) {
    const response = await request('POST', '/auth/verificacion', { token });
    assert.equal(response.status, 200, response.text);
  }
  // Registers and confirms the email through the real HTTP flow; returns the public user.
  async function register(name = 'usuario') {
    const response = await request('POST', '/auth/registro', { nombre_usuario: name, correo: mailOf(name), contrasena: secret });
    assert.equal(response.status, 202, response.text);
    await verify(lastToken(mailer, mailOf(name)));
    return publicUser(db.prepare('SELECT * FROM usuarios WHERE nombre_usuario=?').get(name.toLowerCase()));
  }
  async function login(name = 'usuario') {
    const response = await request('POST', '/auth/login', { nombre_usuario: name, contrasena: secret });
    assert.equal(response.status, 200, response.text);
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: response.body.data.csrf_token,
      user: response.body.data.usuario, response };
  }
  return { db, request, register, login, verify, mailer };
}

test('registro seguro, cookie y consulta de sesión; logout invalida el token', async t => {
  const { db, request, register, login } = await fixture(t);
  const user = await register('USUARIO');
  assert.equal(user.nombre_usuario, 'usuario');
  assert.equal(user.rol, 'user');
  assert.equal(user.correo_verificado, true);
  const stored = db.prepare('SELECT contrasena_hash FROM usuarios WHERE id=?').get(user.id).contrasena_hash;
  assert.match(stored, /^\$argon2id\$v=19\$/);
  assert.deepEqual(Object.fromEntries(stored.split('$')[3].split(',').map(item => item.split('='))),
    { m: '65536', t: '3', p: '1' });
  assert.ok(await verifyPassword(stored, secret));
  const session = await login();
  assert.deepEqual(Object.keys(session.user).sort(), ['correo_verificado', 'estado', 'id', 'nombre_usuario', 'rol']);
  assert.ok(!session.response.text.includes('@ejemplo.test'), 'el DTO no expone el correo');
  assert.match(session.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(session.response.headers.get('set-cookie'), /SameSite=Strict/);
  assert.match(session.response.headers.get('set-cookie'), /Path=\/api\/v1/);
  const raw = session.cookie.split('=')[1];
  const row = db.prepare('SELECT * FROM sesiones').get();
  assert.notEqual(row.token_hash, raw);
  assert.equal(row.token_hash.length, 64);
  assert.ok(!JSON.stringify(row).includes(raw));
  assert.equal(session.csrf, csrfToken(raw));
  const current = await request('GET', '/auth/sesion', undefined, session);
  assert.equal(current.status, 200);
  assert.equal(current.body.data.usuario.id, user.id);
  assert.equal(current.headers.get('cache-control'), 'no-store');
  const logout = await request('POST', '/auth/logout', undefined, session);
  assert.equal(logout.status, 204);
  assert.equal(logout.text, '');
  assert.equal((await request('GET', '/auth/sesion', undefined, session)).status, 401);
});
test('rechaza escalamiento de registro, duplicados y credenciales inválidas', async t => {
  const { request, register } = await fixture(t);
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: 'usuario', correo: mailOf('usuario'), contrasena: secret, rol: 'admin' })).status, 400);
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: 'usuario', correo: mailOf('usuario'), contrasena: 'corta' })).status, 400);
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: 'usuario', contrasena: secret })).status, 400);
  await register();
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: 'USUARIO', correo: 'otro@ejemplo.test', contrasena: secret })).status, 409);
  for (const name of ['usuario', 'inexistente']) {
    const response = await request('POST', '/auth/login', { nombre_usuario: name, contrasena: 'Una contraseña incorrecta' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'CREDENCIALES_INVALIDAS');
    assert.ok(!response.text.includes('argon2'));
  }
});
test('CSRF y origen se verifican; Unicode malicioso no produce un 500', async t => {
  const { request, register, login } = await fixture(t);
  await register();
  const session = await login();
  for (const csrf of ['', 'incorrecto', 'é'.repeat(43)]) {
    assert.equal((await request('POST', '/auth/logout', undefined, { ...session, csrf })).status, 403);
  }
  assert.equal((await request('GET', '/auth/sesion', undefined, session, { Origin: 'https://otro.example' })).status, 403);
  assert.equal((await request('POST', '/auth/login', { nombre_usuario: 'usuario', contrasena: secret }, undefined, { Origin: 'https://otro.example' })).status, 403);
  assert.equal((await request('GET', '/auth/sesion', undefined, session)).status, 200);
});
test('sesiones ausentes, duplicadas y expiradas se rechazan', async t => {
  const { db, request, register, login } = await fixture(t);
  assert.equal((await request('GET', '/auth/sesion')).status, 401);
  await register();
  const session = await login();
  assert.equal((await request('GET', '/auth/sesion', undefined, session, { Cookie: `${session.cookie}; ${session.cookie}` })).status, 401);
  db.prepare("UPDATE sesiones SET creado_en='2000-01-01T00:00:00.000Z',expira_en='2000-01-02T00:00:00.000Z'").run();
  assert.equal((await request('GET', '/auth/sesion', undefined, session)).status, 401);
});
test('identidad proviene de la sesión; user no puede administrar', async t => {
  const { request, register, login } = await fixture(t);
  const a = await register('usuarioa'), b = await register('usuariob');
  const sa = await login('usuarioa'), sb = await login('usuariob');
  assert.equal((await request('GET', '/test-identidad', undefined, sa)).body.usuarioId, a.id);
  assert.equal((await request('GET', '/test-identidad', undefined, sb)).body.usuarioId, b.id);
  assert.equal((await request('GET', '/admin/usuarios', undefined, sa)).status, 403);
  assert.equal((await request('PATCH', `/admin/usuarios/${b.id}/rol`, { rol: 'admin' }, sa)).status, 403);
});
test('admin cambia roles/estado y revoca sesiones; último admin protegido', async t => {
  const { db, request, register, login, verify } = await fixture(t);
  const { usuario: admin, token } = await bootstrapAdmin(db, 'administrador', secret, 'admin@ejemplo.test');
  assert.equal(admin.correo_verificado, false);
  assert.equal((await request('POST', '/auth/login', { nombre_usuario: 'administrador', contrasena: secret })).status, 401);
  await verify(token);
  await assert.rejects(bootstrapAdmin(db, 'segundo', secret, 'segundo@ejemplo.test'), { code: 'ADMIN_EXISTENTE' });
  const user = await register();
  const adminSession = await login('administrador'), userSession = await login();
  const listing = await request('GET', '/admin/usuarios?limite=1&offset=0', undefined, adminSession);
  assert.equal(listing.status, 200);
  assert.equal(listing.body.data.length, 1);
  assert.ok(!listing.text.includes('contrasena_hash'));
  assert.equal((await request('PATCH', `/admin/usuarios/${admin.id}/rol`, { rol: 'user' }, adminSession)).status, 409);
  assert.equal((await request('PATCH', `/admin/usuarios/${admin.id}/estado`, { estado: 'suspendido' }, adminSession)).status, 409);
  assert.equal((await request('PATCH', `/admin/usuarios/${user.id}/rol`, { rol: 'admin' }, adminSession)).status, 200);
  assert.equal((await request('GET', '/auth/sesion', undefined, userSession)).status, 401);
  const promoted = await login();
  assert.equal((await request('GET', '/admin/usuarios', undefined, promoted)).status, 200);
  assert.equal((await request('PATCH', `/admin/usuarios/${user.id}/estado`, { estado: 'suspendido' }, adminSession)).status, 200);
  assert.equal((await request('GET', '/auth/sesion', undefined, promoted)).status, 401);
  assert.equal((await request('POST', '/auth/login', { nombre_usuario: 'usuario', contrasena: secret })).status, 401);
});
test('rate limiting bloquea repetición; no permite payload SQL en identidad', async t => {
  const { db, request } = await fixture(t);
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: "a' OR 1=1 --", correo: 'sql@ejemplo.test', contrasena: secret })).status, 400);
  assert.equal((await request('POST', '/auth/registro', { nombre_usuario: 'sqlcorreo', correo: "x'@a.cl OR 1=1 --", contrasena: secret })).status, 400);
  let response;
  for (let index = 0; index < 11; index++) response = await request('POST', '/auth/login', { nombre_usuario: 'inexistente', contrasena: secret });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.equal(db.prepare('SELECT count(*) n FROM usuarios').get().n, 0);
});
test('cookie segura en HTTPS y rechazo de configuración peligrosa', () => {
  assert.equal(authConfig({ nodeEnv: 'production', appOrigin: 'https://localhost:3000' }).cookie.secure, true);
  assert.throws(() => authConfig({ nodeEnv: 'production', appOrigin: 'http://localhost:3000' }));
  assert.throws(() => authConfig({ sessionTtlSeconds: 0 }));
  assert.throws(() => authConfig({ appOrigin: 'https://localhost:3000/ruta' }));
});

test('máximo cinco sesiones; la más antigua deja de servir', async t => {
  const { db, request, register, login } = await fixture(t);
  await register();
  const first = await login();
  for (let index = 0; index < 5; index++) await login();
  assert.equal(db.prepare('SELECT count(*) n FROM sesiones').get().n, 5);
  assert.equal((await request('GET', '/auth/sesion', undefined, first)).status, 401);
});
