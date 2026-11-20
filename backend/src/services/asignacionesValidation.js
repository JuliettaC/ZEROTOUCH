import { ResourceError, invalid } from '../domain/resourceError.js';
import { GESTOS, ACCIONES, isAllowed } from '../domain/capacidades.js';

// Validación de asignaciones gesto → acción. La comparten PUT/PATCH /modos/{id}/gestos y la mutación conjunta
// (`gestos` dentro de POST /perfiles/{id}/modos y PATCH /modos/{id}), de modo que ambas rutas aceptan y rechazan
// exactamente lo mismo, con los mismos mensajes.
const ITEM_KEYS = ['gesto_codigo', 'accion_codigo', 'habilitado'];

export function validateAssignment(item, patch = false) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('Cada asignación debe ser un objeto.');
  const keys = Object.keys(item);
  const allowed = patch ? ['accion_codigo', 'habilitado', 'version'] : ITEM_KEYS;
  if (keys.some(key => !allowed.includes(key))) invalid('Campo de asignación no permitido.');
  if (!patch) {
    for (const key of ITEM_KEYS) if (!Object.hasOwn(item, key)) invalid(`Falta ${key}.`);
    if (typeof item.gesto_codigo !== 'string' || !GESTOS.includes(item.gesto_codigo)) invalid('gesto_codigo no pertenece al catálogo.');
  }
  if (Object.hasOwn(item, 'accion_codigo') && (typeof item.accion_codigo !== 'string' || !ACCIONES.includes(item.accion_codigo))) invalid('accion_codigo no pertenece al catálogo.');
  if (Object.hasOwn(item, 'habilitado') && typeof item.habilitado !== 'boolean') invalid('habilitado debe ser booleano.');
  return item;
}

/** 400 ACCION_NO_COMPATIBLE si el motor local no ejecuta esa acción para ese gesto (una asignación deshabilitada siempre vale). */
export function checkCompatible(gesto, accion, habilitado) {
  if (!isAllowed(gesto, accion, habilitado)) {
    throw new ResourceError(400, 'ACCION_NO_COMPATIBLE', `El motor no ejecuta ${accion} para ${gesto}; elige una acción compatible o deshabilita el gesto.`);
  }
}

/**
 * Valida la lista completa `gestos` de un reemplazo y la devuelve normalizada: solo las tres claves conocidas y
 * ordenada por gesto, así dos listas equivalentes producen el mismo cuerpo (y la misma huella de idempotencia).
 * @returns {{gesto_codigo: string, accion_codigo: string, habilitado: boolean}[]}
 */
export function validateAssignmentList(list) {
  if (!Array.isArray(list) || list.length > GESTOS.length) invalid('gestos debe ser una lista de hasta 13 asignaciones.');
  const seen = new Set();
  const rows = list.map(item => {
    validateAssignment(item);
    if (seen.has(item.gesto_codigo)) invalid(`Gesto repetido: ${item.gesto_codigo}.`);
    seen.add(item.gesto_codigo);
    checkCompatible(item.gesto_codigo, item.accion_codigo, item.habilitado);
    return { gesto_codigo: item.gesto_codigo, accion_codigo: item.accion_codigo, habilitado: item.habilitado };
  });
  return rows.sort((a, b) => (a.gesto_codigo < b.gesto_codigo ? -1 : 1));
}
