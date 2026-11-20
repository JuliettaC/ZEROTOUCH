import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { readConfig, isPrivateIPv4 } from '../../src/config/env.js';

const base = { DATABASE_PATH: path.join(os.tmpdir(), 'zt-red-local.sqlite') };

test('sin LAN_HOST el servidor solo escucha en loopback', () => {
  const config = readConfig(base);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.lanHost, null);
});

test('LAN_HOST acepta una IPv4 privada concreta y HOST sigue en loopback', () => {
  for (const lan of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', ' 172.20.10.2 ']) {
    const config = readConfig({ ...base, LAN_HOST: lan });
    assert.equal(config.lanHost, lan.trim());
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.appOrigin, 'http://127.0.0.1:3000');
  }
});

test('LAN_HOST nunca abre todas las interfaces ni IP públicas', () => {
  for (const lan of ['0.0.0.0', '8.8.8.8', '172.32.0.1', '192.169.0.1', '::', 'ejemplo.cl', '192.168.001.1', '256.1.1.1', '127.0.0.1']) {
    assert.throws(() => readConfig({ ...base, LAN_HOST: lan }), /LAN_HOST/, lan);
  }
});

test('HOST sigue exigiendo loopback aunque haya LAN_HOST', () => {
  assert.throws(() => readConfig({ ...base, HOST: '192.168.1.20', LAN_HOST: '192.168.1.20' }), /loopback/);
});

test('isPrivateIPv4 reconoce los tres rangos RFC 1918', () => {
  assert.equal(isPrivateIPv4('192.168.0.1'), true);
  assert.equal(isPrivateIPv4('10.255.255.255'), true);
  assert.equal(isPrivateIPv4('172.20.10.2'), true);
  assert.equal(isPrivateIPv4('127.0.0.1'), false);
  assert.equal(isPrivateIPv4('192.168.1'), false);
});
