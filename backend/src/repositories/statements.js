// Sentencias preparadas con caché por conexión. Los repositorios se crean en cada petición y varias sentencias
// (las de escritura de modos y asignaciones) se recompilaban en cada llamada; aquí se preparan una sola vez por
// conexión y SQL. Las claves son solo SQL construido con identificadores internos, nunca datos de la petición.
const cache = new WeakMap();

export function prepared(db, sql) {
  let statements = cache.get(db);
  if (!statements) cache.set(db, (statements = new Map()));
  let statement = statements.get(sql);
  if (!statement) statements.set(sql, (statement = db.prepare(sql)));
  return statement;
}
