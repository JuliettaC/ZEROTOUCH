// «Solo gestos esenciales» (23-11-2026): pocos gestos que funcionen bien antes que muchos inestables.
//
// Para buscar una receta basta con: mover el cursor, clic con la pinza, desplazar con dos dedos, pausar con
// el puño y abrir el teclado con ☝️; el dictado 🤙, Alt+Tab (con su selector) y las pestañas quedan como estén.
// Lo demás se apaga porque las pruebas con
// videos reales y los informes en vivo (PROGRESO.md, 21-23/11) midieron que esos gestos se disparan solos
// mientras se mueve el cursor o se hace clic:
//  - arrastre: la pinza de un clic (0,3-0,5 s) se volvía arrastre (20 START/END_DRAG y 0 clics el 22-11);
//  - golpe de muñeca (ventanas): falsos positivos con el abanico y con el cursor;
//  - palma sostenida: «navegación» falsa en 3 de 14 videos; barridos: indistinguibles de mover rápido;
//  - clic derecho, pulgares y precisión: posturas cercanas a la pinza o al puño.
// Es un ajuste explícito (un botón) y reversible desde la misma lista de gestos; no cambia el motor.
export const ESSENTIAL_ON = Object.freeze(['pointer', 'pinch', 'scroll', 'fistPause', 'airswipe', 'keyboardGesture'])

export const ESSENTIAL_OFF = Object.freeze([
  'drag',
  'windowSwipe',
  'windowGestures',
  'rightClick',
  'openHandScroll',
  'palm',
  'swipeLeft',
  'swipeRight',
  'thumbsUp',
  'thumbsDown',
  'precision',
])

/** Ajustes completos con el conjunto esencial (para `onChangeSettings`, que guarda solo lo que cambió). */
export const withEssentialGestures = (settings) => ({
  ...settings,
  ...Object.fromEntries(ESSENTIAL_ON.map((key) => [key, true])),
  ...Object.fromEntries(ESSENTIAL_OFF.map((key) => [key, false])),
})

/** ¿Ya está aplicado? (para mostrar el botón como hecho). */
export const usesEssentialGestures = (settings) =>
  ESSENTIAL_ON.every((key) => settings?.[key] !== false) &&
  ESSENTIAL_OFF.every((key) => settings?.[key] === false)
