import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LETTERS, keyboardGeometry, letterAt, toKeyUnits } from '../../src/airswipe/layout.js'
import { buildIndex, idealPath } from '../../src/airswipe/decoder.js'
import { afterSend, createKeyboardState, discard, ingest, pick, resetSession, runEffects } from '../../src/airswipe/keyboard.js'
import { HEARTBEAT_KEY, STALE_AFTER_MS, clearHeartbeat, heartbeatFresh, writeHeartbeat } from '../../src/airswipe/link.js'

const lexicon = JSON.parse(readFileSync(new URL('../../src/airswipe/lexico-es.json', import.meta.url), 'utf8'))
const index = buildIndex(lexicon)

// Ventana de 1240×446 px físicos en un escritorio de 1920×1080 (como la que abre el puente).
const screen = { left: 0, top: 0, width: 1920, height: 1080 }
const rect = { x: 340, y: 620, width: 1240, height: 446 }
const geometry = keyboardGeometry(rect.width, rect.height)
const ctx = { index, screen, rect, geometry }

/** Trazo del motor (puntos normalizados de pantalla) que recorre las teclas de una palabra con pequeñas desviaciones. */
function engineTrace(word, jitter = 0.1) {
  const points = []
  let k = 0
  for (const unit of idealPath(word)) {
    for (let i = 0; i < 4; i += 1) {
      k += 1
      const x = unit.x + Math.sin(k) * jitter, y = unit.y + Math.cos(k * 1.3) * jitter
      const px = rect.x + geometry.originX + x * geometry.cell, py = rect.y + geometry.originY + y * geometry.cell
      points.push([Math.round(((px - screen.left) / screen.width) * 1e4) / 1e4, Math.round(((py - screen.top) / screen.height) * 1e4) / 1e4])
    }
  }
  return points
}
const traceEvent = (seq, word) => ({ type: 'EVENT', seq, event: 'AIRSWIPE_TRACE', points: engineTrace(word), length: 0.3, timestamp_ms: seq * 1000 })
const status = (events, eventSeq = events.at(-1)?.seq ?? 0) => ({ running: true, airswipe: true, mode: 'CONTROL', eventSeq, recentEvents: events })

