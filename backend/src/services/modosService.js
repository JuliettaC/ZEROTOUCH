import { randomUUID } from 'node:crypto';
import { validateId, validateQuery, validateBody } from './resourceValidation.js';
import { notFound, conflict } from '../domain/resourceError.js';
export function createModosService(repository, profiles) {
  function get(id) {
    const item = repository.get(validateId(id));
    if (!item) throw notFound();
    return item;
  }
  function profile(id) {
    id = validateId(id);
    if (!profiles.get(id)) throw notFound();
    return id;
  }
  return {
    get,
    list(perfilId, query) {
      const id = profile(perfilId), page = validateQuery(query);
      return { data: repository.list(id, page), paginacion: page };
    },
    create(perfilId, body) {
      const id = profile(perfilId), data = validateBody('modo', body);
      const result = repository.create(id, { ...data, id: randomUUID() });
      if (!result) throw notFound();
      return result;
    },
    update(id, body) {
      const existing = get(id), data = validateBody('modo', body, true);
      const updated = repository.update(existing.id, data);
      if (!updated) throw conflict();
      return updated;
    },
    delete(id) { if (!repository.delete(validateId(id))) throw notFound(); },
  };
}
