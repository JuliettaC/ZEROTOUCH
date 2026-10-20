import { loadConfig } from "../src/config/env.js";
import { openDatabase, validateDatabasePath } from "../src/config/database.js";
try {
  const config = loadConfig();
  const db = openDatabase(config.databasePath, { initialize: true });
  console.log(
    `SQLite ${db.prepare("SELECT sqlite_version() AS version").get().version}; esquema 1 en ${validateDatabasePath(config.databasePath)}`,
  );
  db.close();
} catch (error) {
  console.error(`No se pudo inicializar: ${error.message}`);
  process.exitCode = 1;
}
