import { migrateDatabase } from '../src/config/database.js';
import { databasePathFromEnv } from '../src/security/cli-config.js';

// Explicit operator command. It never runs during startup and never deletes data.
try {
  const result = await migrateDatabase(databasePathFromEnv());
  if (!result.migrated) console.log(`La base ya usa el esquema v${result.version}; no se modificó.`);
  else {
    console.log(`Base migrada al esquema v${result.version}.`);
    console.log(`Respaldo previo: ${result.backup}`);
    if (result.from === 1) console.log('Las cuentas existentes deben vincular y confirmar un correo antes de iniciar sesión.');
    console.log('Esquema v3: el backend anuncia y aplica la idempotencia de POST (Idempotency-Key).');
  }
} catch (error) {
  console.error(`Migración no aplicada: ${error.message}`);
  process.exitCode = 1;
}
