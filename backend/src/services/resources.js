import { randomUUID } from "node:crypto";
import { ApiError } from "../middleware/errors.js";
import { validateBody, validateId, validateQuery } from "./validation.js";
export function createService(kind, repository, profiles) {
  function get(id) {
    const record = repository.get(validateId(id));
    if (!record) throw new ApiError(404, "NOT_FOUND", "Recurso inexistente.");
    return record;
  }
  function requireProfile(id) {
    if (!profiles.get(id))
      throw new ApiError(
        404,
        "PROFILE_NOT_FOUND",
        "El perfil relacionado no existe.",
      );
  }
  const nameKey = (record) =>
    kind === "contexts"
      ? { ...record, nameKey: record.name.normalize("NFC").toLowerCase() }
      : record;
  return {
    get,
    list(query) {
      const options = validateQuery(kind, query);
      if (options.profileId) requireProfile(options.profileId);
      return {
        data: repository.list(options),
        pagination: { limit: options.limit, offset: options.offset },
      };
    },
    create(body) {
      const input = validateBody(kind, body);
      if (kind === "contexts") requireProfile(input.profileId);
      const now = new Date().toISOString();
      const defaults =
        kind === "profiles"
          ? { description: "", gaze: true, proximity: true }
          : {
              sensitivity: 65,
              stability: 40,
              deskRest: true,
              pinch: true,
              scroll: true,
            };
      return repository.insert(
        nameKey({
          ...defaults,
          ...input,
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
        }),
      );
    },
    update(id, body) {
      const input = validateBody(kind, body, true);
      return repository.update(
        nameKey({ ...get(id), ...input, updatedAt: new Date().toISOString() }),
      );
    },
    delete(id) {
      repository.delete(get(id).id);
    },
  };
}
