import Database from 'better-sqlite3-multiple-ciphers';

// Clave ficticia, solo para las bases temporales de las pruebas (nunca se usa con datos reales).
export const TEST_KEY = 'febe924ef52417ac6a2d90c343b09b9c8d6ea556cfe2183c0bc80a640132a55d';

// Abre (o crea) un archivo SQLite cifrado con la clave de prueba, como lo haría una base real.
export function keyed(filename, options) {
  const db = new Database(filename, options);
  db.pragma(`hexkey='${TEST_KEY}'`);
  return db;
}
