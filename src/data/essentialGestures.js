// «Solo gestos esenciales» (23-11-2026): pocos gestos que funcionen bien antes que muchos inestables.
//
// Para buscar una receta basta con: mover el cursor, clic con la pinza, desplazar con dos dedos, pausar con
// el puño (el teclado se abre solo con el foco en un campo de texto, 24-11-2026); Alt+Tab y la pestaña nueva quedan
// como estén. Los gestos retirados el 24-11-2026 (barridos, pulgares, precisión, ventanas, pestañas, dictado y ☝️)
// ya no existen.
// Lo demás se apaga porque las pruebas con
// videos reales y los informes en vivo (PROGRESO.md, 21-23/11) midieron que esos gestos se disparan solos
// mientras se mueve el cursor o se hace clic:
//  - arrastre: la pinza de un clic (0,3-0,5 s) se volvía arrastre (20 START/END_DRAG y 0 clics el 22-11);
//  - palma sostenida: «navegación» falsa en 3 de 14 videos;
//  - clic derecho: postura cercana a la pinza.
// Es un ajuste explícito (un botón) y reversible desde la misma lista de gestos; no cambia el motor.
export const ESSENTIAL_ON = Object.freeze(['pointer', 'pinch', 'scroll', 'fistPause', 'airswipe'])

export const ESSENTIAL_OFF = Object.freeze(['drag', 'rightClick', 'palm'])

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
