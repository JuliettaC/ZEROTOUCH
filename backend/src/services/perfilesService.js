import { randomUUID } from 'node:crypto';
import { validateId, validateQuery, validateBody } from './resourceValidation.js';
import { notFound, conflict } from '../domain/resourceError.js';
export function createPerfilesService(repository) {
  function get(id) {
    const item = repository.get(validateId(id));
    if (!item) throw notFound();
    return item;
  }
  return {
    get,
    list(query) { const page = validateQuery(query); return { data: repository.list(page), paginacion: page }; },
    create(body) { const data = validateBody('perfil', body); return repository.create({ descripcion: '', ...data, id: randomUUID() }); },
    update(id, body) {
      const existing = get(id), data = validateBody('perfil', body, true);
      const updated = repository.update(existing.id, data);
      if (!updated) throw conflict();
      return updated;
    },
    delete(id) { if (!repository.delete(validateId(id))) throw notFound(); },
  };
}
