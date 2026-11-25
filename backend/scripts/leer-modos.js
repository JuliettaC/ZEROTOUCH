import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { databasePathFromEnv } from '../src/security/cli-config.js';

// Lectura DIRECTA del archivo SQLite (solo lectura) para comprobar qué guardó el servidor: cuenta, perfil, modo,
// sensibilidad del puntero, versión y fecha de la última modificación. No muestra contraseñas, correos ni tokens.
// Uso: npm run db:modos --prefix backend -- [nombre_de_usuario]
const user = process.argv[2];
let db;
try {
  const filename = databasePathFromEnv();
  if (!existsSync(filename)) throw new Error(`No existe la base ${filename}. Créala con: npm run db:init --prefix backend`);
  db = new Database(filename, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`
    SELECT u.nombre_usuario AS cuenta, p.nombre AS perfil, m.nombre AS modo,
           m.sensibilidad_puntero AS sensibilidad, m.version, m.actualizado_en AS actualizado
    FROM modos_uso m JOIN perfiles p ON p.id = m.perfil_id JOIN usuarios u ON u.id = p.usuario_id
    ${user ? 'WHERE u.nombre_usuario = ?' : ''}
    ORDER BY u.nombre_usuario, p.nombre, m.nombre`).all(...(user ? [user] : []));
  const schema = db.pragma('user_version', { simple: true });
  console.log(`Base: ${filename} (esquema v${schema})`);
  if (!rows.length) console.log(user ? `La cuenta «${user}» todavía no tiene modos guardados en el servidor. Pulsa «Sincronizar» en la aplicación.` : 'Todavía no hay modos guardados en el servidor.');
  else console.table(rows);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { db?.close(); }
