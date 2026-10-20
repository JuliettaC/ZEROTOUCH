import { ApiError } from "../middleware/errors.js";
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
export function createRepository(db, kind) {
  const { columns, booleans } = definitions[kind];
  const map = (row) =>
    row &&
    Object.fromEntries(
      columns
        .filter((key) => key !== "name_key")
        .map((key) => [
          camel(key),
          booleans.includes(key) ? Boolean(row[key]) : row[key],
        ]),
    );
  function write(action) {
    try {
      return action();
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
        throw new ApiError(
          409,
          "DUPLICATE_CONTEXT",
          "Ya existe un contexto con ese nombre en el perfil.",
        );
      if (
        ["SQLITE_CONSTRAINT_FOREIGNKEY", "SQLITE_CONSTRAINT_TRIGGER"].includes(
          error.code,
        )
      )
        throw new ApiError(
          409,
          "RELATED_RECORDS",
          "La operación viola una relación entre perfil y contexto.",
        );
      if (error.code === "SQLITE_BUSY")
        throw new ApiError(
          503,
          "DATABASE_BUSY",
          "La base está ocupada. Reintenta la operación.",
        );
      throw error;
    }
  }
  // Table/column identifiers are internal constants; values are always bound parameters.
  const getStatement = db.prepare(`SELECT * FROM ${kind} WHERE id = ?`);
  const values = (data, keys) =>
    keys.map((key) =>
      booleans.includes(key) ? Number(data[camel(key)]) : data[camel(key)],
    );
  return {
    get: (id) => map(getStatement.get(id)),
    list({ limit, offset, profileId }) {
      const where = profileId ? " WHERE profile_id = ?" : "";
      return db
        .prepare(
          `SELECT * FROM ${kind}${where} ORDER BY created_at, id LIMIT ? OFFSET ?`,
        )
        .all(...(profileId ? [profileId] : []), limit, offset)
        .map(map);
    },
    insert(data) {
      return write(() => {
        db.prepare(
          `INSERT INTO ${kind} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        ).run(...values(data, columns));
        return map(getStatement.get(data.id));
      });
    },
    update(data) {
      return write(() => {
        const mutable = columns.filter(
          (key) => !["id", "created_at", "profile_id"].includes(key),
        );
        db.prepare(
          `UPDATE ${kind} SET ${mutable.map((key) => `${key} = ?`).join(",")} WHERE id = ?`,
        ).run(...values(data, mutable), data.id);
        return map(getStatement.get(data.id));
      });
    },
    delete: (id) =>
      write(() => db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id)),
  };
}
