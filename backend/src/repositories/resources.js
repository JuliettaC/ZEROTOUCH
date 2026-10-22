import { DomainError } from "../domain/errors.js";
const definitions = {
  profiles: {
    columns: [
      "id",
      "name",
      "description",
      "gaze",
      "proximity",
      "created_at",
      "updated_at",
    ],
    booleans: ["gaze", "proximity"],
  },
  contexts: {
    columns: [
      "id",
      "profile_id",
      "name",
      "name_key",
      "sensitivity",
      "stability",
      "desk_rest",
      "pinch",
      "scroll",
      "created_at",
      "updated_at",
    ],
    booleans: ["desk_rest", "pinch", "scroll"],
  },
};
const camel = (key) =>
  key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
export function createRepository(db, kind, accountId, crypto) {
  if (!accountId || !crypto || !definitions[kind]) throw new Error('Scoped repository requires account and crypto');
  const { columns, booleans } = definitions[kind];
  const owner = kind === 'profiles' ? 'account_id = ?' : 'profile_id IN (SELECT id FROM profiles WHERE account_id = ?)';
  const map = (row) =>
    row &&
    Object.fromEntries(
      columns
        .filter((key) => key !== "name_key")
        .map((key) => [
          camel(key),
          booleans.includes(key) ? Boolean(row[key]) :
            kind === 'profiles' && key === 'description' ? crypto.decrypt(Buffer.from(row[key], 'base64'), `profile:${row.id}:description`).toString('utf8') : row[key],
        ]),
    );
  function write(action) {
    try {
      return action();
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
        throw new DomainError("DUPLICATE_CONTEXT",
          "Ya existe un contexto con ese nombre en el perfil.",
        );
      if (
        ["SQLITE_CONSTRAINT_FOREIGNKEY", "SQLITE_CONSTRAINT_TRIGGER"].includes(
          error.code,
        )
      )
        throw new DomainError("RELATED_RECORDS",
          "La operación viola una relación entre perfil y contexto.",
        );
      if (error.code === "SQLITE_BUSY")
        throw new DomainError("DATABASE_BUSY",
          "La base está ocupada. Reintenta la operación.",
        );
      throw error;
    }
  }
  // Table/column identifiers are internal constants; values are always bound parameters.
  const getStatement = db.prepare(`SELECT * FROM ${kind} WHERE id = ? AND ${owner}`);
  const values = (data, keys) =>
    keys.map((key) =>
      booleans.includes(key) ? Number(data[camel(key)]) :
        kind === 'profiles' && key === 'description' ? crypto.encrypt(Buffer.from(data.description), `profile:${data.id}:description`).toString('base64') : data[camel(key)],
    );
  return {
    get: (id) => map(getStatement.get(id, accountId)),
    count: () => db.prepare(`SELECT count(*) n FROM ${kind} WHERE ${owner}`).get(accountId).n,
    list({ limit, offset, profileId }) {
      const where = ` WHERE ${owner}` + (profileId ? ' AND profile_id = ?' : '');
      return db
        .prepare(
          `SELECT * FROM ${kind}${where} ORDER BY created_at, id LIMIT ? OFFSET ?`,
        )
        .all(accountId, ...(profileId ? [profileId] : []), limit, offset)
        .map(map);
    },
    insert(data) {
      return write(() => {
        const insertColumns = kind === 'profiles' ? [...columns, 'account_id'] : columns;
        db.prepare(
          `INSERT INTO ${kind} (${insertColumns.join(",")}) VALUES (${insertColumns.map(() => "?").join(",")})`,
        ).run(...values(data, columns), ...(kind === 'profiles' ? [accountId] : []));
        return map(getStatement.get(data.id, accountId));
      });
    },
    update(data) {
      return write(() => {
        const mutable = columns.filter(
          (key) => !["id", "created_at", "profile_id"].includes(key),
        );
        db.prepare(
          `UPDATE ${kind} SET ${mutable.map((key) => `${key} = ?`).join(",")} WHERE id = ? AND ${owner}`,
        ).run(...values(data, mutable), data.id, accountId);
        return map(getStatement.get(data.id, accountId));
      });
    },
    delete: (id) =>
      write(() => db.prepare(`DELETE FROM ${kind} WHERE id = ? AND ${owner}`).run(id, accountId)),
  };
}
