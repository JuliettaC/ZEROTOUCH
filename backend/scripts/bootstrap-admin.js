import { loadConfig } from '../src/config/env.js';
import { openDatabase } from '../src/config/database.js';
import { accountRepository } from '../src/repositories/accounts.js';
let db;
try {
  const id=process.argv[2];
  if (!id) throw new Error('Indica el UUID de una cuenta ya registrada.');
  db=openDatabase(loadConfig().databasePath);
  const repo=accountRepository(db);
  repo.transaction(()=>{
    if (db.prepare("SELECT count(*) n FROM accounts WHERE role='admin'").get().n) throw new Error('Ya existe un administrador; utiliza la gestión autenticada.');
    const a=repo.get(id);
    if (!a || a.status!=='active') throw new Error('Cuenta activa inexistente.');
    repo.update(id,{role:'admin'}); repo.event('admin_bootstrap',id,id);
  });
  console.log('Primer administrador asignado. Sus sesiones anteriores fueron revocadas.');
} catch(error) { console.error(error.message); process.exitCode=1; }
finally { if(db?.open) db.close(); }
