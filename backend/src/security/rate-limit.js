import { createHash } from 'node:crypto';
import { AuthError } from './auth-errors.js';

const stores = new WeakMap();
export function authLimiter(db) {
  if (stores.has(db)) return stores.get(db);
  const buckets = new Map();
  const consume = (scope, value, maximum) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const key = createHash('sha256').update(`${scope}:${value}`).digest('hex');
    if (!buckets.has(key) && buckets.size >= 2000) throw new AuthError(429, 'LIMITE_SOLICITUDES', 'Reintenta más tarde.');
    const bucket = buckets.get(key) ?? { count: 0, until: now + 900000 };
    buckets.set(key, bucket);
    if (++bucket.count > maximum) throw new AuthError(429, 'LIMITE_SOLICITUDES', 'Reintenta más tarde.');
  };
  stores.set(db, consume);
  return consume;
}
