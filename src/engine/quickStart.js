// Botón «Empezar» del inicio: encender la cámara y pasar a controlar en UNA acción explícita.
// Lógica pura (sin React ni puente) para probarla en Node; `useEngine.quickStart` solo la ejecuta.
//
// Seguridad: el motor sigue arrancando en Observar y solo pasa a CONTROL por esta orden explícita de la
// persona. Si la cámara no llega a abrirse o el motor se niega (p. ej. sin Ctrl+Alt+Z), se dice y se queda
// en Observar: nunca se informa un éxito que no ocurrió.

/** Tiempo máximo esperando a que el motor confirme la cámara abierta antes de pedir el control. */
export const CAMERA_WAIT_MS = 8000
export const CAMERA_POLL_MS = 250

/** Pasos que faltan para controlar desde el estado actual del motor. */
export function quickStartPlan(status) {
  if (status?.emergencyStopped) return ['stop', 'start', 'control']
  if (!status?.running) return ['start', 'control']
  if (status.mode !== 'CONTROL') return ['control']
  return []
}

/** ¿Se puede pedir ya el control? `ready` con la cámara abierta, `timeout` tras CAMERA_WAIT_MS. */
export function cameraReadiness(status, elapsedMs) {
  if (status?.running && status?.cameraOpen) return 'ready'
  if (!status?.running) return 'stopped'
  return elapsedMs >= CAMERA_WAIT_MS ? 'timeout' : 'wait'
}

export const QUICK_START_MESSAGES = {
  ok: 'Listo: mueve el cursor con la mano abierta. Cierra el puño para pausar; Ctrl+Alt+Z lo detiene todo.',
  already: 'Ya estás controlando.',
  cameraTimeout:
    'La cámara no se abrió. Revisa que esté conectada y que otra aplicación no la esté usando, o elige otra en Calibrar.',
  stopped: 'El motor se detuvo mientras se abría la cámara. Vuelve a pulsar Empezar.',
}

/** Texto para la persona según el código estable que devuelve el puente o el motor. */
export function quickStartError(error) {
  switch (error?.code) {
    case 'CAMERA_NOT_OPEN':
    case 'CAMERA_LOST':
      return QUICK_START_MESSAGES.cameraTimeout
    case 'EMERGENCY_HOTKEY_UNAVAILABLE':
      return 'Windows no dejó registrar Ctrl+Alt+Z, la parada de emergencia, así que el control no se activa por seguridad. Cierra la aplicación que use ese atajo y vuelve a intentarlo.'
    default:
      return error?.message || 'No se pudo empezar. Revisa la cámara en Calibrar.'
  }
}

// Minimizar ZeroTouch al empezar (preferencia del equipo; por defecto sí: el indicador flotante queda a la vista).
export const MINIMIZE_KEY = 'zerotouch:minimizar-al-empezar'

export function readMinimizeOnStart(storage) {
  try {
    return storage?.getItem(MINIMIZE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeMinimizeOnStart(storage, enabled) {
  try {
    storage?.setItem(MINIMIZE_KEY, enabled ? 'on' : 'off')
    return true
  } catch {
    return false
  }
}
