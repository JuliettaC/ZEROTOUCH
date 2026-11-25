import { NO_ACTION, actionName, allowedActions, capabilities } from './capabilities.js'

// Solo gestos que el motor local reconoce realmente.
// code: gesto del contrato (contracts/capacidades.json) cuya asignación gobierna este gesto de la interfaz.
// common: uso frecuente. Se muestran primero y vienen activados al empezar.
// toggle: clave de configuración que el motor usa para habilitar el gesto.
// setting: ajuste fino asociado (debe existir en settingLabels).
// live: false si el motor no envía telemetría de ese gesto; su vista previa no puede confirmarse.
// hidden: true si existe en el contrato pero no se lista en la interfaz.
// 24-11-2026: se retiraron los gestos experimentales y los que no se usaban (barridos, pulgares, precisión,
// ventanas, pestañas, dictado, ☝️ sostenido y desplazar con la mano abierta).
export const gestures = {
  pointer: {
    order: 1,
    code: 'mano_abierta_sostenida',
    common: true,
    title: 'Mano abierta',
    action: 'Mover el cursor',
    instruction: 'Abre la mano y muévela.',
    emoji: '✋',
    icon: 'mobileHand',
    setting: 'sensitivity',
    toggle: 'pointer',
  },
  click: {
    order: 2,
    code: 'micro_pinza',
    common: true,
    title: 'Pinza',
    action: 'Hacer clic',
    instruction: 'Junta un instante índice y pulgar.',
    emoji: '🤏',
    icon: 'pinch',
    setting: 'pinchTolerance',
    toggle: 'pinch',
  },
  scroll: {
    order: 3,
    code: 'dos_dedos',
    common: true,
    title: 'Dos dedos',
    action: 'Desplazar',
    instruction: 'Dos dedos juntos hacia arriba: sube. Hacia abajo: baja.',
    emoji: '✌️',
    icon: 'mobileHand',
    setting: 'stability',
    toggle: 'scroll',
  },
  pause: {
    order: 4,
    code: 'puno_cerrado',
    common: true,
    title: 'Puño',
    action: 'Pausar o reanudar',
    instruction: 'Cierra el puño un momento.',
    emoji: '✊',
    icon: 'fist',
    setting: 'confidenceThreshold',
    toggle: 'fistPause',
  },
  drag: {
    order: 5,
    code: 'pinza_sostenida',
    common: true,
    title: 'Pinza sostenida',
    action: 'Arrastrar',
    instruction: 'Mantén la pinza un segundo y mueve la mano.',
    emoji: '🤏',
    icon: 'pinch',
    setting: 'pinchTolerance',
    toggle: 'drag',
  },
  rightClick: {
    order: 11,
    common: true,
    title: 'Pinza con el medio',
    action: 'Clic derecho',
    instruction: 'Junta un instante pulgar y dedo medio.',
    emoji: '🫰',
    icon: 'pinch',
    setting: 'pinchTolerance',
    toggle: 'rightClick',
  },
  altTab: {
    order: 14,
    common: true,
    title: 'Tres dedos abajo',
    action: 'Cambiar de ventana (Alt + Tab)',
    instruction: 'Baja rápido tres dedos. Mantenlos abajo para elegir ventana.',
    emoji: '🤟',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'altTab',
  },
  newTab: {
    order: 14.5,
    common: true,
    title: 'V sostenida',
    action: 'Pestaña nueva (Ctrl + T)',
    instruction: 'Haz la V con los dedos separados, quieta.',
    emoji: '✌️',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'newTab',
  },
}

/** Acción que realiza un gesto en el modo activo: la asignada si el gesto admite varias; si no, la fija del gesto. */
export function gestureActionLabel(id, assignments) {
  const g = gestures[id]
  const entry = g?.code && assignments?.[g.code]
  if (!entry || allowedActions(g.code).length <= 2) return g?.action ?? ''
  return entry.habilitado && entry.accion !== NO_ACTION ? actionName(entry.accion) : g.action
}

// Etiquetas en lenguaje sencillo para los parámetros del motor.
export const settingLabels = {
  sensitivity: { label: 'Velocidad del cursor', min: 'Lenta', max: 'Rápida' },
  stability: { label: 'Suavizado', help: 'Reduce temblores.', min: 'Bajo', max: 'Alto' },
  movementArea: {
    label: 'Recorrido de la mano',
    help: 'Cuánto debes mover la mano para cruzar la pantalla.',
    min: 'Corto',
    max: 'Largo',
    range: [20, 100],
  },
  pinchTolerance: {
    label: 'Facilidad del clic',
    help: 'Más alto: la pinza se detecta antes.',
    min: 'Estricto',
    max: 'Fácil',
  },
  confidenceThreshold: {
    label: 'Exigencia de detección',
    help: 'Más alto: menos falsos gestos.',
    min: 'Baja',
    max: 'Alta',
    range: [30, 95],
  },
}

// Cómo se hace cada gesto del contrato. Una frase corta: la imagen explica el resto (24-11-2026).
export const GESTURE_HELP = {
  mano_abierta_sostenida: 'Abre la mano un instante; luego muévela.',
  micro_pinza: 'Junta un instante índice y pulgar.',
  pinza_sostenida: 'Mantén la pinza y mueve la mano.',
  liberacion_pinza: 'Abre los dedos para soltar.',
  dos_dedos: 'Dos dedos juntos hacia arriba: sube. Hacia abajo: baja.',
  puno_cerrado: 'Cierra el puño un momento. Repite para reanudar.',
  palma_abierta: 'Palma abierta y quieta un segundo.',
  trazo_airswipe: 'Con el teclado abierto, recorre las letras con el índice.',
}

// Incorpora también las posturas del contrato que antes solo aparecían en el editor de asignaciones.
const catalogIcons = {
  liberacion_pinza: '🖐️',
  palma_abierta: '✋',
  trazo_airswipe: '☝️',
}
for (const [code, emoji] of Object.entries(catalogIcons)) {
  const entry = capabilities.gestos[code]
  gestures[code] = {
    code,
    emoji,
    title: entry.nombre,
    action: actionName(entry.predeterminada),
    instruction: GESTURE_HELP[code],
    toggle: entry.interruptor,
    live: false,
    // El trazo Air-Swipe solo existe dentro del teclado: no se lista como gesto (24-11-2026).
    hidden: code === 'trazo_airswipe',
  }
}
