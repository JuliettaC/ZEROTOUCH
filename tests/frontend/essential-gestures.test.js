import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultState, getEffectiveSettings, getActiveAssignments, settingsPatch, updateActiveSettings } from '../../src/data/preferences.js'
import { buildEngineConfig } from '../../src/engine/engineConfig.js'
import { ESSENTIAL_OFF, ESSENTIAL_ON, usesEssentialGestures, withEssentialGestures } from '../../src/data/essentialGestures.js'

// Mismo camino que el botón de Calibrar: settingsPatch → updateActiveSettings → configuración del motor.
const apply = (state) => {
  const settings = getEffectiveSettings(state)
  return updateActiveSettings(state, settingsPatch(settings, withEssentialGestures(settings)))
}

test('«solo gestos esenciales» deja mover, clic, desplazar, pausar y el trazo, y apaga el resto en el motor', () => {
  const state = apply(createDefaultState())
  const settings = getEffectiveSettings(state)
  for (const key of ESSENTIAL_OFF) assert.equal(settings[key], false, `${key} apagado`)
  for (const key of ESSENTIAL_ON) assert.notEqual(settings[key], false, `${key} encendido`)
  assert.equal(usesEssentialGestures(settings), true)
  const config = buildEngineConfig(settings, getActiveAssignments(state))
  for (const key of ['drag', 'rightClick', 'palm'])
    assert.equal(config[key], false, `el motor recibe ${key} = false`)
  for (const key of ['pointer', 'pinch', 'scroll', 'fistPause', 'airswipe'])
    assert.equal(config[key], true, `el motor recibe ${key} = true`)
})

test('cada interruptor del conjunto existe de verdad (un nombre mal escrito no se guardaría)', () => {
  const settings = getEffectiveSettings(createDefaultState())
  for (const key of [...ESSENTIAL_ON, ...ESSENTIAL_OFF]) assert.ok(key in settings, `${key} es un ajuste conocido`)
  assert.equal(usesEssentialGestures(settings), false, 'por defecto no está aplicado')
})

test('aplicarlo dos veces no cambia nada más (idempotente)', () => {
  const once = apply(createDefaultState())
  const settings = getEffectiveSettings(once)
  assert.deepEqual(settingsPatch(settings, withEssentialGestures(settings)), {})
})
