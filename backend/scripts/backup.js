import { loadConfig } from '../src/config/env.js';
import { openDatabase } from '../src/config/database.js';
import { loadKey } from '../src/security/crypto.js';
import { backupDatabase,restoreDatabase } from '../src/security/backup.js';
let db;
try {
  const config=loadConfig(), key=loadKey(config.keyPath);
  const [action,source,destination]=process.argv.slice(2);
  if(action==='create' && source && !destination) {db=openDatabase(config.databasePath); await backupDatabase(db,key,source);}
  else if(action==='restore' && source && destination) await restoreDatabase(source,key,destination);
  else throw new Error('Uso: backup create RUTA_NUEVA | backup restore RESPALDO BASE_NUEVA');
  console.log('Operación completada sin sobrescribir archivos existentes.');
} catch(error) { console.error(`Respaldo/restauración falló: ${error.message}`); process.exitCode=1; }
finally {if(db?.open) db.close();}
