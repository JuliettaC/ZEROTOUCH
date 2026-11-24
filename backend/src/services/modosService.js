import { randomUUID } from 'node:crypto';
import { validateId, validateQuery, validateBody } from './resourceValidation.js';
import { notFound, conflict, preconditionFailed, preconditionRequired } from '../domain/resourceError.js';
import { parseIfMatch } from '../domain/etag.js';
export function createModosService(repository, profiles, idempotency) {
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
    /** @returns {{data: object, replayed: boolean}} `replayed`: se devolvió la respuesta original de una repetición idempotente. */
    create(perfilId, body, idempotencyKey) {
      const id = profile(perfilId), data = validateBody('modo', body);
      const { gestos, ...fields } = data; // `gestos` opcional: modo y asignaciones se crean juntos o no se crea nada
      return idempotency.run({
        header: idempotencyKey, tipo: 'modo', ruta: `/perfiles/${id}/modos`, cuerpo: data,
        create: () => {
          const result = repository.create(id, { ...fields, id: randomUUID() }, gestos);
          if (!result) throw notFound();
          return result;
        },
      });
    },
    update(id, body) {
      const existing = get(id), data = validateBody('modo', body, true);
      const { gestos, ...fields } = data; // `gestos` opcional: campos y asignaciones se aplican juntos, con una sola subida de versión
      const updated = repository.update(existing.id, fields, gestos);
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
