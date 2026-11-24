import { NO_ACTION, actionName, allowedActions, capabilities } from './capabilities.js'

// Solo gestos que el motor local reconoce realmente.
// code: gesto del contrato (contracts/capacidades.json) cuya asignación gobierna este gesto de la interfaz.
// common: uso frecuente. Se muestran primero y vienen activados al empezar.
// toggle: clave de configuración que el motor usa para habilitar el gesto.
// setting: ajuste fino asociado (debe existir en settingLabels).
// live: false si el motor no envía telemetría de ese gesto; su vista previa no puede confirmarse.
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
    instruction: 'Extiende índice y medio, y sube o baja la mano.',
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
    instruction: 'Cierra el puño y mantenlo un momento.',
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
    instruction: 'Mantén la pinza un momento y mueve la mano; suelta para terminar.',
    emoji: '🤏',
    icon: 'pinch',
    setting: 'pinchTolerance',
    toggle: 'drag',
  },
  swipeLeft: {
    order: 7,
    code: 'deslizamiento_izquierda',
    common: false,
    live: false,
    title: 'Barrido a la izquierda',
    action: 'Atrás',
    instruction:
      'Experimental (apagado por defecto): palma abierta, mueve la mano rápido hacia la izquierda. Puede confundirse con mover el cursor.',
    emoji: '👈',
    icon: 'mobileHand',
    setting: 'sensitivity',
    toggle: 'swipeLeft',
  },
  swipeRight: {
    order: 8,
    code: 'deslizamiento_derecha',
    common: false,
    live: false,
    title: 'Barrido a la derecha',
    action: 'Adelante',
    instruction:
      'Experimental (apagado por defecto): palma abierta, mueve la mano rápido hacia la derecha. Puede confundirse con mover el cursor.',
    emoji: '👉',
    icon: 'mobileHand',
    setting: 'sensitivity',
    toggle: 'swipeRight',
  },
  windowSwipe: {
    order: 6,
    common: false,
    live: false,
    title: 'Mano abajo / arriba',
    action: 'Bajar o traer la ventana',
    instruction:
      'Con la mano vertical (dedos hacia arriba) y sin mover el brazo, dobla la muñeca rápido hacia abajo y vuelve: ZeroTouch pulsa Win + flecha abajo (si la ventana está maximizada, la primera vez baja de tamaño y la segunda se minimiza). Para traerla de vuelta, deja la mano colgando (dedos hacia abajo) un momento y súbela abierta y vertical. Con la mano ladeada, bajar los dedos pasa de pestaña.',
    emoji: '🖐️',
    icon: 'mobileHand',
    setting: 'sensitivity',
    toggle: 'windowSwipe',
  },
  tabs: {
    order: 10,
    common: true,
    title: 'Abanico',
    action: 'Pestaña siguiente',
    instruction:
      'Mano abierta y ladeada, casi quieta: dobla la muñeca rápido hacia el lado del pulgar, como abanicando. Cada abanico pasa una pestaña; el regreso no cuenta. Hacia el lado del meñique, rápido, vuelve a la pestaña anterior.',
    emoji: '👋',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'tabGestures',
  },
  rightClick: {
    order: 11,
    common: true,
    title: 'Pinza con el medio',
    action: 'Clic derecho',
    instruction:
      'Con el índice extendido, junta un instante las puntas del pulgar y del dedo medio.',
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
    instruction:
      'Desde la mano abierta, dobla rápido índice, medio y anular dejando arriba el meñique. Rápido (sube antes de medio segundo): vuelve a la ventana anterior. Mantenidos abajo con el pulgar pegado a la mano: Windows muestra todas las ventanas y cada segundo pasa a la siguiente; sube los dedos para abrir la elegida. Con el pulgar afuera es la llamada del dictado.',
    emoji: '🤟',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'altTab',
  },
  openHandScroll: {
    order: 15,
    common: false,
    live: false,
    title: 'Mano abierta: agarrar y deslizar',
    action: 'Desplazar (experimental)',
    instruction:
      'Experimental, apagado por defecto: deja la mano abierta quieta un instante (la página queda «agarrada») y súbela o bájala; como en una pantalla táctil, subirla baja la página. Mientras está agarrada el cursor no se mueve; cierra o cambia la mano para soltar. Inconveniente: cada vez que dejes la mano abierta quieta, el siguiente movimiento desplaza en vez de mover el cursor.',
    emoji: '🖐️',
    icon: 'mobileHand',
    setting: 'stability',
    toggle: 'openHandScroll',
  },
  keyboard: {
    order: 13,
    common: true,
    title: 'Índice sostenido',
    action: 'Abrir el teclado',
    instruction:
      'Apunta solo con el índice (los demás dedos plegados) y deja la mano quieta un segundo: se abre el teclado Air-Swipe. Si mueves la mano mientras apuntas (mover el cursor) no se abre. Para bajarlo, con la mano abierta y vertical dobla la muñeca rápido hacia abajo y vuelve (el mismo gesto que baja una ventana), o haz una pinza en su botón ✕.',
    emoji: '☝️',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'keyboardGesture',
  },
  dictation: {
    order: 12,
    common: true,
    title: 'Llamada',
    action: 'Dictado por voz',
    instruction:
      'Pulgar y meñique extendidos (🤙), los demás dedos plegados, medio segundo: abre el dictado de Windows (Win + H); di el texto y vuelve a hacerla para cerrarlo. Necesita micrófono y el idioma español instalado en Windows.',
    emoji: '🤙',
    icon: 'hand',
    setting: 'confidenceThreshold',
    toggle: 'dictation',
  },
  threeFingers: {
    order: 9,
    common: false,
    title: 'Tres dedos',
    action: 'Minimizar o restaurar ventana',
    instruction:
      'Índice, medio y anular extendidos: baja la mano (más de media palma) para pulsar Win + flecha abajo en la ventana activa; súbela para restaurar la última.',
    emoji: '🖐️',
    icon: 'mobileHand',
    setting: 'stability',
    toggle: 'windowGestures',
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

// Cómo se hace cada gesto del contrato (editor «Qué hace cada gesto»). Frases cortas y concretas.
export const GESTURE_HELP = {
  mano_abierta_sostenida:
    'Abre la mano frente a la cámara y mantenla un instante; después la mano mueve el cursor.',
  micro_pinza: 'Junta un instante las puntas del índice y el pulgar, y sepáralas.',
  pinza_sostenida:
    'Mantén la pinza cerrada un momento y mueve la mano; abre los dedos para soltar.',
  liberacion_pinza: 'Abrir los dedos tras una pinza sostenida termina el arrastre.',
  dos_dedos: 'Extiende índice y medio (los demás plegados) y sube o baja la mano.',
  puno_cerrado: 'Cierra el puño y mantenlo quieto medio segundo. Repite para reanudar.',
  palma_abierta: 'Palma abierta y quieta durante casi un segundo.',
  deslizamiento_izquierda:
    'Experimental, apagado por defecto: palma abierta, muévela rápido hacia la izquierda, de una vez. Puede confundirse con mover el cursor.',
  deslizamiento_derecha:
    'Experimental, apagado por defecto: palma abierta, muévela rápido hacia la derecha, de una vez. Puede confundirse con mover el cursor.',
  pulgar_arriba:
    'Puño (también de lado y algo suelto) con el pulgar hacia arriba durante medio segundo.',
  pulgar_abajo: 'Puño con el pulgar hacia abajo durante medio segundo.',
  modo_precision: 'Índice y meñique extendidos (medio y anular plegados) un instante.',
  trazo_airswipe:
    'Con el teclado abierto, apunta con el índice y recorre las letras de la palabra.',
}

// Incorpora también las posturas del contrato que antes solo aparecían en el editor de asignaciones.
const catalogIcons = {
  liberacion_pinza: '🖐️',
  palma_abierta: '✋',
  pulgar_arriba: '👍',
  pulgar_abajo: '👎',
  modo_precision: '🤘',
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
  }
}
