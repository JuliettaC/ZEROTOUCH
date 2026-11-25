// Imágenes de ejemplo de cada gesto (mano real). El archivo va en public/gestos/<nombre> y la clave es el id del
// gesto en src/data/gestures.js. Formato: JPEG cuadrado de 480 px. Con varias imágenes (p. ej. desplazar hacia
// arriba y hacia abajo) se alternan. Sin imagen, la interfaz muestra el emoji del gesto: nunca una imagen de otra
// persona ni una inventada. (Hasta el 24-11-2026 eran clips de video.)
export const GESTURE_IMAGES = {
  pointer: ['mano-abierta.jpg'],
  liberacion_pinza: ['mano-abierta.jpg'],
  palma_abierta: ['mano-abierta.jpg'],
  click: ['clic.jpg'],
  scroll: ['desplazar-arriba.jpg', 'desplazar-abajo.jpg'],
  pause: ['pausar.jpg'],
  drag: ['arrastrar.jpg'],
  rightClick: ['clic-derecho.jpg'],
  altTab: ['alt-tab.jpg'],
  newTab: ['nueva-pestana.jpg'],
}

/** Imágenes del gesto (lista vacía si no tiene). */
export const imagesFor = (id) => GESTURE_IMAGES[id] ?? []

/** Cada cuánto se alterna entre las imágenes de un mismo gesto. */
export const IMAGE_CYCLE_MS = 1400
