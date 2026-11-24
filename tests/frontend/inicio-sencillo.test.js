import test from 'node:test'
import assert from 'node:assert/strict'
import { CAMERA_WAIT_MS, QUICK_START_MESSAGES, cameraReadiness, quickStartError, quickStartPlan, readMinimizeOnStart, writeMinimizeOnStart } from '../../src/engine/quickStart.js'
import { BASIC_GESTURES, ONBOARDING_KEY, STEPS, markOnboardingDone, needsOnboarding, nextStep, practiceProgress, previousStep, readOnboarding, resetOnboarding } from '../../src/onboarding/onboarding.js'
import { DEFAULT_ENGINE_STATUS } from '../../src/data/engineStatus.js'

const memory = () => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }
const blocked = { getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') }, removeItem() { throw new Error('bloqueado') } }
const live = patch => ({ ...DEFAULT_ENGINE_STATUS, running: true, cameraOpen: true, handDetected: true, ...patch })

// ------------------------------------------------------------------ Empezar en una acción
test('Empezar: desde apagado enciende la cámara y luego pide el control', () => {
  assert.deepEqual(quickStartPlan(DEFAULT_ENGINE_STATUS), ['start', 'control'])
  assert.deepEqual(quickStartPlan(live({ mode: 'OBSERVATION' })), ['control'], 'con la cámara ya encendida solo falta el control')
  assert.deepEqual(quickStartPlan(live({ mode: 'CONTROL' })), [], 'si ya controla no hace nada')
  assert.deepEqual(quickStartPlan(live({ emergencyStopped: true })), ['stop', 'start', 'control'], 'tras una parada de emergencia reinicia la cámara')
  assert.deepEqual(quickStartPlan(undefined), ['start', 'control'])
})

test('Empezar espera a que la cámara esté abierta y no espera para siempre', () => {
  assert.equal(cameraReadiness(live(), 0), 'ready')
  assert.equal(cameraReadiness(live({ cameraOpen: false }), 100), 'wait')
  assert.equal(cameraReadiness(live({ cameraOpen: false }), CAMERA_WAIT_MS), 'timeout', 'la cámara 9 (inexistente) termina en aviso, no en éxito')
  assert.equal(cameraReadiness(DEFAULT_ENGINE_STATUS, 0), 'stopped')
})

test('los rechazos del motor se explican con su causa real', () => {
  assert.equal(quickStartError({ code: 'CAMERA_NOT_OPEN' }), QUICK_START_MESSAGES.cameraTimeout)
  assert.match(quickStartError({ code: 'EMERGENCY_HOTKEY_UNAVAILABLE' }), /Ctrl\+Alt\+Z/)
  assert.equal(quickStartError({ code: 'OTRO', message: 'Detalle del puente' }), 'Detalle del puente')
  assert.match(quickStartError(undefined), /No se pudo empezar/)
})

test('minimizar al empezar viene activado y se puede apagar por equipo', () => {
  const storage = memory()
  assert.equal(readMinimizeOnStart(storage), true)
  assert.equal(writeMinimizeOnStart(storage, false), true)
  assert.equal(readMinimizeOnStart(storage), false)
  assert.equal(readMinimizeOnStart(blocked), true)
  assert.equal(writeMinimizeOnStart(blocked, false), false)
})

// ------------------------------------------------------------------ Primera vez
test('el asistente se muestra solo hasta completarlo o saltarlo, una vez por equipo', () => {
  const storage = memory()
  assert.equal(needsOnboarding(storage), true)
  assert.equal(markOnboardingDone(storage, Date.UTC(2026, 10, 21)), true)
  assert.equal(needsOnboarding(storage), false)
  assert.equal(JSON.parse(storage.m.get(ONBOARDING_KEY)).at, '2026-11-21T00:00:00.000Z')
  assert.equal(resetOnboarding(storage), true, '«Repetir la configuración inicial» desde Ajustes')
  assert.equal(needsOnboarding(storage), true)
  markOnboardingDone(storage, Date.now(), { skipped: true })
  assert.equal(JSON.parse(storage.m.get(ONBOARDING_KEY)).skipped, true)
  assert.equal(readOnboarding(storage).done, true)
})

test('un valor dañado, de otra versión o un almacenamiento bloqueado vuelven a mostrar el asistente', () => {
  const storage = memory()
  storage.m.set(ONBOARDING_KEY, '{no es json')
  assert.equal(needsOnboarding(storage), true)
  storage.m.set(ONBOARDING_KEY, JSON.stringify({ version: 99, done: true }))
  assert.equal(needsOnboarding(storage), true)
  assert.equal(needsOnboarding(blocked), true)
  assert.equal(markOnboardingDone(blocked), false)
})

test('los pasos avanzan y retroceden sin salirse', () => {
  assert.deepEqual(STEPS, ['camara', 'gestos'])
  assert.equal(nextStep('camara'), 'gestos')
  assert.equal(nextStep('gestos'), 'gestos')
  assert.equal(previousStep('camara'), 'camara')
  assert.equal(previousStep('gestos'), 'camara')
})

test('la práctica marca cada gesto reconocido y lo conserva', () => {
  let done = practiceProgress([], live({ gesture: 'POINTER' }))
  assert.deepEqual(done, ['pointer'])
  done = practiceProgress(done, live({ gesture: 'PINCH' }))
  assert.deepEqual(done, ['pointer', 'click'], 'el gesto anterior sigue marcado')
  done = practiceProgress(done, live({ gesture: 'SCROLL' }))
  done = practiceProgress(done, live({ gesture: 'PAUSE' }))
  assert.deepEqual(done, BASIC_GESTURES)
  assert.deepEqual(practiceProgress([], { ...live({ gesture: 'POINTER' }), handDetected: false }), [], 'sin mano no cuenta')
  assert.deepEqual(practiceProgress([], { ...DEFAULT_ENGINE_STATUS, gesture: 'PINCH' }), [], 'con la cámara apagada no cuenta')
  assert.deepEqual(practiceProgress([], live({ gesture: 'PINCH' }), ['pointer', 'scroll', 'pause']), [], 'un gesto apagado en los ajustes no se cuenta')
})
