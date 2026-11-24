// Estado «guardado / pendiente / aplicado / rechazado» de la configuración enviada al motor.
//
// Guardado = en el almacenamiento local (lo decide la capa de preferencias). Aplicado = el motor
// confirmó con su ACK una configuración equivalente a la deseada (`appliedConfig`). Rechazado = el
// motor respondió con un código de error para esa misma configuración: no se reintenta en bucle
// ni se sustituye en silencio por valores por defecto.
//
// La comparación es semántica: el motor devuelve su configuración normalizada (campos propios como
// `precisionMode`, acciones de gestos continuos fijas, `habilitado` derivado del interruptor).
import { NO_ACTION, TOGGLE_KEYS } from '../data/capabilities.js'
import { configKey } from './engineConfig.js'

const SCALARS = [
  'preferredHand',
  'mirrorCamera',
  'cameraIndex',
  'movementArea',
  'confidenceThreshold',
  'sensitivity',
  'stability',
  'pinchTolerance',
  'deskRest',
  'windowGestures',
  'windowSwipe',
  'tabGestures',
  'rightClick',
  'dictation',
  'keyboardGesture',
  'altTab',
  'openHandScroll',
  'pointerAcceleration',
]
const GAZE_KEYS = ['enabled', 'yawTolerance', 'pitchTolerance', 'awayMs', 'backMs']

function semantic(config) {
  const c = config && typeof config === 'object' ? config : {}
  const gaze = c.gaze && typeof c.gaze === 'object' ? c.gaze : {}
  const gestos = {}
  for (const [code, item] of Object.entries(
    c.gestos && typeof c.gestos === 'object' ? c.gestos : {},
  )) {
    // Un gesto inactivo no tiene acción efectiva, sea por habilitado=false o por sin_accion.
    gestos[code] =
      item && item.habilitado === true && item.accion !== NO_ACTION ? item.accion : null
  }
  return {
    scalars: Object.fromEntries(SCALARS.map((key) => [key, c[key] ?? null])),
    toggles: Object.fromEntries(TOGGLE_KEYS.map((key) => [key, c[key] === true])),
    activeBox: Array.isArray(c.activeBox)
      ? c.activeBox.map((v) => Math.round(v * 1000) / 1000)
      : null,
    gaze: {
      ...Object.fromEntries(GAZE_KEYS.map((key) => [key, gaze[key] ?? null])),
      calibration: gaze.calibration
        ? { yaw: gaze.calibration.yaw, pitch: gaze.calibration.pitch }
        : null,
    },
    gestos,
  }
}

/** True si la configuración que el motor dice haber aplicado equivale a la deseada. */
export function appliedMatches(desired, applied) {
  if (!applied || typeof applied !== 'object' || Object.keys(applied).length === 0) return false
  return configKey(semantic(desired)) === configKey(semantic(applied))
}

export const APPLY = Object.freeze({
  NO_ENGINE: 'sin_motor',
  STARTING: 'iniciando',
  SENDING: 'enviando',
  APPLIED: 'aplicada',
  PENDING: 'pendiente',
  REJECTED: 'rechazada',
})

/**
 * @param {object} p
 * @param {object} p.desired configuración IPC deseada (buildEngineConfig)
 * @param {object} p.engineStatus telemetría del motor (running, appliedConfig)
 * @param {{key:string, code?:string, message?:string}|null} [p.rejection] último rechazo del motor
 * @param {string|null} [p.sendingKey] clave de la configuración con un envío en curso
 */
export function applyState({ desired, engineStatus, rejection = null, sendingKey = null }) {
  const key = configKey(desired)
  if (!engineStatus?.running) return { state: APPLY.NO_ENGINE, key }
  // El motor confirma su configuración inicial en READY; hasta entonces no se le envía nada.
  if (!engineStatus.appliedConfig || typeof engineStatus.appliedConfig !== 'object')
    return { state: APPLY.STARTING, key }
  if (appliedMatches(desired, engineStatus.appliedConfig)) return { state: APPLY.APPLIED, key }
  if (rejection && rejection.key === key)
    return { state: APPLY.REJECTED, key, code: rejection.code, message: rejection.message }
  if (sendingKey === key) return { state: APPLY.SENDING, key }
  return { state: APPLY.PENDING, key }
}

/** ¿Hay que enviar la configuración ahora? Solo con el motor activo, sin envío en curso ni rechazo de esta misma clave. */
export function shouldSend(status) {
  return status.state === APPLY.PENDING
}

export const APPLY_LABELS = Object.freeze({
  [APPLY.NO_ENGINE]: 'Guardado en este equipo. Se aplicará al activar la cámara.',
  [APPLY.STARTING]: 'Guardado. El motor está iniciando.',
  [APPLY.SENDING]: 'Aplicando al motor…',
  [APPLY.APPLIED]: 'Guardado y aplicado al motor.',
  [APPLY.PENDING]: 'Guardado. Pendiente de aplicar al motor.',
  [APPLY.REJECTED]: 'Guardado, pero el motor rechazó esta configuración.',
})
