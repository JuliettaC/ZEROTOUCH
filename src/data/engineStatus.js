// Traduce la telemetría del motor gestual a estados comprensibles para la interfaz.
// No modifica el motor: solo interpreta los campos que ya expone engine_status.

export const GESTURE_LABELS = {
  POINTER: 'Mano abierta',
  PINCH: 'Pinza',
  CLICK: 'Clic',
  DRAG: 'Arrastre',
  SCROLL: 'Dos dedos',
  PAUSE: 'Puño',
  FIST_HOLD: 'Puño…',
  TRES_DEDOS: 'Tres dedos',
  PESTANAS: 'Abanico',
  DICTADO: 'Llamada (dictado)',
  TECLADO: 'Índice (abrir teclado)',
  SCROLL_MANO: 'Mano abierta (desplazar)',
  PINZA_MEDIO: 'Pinza con el medio',
  RIGHT_CLICK: 'Clic derecho',
  PULGAR: 'Pulgar',
  EMERGENCY_STOP: 'Parada de emergencia',
}

// Gestos de la interfaz → códigos que reporta el motor. Los barridos no envían telemetría propia.
export const GESTURE_MATCH = {
  pointer: ['POINTER'],
  click: ['PINCH', 'CLICK'],
  drag: ['DRAG'],
  pause: ['PAUSE', 'FIST_HOLD'],
  scroll: ['SCROLL'],
  threeFingers: ['TRES_DEDOS'],
  tabs: ['PESTANAS'],
  dictation: ['DICTADO'],
  keyboard: ['TECLADO'],
  openHandScroll: ['SCROLL_MANO'],
  rightClick: ['PINZA_MEDIO', 'RIGHT_CLICK'],
}

export const HAND_LABELS = { RIGHT: 'Derecha', LEFT: 'Izquierda', AUTO: 'Automática' }

/** Telemetría con el motor detenido (campos de engine.rs `EngineStatus`, en camelCase). */
export const DEFAULT_ENGINE_STATUS = Object.freeze({
  running: false,
  cameraOpen: false,
  cameraIndex: 0,
  mode: 'OBSERVATION',
  paused: false,
  emergencyStopped: false,
  hotkeyActive: false,
  preferredHand: 'RIGHT',
  mirrorCamera: true,
  handDetected: false,
  handedness: 'NINGUNA',
  confidence: 0,
  gesture: 'NONE',
  lastEvent: 'NONE',
  pointerArmed: false,
  precision: false,
  airswipe: false,
  tracing: false,
  gaze: {},
  windowResult: '',
  pinchDistancePx: 0,
  pinchRatio: 0,
  cursorX: 0.5,
  cursorY: 0.5,
  rawAnchorX: 0.5,
  rawAnchorY: 0.5,
  activeBounds: [0.18, 0.82, 0.24, 0.84],
  landmarks: [],
  fps: 0,
  latencyMs: 0,
  totalClicks: 0,
  totalScrolls: 0,
  eventCounts: {},
  deliveryCounts: {},
  pinchDiag: {},
  appliedConfig: null,
  eventSeq: 0,
  recentEvents: [],
  message: 'Motor gestual detenido.',
})

const HANDEDNESS = {
  RIGHT: 'derecha',
  LEFT: 'izquierda',
  DERECHA: 'derecha',
  IZQUIERDA: 'izquierda',
}

export function getEngineState(status) {
  const running = Boolean(status?.running)
  const cameraOpen = Boolean(running && status?.cameraOpen)
  const handDetected = Boolean(cameraOpen && status?.handDetected)
  const base = { running, cameraOpen, handDetected, control: false }

  if (status?.emergencyStopped)
    return {
      ...base,
      key: 'error',
      tone: 'error',
      label: 'Parada de emergencia',
      hint: 'El control se detuvo. Apaga y vuelve a activar la cámara.',
    }
  if (!running)
    return {
      ...base,
      key: 'off',
      tone: 'off',
      label: 'Cámara apagada',
      hint: 'Actívala para empezar.',
    }
  if (!cameraOpen)
    return {
      ...base,
      key: 'nocam',
      tone: 'error',
      label: 'Cámara no disponible',
      hint: 'Ciérrala en otras apps o elige otra cámara en Calibrar.',
    }
  if (status.paused)
    return {
      ...base,
      key: 'paused',
      tone: 'paused',
      label: 'En pausa',
      hint: 'Cierra el puño o pulsa Reanudar.',
    }
  if (status.mode === 'CONTROL') {
    // Con el puntero habilitado, el cursor no se mueve hasta que la mano abierta sostenida lo arma.
    if (status.pointerArmed === false)
      return {
        ...base,
        control: true,
        key: 'control',
        tone: 'control',
        label: 'Control activo',
        hint: 'Mantén la mano abierta un momento para activar el puntero.',
      }
    return {
      ...base,
      control: true,
      key: 'control',
      tone: 'control',
      label: 'Controlando el cursor',
      hint: 'Tu mano mueve el cursor de Windows.',
    }
  }
  return {
    ...base,
    key: 'observe',
    tone: 'observe',
    label: 'Observando',
    hint: 'Prueba sin mover el cursor.',
  }
}

export function describeHand(status) {
  if (!status?.running || !status?.cameraOpen) return ''
  if (!status.handDetected) return 'Muestra tu mano a la cámara'
  const side = HANDEDNESS[String(status.handedness || '').toUpperCase()]
  const gesture = GESTURE_LABELS[status.gesture]
  return `Mano ${side || ''} detectada${gesture ? ` · ${gesture}` : ''}`.replace('  ', ' ')
}

export function isGestureLive(id, status) {
  return Boolean(
    status?.running &&
    status?.cameraOpen &&
    status?.handDetected &&
    GESTURE_MATCH[id]?.includes(status.gesture),
  )
}
