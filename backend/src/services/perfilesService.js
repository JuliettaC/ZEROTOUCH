import { randomUUID } from 'node:crypto';
import { validateId, validateQuery, validateBody } from './resourceValidation.js';
import { notFound, conflict, preconditionFailed, preconditionRequired } from '../domain/resourceError.js';
import { parseIfMatch } from '../domain/etag.js';
import { quotaExceeded } from '../domain/cuotas.js';
export function createPerfilesService(repository, idempotency) {
  function get(id) {
    const item = repository.get(validateId(id));
    if (!item) throw notFound();
    return item;
  }
  return {
    get,
    list(query) { const page = validateQuery(query); return { data: repository.list(page), paginacion: page }; },
    /** @returns {{data: object, replayed: boolean}} `replayed`: se devolvió la respuesta original de una repetición idempotente. */
    create(body, idempotencyKey) {
      const data = validateBody('perfil', body);
      return idempotency.run({
        header: idempotencyKey, tipo: 'perfil', ruta: '/perfiles', cuerpo: data,
        create: () => {
          const created = repository.create({ descripcion: '', ...data, id: randomUUID() });
          if (!created) throw quotaExceeded('perfiles');
          return created;
        },
      });
    },
    update(id, body) {
      const existing = get(id), data = validateBody('perfil', body, true);
      const updated = repository.update(existing.id, data);
      if (!updated) throw conflict();
      return updated;
    },
    etag: item => repository.etag(item),
    /** DELETE condicional: 404 si no existe o es ajeno, 400 si If-Match es inválido, 428 si falta, 412 si cambió. */
    delete(id, ifMatch) {
      const existing = get(id), etag = parseIfMatch(ifMatch);
      if (!etag) throw preconditionRequired();
      const result = repository.deleteIfMatch(existing.id, etag);
      if (result === 'missing') throw notFound();
      if (result === 'stale') throw preconditionFailed();
    },
  };
}
