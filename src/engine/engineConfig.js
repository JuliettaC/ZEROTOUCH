// Configuración IPC que la interfaz envía al motor (formato 2). Puro: sin React ni Tauri.
// Incluye SIEMPRE todos los interruptores y el mapa gesto → acción del modo activo, para que el
// motor nunca complete claves ausentes con sus propios valores por defecto.
import { GESTURE_CODES, togglesFrom } from '../data/capabilities.js'

export const IPC_FORMAT_VERSION = 2

export function buildEngineConfig(effective, assignments) {
  const toggles = togglesFrom(assignments)
  const gestos = Object.fromEntries(GESTURE_CODES.map(code => [code, { accion: assignments[code].accion, habilitado: assignments[code].habilitado }]))
  return {
    format_version: IPC_FORMAT_VERSION,
    preferredHand: effective.preferredHand,
    mirrorCamera: effective.mirrorCamera,
    cameraIndex: effective.cameraIndex,
    movementArea: effective.movementArea,
    confidenceThreshold: effective.confidenceThreshold,
    sensitivity: effective.sensitivity,
    stability: effective.stability,
    pinchTolerance: effective.pinchTolerance,
    deskRest: effective.deskRest,
    windowGestures: effective.windowGestures,
    windowSwipe: effective.windowSwipe === true,
    tabGestures: effective.tabGestures !== false,
    rightClick: effective.rightClick !== false,
    pointerAcceleration: effective.pointerAcceleration !== false,
    activeBox: effective.activeBox,
    gaze: {
      enabled: Boolean(effective.gaze?.enabled && effective.gazeAssist),
      yawTolerance: effective.gaze?.yawTolerance ?? 22,
      pitchTolerance: effective.gaze?.pitchTolerance ?? 18,
      awayMs: effective.gaze?.awayMs ?? 800,
      backMs: effective.gaze?.backMs ?? 300,
      calibration: effective.gaze?.calibration ?? null,
    },
    ...toggles,
    gestos,
  }
}

/** Comparación estable (orden de claves) para saber si la configuración aplicada coincide con la deseada. */
export function configEquals(a, b) {
  return stable(a) === stable(b)
}

/** Clave estable de una configuración: sirve para recordar cuál se envió o se rechazó. */
export const configKey = stable

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
