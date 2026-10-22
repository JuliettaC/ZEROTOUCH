import fs from 'node:fs';
import path from 'node:path';
import { root } from '../config/env.js';
import { validateDatabasePath } from '../config/database.js';
export function privatePath(filename) {
  const resolved=validateDatabasePath(filename);
  const relative=path.relative(fs.realpathSync(root),resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Los secretos y respaldos deben estar fuera del repositorio.');
  return resolved;
}
