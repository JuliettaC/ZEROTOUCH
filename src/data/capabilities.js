// Contrato único de capacidades gestuales (contracts/capacidades.json), compartido con el backend y
// el motor. La interfaz solo ofrece las combinaciones gesto → acción que el motor ejecuta realmente.
import contract from '../../contracts/capacidades.json' with { type: 'json' }

export const capabilities = contract
export const GESTURE_CODES = Object.keys(contract.gestos)
export const ACTION_CODES = Object.keys(contract.acciones)
export const DISCRETE_ACTIONS = contract.acciones_discretas
export const NO_ACTION = 'sin_accion'

/** Interruptor de interfaz (camelCase) → código de gesto del catálogo. */
export const TOGGLE_TO_GESTURE = Object.fromEntries(
  Object.entries(contract.gestos).filter(([, g]) => g.interruptor).map(([code, g]) => [g.interruptor, code]),
)
export const GESTURE_TO_TOGGLE = Object.fromEntries(Object.entries(TOGGLE_TO_GESTURE).map(([t, g]) => [g, t]))
export const TOGGLE_KEYS = Object.keys(TOGGLE_TO_GESTURE)

/** Acciones que puede recibir un gesto (siempre incluye sin_accion). */
export function allowedActions(gesto) {
  const entry = contract.gestos[gesto]
  if (!entry) return [NO_ACTION]
  return [...entry.acciones, NO_ACTION]
}

export function isAllowed(gesto, accion, habilitado = true) {
  if (!contract.gestos[gesto] || !contract.acciones[accion]) return false
  if (!habilitado || accion === NO_ACTION) return true
  return contract.gestos[gesto].acciones.includes(accion)
}

/** Asignaciones por defecto de un modo nuevo: acción predeterminada y el interruptor de la interfaz. */
export function defaultAssignments() {
  const defaults = contract.predeterminados_interfaz
  return Object.fromEntries(GESTURE_CODES.map(code => {
    const g = contract.gestos[code]
    const toggle = g.interruptor
    return [code, { accion: g.predeterminada, habilitado: toggle ? defaults[toggle] !== false : true }]
  }))
}

/** Normaliza un mapa de asignaciones: completa gestos ausentes y descarta combinaciones no permitidas. */
export function normalizeAssignments(raw) {
  const base = defaultAssignments()
  if (!raw || typeof raw !== 'object') return base
  for (const code of GESTURE_CODES) {
    const item = raw[code]
    if (!item || typeof item !== 'object') continue
    const accion = typeof item.accion === 'string' && contract.acciones[item.accion] ? item.accion : base[code].accion
    const habilitado = typeof item.habilitado === 'boolean' ? item.habilitado : base[code].habilitado
    base[code] = isAllowed(code, accion, habilitado) ? { accion, habilitado } : { accion, habilitado: false }
  }
  return base
}

/** Interruptores (camelCase) derivados de las asignaciones: activo = habilitado y con acción. */
export function togglesFrom(assignments) {
  return Object.fromEntries(TOGGLE_KEYS.map(key => {
    const item = assignments?.[TOGGLE_TO_GESTURE[key]]
    return [key, Boolean(item && item.habilitado && item.accion !== NO_ACTION)]
  }))
}

/** Exportación `gestos` (formato 1 de la API) a partir del mapa local, en orden alfabético de código. */
export function assignmentsToExport(assignments) {
  return [...GESTURE_CODES].sort().map(code => ({ gesto_codigo: code, accion_codigo: assignments[code].accion, habilitado: assignments[code].habilitado }))
}

/** Mapa local a partir de la lista `gestos` de la API (GET /modos/:id/gestos). */
export function assignmentsFromExport(list) {
  const raw = {}
  for (const item of Array.isArray(list) ? list : []) {
    if (item && typeof item.gesto_codigo === 'string') raw[item.gesto_codigo] = { accion: item.accion_codigo, habilitado: item.habilitado }
  }
  return normalizeAssignments(raw)
}

export function actionName(code) { return contract.acciones[code]?.nombre || code }
export function gestureName(code) { return contract.gestos[code]?.nombre || code }

/** Gestos habilitados del modo que realizan `action` (p. ej. qué gesto inicia el temporizador). */
export function gesturesWithAction(action, assignments) {
  return GESTURE_CODES.filter(code => {
    const item = assignments?.[code]
    return Boolean(item && item.habilitado && item.accion === action && item.accion !== NO_ACTION)
  })
}
