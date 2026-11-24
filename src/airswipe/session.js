// Contrato de sesión del teclado Air-Swipe entre la interfaz y el motor (endurecido en motor-local).
//
// - El motor decide si una escritura procede (`TYPE_TEXT` / `PRESS_KEY`). Si la rechaza con uno de
//   `DISCARD_CODES`, la interfaz DESCARTA el envío: nunca reintenta en bucle ni deja texto en cola
//   para una sesión posterior (volver a CONTROL más tarde no debe escribir lo de antes).
// - Una parada de emergencia, parar el motor o desactivar el trazo apagan el modo teclado en el motor:
//   la interfaz limpia lo pendiente y, solo tras reactivar CONTROL con la ventana abierta y el trazo
//   habilitado, vuelve a pedir `engineAirswipe(true)`.
// - Al cerrar el teclado siempre se apaga el modo en el motor (`engineAirswipe(false)`), aunque la
//   ventana ya no exista o falle su cierre.
// Módulo puro: recibe el cliente de la API; no importa React ni Tauri.

export const DISCARD_CODES = Object.freeze([
  'AIRSWIPE_INACTIVE',
  'CONTROL_REQUIRED',
  'INTERACTION_PAUSED',
  'GAZE_HOLD',
  'TRACKING_LOST',
])

export const REJECTION_MESSAGES = Object.freeze({
  AIRSWIPE_INACTIVE: 'El teclado no está activo en el motor.',
  CONTROL_REQUIRED: 'Activa el modo Controlar para escribir.',
  INTERACTION_PAUSED: 'El control está en pausa.',
  GAZE_HOLD: 'La asistencia por mirada retuvo la interacción.',
  TRACKING_LOST: 'Se perdió la mano: muéstrala a la cámara.',
})

export const isSessionRejection = (error) => DISCARD_CODES.includes(error?.code)

/**
 * Motivo por el que el motor rechazaría ahora una escritura, según la telemetría (solo orientativo:
 * la decisión es del motor). `null` si nada lo impide a la vista de la interfaz.
 */
export function typingBlocker(engineStatus) {
  const s = engineStatus || {}
  if (!s.running) return 'CONTROL_REQUIRED'
  if (!s.airswipe) return 'AIRSWIPE_INACTIVE'
  if (s.mode !== 'CONTROL' || s.emergencyStopped) return 'CONTROL_REQUIRED'
  if (s.paused) return 'INTERACTION_PAUSED'
  if (s.gaze?.holding === true) return 'GAZE_HOLD'
  if (!s.handDetected) return 'TRACKING_LOST'
  return null
}

async function send(call) {
  try {
    await call()
    return { ok: true }
  } catch (error) {
    const discard = isSessionRejection(error)
    return {
      ok: false,
      discard,
      code: error?.code ?? 'ERROR',
      message: discard
        ? REJECTION_MESSAGES[error.code]
        : error?.message || 'No se pudo enviar al motor.',
    }
  }
}

/** Envía texto imprimible. Un rechazo de sesión devuelve `discard: true`: el llamador vacía su cola. Sin reintentos. */
export const sendText = (api, text) => send(() => api.engineTypeText(text))
/** Envía backspace, enter o space. Mismo contrato que `sendText`. */
export const sendKey = (api, key) => send(() => api.enginePressKey(key))

/**
 * Compara dos telemetrías consecutivas y dice qué debe hacer la interfaz con el teclado.
 * @param {object} prev telemetría anterior
 * @param {object} next telemetría nueva
 * @param {{wantOpen:boolean, airswipeEnabled:boolean}} ui ventana abierta y trazo habilitado en el modo
 * @returns {{clearPending:boolean, reengage:boolean}}
 */
export function airswipeTransition(prev, next, { wantOpen, airswipeEnabled }) {
  const p = prev || {},
    n = next || {}
  const stoppedNow = !p.emergencyStopped && Boolean(n.emergencyStopped)
  const resumedFromStop = Boolean(p.emergencyStopped) && !n.emergencyStopped
  const engineStopped = Boolean(p.running) && !n.running
  const leftControl = p.mode === 'CONTROL' && n.mode !== 'CONTROL'
  const modeClosed = Boolean(p.airswipe) && !n.airswipe
  const clearPending = stoppedNow || resumedFromStop || engineStopped || leftControl || modeClosed
  const reengage = Boolean(
    wantOpen &&
    airswipeEnabled &&
    resumedFromStop &&
    n.running &&
    n.mode === 'CONTROL' &&
    !n.airswipe,
  )
  return { clearPending, reengage }
}

/**
 * Con el teclado Air-Swipe encendido en el motor, Confirmar/Cancelar/Atrás/Adelante dejan de llegar al
 * sistema y se entregan como eventos de la aplicación. Si la interfaz ya no tiene el teclado abierto
 * (ventana cerrada, recarga, fallo), ese modo queda «huérfano» y hay que apagarlo.
 */
export const isOrphanedAirswipe = (engineStatus, keyboardOpen) =>
  Boolean(engineStatus?.running && engineStatus.airswipe && !keyboardOpen)

/** Cierre completo y tolerante: apaga el modo en el motor y luego la ventana; intenta ambos siempre. */
export async function closeAirswipe(api) {
  const result = { engine: true, window: true }
  try {
    await api.engineAirswipe(false)
  } catch {
    result.engine = false
  }
  try {
    await api.airswipeWindowClose()
  } catch {
    result.window = false
  }
  return result
}
