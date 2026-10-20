import { ApiError } from "../middleware/errors.js";
const invalid = (message) => {
  throw new ApiError(400, "INVALID_INPUT", message);
};
export function validateId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid("El identificador debe ser un UUID v4.");
  return value.toLowerCase();
}
const fields = {
  profiles: ["name", "description", "gaze", "proximity"],
  contexts: [
    "profileId",
    "name",
    "sensitivity",
    "stability",
    "deskRest",
    "pinch",
    "scroll",
  ],
};
export function validateBody(kind, body, patch = false) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    invalid("Se requiere un objeto JSON.");
  const keys = Object.keys(body);
  if (patch && !keys.length) invalid("PATCH requiere al menos un campo.");
  for (const key of keys)
    if (!fields[kind].includes(key) || (patch && key === "profileId"))
      invalid(`Campo no permitido: ${key}`);
  const data = { ...body };
  if (!patch && !Object.hasOwn(data, "name")) invalid("name es obligatorio.");
  if (Object.hasOwn(data, "name")) {
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.trim().length > 60
    )
      invalid("name debe tener entre 1 y 60 caracteres.");
    data.name = data.name.trim().normalize("NFC");
  }
  if (
    Object.hasOwn(data, "description") &&
    (typeof data.description !== "string" || data.description.length > 300)
  )
    invalid("description debe ser texto de hasta 300 caracteres.");
  for (const key of ["gaze", "proximity", "deskRest", "pinch", "scroll"])
    if (Object.hasOwn(data, key) && typeof data[key] !== "boolean")
      invalid(`${key} debe ser booleano.`);
  for (const key of ["sensitivity", "stability"])
    if (
      Object.hasOwn(data, key) &&
      (!Number.isInteger(data[key]) || data[key] < 0 || data[key] > 100)
    )
      invalid(`${key} debe ser entero entre 0 y 100.`);
  if (kind === "contexts" && !patch)
    data.profileId = validateId(data.profileId);
  return data;
}
export function validateQuery(kind, query) {
  const allowed =
    kind === "contexts"
      ? ["limit", "offset", "profileId"]
      : ["limit", "offset"];
  for (const key of Object.keys(query))
    if (!allowed.includes(key)) invalid(`Parámetro no permitido: ${key}`);
  const integer = (key, fallback, maximum) => {
    if (query[key] === undefined) return fallback;
    if (
      typeof query[key] !== "string" ||
      !/^\d+$/.test(query[key]) ||
      !Number.isSafeInteger(Number(query[key])) ||
      Number(query[key]) > maximum
    )
      invalid(`${key} inválido.`);
    return Number(query[key]);
  };
  const limit = integer("limit", 20, 100);
  if (limit < 1) invalid("limit debe ser entre 1 y 100.");
  return {
    limit,
    offset: integer("offset", 0, Number.MAX_SAFE_INTEGER),
    ...(query.profileId !== undefined
      ? { profileId: validateId(query.profileId) }
      : {}),
  };
}
