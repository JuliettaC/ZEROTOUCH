import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/config/database.js';
import { TEST_KEY } from '../helpers/clave.js';
import { tokenFromOutbox } from '../helpers/correo.js';

test('servidor real: bloqueo 503, cierre y persistencia después de reiniciar el proceso', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zt-i2-server-'));
  const filename = path.join(directory, 'test.sqlite');
  openDatabase(filename, { key: TEST_KEY, initialize: true }).close();
  const processes = [];
  t.after(async () => {
    for (const process of processes) await process.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  async function start() {
    const child = fork(fileURLToPath(new URL('../../src/server.js', import.meta.url)), [], {
      cwd: directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, DATABASE_PATH: filename, DATABASE_KEY: TEST_KEY, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3000', SESSION_TTL_SECONDS: '28800' },
    });
    child.stdout.resume(); child.stderr.resume();
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let stopping;
    const runtime = { async stop() {
      stopping ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return exited;
        const timer = setTimeout(() => child.kill(), 7000);
        try { if (child.connected) child.send('shutdown'); else child.kill(); return await exited; }
        finally { clearTimeout(timer); }
      })();
      return stopping;
    } };
    processes.push(runtime);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor no inició.')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Servidor terminó antes de iniciar.')); });
      child.once('message', message => { clearTimeout(timer); resolve(message.port); });
    });
    return { ...runtime, async request(method, route, body, session, extra = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1${route}`, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
    } };
  }
  let server = await start();
  const credentials = { nombre_usuario: 'persistente', contrasena: 'Prueba de reinicio 2026!' };
  assert.equal((await server.request('POST', '/auth/registro', { ...credentials, correo: 'persistente@ejemplo.test' })).status, 202);
  // Development transport: the real server writes the message as .eml next to the test database.
  const token = await tokenFromOutbox(path.join(directory, 'correo-saliente'), 'persistente@ejemplo.test');
  assert.equal((await server.request('POST', '/auth/verificacion', { token })).status, 200);
  const login = await server.request('POST', '/auth/login', credentials);
  const session = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.body.data.csrf_token };
  const p = (await server.request('POST', '/perfiles', { nombre: 'Persistente' }, session)).body.data;
  const m = (await server.request('POST', `/perfiles/${p.id}/modos`, { nombre: 'Mi modo', sensibilidad_puntero: 72 }, session)).body.data;
  const lock = openDatabase(filename, { key: TEST_KEY });
  try {
    lock.exec('BEGIN IMMEDIATE');
    assert.equal((await server.request('POST', '/perfiles', { nombre: 'Bloqueado' }, session)).status, 503);
  } finally { if (lock.inTransaction) lock.exec('ROLLBACK'); lock.close(); }
  assert.equal((await server.stop()).code, 0);
  server = await start();
  const persisted = await server.request('GET', `/modos/${m.id}`, undefined, session);
  assert.equal(persisted.status, 200); assert.equal(persisted.body.data.sensibilidad_puntero, 72);
  const tag = persisted.headers.get('etag');
  assert.equal((await server.request('GET', `/perfiles/${p.id}`, undefined, session)).status, 200);
  const profileTag = (await server.request('GET', `/perfiles/${p.id}`, undefined, session)).headers.get('etag');
  assert.ok(tag && profileTag, 'los GET entregan ETag');
  assert.equal((await server.request('DELETE', `/perfiles/${p.id}`, undefined, session, { 'If-Match': profileTag })).status, 204);
  assert.equal((await server.stop()).code, 0);
});
