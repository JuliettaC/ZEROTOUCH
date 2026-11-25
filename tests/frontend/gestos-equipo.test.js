import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultState, getEffectiveSettings, getActiveAssignments, normalizeDevice, updateActiveSettings } from '../../src/data/preferences.js'
import { buildEngineConfig } from '../../src/engine/engineConfig.js'
import { appliedMatches } from '../../src/engine/engineApply.js'
import { describeEvent } from '../../src/engine/appEvents.js'
import { gestures } from '../../src/data/gestures.js'
import { GESTURE_MATCH } from '../../src/data/engineStatus.js'

// Gestos locales del equipo para PC: clic derecho (pinza con el medio), Alt+Tab y pestaña nueva (V sostenida).
// No se sincronizan ni pasan por la API: son ajustes del equipo. El 24-11-2026 se retiraron los de ventana (tres dedos
// y golpe de muñeca), pestañas, dictado, ☝️ sostenido y desplazar con la mano abierta.
const RETIRADOS = ['windowGestures', 'windowSwipe', 'tabGestures', 'dictation', 'keyboardGesture', 'openHandScroll']

test('el clic derecho viene activado y se apaga por equipo, sin tocar los modos', () => {
  const state = createDefaultState()
  assert.equal(getEffectiveSettings(state).rightClick, true)
  const next = updateActiveSettings(state, { rightClick: false })
  assert.equal(next.device.rightClick, false, 'es un ajuste del equipo, no del modo')
  assert.deepEqual(next.modes, state.modes, 'no cambia ningún modo sincronizable')
  assert.equal(gestures.rightClick.toggle, 'rightClick')
  assert.deepEqual(GESTURE_MATCH.rightClick, ['PINZA_MEDIO', 'RIGHT_CLICK'])
})

test('los gestos retirados desaparecen de las preferencias guardadas, de la configuración del motor y de la lista', () => {
  const saved = Object.fromEntries(RETIRADOS.map((key) => [key, true]))
  const device = normalizeDevice({ preferredHand: 'LEFT', ...saved })
  for (const key of RETIRADOS) assert.equal(key in device, false, `${key} se descarta al leer`)
  assert.equal(device.preferredHand, 'LEFT', 'el resto de la preferencia se conserva')
  const state = createDefaultState()
  const desired = buildEngineConfig(getEffectiveSettings(state), getActiveAssignments(state))
  for (const key of RETIRADOS) assert.equal(key in desired, false, `${key} no se envía al motor`)
  for (const id of ['threeFingers', 'windowSwipe', 'tabs', 'dictation', 'keyboard', 'openHandScroll'])
    assert.equal(gestures[id], undefined, `${id} no aparece en la lista de gestos`)
  for (const code of ['THREE', 'TRES_DEDOS', 'PESTANAS', 'DICTADO', 'TECLADO', 'SCROLL_MANO'])
    assert.ok(!Object.values(GESTURE_MATCH).flat().includes(code), code)
  for (const event of ['NEXT_TAB', 'PREV_TAB', 'DICTATION', 'MINIMIZE_WINDOW', 'RESTORE_WINDOW'])
    assert.equal(describeEvent({ seq: 1, event, injected: true }), null, `${event} ya no tiene aviso`)
})

test('la configuración enviada al motor incluye los interruptores del equipo y su cambio exige confirmación', () => {
  const state = updateActiveSettings(createDefaultState(), { rightClick: false })
  const desired = buildEngineConfig(getEffectiveSettings(state), getActiveAssignments(state))
  assert.equal(desired.rightClick, false)
  assert.equal(desired.altTab, true)
  assert.equal(appliedMatches(desired, { ...desired, rightClick: true }), false)
  assert.equal(appliedMatches(desired, { ...desired }), true)
})

test('QA de comodidad: aceleración del cursor encendida por defecto y ajuste del equipo', () => {
  const state = createDefaultState()
  const effective = getEffectiveSettings(state)
  assert.equal(effective.pointerAcceleration, true)
  assert.equal(buildEngineConfig(effective, getActiveAssignments(state)).pointerAcceleration, true)
  const off = updateActiveSettings(state, { pointerAcceleration: false })
  assert.equal(off.device.pointerAcceleration, false, 'ajuste del equipo')
})

test('Alt+Tab activado por defecto, se apaga por equipo, llega al motor y se anuncia', () => {
  const state = createDefaultState()
  assert.equal(getEffectiveSettings(state).altTab, true)
  const off = updateActiveSettings(state, { altTab: false })
  assert.equal(buildEngineConfig(getEffectiveSettings(off), getActiveAssignments(off)).altTab, false)
  assert.equal(gestures.altTab.toggle, 'altTab')
  assert.doesNotMatch(gestures.altTab.instruction, /dictado/, 'ya no remite al gesto retirado')
  assert.match(describeEvent({ seq: 1, event: 'ALT_TAB', injected: true }).text, /Alt \+ Tab/)
})

test('pestaña nueva con la V: activada por defecto, del equipo (no sincroniza), llega al motor y se anuncia', () => {
  const state = createDefaultState()
  assert.equal(getEffectiveSettings(state).newTab, true)
  const off = updateActiveSettings(state, { newTab: false })
  assert.equal(off.device.newTab, false, 'es un ajuste del equipo')
  assert.deepEqual(off.modes, state.modes)
  assert.equal(buildEngineConfig(getEffectiveSettings(off), getActiveAssignments(off)).newTab, false)
  assert.equal(normalizeDevice({}).newTab, true, 'una preferencia guardada antes del gesto lo recibe activado')
  assert.equal(gestures.newTab.toggle, 'newTab')
  assert.match(describeEvent({ seq: 1, event: 'NEW_TAB', injected: true }).text, /Pestaña nueva/)
  assert.match(describeEvent({ seq: 2, event: 'NEW_TAB', injected: false }).text, /Controlar/)
})
