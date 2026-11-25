import { openDatabase } from '../src/config/database.js';
import { databaseFromEnv } from '../src/security/cli-config.js';

let db;
try {
  const { filename, key } = databaseFromEnv();
  db = openDatabase(filename, { key, initialize: true });
  console.log('Base nueva (esquema v4: nueve tablas) inicializada y cifrada con DATABASE_KEY. No se crearon cuentas.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'La base ya existe; no se modificó.' : `Inicialización fallida: ${error.message}`);
  process.exitCode = 1;
} finally { db?.close(); }
