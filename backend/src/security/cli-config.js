import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

export function databasePathFromEnv() {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  if (!process.env.DATABASE_PATH) throw new Error('Configura DATABASE_PATH en el archivo .env de la raíz.');
  return process.env.DATABASE_PATH;
}
