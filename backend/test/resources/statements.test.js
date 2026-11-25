import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3-multiple-ciphers';
import { prepared } from '../../src/repositories/statements.js';

test('prepared: una sola sentencia por conexión y SQL, distinta entre conexiones y entre SQL', t => {
  const a = new Database(':memory:'), b = new Database(':memory:');
  t.after(() => { a.close(); b.close(); });
  const first = prepared(a, 'SELECT 1 AS n');
  assert.equal(prepared(a, 'SELECT 1 AS n'), first, 'misma conexión y mismo SQL: la misma sentencia');
  assert.notEqual(prepared(a, 'SELECT 2 AS n'), first, 'otro SQL: otra sentencia');
  assert.notEqual(prepared(b, 'SELECT 1 AS n'), first, 'otra conexión: otra sentencia (una sentencia no sirve en otra base)');
  assert.equal(prepared(a, 'SELECT 1 AS n').get().n, 1);
  assert.equal(prepared(b, 'SELECT 1 AS n').get().n, 1);
});
