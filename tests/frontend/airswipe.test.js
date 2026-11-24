import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KEY_CENTERS, keyRects, letterAt, toKeyUnits, LETTERS } from '../../src/airswipe/layout.js'
import { buildIndex, decode, idealPath, resample, traceToKeyUnits } from '../../src/airswipe/decoder.js'

const lexicon = JSON.parse(readFileSync(new URL('../../src/airswipe/lexico-es.json', import.meta.url), 'utf8'))
const index = buildIndex(lexicon)

/** Trazo sintético: recorrido por los centros de las letras con pequeñas desviaciones. */
function traceFor(word, jitter = 0.12) {
  const points = []
  let k = 0
  for (const point of idealPath(word)) {
    for (let i = 0; i < 4; i += 1) {
      k += 1
      points.push({ x: point.x + Math.sin(k) * jitter, y: point.y + Math.cos(k * 1.3) * jitter })
    }
  }
  return points
}

test('el léxico es local, en español, con ñ y acentos, y tiene licencia documentada', () => {
  assert.ok(lexicon.palabras.length > 20000)
  assert.equal(lexicon.palabras.length, lexicon.pesos.length)
  assert.ok(lexicon.palabras.includes('año') && lexicon.palabras.includes('niño'))
  assert.ok(lexicon.palabras.includes('también') && lexicon.palabras.includes('después'))
  assert.match(lexicon.meta.licencia, /MIT/)
  assert.ok(lexicon.palabras.every(w => /^[a-záéíóúüñ]+$/.test(w)))
})

test('la distribución tiene las 27 letras con la ñ en su fila y sabe qué tecla hay bajo un punto', () => {
  assert.equal(LETTERS.length, 27)
  assert.ok(KEY_CENTERS.ñ.x > KEY_CENTERS.l.x && KEY_CENTERS.ñ.y === KEY_CENTERS.a.y)
  const geometry = keyRects(1000, 300, 10)
  const center = geometry.rects.g
  const unit = toKeyUnits({ x: center.x + center.w / 2, y: center.y + center.h / 2 }, geometry)
  assert.equal(letterAt(unit), 'g')
  assert.equal(letterAt({ x: -5, y: -5 }), null)
})

test('un trazo que recorre las teclas de una palabra la propone entre los primeros candidatos', () => {
  // Nota: la lista de pyspellchecker omite palabras comunes (p. ej. «gracias»); ver PROGRESO.md.
  for (const word of ['hola', 'gracia', 'mañana', 'receta', 'pausar', 'niño', 'tiempo']) {
    const candidates = decode(traceFor(word), index)
    const words = candidates.map(c => c.word)
    assert.ok(words.slice(0, 3).includes(word), `${word}: ${words.join(', ')}`)
  }
})

test('los acentos salen del léxico aunque el trazo pase por la tecla base', () => {
  const candidates = decode(traceFor('también'), index).map(c => c.word)
  assert.ok(candidates.slice(0, 3).includes('también'), candidates.join(', '))
  const que = decode(traceFor('que'), index).map(c => c.word)
  assert.ok(que.includes('que'))
})

test('un trazo degenerado no propone nada y el remuestreo es estable', () => {
  assert.deepEqual(decode([], index), [])
  assert.deepEqual(decode([{ x: 1, y: 1 }], index), [])
  const sampled = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 11)
  assert.equal(sampled.length, 11)
  assert.ok(Math.abs(sampled[5].x - 5) < 1e-9)
})

test('los puntos normalizados del motor se convierten a unidades de tecla con la geometría de la ventana', () => {
  const screen = { left: 0, top: 0, width: 1920, height: 1080 }
  const rect = { x: 460, y: 700, width: 1000, height: 300 }
  const geometry = keyRects(rect.width, rect.height, 10)
  const target = geometry.rects.q
  const px = rect.x + target.x + target.w / 2, py = rect.y + target.y + target.h / 2
  const units = traceToKeyUnits([[px / screen.width, py / screen.height]], { screen, rect, geometry })
  assert.equal(letterAt(units[0]), 'q')
})
