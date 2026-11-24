import { openDatabase } from '../src/config/database.js';
import { databasePathFromEnv } from '../src/security/cli-config.js';

let db;
try {
  db = openDatabase(databasePathFromEnv(), { initialize: true });
  console.log('Base nueva (esquema v2: ocho tablas) inicializada. No se crearon cuentas.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'La base ya existe; no se modificó.' : `Inicialización fallida: ${error.message}`);
  process.exitCode = 1;
} finally { db?.close(); }
