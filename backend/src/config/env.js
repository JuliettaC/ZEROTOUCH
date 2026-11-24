import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authConfig } from '../security/auth-config.js';
import { readMailSettings } from '../security/mailer.js';

export function readConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const raw = env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new Error(`${key} inválido.`);
    return Number(raw);
  };
  const port = integer('PORT', 3000, 0, 65535);
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('HOST debe ser loopback; despliegue remoto pendiente.');
  if (!env.DATABASE_PATH || !path.isAbsolute(env.DATABASE_PATH)) throw new Error('DATABASE_PATH debe ser absoluta.');
  const config = {
    port, host, databasePath: env.DATABASE_PATH,
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
