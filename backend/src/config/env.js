import dotenv from "dotenv";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../..", import.meta.url));
export function readConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv))
    throw new Error("NODE_ENV inválido");
  const rawPort = environment.PORT ?? "3000";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535)
    throw new Error("PORT debe ser entero entre 0 y 65535");
  const host = environment.HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host))
    throw new Error("HOST debe ser loopback: despliegue remoto pendiente");
  const dataHome =
    process.platform === "win32"
      ? environment.LOCALAPPDATA || path.join(homedir(), "AppData", "Local")
      : environment.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  const appOrigin = environment.APP_ORIGIN || `http://127.0.0.1:${rawPort}`;
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || !['http:', 'https:'].includes(origin.protocol) || (nodeEnv === 'production' && origin.protocol !== 'https:')) throw new Error('APP_ORIGIN debe ser un origen exacto; producción requiere HTTPS');
  return {
    nodeEnv,
    port: Number(rawPort),
    host,
    appOrigin,
    keyPath: environment.ENCRYPTION_KEY_FILE || path.join(dataHome, 'ZeroTouch', 'keys', 'v2.key'),
    databasePath:
      environment.DATABASE_PATH ||
      path.join(dataHome, "ZeroTouch", `${nodeEnv}-v2.sqlite`),
  };
}
export function loadConfig() {
  dotenv.config({ path: path.join(root, ".env"), quiet: true });
  return readConfig();
}
