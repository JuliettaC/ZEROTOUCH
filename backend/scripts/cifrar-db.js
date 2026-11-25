import { encryptDatabase } from '../src/config/database.js';
import { databaseFromEnv } from '../src/security/cli-config.js';

// Comando explícito para bases creadas antes del cifrado en reposo. Detén el servidor antes de ejecutarlo.
// Nunca borra datos: deja el original sin cifrar como respaldo para que lo elimines tú tras comprobar la aplicación.
try {
  const { filename, key } = databaseFromEnv();
  const result = encryptDatabase(filename, { key });
  if (result.alreadyEncrypted) console.log('La base ya está cifrada con DATABASE_KEY; no se modificó.');
  else {
    console.log(`Base cifrada con DATABASE_KEY: ${filename}`);
    console.log(`El original SIN CIFRAR quedó en: ${result.plaintextBackup}`);
    console.log('Comprueba que la aplicación inicia sesión y sincroniza; después borra ese archivo (tiene los datos en claro).');
  }
} catch (error) {
  console.error(`Cifrado no aplicado: ${error.message}`);
  process.exitCode = 1;
}
