import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, request } from './helpers.js';
import { openDatabase, validateDatabasePath } from '../src/config/database.js';
import { createApp } from '../src/app.js';

test('bloqueo de escritura devuelve 503 sin crear el registro', async t => {
  const f = await fixture(t);
  const instance = await f.start();
  const lock = openDatabase(f.filename);
  try {
    lock.exec('BEGIN IMMEDIATE');
    const response = await request(instance.base, 'POST', '/api/v1/profiles', { name: 'Bloqueado' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'DATABASE_BUSY');
    lock.exec('ROLLBACK');
    const list = await request(instance.base, 'GET', '/api/v1/profiles');
    assert.equal(list.body.data.length, 0);
  } finally {
    if (lock.inTransaction) lock.exec('ROLLBACK');
    lock.close();
  }
});

test('fallo inesperado de persistencia devuelve 500 sin detalles internos', async t => {
  const f = await fixture(t);
  const db = openDatabase(f.filename);
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); });
  db.close(); // Deliberate fault injection, isolated fixture only.
  const response = await request(`http://127.0.0.1:${server.address().port}`, 'GET', '/api/v1/profiles');
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' } });
});

test('enlace/junction a OneDrive es rechazado antes de abrir SQLite', async t => {
  const f = await fixture(t);
  const directory = path.dirname(f.filename);
  const cloud = path.join(directory, 'OneDrive');
  const alias = path.join(directory, 'alias');
  await fs.mkdir(cloud);
  await fs.symlink(cloud, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateDatabasePath(path.join(alias, 'test.sqlite')), /OneDrive/);
  assert.throws(() => validateDatabasePath(path.join(directory, 'custom-cloud', 'test.sqlite'), { OneDrive: path.join(directory, 'custom-cloud') }), /OneDrive/);
});
