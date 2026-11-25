// HUD: indicador flotante con el estado del motor y su última acción (ventana `index.html#hud`).
// Lógica pura: traduce la telemetría de `engine_status` a dos líneas de texto. Sin efectos.
import { getEngineState } from '../data/engineStatus.js'

/** Eventos del motor (motor_local/interpreter.py y action_engine.py) → texto para la persona. */
export const ACTION_LABELS = {
  LEFT_CLICK: 'Clic',
  RIGHT_CLICK: 'Clic derecho',
  KEYBOARD: 'Abrir teclado',
  KEYBOARD_CLOSE: 'Bajar teclado',
  ALT_TAB: 'Cambiar de ventana',
  ALT_TAB_HOLD: 'Elegir ventana',
  NEW_TAB: 'Pestaña nueva',
  SCROLL: 'Desplazamiento',
  START_DRAG: 'Arrastre iniciado',
  END_DRAG: 'Arrastre soltado',
  PAUSE: 'Pausa',
  RESUME: 'Reanudado',
  TRACKING_LOST: 'Mano perdida',
  BACK: 'Atrás (Alt+←)',
  FORWARD: 'Adelante (Alt+→)',
  CONFIRM: 'Confirmar (Intro)',
  CANCEL: 'Cancelar (Esc)',
  MEDIA_PLAY_PAUSE: 'Reproducir / pausar',
  MEDIA_NEXT: 'Siguiente pista',
  TIMER: 'Temporizador',
  PRECISION: 'Modo precisión',
  NAVIGATION: 'Navegación',
  AIRSWIPE_TRACE: 'Trazo Air-Swipe',
  EMERGENCY_STOP: 'Parada de emergencia',
  TYPE_TEXT: 'Texto escrito',
}

export function actionLabel(code) {
  const value = String(code ?? '').trim()
  if (!value || value === 'NONE') return 'Ninguna todavía'
  if (ACTION_LABELS[value]) return ACTION_LABELS[value]
  if (/^KEY_[A-Z0-9_]+$/.test(value)) return `Tecla ${value.slice(4).toLowerCase()}`
  return value
}

/**
 * Firma que cambia cada vez que el motor hace algo, aunque repita la misma acción (dos clics seguidos):
 * sirve para resaltar el HUD un momento.
 */
export function actionSignature(status) {
  return [
    status?.lastEvent ?? 'NONE',
    status?.totalClicks ?? 0,
    status?.totalScrolls ?? 0,
    status?.eventSeq ?? 0,
  ].join('|')
}

/** Contenido del HUD. `bridgeDown`: el puente no respondió (no se inventa un estado). */
export function describeHud(status, { bridgeDown = false } = {}) {
  if (bridgeDown)
    return { tone: 'error', state: 'Sin conexión con el motor', action: '', observing: false }
  const engine = getEngineState(status)
  const observing = engine.key === 'observe'
  const action = engine.running ? actionLabel(status?.lastEvent) : ''
  return {
    tone: engine.tone,
    state: engine.label,
    action: action
      ? `Última acción: ${action}${observing && status?.lastEvent && status.lastEvent !== 'NONE' ? ' (no se envió)' : ''}`
      : '',
    observing,
  }
}
