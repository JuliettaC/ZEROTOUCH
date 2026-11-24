import { validateId } from './resourceValidation.js';
import { notFound, conflict, invalid } from '../domain/resourceError.js';
import { capacidades, GESTOS } from '../domain/capacidades.js';
import { RETENCION_DIAS } from '../domain/idempotencia.js';
import { checkCompatible, validateAssignment, validateAssignmentList } from './asignacionesValidation.js';

function requireVersion(body) {
  if (!Number.isSafeInteger(body.version) || body.version < 1) invalid('Se requiere version entera positiva.');
  return body.version;
}

export function createCatalogosService(repository, modes, usuarioId, features = {}) {
  function effective(id) {
    id = validateId(id);
    return repository.snapshot(() => {
      const mode = modes.get(id);
      if (!mode) throw notFound();
      return { formato_version: 1, modo: mode, gestos: repository.effective(id, usuarioId) };
    });
  }
  function applyResult(result) {
    if (result === 'missing') throw notFound();
    if (result === 'conflict') throw conflict();
    return result;
  }
  return {
    gestures: () => repository.gestures(),
    actions: () => repository.actions(),
    // `servidor` anuncia funciones del backend que no forman parte del contrato gesto → acción del motor.
    // `idempotencia` es `false` en una base v2 (sin la tabla); en v3 describe cómo usarla.
    // `modo_con_asignaciones`: POST /perfiles/{id}/modos y PATCH /modos/{id} aceptan `gestos` y lo aplican en una sola transacción.
    capabilities: () => ({ ...capacidades, servidor: { borrado_condicional: true, modo_con_asignaciones: true, idempotencia: features.idempotencia ? { clave: 'uuid-v7', retencion_dias: RETENCION_DIAS } : false } }),
    effective,
    /** PUT /modos/:id/gestos — reemplaza todas las asignaciones del modo. */
    replace(id, body) {
      id = validateId(id);
      if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Se requiere un objeto JSON.');
      if (Object.keys(body).some(key => !['version', 'gestos'].includes(key))) invalid('Campo no permitido.');
      const version = requireVersion(body);
      const rows = validateAssignmentList(body.gestos);
      applyResult(repository.writeAssignments(id, usuarioId, version, rows, { replaceAll: true }));
      return effective(id);
    },
    /** PATCH /modos/:id/gestos/:gesto — edita una asignación conservando las demás. */
    patchOne(id, gesto, body) {
      id = validateId(id);
      if (typeof gesto !== 'string' || !GESTOS.includes(gesto)) throw notFound();
      if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Se requiere un objeto JSON.');
      validateAssignment(body, true);
      if (!Object.hasOwn(body, 'accion_codigo') && !Object.hasOwn(body, 'habilitado')) invalid('PATCH requiere accion_codigo o habilitado.');
      const version = requireVersion(body);
      const current = effective(id).gestos.find(row => row.gesto_codigo === gesto);
      const next = { gesto_codigo: gesto, accion_codigo: body.accion_codigo ?? current.accion_codigo, habilitado: body.habilitado ?? current.habilitado };
      checkCompatible(gesto, next.accion_codigo, next.habilitado);
      applyResult(repository.writeAssignments(id, usuarioId, version, [next], { replaceAll: false }));
      return effective(id);
    },
  };
}
