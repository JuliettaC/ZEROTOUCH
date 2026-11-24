import test from 'node:test'
import assert from 'node:assert/strict'
import { DISCARD_CODES, airswipeTransition, closeAirswipe, isOrphanedAirswipe, isSessionRejection, sendKey, sendText, typingBlocker } from '../../src/airswipe/session.js'

const ready = { running: true, airswipe: true, mode: 'CONTROL', emergencyStopped: false, paused: false, handDetected: true, gaze: { holding: false } }

test('los cinco rechazos de sesión se descartan y no se reintentan', async () => {
  for (const code of DISCARD_CODES) {
    let calls = 0
    const api = { engineTypeText: async () => { calls += 1; throw { code, message: 'rechazo del motor' } }, enginePressKey: async () => { calls += 1; throw { code, message: 'rechazo del motor' } } }
    const text = await sendText(api, 'hola')
    const key = await sendKey(api, 'enter')
    assert.deepEqual([text.ok, text.discard, text.code], [false, true, code])
    assert.deepEqual([key.ok, key.discard], [false, true])
    assert.equal(calls, 2, `${code}: un único intento por envío`)
    assert.ok(text.message.length > 0)
  }
  assert.equal(isSessionRejection({ code: 'TEXT_INVALID' }), false)
})

test('otros errores no se tratan como cierre de sesión y conservan el mensaje del puente', async () => {
  const api = { engineTypeText: async () => { throw { code: 'TEXT_INVALID', message: 'Texto no válido.' } }, enginePressKey: async () => {} }
  const bad = await sendText(api, 'x')
  assert.deepEqual([bad.ok, bad.discard, bad.code, bad.message], [false, false, 'TEXT_INVALID', 'Texto no válido.'])
  assert.deepEqual(await sendKey(api, 'space'), { ok: true })
})

test('el aviso previo sigue el orden de las compuertas del motor', () => {
  assert.equal(typingBlocker(ready), null)
  assert.equal(typingBlocker({ ...ready, running: false }), 'CONTROL_REQUIRED')
  assert.equal(typingBlocker({ ...ready, airswipe: false }), 'AIRSWIPE_INACTIVE')
  assert.equal(typingBlocker({ ...ready, mode: 'OBSERVATION' }), 'CONTROL_REQUIRED')
  assert.equal(typingBlocker({ ...ready, emergencyStopped: true }), 'CONTROL_REQUIRED')
  assert.equal(typingBlocker({ ...ready, paused: true }), 'INTERACTION_PAUSED')
  assert.equal(typingBlocker({ ...ready, gaze: { holding: true } }), 'GAZE_HOLD')
  assert.equal(typingBlocker({ ...ready, handDetected: false }), 'TRACKING_LOST')
  assert.equal(typingBlocker(undefined), 'CONTROL_REQUIRED')
})

test('parada de emergencia: limpia lo pendiente; reactivar CONTROL con ventana abierta vuelve a pedir el teclado', () => {
  const ui = { wantOpen: true, airswipeEnabled: true }
  const stopped = { ...ready, airswipe: false, emergencyStopped: true, mode: 'CONTROL' }
  const onStop = airswipeTransition(ready, stopped, ui)
  assert.deepEqual(onStop, { clearPending: true, reengage: false })
  const resumed = { ...ready, airswipe: false, emergencyStopped: false, mode: 'CONTROL' }
  assert.deepEqual(airswipeTransition(stopped, resumed, ui), { clearPending: true, reengage: true })
  assert.equal(airswipeTransition(stopped, resumed, { wantOpen: false, airswipeEnabled: true }).reengage, false, 'ventana cerrada: no se reabre')
  assert.equal(airswipeTransition(stopped, resumed, { wantOpen: true, airswipeEnabled: false }).reengage, false, 'trazo deshabilitado: no se reabre')
  assert.equal(airswipeTransition(stopped, { ...resumed, mode: 'OBSERVATION' }, ui).reengage, false, 'solo con CONTROL')
})

test('el motor apaga el teclado al deshabilitar el trazo o al detenerse: se limpia sin reabrir', () => {
  const ui = { wantOpen: true, airswipeEnabled: false }
  assert.deepEqual(airswipeTransition(ready, { ...ready, airswipe: false }, ui), { clearPending: true, reengage: false })
  assert.equal(airswipeTransition(ready, { ...ready, running: false, airswipe: false }, { wantOpen: true, airswipeEnabled: true }).clearPending, true)
  assert.equal(airswipeTransition(ready, { ...ready, mode: 'OBSERVATION' }, ui).clearPending, true)
  assert.deepEqual(airswipeTransition(ready, { ...ready, handDetected: false }, { wantOpen: true, airswipeEnabled: true }), { clearPending: false, reengage: false }, 'perder la mano no vacía el trazo de la sesión')
})

test('un modo teclado encendido sin teclado abierto en la interfaz está huérfano', () => {
  assert.equal(isOrphanedAirswipe({ running: true, airswipe: true }, false), true)
  assert.equal(isOrphanedAirswipe({ running: true, airswipe: true }, true), false)
  assert.equal(isOrphanedAirswipe({ running: true, airswipe: false }, false), false)
  assert.equal(isOrphanedAirswipe({ running: false, airswipe: true }, false), false, 'con el motor parado no hay nada que apagar')
  assert.equal(isOrphanedAirswipe(undefined, false), false)
})

test('cerrar el teclado apaga el motor y la ventana aunque uno de los dos falle', async () => {
  const calls = []
  const ok = await closeAirswipe({ engineAirswipe: async v => { calls.push(['engine', v]) }, airswipeWindowClose: async () => { calls.push(['window']) } })
  assert.deepEqual(ok, { engine: true, window: true })
  assert.deepEqual(calls, [['engine', false], ['window']], 'primero el motor, después la ventana')
  const noEngine = await closeAirswipe({ engineAirswipe: async () => { throw { code: 'ENGINE_NOT_RUNNING' } }, airswipeWindowClose: async () => { calls.push(['window2']) } })
  assert.deepEqual(noEngine, { engine: false, window: true })
  assert.deepEqual(calls.at(-1), ['window2'], 'la ventana se cierra aunque el motor no responda')
  const noWindow = await closeAirswipe({ engineAirswipe: async () => {}, airswipeWindowClose: async () => { throw { code: 'AIRSWIPE_WINDOW' } } })
  assert.deepEqual(noWindow, { engine: true, window: false })
})
