import { migrateDatabase } from '../src/config/database.js';
import { databaseFromEnv } from '../src/security/cli-config.js';

// Explicit operator command. It never runs during startup; only v3 -> v4 deletes rows (retired gestures), after the backup.
try {
  const { filename, key } = databaseFromEnv();
  const result = await migrateDatabase(filename, { key });
  if (!result.migrated) console.log(`La base ya usa el esquema v${result.version}; no se modificó.`);
  else {
    console.log(`Base migrada al esquema v${result.version}.`);
    console.log(`Respaldo previo (cifrado con la misma clave): ${result.backup}`);
    if (result.from === 1) console.log('Las cuentas existentes deben vincular y confirmar un correo antes de iniciar sesión.');
    console.log('Esquema v3: el backend anuncia y aplica la idempotencia de POST (Idempotency-Key).');
    if (result.from <= 3) console.log('Esquema v4: se retiraron del catálogo los barridos, los pulgares y el modo precisión (y sus asignaciones).');
  }
} catch (error) {
  console.error(`Migración no aplicada: ${error.message}`);
  process.exitCode = 1;
}
