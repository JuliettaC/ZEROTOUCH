import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import argon2 from 'argon2';
import { DomainError } from '../domain/errors.js';
import { privatePath } from './local-files.js';

export const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
let activeHashes = 0;
async function limited(operation) {
  if (activeHashes >= 2) throw new DomainError('RATE_LIMITED', 'Espera un momento antes de reintentar.');
  activeHashes++;
  try { return await operation(); } finally { activeHashes--; }
}
export const hashPassword = password => limited(() => argon2.hash(password, passwordOptions));
const dummy = await argon2.hash(randomBytes(32), passwordOptions);
export const verifyPassword = (hash, password) => limited(() => argon2.verify(hash || dummy, password));
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function loadKey(filename) {
  filename = privatePath(filename);
  const key = fs.readFileSync(filename);
  if (key.length !== 32) throw new Error('Clave de cifrado inválida: se requieren 32 bytes');
  if (process.platform !== 'win32' && (fs.statSync(filename).mode & 0o077))
    throw new Error('La clave requiere permisos 0600');
  return key;
}
export function createCrypto(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Clave requerida');
  const derive = purpose => createHmac('sha256', key).update(`zerotouch-v2:${purpose}`).digest();
  return {
    fingerprint: value => createHmac('sha256', derive('rate-limit')).update(value).digest('hex'),
    csrf: sessionToken => createHmac('sha256', derive('csrf')).update(sessionToken).digest('base64url'),
    encrypt(value, purpose) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derive(purpose), iv);
      cipher.setAAD(Buffer.from(purpose));
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([Buffer.from('ZT2'), iv, cipher.getAuthTag(), data]);
    },
    decrypt(value, purpose) {
      if (value.length < 31 || value.subarray(0, 3).toString() !== 'ZT2') throw new Error('Formato cifrado inválido');
      const cipher = createDecipheriv('aes-256-gcm', derive(purpose), value.subarray(3, 15));
      cipher.setAAD(Buffer.from(purpose));
      cipher.setAuthTag(value.subarray(15, 31));
      return Buffer.concat([cipher.update(value.subarray(31)), cipher.final()]);
    },
  };
}
