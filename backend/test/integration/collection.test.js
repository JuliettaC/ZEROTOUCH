import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { openDatabase } from '../../src/config/database.js';

// Executes only this repository's Postman scripts, with a small explicit pm adapter.
// This is HTTP integration evidence, not a claim that the Postman UI was tested.
test('colección: HTTP real, aislamiento, reinicio y exportación sin credenciales', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zt-i3-'));
  const database = path.join(dir, 'test.sqlite');
  openDatabase(database, { initialize: true }).close();
  const processes = [];
  t.after(async () => {
    for (const runtime of processes) await runtime.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  async function start() {
    const child = fork(fileURLToPath(new URL('../../src/server.js', import.meta.url)), [], {
      cwd: dir, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, DATABASE_PATH: database, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3000', SESSION_TTL_SECONDS: '28800' },
    });
    child.stderr.resume();
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let stopping;
    const runtime = { stop() {
      stopping ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return exit;
        const timer = setTimeout(() => child.kill(), 7000);
        try { if (child.connected) child.send('shutdown'); else child.kill(); return await exit; }
        finally { clearTimeout(timer); }
      })();
      return stopping;
    } };
    processes.push(runtime);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor no inició')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Servidor terminó antes de iniciar')); });
      child.once('message', message => { clearTimeout(timer); assert.equal(message.type, 'ready'); resolve(message.port); });
    });
    return { ...runtime, base: `http://127.0.0.1:${port}/api/v1`, pid: child.pid };
  }
  let server = await start();
  const collection = JSON.parse(readFileSync(new URL('../../../docs/api/coleccion.json', import.meta.url), 'utf8'));
  const values = new Map([['base_url', server.base]]);
  const replace = text => text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (key === '$guid') return randomUUID();
    assert.ok(values.has(key), `Variable ausente: ${key}`);
    return values.get(key);
  });
  let cookie = '';
  async function request(method, route, body, headers = {}) {
    const response = await fetch(server.base + route, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response;
  }
  for (const item of collection.item) {
    let response, body;
    const pm = {
      variables: { set: (key, value) => values.set(key, value), replaceIn: replace },
      test: (name, run) => { try { run(); } catch (error) { throw new Error(`${item.name}: ${name}`, { cause: error }); } },
      response: { json: () => JSON.parse(body), to: { have: { status: expected => assert.equal(response.status, expected) } } },
    };
    const scripts = event => item.event.filter(e => e.listen === event).forEach(e => vm.runInNewContext(e.script.exec.join('\n'), { pm }, { timeout: 1000 }));
    scripts('prerequest');
    const headers = Object.fromEntries(item.request.header.map(h => [h.key, replace(h.value)]));
    if (cookie) headers.Cookie = cookie;
    response = await fetch(replace(item.request.url), {
      method: item.request.method, headers,
      ...(item.request.body ? { body: replace(item.request.body.raw) } : {}),
    });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    body = await response.text();
    scripts('test');
    if (item.name.startsWith('18 ')) {
      assert.doesNotMatch(values.get('motor_json'), /csrf|contrasena|token_hash|zt_session/);
      const configuration = JSON.parse(values.get('motor_json'));
      assert.deepEqual(Object.keys(configuration).sort(), ['formato_version', 'gestos', 'modo']);
      assert.equal(configuration.formato_version, 1);
      assert.equal(configuration.modo.sensibilidad_puntero, 70);
      assert.equal(configuration.modo.version, 2);
      assert.equal(configuration.gestos.length, 13);
      assert.ok(configuration.gestos.every(g => typeof g.habilitado === 'boolean'));
      assert.equal(configuration.gestos.find(g => g.gesto_codigo === 'micro_pinza').accion_codigo, 'clic');
      const oldPid = server.pid;
      assert.equal((await server.stop()).code, 0);
      server = await start();
      assert.notEqual(server.pid, oldPid);
      values.set('base_url', server.base);
      const persisted = await request('GET', `/modos/${values.get('modo_id')}`);
      assert.equal(persisted.status, 200);
      assert.equal((await persisted.json()).data.sensibilidad_puntero, 70);
      assert.equal((await request('PATCH', `/modos/${values.get('modo_id')}`, { nombre: 'Sin CSRF', version: 2 })).status, 403);
      const ownerCookie = cookie;
      const other = { nombre_usuario: 'otro_usuario', contrasena: randomUUID() };
      assert.equal((await request('POST', '/auth/registro', other)).status, 201);
      const login = await request('POST', '/auth/login', other);
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie').split(';')[0];
      const csrf = (await login.json()).data.csrf_token;
      for (const route of [`/perfiles/${values.get('perfil_id')}`, `/modos/${values.get('modo_id')}`, `/modos/${values.get('modo_id')}/gestos`]) {
        assert.equal((await request('GET', route)).status, 404);
      }
      assert.equal((await request('DELETE', `/perfiles/${values.get('perfil_id')}`, undefined, { 'X-CSRF-Token': csrf })).status, 404);
      cookie = ownerCookie;
    }
  }
  assert.equal((await server.stop()).code, 0);
});
