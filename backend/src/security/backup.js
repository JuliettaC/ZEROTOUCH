import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createCrypto } from './crypto.js';
import { privatePath } from './local-files.js';
const maximum=64*1024*1024;
async function boundedRead(filename) {
  if ((await fs.stat(filename)).size>maximum) throw new Error('El respaldo excede el límite local de 64 MiB.');
  const data=await fs.readFile(filename);
  if(data.length>maximum) throw new Error('El respaldo excede el límite local.');
  return data;
}
export async function backupDatabase(db,key,destination) {
  const target=privatePath(destination), temporary=path.join(path.dirname(target),`.zt-backup-${randomUUID()}.sqlite`);
  try {
    await fs.writeFile(temporary,Buffer.alloc(0),{flag:'wx',mode:0o600});
    await db.backup(temporary);
    const encrypted=createCrypto(key).encrypt(await boundedRead(temporary),'database-backup');
    await fs.writeFile(target,encrypted,{flag:'wx',mode:0o600});
  } finally { await fs.rm(temporary,{force:true}); }
}
export async function restoreDatabase(source,key,destination) {
  const target=privatePath(destination), input=privatePath(source);
  const plain=createCrypto(key).decrypt(await boundedRead(input),'database-backup');
  const temporary=path.join(path.dirname(target),`.zt-restore-${randomUUID()}.sqlite`);
  try {
    await fs.writeFile(temporary,plain,{flag:'wx',mode:0o600});
    const db=new Database(temporary,{fileMustExist:true});
    try {
      if(db.pragma('user_version',{simple:true})!==2 || db.pragma('integrity_check',{simple:true})!=='ok' || db.pragma('foreign_key_check').length) throw new Error('Respaldo incompatible o dañado.');
      db.pragma('journal_mode = DELETE');
      db.transaction(()=>{db.prepare('DELETE FROM sessions').run();db.prepare('DELETE FROM rate_limits').run();}).immediate();
    } finally {db.close();}
    // Exclusive creation prevents replacing any existing database.
    await fs.copyFile(temporary,target,1);
    await fs.chmod(target,0o600);
  } finally { await fs.rm(temporary,{force:true}); }
}
