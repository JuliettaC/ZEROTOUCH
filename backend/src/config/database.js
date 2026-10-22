import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function within(candidate, directory) {
  const relative = path.relative(
    directory.toLowerCase(),
    candidate.toLowerCase(),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
export function validateDatabasePath(filename, environment = process.env) {
  if (!path.isAbsolute(filename) || /^[\\/]{2}/.test(filename))
    throw new Error("DATABASE_PATH debe ser una ruta absoluta local");
  let ancestor = filename;
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('DATABASE_PATH apunta a una unidad inexistente');
    ancestor = parent;
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...suffix);
  if (/^[\\/]{2}/.test(resolved))
    throw new Error("DATABASE_PATH no puede apuntar a una unidad de red");
  const cloudRoots = Object.entries(environment)
    .filter(([key, value]) => /^onedrive/i.test(key) && value)
    .map(([, value]) => path.resolve(value));
  if (
    [filename, resolved].some(
      (p) =>
        /(^|[\\/])onedrive[^\\/]*([\\/]|$)/i.test(p) ||
        cloudRoots.some((r) => within(p, r)),
    )
  )
    throw new Error(
      "DATABASE_PATH debe estar fuera de OneDrive, incluidos enlaces y junctions",
    );
  return resolved;
}
export function openDatabase(filename, { initialize = false } = {}) {
  const resolved = validateDatabasePath(filename);
  if (initialize) fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  if (initialize && !fs.existsSync(resolved)) fs.closeSync(fs.openSync(resolved,'wx',0o600));
  const db = new Database(resolved, {
    fileMustExist: !initialize,
    timeout: 3000,
  });
  try {
    db.pragma("foreign_keys = ON");
    if (
      initialize &&
      db.pragma("user_version", { simple: true }) === 0 &&
      db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .get().n > 0
    )
      throw new Error(
        "Base existente sin versión: no se modificará automáticamente",
      );
    if (initialize && db.pragma("user_version", { simple: true }) === 0)
      db.exec(
        fs.readFileSync(
          new URL("../../../db/schema.sql", import.meta.url),
          "utf8",
        ),
      );
    if (db.pragma("user_version", { simple: true }) !== 2)
      throw new Error(
        "Esquema incompatible: v2 requiere base nueva; no se migran perfiles sin propietario",
      );
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
