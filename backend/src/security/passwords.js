import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AuthError } from './auth-errors.js';

export const passwordOptions = Object.freeze({
  type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32,
});
let active = 0;
async function limited(operation) {
  if (active >= 2) throw new AuthError(429, 'LIMITE_SOLICITUDES', 'Reintenta más tarde.');
  active++;
  try { return await operation(); } finally { active--; }
}
let dummyHash;
function dummy() {
  dummyHash ??= argon2.hash(randomBytes(32), passwordOptions);
  return dummyHash;
}
export const hashPassword = value => limited(() => argon2.hash(value, passwordOptions));
export const verifyPassword = (hash, value) => limited(async () => argon2.verify(hash || await dummy(), value));
