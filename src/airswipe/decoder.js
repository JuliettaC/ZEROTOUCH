// Decodificador local de trazos Air-Swipe (sin red): compara la forma y la posición del trazo con
// el recorrido ideal de cada palabra sobre el teclado (en la línea de SHARK², Kristensson & Zhai,
// 2004) y pondera con la frecuencia de la palabra. Puro: sin DOM ni React.
import { KEY_CENTERS, baseLetter } from './layout.js'

export const SAMPLES = 24
const START_RADIUS = 1.6 // anchos de tecla alrededor del inicio y del final del trazo
const END_RADIUS = 1.6
const SHAPE_WEIGHT = 1.4
const LOCATION_WEIGHT = 1.0
const FREQUENCY_WEIGHT = 0.9
// Salvaguarda de coste, no un filtro: con 6000 se descartaban palabras comunes en grupos densos
// (p. ej. «gracias»: 7 290 candidatos con inicio en «g» y fin en «s»). Se mide en decodificar.test.
const MAX_CANDIDATES_SCANNED = 20000

/** Une el léxico base con la lista complementaria (propia) sin duplicar palabras: gana el mayor peso. */
export function withExtras(base, extra) {
  const words = [...(base.palabras || [])],
    weights = [...(base.pesos || [])]
  const position = new Map(words.map((word, i) => [word, i]))
  ;(extra?.palabras || []).forEach((word, i) => {
    const weight = extra.pesos?.[i] ?? 1
    if (position.has(word))
      weights[position.get(word)] = Math.max(weights[position.get(word)] ?? 1, weight)
    else {
      position.set(word, words.length)
      words.push(word)
      weights.push(weight)
    }
  })
  return { palabras: words, pesos: weights }
}

/** Índice del léxico: palabras agrupadas por letra base inicial, con recorridos precalculados. */
export function buildIndex(lexicon) {
  const words = lexicon.palabras || []
  const weights = lexicon.pesos || []
  const index = new Map()
  words.forEach((word, i) => {
    const path = idealPath(word)
    if (!path) return
    const first = baseLetter(word[0])
    if (!index.has(first)) index.set(first, [])
    index.get(first).push({
      word,
      weight: (weights[i] ?? 1) / 255,
      path,
      last: baseLetter(word[word.length - 1]),
    })
  })
  // Cada grupo se ordena por frecuencia: si algún día se alcanza el tope de candidatos, lo que se deja
  // fuera es lo menos frecuente, no lo último que se añadió al léxico.
  for (const entries of index.values()) entries.sort((a, b) => b.weight - a.weight)
  return { index, size: words.length }
}

/** Recorrido ideal: centros de las teclas de la palabra (sin letras repetidas consecutivas). */
export function idealPath(word) {
  const points = []
  let previous = null
  for (const letter of word) {
    const base = baseLetter(letter)
    const center = KEY_CENTERS[base]
    if (!center) return null
    if (base !== previous) points.push({ x: center.x, y: center.y })
    previous = base
  }
  return points
}

export function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i += 1)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

/** Remuestrea una polilínea a `n` puntos equiespaciados por longitud de arco. */
export function resample(points, n = SAMPLES) {
  if (!points.length) return []
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }))
  const total = pathLength(points)
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0] }))
  const step = total / (n - 1)
  const out = [{ ...points[0] }]
  let accumulated = 0,
    i = 1
  let current = { ...points[0] }
  while (out.length < n && i < points.length) {
    const next = points[i]
    const segment = Math.hypot(next.x - current.x, next.y - current.y)
    if (accumulated + segment >= step - 1e-9) {
      const t = (step - accumulated) / segment
      current = { x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t }
      out.push({ ...current })
      accumulated = 0
    } else {
      accumulated += segment
      current = { ...next }
      i += 1
    }
  }
  while (out.length < n) out.push({ ...points[points.length - 1] })
  return out
}

function normalizeShape(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  let scale = 0
  for (const p of points) scale = Math.max(scale, Math.hypot(p.x - cx, p.y - cy))
  scale = scale || 1
  return points.map((p) => ({ x: (p.x - cx) / scale, y: (p.y - cy) / scale }))
}

function meanDistance(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  return sum / a.length
}

/**
 * Decodifica un trazo (puntos en unidades de tecla) y devuelve candidatos ordenados.
 * @returns {{word:string, score:number}[]}
 */
export function decode(trace, index, { max = 5 } = {}) {
  if (!trace || trace.length < 2) return []
  const sampled = resample(trace, SAMPLES)
  const shape = normalizeShape(sampled)
  const start = trace[0],
    end = trace[trace.length - 1]
  const traceLength = pathLength(trace)
  const candidates = []
  let scanned = 0
  for (const [first, entries] of index.index) {
    const startCenter = KEY_CENTERS[first]
    if (Math.hypot(startCenter.x - start.x, startCenter.y - start.y) > START_RADIUS) continue
    for (const entry of entries) {
      const lastCenter = KEY_CENTERS[entry.last]
      if (Math.hypot(lastCenter.x - end.x, lastCenter.y - end.y) > END_RADIUS) continue
      scanned += 1
      if (scanned > MAX_CANDIDATES_SCANNED) break
      const ideal = resample(entry.path, SAMPLES)
      const location = meanDistance(sampled, ideal)
      const shapeDistance =
        entry.path.length > 1
          ? meanDistance(shape, normalizeShape(ideal))
          : Math.min(1, traceLength / 2)
      const score =
        LOCATION_WEIGHT * location + SHAPE_WEIGHT * shapeDistance - FREQUENCY_WEIGHT * entry.weight
      candidates.push({ word: entry.word, score })
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates.slice(0, max)
}

/** Trazo del motor (coordenadas normalizadas de pantalla) → unidades de tecla del panel. */
export function traceToKeyUnits(points, { screen, rect, geometry }) {
  return points.map(([nx, ny]) => {
    const px = screen.left + nx * screen.width - rect.x
    const py = screen.top + ny * screen.height - rect.y
    return {
      x: (px - geometry.originX) / geometry.cell,
      y: (py - geometry.originY) / geometry.cell,
    }
  })
}
