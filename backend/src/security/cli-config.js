import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { validateDatabaseKey } from '../config/database.js';

function loadEnv() {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
}

export function databasePathFromEnv() {
  loadEnv();
  if (!process.env.DATABASE_PATH) throw new Error('Configura DATABASE_PATH en el archivo .env de la raíz.');
  return process.env.DATABASE_PATH;
}

// Ruta y clave de cifrado de la base (DATABASE_KEY, 64 caracteres hexadecimales). Sin clave nada abre la base.
export function databaseFromEnv() {
  const filename = databasePathFromEnv();
  if (!process.env.DATABASE_KEY) throw new Error('Configura DATABASE_KEY en el archivo .env de la raíz (genera una con `npm run db:clave --prefix backend`).');
  return { filename, key: validateDatabaseKey(process.env.DATABASE_KEY) };
}
