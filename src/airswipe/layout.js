// Distribución del teclado Air-Swipe (QWERTY español con Ñ) y geometría en unidades de tecla.
// Puro: sin DOM. Las coordenadas de teclas se expresan en "anchos de tecla" para que el
// decodificador no dependa del tamaño en píxeles del panel.
export const ROWS = ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm']
export const ROW_OFFSETS = [0, 0.5, 1.5]
export const KEY_W = 1
export const KEY_H = 1
export const COLUMNS = 10

/** Centro de cada letra en unidades de tecla. */
export const KEY_CENTERS = (() => {
  const centers = {}
  ROWS.forEach((row, r) => {
    ;[...row].forEach((letter, c) => {
      centers[letter] = { x: ROW_OFFSETS[r] + c * KEY_W + KEY_W / 2, y: r * KEY_H + KEY_H / 2 }
    })
  })
  return centers
})()

export const LETTERS = Object.keys(KEY_CENTERS)
export const LAYOUT_WIDTH = COLUMNS * KEY_W
export const LAYOUT_HEIGHT = ROWS.length * KEY_H

// Letras acentuadas y diéresis se escriben sobre la tecla base: el léxico aporta los acentos.
const BASE = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' }
export const baseLetter = (letter) => BASE[letter] || letter

/** Rectángulos de las letras para un panel de `width` × `height` píxeles (con márgenes). */
export function keyRects(width, height, padding = 0) {
  const cell = Math.min(
    (width - padding * 2) / LAYOUT_WIDTH,
    (height - padding * 2) / LAYOUT_HEIGHT,
  )
  const originX = (width - cell * LAYOUT_WIDTH) / 2
  const originY = (height - cell * LAYOUT_HEIGHT) / 2
  const rects = {}
  for (const letter of LETTERS) {
    const center = KEY_CENTERS[letter]
    rects[letter] = {
      x: originX + (center.x - KEY_W / 2) * cell,
      y: originY + (center.y - KEY_H / 2) * cell,
      w: cell * KEY_W,
      h: cell * KEY_H,
    }
  }
  return { cell, originX, originY, rects }
}

/** Convierte un punto en píxeles del panel a unidades de tecla. */
export function toKeyUnits(point, geometry) {
  return {
    x: (point.x - geometry.originX) / geometry.cell,
    y: (point.y - geometry.originY) / geometry.cell,
  }
}

/** Letra bajo un punto (en unidades de tecla) o null. */
export function letterAt(unit) {
  let best = null,
    bestDistance = Infinity
  for (const letter of LETTERS) {
    const c = KEY_CENTERS[letter]
    const dx = Math.abs(unit.x - c.x),
      dy = Math.abs(unit.y - c.y)
    if (dx <= KEY_W / 2 && dy <= KEY_H / 2) return letter
    const distance = Math.hypot(dx, dy)
    if (distance < bestDistance) {
      bestDistance = distance
      best = letter
    }
  }
  return bestDistance <= 0.9 ? best : null
}

/**
 * Geometría completa de la ventana del teclado, en píxeles físicos de la ventana: una franja superior
 * (propuestas y botones) y, debajo, las teclas. El decodificador y el dibujo usan esta misma geometría,
 * así lo que se ve coincide con lo que se decodifica.
 */
export function keyboardGeometry(width, height, { barRatio = 0.26, paddingRatio = 0.012 } = {}) {
  const bar = Math.round(height * barRatio)
  const padding = Math.round(Math.min(width, height) * paddingRatio)
  const keys = keyRects(width, height - bar, padding)
  const rects = Object.fromEntries(
    Object.entries(keys.rects).map(([letter, rect]) => [letter, { ...rect, y: rect.y + bar }]),
  )
  return { ...keys, originY: keys.originY + bar, rects, bar, width, height }
}
