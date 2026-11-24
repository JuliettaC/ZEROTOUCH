// Teclado por permanencia (23-11-2026): teclas grandes que se escriben al mantener el cursor encima.
// Puro (sin DOM ni React): distribución en píxeles de la ventana, prueba de impacto con histéresis y la
// máquina de permanencia. La ventana overlay lo conecta a la posición del cursor que da la telemetría.
//
// Por qué así (diagnóstico del teclado Air-Swipe): el trazo exige dibujar la palabra entera con un
// cursor que tiembla, y tocar teclas exigía una pinza (clic) sobre teclas de ~60 px. La permanencia solo
// pide apuntar y esperar: no hay que hacer ningún gesto encima de la tecla, que es lo que más falla.
//  - Para EMPEZAR a contar, el cursor debe entrar en la parte central de la tecla (margen interior):
//    pasar rozando el borde camino de otra tecla no cuenta.
//  - Para SEGUIR contando basta con no salir de la tecla más un margen (histéresis): el temblor del
//    cursor en el borde no reinicia la espera.
//  - Un fotograma sin cursor (mano perdida un instante) no reinicia la espera durante GRACE_MS.
//  - Una tecla escrita queda bloqueada hasta que el cursor sale de ella: mantener la mano quieta nunca
//    repite la letra. Para una letra doble («ll», «rr») se sale y se vuelve a entrar.
import { ROWS } from './layout.js'

export const DWELL_MS = Object.freeze({ letter: 800, suggestion: 1000, action: 1100 })
export const GRACE_MS = 250
export const INNER_MARGIN = 0.14 // fracción del lado menor de la tecla: zona del borde que no inicia
export const HOLD_MARGIN = 0.12 // fracción del lado menor: margen exterior que mantiene la tecla
export const CLICK_AFTER_DWELL_MS = 1500 // un clic sobre la tecla recién escrita por permanencia se ignora
export const MAX_SUGGESTIONS = 4

export const ACTIONS = Object.freeze([
  { id: 'backspace', label: '⌫ Borrar', span: 2 },
  { id: 'word', label: 'Borrar palabra', span: 2 },
  { id: 'space', label: 'Espacio', span: 3 },
  { id: 'clear', label: 'Limpiar', span: 1.5 },
  { id: 'enter', label: 'Buscar ⏎', span: 1.5 },
])

/**
 * Distribución en píxeles de una ventana `width`×`height`: franja de texto y controles, franja de
 * sugerencias, tres filas de letras (QWERTY con ñ) y una fila de acciones.
 * Cada tecla: { id, kind: 'letter'|'suggestion'|'action', x, y, w, h, value?, label? }.
 */
export function dwellLayout(width, height, { suggestions = MAX_SUGGESTIONS } = {}) {
  const pad = Math.round(Math.min(width, height) * 0.015)
  const textH = Math.round(height * 0.15)
  const rowH = (height - textH - pad * 2) / 5
  const top = textH + pad
  const innerW = width - pad * 2
  const keys = []
  // Sugerencias: una fila de `suggestions` huecos iguales (los vacíos no se dibujan ni cuentan).
  const sugW = innerW / suggestions
  for (let i = 0; i < suggestions; i += 1)
    keys.push({
      id: `s${i}`,
      kind: 'suggestion',
      index: i,
      x: pad + i * sugW,
      y: top,
      w: sugW,
      h: rowH,
    })
  // Letras: 10 columnas; la fila corta se centra.
  const cellW = innerW / 10
  ROWS.forEach((row, r) => {
    const offset = (10 - row.length) / 2
    ;[...row].forEach((letter, c) => {
      keys.push({
        id: `k:${letter}`,
        kind: 'letter',
        value: letter,
        x: pad + (offset + c) * cellW,
        y: top + (r + 1) * rowH,
        w: cellW,
        h: rowH,
      })
    })
  })
  const totalSpan = ACTIONS.reduce((sum, a) => sum + a.span, 0)
  let x = pad
  for (const action of ACTIONS) {
    const w = (innerW * action.span) / totalSpan
    keys.push({
      id: `a:${action.id}`,
      kind: 'action',
      value: action.id,
      label: action.label,
      x,
      y: top + 4 * rowH,
      w,
      h: rowH,
    })
    x += w
  }
  return { width, height, pad, textH, rowH, keys }
}

