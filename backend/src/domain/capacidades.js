import { readFileSync } from 'node:fs';

// Contrato único de capacidades (contracts/capacidades.json): qué acción puede ejecutar el motor para
// cada gesto. El backend lo usa para no persistir asignaciones habilitadas que el motor rechazaría.
export const capacidades = JSON.parse(readFileSync(new URL('../../../contracts/capacidades.json', import.meta.url), 'utf8'));
export const NO_ACTION = 'sin_accion';
export const GESTOS = Object.freeze(Object.keys(capacidades.gestos));
export const ACCIONES = Object.freeze(Object.keys(capacidades.acciones));

export function isAllowed(gesto, accion, habilitado = true) {
  const entry = capacidades.gestos[gesto];
  if (!entry || !capacidades.acciones[accion]) return false;
  if (!habilitado || accion === NO_ACTION) return true;
  return entry.acciones.includes(accion);
}

export function allowedActions(gesto) {
  const entry = capacidades.gestos[gesto];
  return entry ? [...entry.acciones, NO_ACTION] : [];
}
