import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { AuthError } from './auth-errors.js';

// In-memory fixed windows of 15 minutes for a single process. A restart clears them.
// consume(...) throws 429. With { silent: true } it returns false instead, so endpoints that
// must not reveal whether an account exists (resend, password recovery) can skip work quietly.
const WINDOW_MS = 900000;
// Upper bound on tracked keys. When it is full (and nothing has expired) new keys are refused: failing closed keeps
// brute force out at the cost of temporary 429s. Large enough that ordinary use never reaches it.
export const MAX_BUCKETS = 20000;
const stores = new WeakMap();

// Rate-limit key for a client address. IPv4-mapped IPv6 (::ffff:1.2.3.4) counts as its IPv4 address, and IPv6
// is grouped by /64: one subscriber usually controls a whole /64, so a per-address limit could be bypassed by
// rotating addresses inside it.
export function clientKey(address) {
  if (typeof address !== 'string' || !address) return 'desconocido';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return 'desconocido';
  const [head, tail = ''] = address.split('%')[0].toLowerCase().split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export function authLimiter(db) {
  if (stores.has(db)) return stores.get(db);
  const buckets = new Map();
  let nextSweep = 0;
  const sweep = now => {
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    nextSweep = now + 60000;
  };
  const consume = (scope, value, maximum, { silent = false } = {}) => {
    const now = Date.now();
    // Amortized cleanup: a full scan at most once a minute (or when the map is full), not on every request.
    if (now >= nextSweep || buckets.size >= MAX_BUCKETS) sweep(now);
    const key = createHash('sha256').update(`${scope}:${value}`).digest('hex');
    const exceeded = () => {
      if (silent) return false;
      throw new AuthError(429, 'LIMITE_SOLICITUDES', 'Reintenta más tarde.');
    };
    let bucket = buckets.get(key);
    if (bucket && bucket.until <= now) bucket = undefined;
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) return exceeded();
      bucket = { count: 0, until: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    if (++bucket.count > maximum) return exceeded();
    return true;
  };
  stores.set(db, consume);
  return consume;
}