const inside = (key, point, margin) => {
  const m = Math.min(key.w, key.h) * margin
  return (
    point.x >= key.x - m &&
    point.x <= key.x + key.w + m &&
    point.y >= key.y - m &&
    point.y <= key.y + key.h + m
  )
}

/**
 * Tecla bajo el punto (píxeles de la ventana) con histéresis: la tecla actual se conserva mientras el
 * punto no salga de ella más HOLD_MARGIN; una tecla nueva exige entrar en su parte central.
 * `isEnabled(key)` excluye huecos vacíos (p. ej. sugerencias sin palabra).
 */
export function hitTest(keys, point, currentId = null, isEnabled = () => true) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  if (currentId) {
    const current = keys.find((k) => k.id === currentId)
    if (current && isEnabled(current) && inside(current, point, HOLD_MARGIN)) return currentId
  }
  const hit = keys.find((k) => isEnabled(k) && inside(k, point, -INNER_MARGIN))
  return hit ? hit.id : null
}

export const createDwell = () => ({ key: null, since: 0, fired: false, lostAt: null })

/**
 * Un paso de la máquina de permanencia.
 * @param {object} state estado previo (`createDwell()`)
 * @param {string|null} keyId tecla bajo el cursor ahora (o null)
 * @param {number} now marca de tiempo en ms
 * @param {(id:string)=>number} needMs espera necesaria para esa tecla
 * @returns {{state:object, fire:string|null, progress:number}}
 */
export function stepDwell(state, keyId, now, needMs) {
  if (keyId === null) {
    if (state.key === null) return { state, fire: null, progress: 0 }
    // Hueco breve (mano perdida un fotograma): se conserva la tecla sin avanzar.
    if (state.lostAt === null)
      return {
        state: { ...state, lostAt: now },
        fire: null,
        progress: progressOf(state, state.lostAt, needMs),
      }
    if (now - state.lostAt <= GRACE_MS)
      return { state, fire: null, progress: progressOf(state, state.lostAt, needMs) }
    return { state: createDwell(), fire: null, progress: 0 }
  }
  if (keyId !== state.key)
    return {
      state: { key: keyId, since: now, fired: false, lostAt: null },
      fire: null,
      progress: 0,
    }
  // De vuelta tras un hueco: el tiempo sin cursor no cuenta.
  const since = state.lostAt === null ? state.since : state.since + (now - state.lostAt)
  const current = { ...state, since, lostAt: null }
  if (current.fired) return { state: current, fire: null, progress: 1 }
  const need = needMs(keyId)
  if (now - since >= need) return { state: { ...current, fired: true }, fire: keyId, progress: 1 }
  return { state: current, fire: null, progress: Math.max(0, (now - since) / need) }
}

function progressOf(state, at, needMs) {
  if (state.fired) return 1
  return Math.min(1, Math.max(0, (at - state.since) / needMs(state.key)))
}

/** Espera por tipo de tecla: las acciones (borrar, buscar…) piden algo más para no dispararse de paso. */
export const needFor = (keys) => {
  const kinds = new Map(keys.map((k) => [k.id, k.kind]))
  return (id) => DWELL_MS[kinds.get(id)] ?? DWELL_MS.letter
}

/**
 * Un clic (pinza) sobre una tecla: la marca como escrita para la permanencia y dice si hay que escribirla.
 * Se ignora si esa misma tecla acaba de escribirse por permanencia (la pinza llega tarde): sin duplicados.
 */
export function clickKey(state, keyId, now, lastFire) {
  const duplicate = lastFire && lastFire.id === keyId && now - lastFire.at < CLICK_AFTER_DWELL_MS
  return { state: { key: keyId, since: now, fired: true, lostAt: null }, write: !duplicate }
}

/** Punto del cursor (telemetría normalizada a la pantalla virtual) en píxeles de la ventana. */
export function cursorInWindow(status, ctx) {
  if (!ctx?.screen || !ctx?.rect) return null
  const nx = Number(status?.cursorX),
    ny = Number(status?.cursorY)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null
  return {
    x: ctx.screen.left + nx * ctx.screen.width - ctx.rect.x,
    y: ctx.screen.top + ny * ctx.screen.height - ctx.rect.y,
  }
}
