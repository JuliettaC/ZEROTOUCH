import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authConfig } from '../security/auth-config.js';
import { readMailSettings } from '../security/mailer.js';

/** IPv4 de red privada (RFC 1918): 10/8, 172.16/12, 192.168/16. */
export function isPrivateIPv4(value) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(value));
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(n => n > 255) || m.slice(1).some(t => t.length > 1 && t.startsWith('0'))) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

export function readConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const raw = env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new Error(`${key} inválido.`);
    return Number(raw);
  };
  const port = integer('PORT', 3000, 0, 65535);
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('HOST debe ser loopback; despliegue remoto pendiente.');
  // Demo con el teléfono: LAN_HOST abre un segundo punto de escucha en una IPv4 privada concreta
  // (p. ej. la del PC en el hotspot del teléfono). HOST sigue en loopback para la app de escritorio.
  // Nunca 0.0.0.0 ni IP públicas: escuchar en todas las interfaces expondría la API.
  const lanHost = env.LAN_HOST ? env.LAN_HOST.trim() : null;
  if (lanHost !== null && !isPrivateIPv4(lanHost)) throw new Error('LAN_HOST debe ser una IPv4 privada (10.x, 172.16-31.x o 192.168.x).');
  if (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH)) throw new Error('DATABASE_PATH debe ser absoluta.');
  const config = {
    port, host, lanHost, databasePath: env.DATABASE_PATH,
    nodeEnv: env.NODE_ENV ?? 'development',
    appOrigin: env.APP_ORIGIN ?? `http://${host === '::1' ? '[::1]' : host}:${port}`,
    sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 28800, 60, 86400),
  };
  authConfig(config);
  config.mail = readMailSettings(env, config);
  return config;
}
export function loadConfig() {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  return readConfig();
}