test('la geometría reserva la franja superior y cada tecla se reconoce en su sitio', () => {
  assert.ok(geometry.bar > 0 && geometry.bar < rect.height / 2)
  for (const letter of LETTERS) {
    const r = geometry.rects[letter]
    assert.ok(r.y >= geometry.bar, `${letter} queda bajo la franja de propuestas`)
    assert.ok(r.x >= 0 && r.x + r.w <= rect.width && r.y + r.h <= rect.height, `${letter} cabe en la ventana`)
    assert.equal(letterAt(toKeyUnits({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, geometry)), letter)
  }
})

test('un trazo del motor genera una propuesta con la palabra y no escribe nada', () => {
  for (const word of ['hola', 'receta', 'mañana', 'pausar']) {
    const events = [traceEvent(1, word)]
    const { state, effects } = ingest(createKeyboardState(status([], 0)), status(events), ctx)
    assert.deepEqual(effects, [], 'proponer no escribe')
    assert.ok(state.pending, word)
    assert.ok(state.pending.candidates.slice(0, 3).includes(word), `${word}: ${state.pending.candidates.join(', ')}`)
    assert.ok(state.pending.candidates.length <= 5)
    assert.equal(state.pending.chosen, 0)
    assert.equal(state.baseline, 1)
  }
})

test('escribir exige confirmar: tocar un candidato o el evento CONFIRM, una sola vez', () => {
  let { state } = ingest(createKeyboardState(status([], 0)), status([traceEvent(1, 'hola')]), ctx)
  const chosen = state.pending.candidates[1]
  const picked = pick(state, 1)
  assert.deepEqual(picked.effects, [{ type: 'text', text: `${chosen} ` }])
  assert.equal(picked.state.pending, null)
  assert.deepEqual(pick(picked.state, 0).effects, [], 'sin propuesta no hay nada que escribir')

  const confirmed = ingest(state, status([traceEvent(1, 'hola'), { type: 'EVENT', seq: 2, event: 'CONFIRM' }]), ctx)
  assert.equal(confirmed.effects.length, 1)
  assert.equal(confirmed.effects[0].type, 'text')
  assert.equal(confirmed.effects[0].text, `${state.pending.candidates[0]} `)
  // Volver a procesar la misma telemetría no repite la escritura (los eventos se consumen por secuencia).
  const again = ingest(confirmed.state, status([traceEvent(1, 'hola'), { type: 'EVENT', seq: 2, event: 'CONFIRM' }]), ctx)
  assert.deepEqual(again.effects, [])
  // CONFIRM sin propuesta no escribe.
  assert.deepEqual(ingest(again.state, status([{ type: 'EVENT', seq: 3, event: 'CONFIRM' }]), ctx).effects, [])
})

test('CANCEL descarta, BACK/FORWARD recorren candidatos y sin propuesta equivalen a Borrar y Espacio', () => {
  let state = ingest(createKeyboardState(status([], 0)), status([traceEvent(1, 'hola')]), ctx).state
  const total = state.pending.candidates.length
  const step = (name, seq) => { const r = ingest(state, status([{ type: 'EVENT', seq, event: name }]), ctx); state = r.state; return r.effects }
  assert.deepEqual(step('FORWARD', 2), [])
  assert.equal(state.pending.chosen, 1)
  assert.deepEqual(step('BACK', 3), [])
  assert.deepEqual(step('BACK', 4), [])
  assert.equal(state.pending.chosen, total - 1, 'recorre en círculo')
  assert.deepEqual(step('CANCEL', 5), [])
  assert.equal(state.pending, null)
  assert.match(state.notice, /descartada/)
  assert.deepEqual(step('BACK', 6), [{ type: 'key', key: 'backspace' }])
  assert.deepEqual(step('FORWARD', 7), [{ type: 'key', key: 'space' }])
  assert.deepEqual(discard(state), state, 'descartar sin propuesta no cambia nada')
})

test('un trazo nuevo sustituye la propuesta; un trazo no válido o irreconocible no escribe', () => {
  let state = ingest(createKeyboardState(status([], 0)), status([traceEvent(1, 'hola')]), ctx).state
  const second = ingest(state, status([traceEvent(1, 'hola'), traceEvent(2, 'receta')]), ctx)
  assert.ok(second.state.pending.candidates.slice(0, 3).includes('receta'))
  assert.deepEqual(second.effects, [])
  const broken = [
    { type: 'EVENT', seq: 3, event: 'AIRSWIPE_TRACE', points: [[0.1, 0.1]] },
    { type: 'EVENT', seq: 4, event: 'AIRSWIPE_TRACE', points: [[0.1, 0.1], [0.2, 'x'], [0.3, 0.3], [0.4, 0.4]] },
    { type: 'EVENT', seq: 5, event: 'AIRSWIPE_TRACE', points: Array.from({ length: 601 }, () => [0.5, 0.5]) },
    { type: 'EVENT', seq: 6, event: 'AIRSWIPE_TRACE' },
  ]
  const ignored = ingest(second.state, status(broken), ctx)
  assert.deepEqual(ignored.effects, [])
  assert.deepEqual(ignored.state.pending, second.state.pending, 'los trazos inválidos no cambian la propuesta')
  assert.equal(ignored.state.baseline, 6, 'pero sí se consumen')
  const far = { type: 'EVENT', seq: 7, event: 'AIRSWIPE_TRACE', points: [[0.01, 0.01], [0.02, 0.02], [0.03, 0.02], [0.04, 0.03]] }
  const unknown = ingest(second.state, status([far]), ctx)
  assert.equal(unknown.state.pending, null)
  assert.match(unknown.state.notice, /Repite el trazo/)
})

test('los eventos anteriores a la sesión no se aplican y un reinicio del motor empieza de cero', () => {
  const old = [traceEvent(3, 'hola'), { type: 'EVENT', seq: 4, event: 'CONFIRM' }, { type: 'EVENT', seq: 5, event: 'FORWARD' }]
  const session = createKeyboardState(status(old, 5))
  assert.equal(session.baseline, 5)
  assert.deepEqual(ingest(session, status(old, 5), ctx), { state: session, effects: [] }, 'lo anterior al arranque se ignora')
  const fresh = ingest(session, status([...old, { type: 'EVENT', seq: 6, event: 'FORWARD' }], 6), ctx)
  assert.deepEqual(fresh.effects, [{ type: 'key', key: 'space' }])
  // El motor se reinició: la secuencia vuelve a 1 y no debe quedar ignorada.
  const busy = { baseline: 40, pending: { candidates: ['viejo'], chosen: 0 }, notice: '' }
  const restarted = ingest(busy, status([traceEvent(1, 'hola')], 1), ctx)
  assert.ok(restarted.state.pending.candidates.slice(0, 3).includes('hola'))
  assert.ok(!restarted.state.pending.candidates.includes('viejo'), 'la propuesta de la sesión anterior se descartó')
  const reset = resetSession(busy, status(old, 5), 'Aviso')
  assert.deepEqual(reset, { baseline: 5, pending: null, notice: 'Aviso' })
})

test('un rechazo de sesión descarta la propuesta y lo encolado; otros errores solo avisan', () => {
  const pendingState = { baseline: 2, pending: { candidates: ['hola'], chosen: 0 }, notice: '' }
  const live = status([], 9)
  const discarded = afterSend(pendingState, { ok: false, discard: true, code: 'CONTROL_REQUIRED', message: 'Activa el modo Controlar para escribir.' }, live)
  assert.deepEqual(discarded, { baseline: 9, pending: null, notice: 'Activa el modo Controlar para escribir.' })
  const other = afterSend(pendingState, { ok: false, discard: false, code: 'TEXT_INVALID', message: 'Texto no válido.' }, live)
  assert.deepEqual(other.pending, pendingState.pending)
  assert.equal(other.notice, 'Texto no válido.')
  assert.equal(afterSend(pendingState, { ok: true }, live), pendingState)
})

test('los efectos se envían en orden, una sola vez, y se detienen en el primer fallo', async () => {
  const calls = []
  const api = {
    engineTypeText: async text => { calls.push(['text', text]) },
    enginePressKey: async key => { calls.push(['key', key]); if (key === 'enter') throw { code: 'INTERACTION_PAUSED', message: 'En pausa' } },
  }
  const ok = await runEffects(api, [{ type: 'text', text: 'hola ' }, { type: 'key', key: 'space' }])
  assert.deepEqual(ok, { ok: true })
  assert.deepEqual(calls, [['text', 'hola '], ['key', 'space']])
  calls.length = 0
  const stopped = await runEffects(api, [{ type: 'key', key: 'enter' }, { type: 'text', text: 'no debe salir ' }])
  assert.deepEqual([stopped.ok, stopped.discard, stopped.code], [false, true, 'INTERACTION_PAUSED'])
  assert.deepEqual(calls, [['key', 'enter']], 'tras el rechazo no se envía nada más ni se reintenta')
  assert.deepEqual(await runEffects(api, []), { ok: true })
})

test('el latido entre ventanas caduca, se borra y no guarda texto', () => {
  const map = new Map()
  const storage = { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }
  assert.equal(heartbeatFresh(storage, 10_000), false, 'sin latido no hay teclado')
  assert.equal(writeHeartbeat(storage, 10_000), true)
  assert.equal(heartbeatFresh(storage, 10_000 + STALE_AFTER_MS), true)
  assert.equal(heartbeatFresh(storage, 10_000 + STALE_AFTER_MS + 1), false, 'caduca si la ventana se cuelga o se cierra')
  assert.equal(heartbeatFresh(storage, 9_000), false, 'un reloj hacia atrás no cuenta como fresco')
  assert.deepEqual([...map.keys()], [HEARTBEAT_KEY])
  assert.match(map.get(HEARTBEAT_KEY), /^\d+$/, 'solo una marca de tiempo')
  clearHeartbeat(storage)
  assert.equal(heartbeatFresh(storage, 10_001), false)
  const broken = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') }, removeItem: () => { throw new Error('bloqueado') } }
  assert.deepEqual([writeHeartbeat(broken), clearHeartbeat(broken), heartbeatFresh(broken)], [false, false, false])
})
