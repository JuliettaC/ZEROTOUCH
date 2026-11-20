import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultState, getEffectiveSettings, getActiveAssignments, normalizeDevice, updateActiveSettings } from '../../src/data/preferences.js'
import { buildEngineConfig } from '../../src/engine/engineConfig.js'
import { appliedMatches } from '../../src/engine/engineApply.js'
import { describeEvent } from '../../src/engine/appEvents.js'
import { gestures } from '../../src/data/gestures.js'
import { GESTURE_MATCH } from '../../src/data/engineStatus.js'

// Gestos locales del equipo para PC: pulgar y meñique (pestañas) y pinza con el medio (clic derecho).
// No se sincronizan ni pasan por la API: son ajustes del equipo, como los gestos de ventana.

test('los gestos de pestañas y clic derecho vienen activados y se pueden apagar por equipo', () => {
  const state = createDefaultState()
  assert.equal(getEffectiveSettings(state).tabGestures, true)
  assert.equal(getEffectiveSettings(state).rightClick, true)
  const next = updateActiveSettings(state, { tabGestures: false, rightClick: false })
  assert.equal(next.device.tabGestures, false, 'es un ajuste del equipo, no del modo')
  assert.equal(next.device.rightClick, false)
  assert.deepEqual(next.modes, state.modes, 'no cambia ningún modo sincronizable')
})

test('una preferencia guardada antes de estos gestos los recibe activados', () => {
  const device = normalizeDevice({ preferredHand: 'LEFT', windowGestures: true })
  assert.equal(device.tabGestures, true)
  assert.equal(device.rightClick, true)
  assert.equal(normalizeDevice({ tabGestures: 'no' }).tabGestures, true, 'un valor no booleano se descarta')
})

test('la configuración enviada al motor incluye ambos interruptores y su cambio exige confirmación', () => {
  const state = updateActiveSettings(createDefaultState(), { tabGestures: false })
  const desired = buildEngineConfig(getEffectiveSettings(state), getActiveAssignments(state))
  assert.equal(desired.tabGestures, false)
  assert.equal(desired.rightClick, true)
  assert.equal(appliedMatches(desired, { ...desired, tabGestures: true }), false)
  assert.equal(appliedMatches(desired, { ...desired }), true)
})

test('la interfaz muestra los gestos, su telemetría y el aviso de pestaña', () => {
  assert.equal(gestures.tabs.toggle, 'tabGestures')
  assert.equal(gestures.rightClick.toggle, 'rightClick')
  assert.equal(gestures.tabs.code, undefined, 'no apunta a un gesto del catálogo sincronizado')
  assert.deepEqual(GESTURE_MATCH.tabs, ['PESTANAS'])
  assert.match(describeEvent({ event: 'NEXT_TAB', injected: true }).text, /Pestaña siguiente/)
  assert.equal(describeEvent({ event: 'PREV_TAB', injected: false }).tone, 'warn')
})

test('QA de comodidad: barrido vertical de ventanas apagado y aceleración del cursor encendida por defecto', () => {
  const state = createDefaultState()
  const effective = getEffectiveSettings(state)
  assert.equal(effective.windowSwipe, false, 'mover el cursor rápido hacia abajo minimizaba ventanas')
  assert.equal(effective.pointerAcceleration, true)
  const desired = buildEngineConfig(effective, getActiveAssignments(state))
  assert.equal(desired.windowSwipe, false)
  assert.equal(desired.pointerAcceleration, true)
  const off = updateActiveSettings(state, { pointerAcceleration: false })
  assert.equal(off.device.pointerAcceleration, false, 'ajuste del equipo')
  assert.equal(normalizeDevice({}).windowSwipe, false)
})
