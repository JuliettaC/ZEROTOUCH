import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APPLY, appliedMatches, applyState, shouldSend } from '../../src/engine/engineApply.js'
import { buildEngineConfig, configKey } from '../../src/engine/engineConfig.js'
import { createDefaultState, getActiveAssignments, getEffectiveSettings, setAssignment, updateActiveSettings } from '../../src/data/preferences.js'

// Pares «deseada → aplicada» producidos por el validador real del motor (EngineConfig.from_dict().to_dict()),
// fuera de este proceso. Si cambian el contrato o buildEngineConfig, regenerar y revisar la diferencia.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/engine-applied.json', import.meta.url), 'utf8'))
const desiredFor = state => buildEngineConfig(getEffectiveSettings(state), getActiveAssignments(state))

test('la configuración de la interfaz coincide con la que devuelve el motor real (valores por defecto y personalizados)', () => {
  for (const name of ['default', 'custom']) {
    const { desired, applied } = fixture[name]
    assert.equal(appliedMatches(desired, applied), true, name)
  }
  const defaults = desiredFor(createDefaultState())
  assert.equal(configKey(defaults), configKey(fixture.default.desired), 'la interfaz sigue generando lo que se probó contra el motor')
})

test('una diferencia real se detecta como no aplicada', () => {
  const { desired, applied } = fixture.custom
  assert.equal(appliedMatches({ ...desired, sensitivity: desired.sensitivity + 1 }, applied), false)
  assert.equal(appliedMatches({ ...desired, rightClick: !desired.rightClick }, applied), false)
  assert.equal(appliedMatches({ ...desired, gestos: { ...desired.gestos, palma_abierta: { accion: 'atras', habilitado: true } } }, applied), false)
  assert.equal(appliedMatches(desired, { ...applied, gaze: { ...applied.gaze, calibration: null } }), false)
  assert.equal(appliedMatches(desired, null), false)
  assert.equal(appliedMatches(desired, {}), false)
})

test('el estado pasa por sin motor → pendiente → aplicada y recuerda el rechazo de esa clave', () => {
  const state = createDefaultState()
  const desired = desiredFor(state)
  const off = applyState({ desired, engineStatus: { running: false } })
  assert.equal(off.state, APPLY.NO_ENGINE)
  assert.equal(shouldSend(off), false)

  const starting = applyState({ desired, engineStatus: { running: true, appliedConfig: null } })
  assert.equal(starting.state, APPLY.STARTING, 'sin READY no se envía nada')
  assert.equal(shouldSend(starting), false)

  const pending = applyState({ desired, engineStatus: { running: true, appliedConfig: {} } })
  assert.equal(pending.state, APPLY.PENDING)
  assert.equal(shouldSend(pending), true)

  const sending = applyState({ desired, engineStatus: { running: true, appliedConfig: {} }, sendingKey: pending.key })
  assert.equal(sending.state, APPLY.SENDING)
  assert.equal(shouldSend(sending), false, 'no se reenvía mientras hay un envío en curso')

  const applied = applyState({ desired, engineStatus: { running: true, appliedConfig: fixture.default.applied } })
  assert.equal(applied.state, APPLY.APPLIED)
  assert.equal(shouldSend(applied), false)

  const rejection = { key: pending.key, code: 'FIELD_INVALID', message: 'Rango fuera de límites.' }
  const rejected = applyState({ desired, engineStatus: { running: true, appliedConfig: {} }, rejection })
  assert.deepEqual([rejected.state, rejected.code, rejected.message], [APPLY.REJECTED, 'FIELD_INVALID', 'Rango fuera de límites.'])
  assert.equal(shouldSend(rejected), false, 'un rechazo no se reintenta en bucle')

  // Cambiar la configuración deja atrás el rechazo anterior y vuelve a intentarlo una vez.
  const edited = desiredFor(updateActiveSettings(state, { sensitivity: 12 }))
  const retry = applyState({ desired: edited, engineStatus: { running: true, appliedConfig: fixture.default.applied }, rejection })
  assert.equal(retry.state, APPLY.PENDING)
  assert.equal(shouldSend(retry), true)
})

test('desactivar un interruptor o reasignar un gesto cambia la clave y exige confirmación nueva', () => {
  const state = createDefaultState()
  const base = desiredFor(state)
  const withoutPinch = desiredFor(updateActiveSettings(state, { pinch: false }))
  const remapped = desiredFor(setAssignment(state, state.activeModeId, 'palma_abierta', { accion: 'multimedia_play_pause', habilitado: true }))
  assert.notEqual(configKey(base), configKey(withoutPinch))
  assert.notEqual(configKey(base), configKey(remapped))
  const status = { running: true, appliedConfig: fixture.default.applied }
  assert.equal(applyState({ desired: base, engineStatus: status }).state, APPLY.APPLIED)
  assert.equal(applyState({ desired: withoutPinch, engineStatus: status }).state, APPLY.PENDING)
  assert.equal(applyState({ desired: remapped, engineStatus: status }).state, APPLY.PENDING)
})
