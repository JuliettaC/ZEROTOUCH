import { ResourceError } from '../domain/resourceError.js';
import { fingerprint, parseIdempotencyKey, retentionCutoff } from '../domain/idempotencia.js';

/**
 * Ejecuta una creación con idempotencia opcional.
 * - Sin cabecera: se crea como siempre (comportamiento anterior).
 * - Con cabecera y la base sin la tabla (esquema v2): 501, nunca se ignora en silencio (el cliente creería estar protegido).
 * - Con cabecera: la comprobación de la clave, la creación del recurso y el registro de su resultado ocurren en UNA
 *   transacción. Misma clave y misma huella => se devuelve la respuesta ORIGINAL sin crear nada (`replayed: true`);
 *   misma clave y otra huella => 409. Solo se registran creaciones que terminaron bien: un error de validación o un
 *   nombre duplicado no deja rastro, así que la misma clave puede reutilizarse tras corregir la solicitud.
 */
export function createIdempotencyRunner({ repository, enabled, now = Date.now }) {
  return {
    run({ header, tipo, ruta, cuerpo, create }) {
      if (header === undefined) return { data: create(), replayed: false };
      if (!enabled) {
        throw new ResourceError(501, 'IDEMPOTENCIA_NO_DISPONIBLE', 'Este servidor no tiene habilitada la idempotencia (base en esquema v2). Migra la base a v3 o no envíes Idempotency-Key.');
      }
      const key = parseIdempotencyKey(header, now());
      const huella = fingerprint({ metodo: 'POST', ruta, cuerpo });
      const outcome = repository.atomic(() => {
        const found = repository.find(key);
        if (found) {
          if (found.huella !== huella) {
            throw new ResourceError(409, 'IDEMPOTENCIA_CONFLICTO', 'Esta Idempotency-Key ya se usó con una solicitud distinta.');
          }
          return { data: JSON.parse(found.respuesta), replayed: true };
        }
        const data = create();
        repository.insert({ clave: key, huella, tipo, recurso: data.id, respuesta: JSON.stringify(data), creadoEn: new Date(now()).toISOString() });
        return { data, replayed: false };
      });
      // Purga acotada FUERA de la transacción de creación: no alarga el bloqueo de escritura y, si falla o la base está
      // ocupada, la creación ya confirmada no se ve afectada (se purgará en la siguiente).
      if (!outcome.replayed) {
        try { repository.purge(retentionCutoff(now())); } catch { /* mantenimiento de mejor esfuerzo */ }
      }
      return outcome;
    },
  };
}
