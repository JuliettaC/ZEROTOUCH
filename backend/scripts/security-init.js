import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { privatePath } from '../src/security/local-files.js';
try {
  const filename=privatePath(loadConfig().keyPath);
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  fs.writeFileSync(filename,randomBytes(32),{flag:'wx',mode:0o600});
  console.log('Clave creada sin mostrar su contenido. Conserva una copia separada y restringe la ACL de Windows a tu cuenta.');
} catch(error) { console.error(`No se creó la clave: ${error.message}`); process.exitCode=1; }
