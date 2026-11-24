import { createHash } from 'node:crypto';
import { AuthError } from './auth-errors.js';

// In-memory fixed windows of 15 minutes for a single process. A restart clears them.
// consume(...) throws 429. With { silent: true } it returns false instead, so endpoints that
// must not reveal whether an account exists (resend, password recovery) can skip work quietly.
const stores = new WeakMap();
export function authLimiter(db) {
  if (stores.has(db)) return stores.get(db);
  const buckets = new Map();
  const consume = (scope, value, maximum, { silent = false } = {}) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const key = createHash('sha256').update(`${scope}:${value}`).digest('hex');
    const exceeded = () => {
      if (silent) return false;
      throw new AuthError(429, 'LIMITE_SOLICITUDES', 'Reintenta más tarde.');
    };
    if (!buckets.has(key) && buckets.size >= 2000) return exceeded();
    const bucket = buckets.get(key) ?? { count: 0, until: now + 900000 };
    buckets.set(key, bucket);
    if (++bucket.count > maximum) return exceeded();
    return true;
  };
  stores.set(db, consume);
  return consume;
}
