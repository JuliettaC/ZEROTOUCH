import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_LABELS, actionLabel, actionSignature, describeHud } from '../../src/hud/hudModel.js'
import { HUD_STORAGE_KEY, hudCommand, hudShouldBeOpen, readHudEnabled, writeHudEnabled } from '../../src/hud/hudWindow.js'
import { DEFAULT_ENGINE_STATUS } from '../../src/data/engineStatus.js'
import { readFileSync } from 'node:fs'

const running = patch => ({ ...DEFAULT_ENGINE_STATUS, running: true, cameraOpen: true, ...patch })

test('cada evento que el motor puede registrar como última acción tiene un texto', () => {
  // Los códigos salen del motor real: si se agrega un evento allí, esta prueba lo exige aquí.
  const source = readFileSync(new URL('../../motor-local/motor_local/interpreter.py', import.meta.url), 'utf8')
  const codes = [...source.matchAll(/^EVENT_[A-Z_]+ *= *"([A-Z_]+)"/gm)].map(m => m[1]).filter(code => code !== 'MOVE_CURSOR')
  assert.ok(codes.length >= 20, 'se leyeron los eventos del intérprete')
  for (const code of codes) assert.ok(ACTION_LABELS[code], `falta el texto de ${code}`)
  assert.equal(actionLabel('EMERGENCY_STOP'), 'Parada de emergencia')
  assert.equal(actionLabel('TYPE_TEXT'), 'Texto escrito')
  assert.equal(actionLabel('KEY_ENTER'), 'Tecla enter')
  assert.equal(actionLabel('NONE'), 'Ninguna todavía')
  assert.equal(actionLabel(undefined), 'Ninguna todavía')
  assert.equal(actionLabel('ALGO_NUEVO'), 'ALGO_NUEVO', 'un código desconocido se muestra tal cual, no se inventa')
})

test('el HUD muestra el estado real del motor y la última acción', () => {
  assert.deepEqual(describeHud(DEFAULT_ENGINE_STATUS), { tone: 'off', state: 'Cámara apagada', action: '', observing: false })
  const control = describeHud(running({ mode: 'CONTROL', pointerArmed: true, lastEvent: 'LEFT_CLICK' }))
  assert.equal(control.state, 'Controlando el cursor')
  assert.equal(control.action, 'Última acción: Clic')
  assert.equal(control.tone, 'control')
  const paused = describeHud(running({ mode: 'CONTROL', paused: true, lastEvent: 'PAUSE' }))
  assert.equal(paused.state, 'En pausa')
  assert.equal(paused.action, 'Última acción: Pausa')
})

test('en observación se aclara que la acción no se envió al sistema', () => {
  const observing = describeHud(running({ mode: 'OBSERVATION', lastEvent: 'SCROLL' }))
  assert.equal(observing.state, 'Observando')
  assert.equal(observing.action, 'Última acción: Desplazamiento (no se envió)')
  assert.equal(describeHud(running({ mode: 'OBSERVATION', lastEvent: 'NONE' })).action, 'Última acción: Ninguna todavía')
})

test('sin puente no se inventa un estado', () => {
  const down = describeHud(running({ mode: 'CONTROL', lastEvent: 'LEFT_CLICK' }), { bridgeDown: true })
  assert.equal(down.state, 'Sin conexión con el motor')
  assert.equal(down.action, '')
  assert.equal(describeHud(running({ emergencyStopped: true, lastEvent: 'EMERGENCY_STOP' })).state, 'Parada de emergencia')
})

test('la firma cambia al repetir la misma acción', () => {
  const a = actionSignature(running({ lastEvent: 'LEFT_CLICK', totalClicks: 3 }))
  const b = actionSignature(running({ lastEvent: 'LEFT_CLICK', totalClicks: 4 }))
  assert.notEqual(a, b)
  assert.equal(a, actionSignature(running({ lastEvent: 'LEFT_CLICK', totalClicks: 3 })))
  assert.notEqual(actionSignature(running({ lastEvent: 'TIMER', eventSeq: 1 })), actionSignature(running({ lastEvent: 'TIMER', eventSeq: 2 })))
})

test('la ventana HUD existe solo con el motor en marcha y la preferencia activada', () => {
  assert.equal(hudShouldBeOpen({ running: true, enabled: true }), true)
  assert.equal(hudShouldBeOpen({ running: false, enabled: true }), false)
  assert.equal(hudShouldBeOpen({ running: true, enabled: false }), false)
  assert.equal(hudCommand(false, true), 'open')
  assert.equal(hudCommand(true, false), 'close')
  assert.equal(hudCommand(true, true), null, 'no se repite la apertura en cada sondeo')
  assert.equal(hudCommand(null, false), 'close', 'al cargar se cierra una ventana que pudiera haber quedado')
})

test('la preferencia del HUD se guarda por equipo y falla de forma segura', () => {
  const memory = new Map()
  const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }
  assert.equal(readHudEnabled(storage), true, 'activado por defecto')
  assert.equal(writeHudEnabled(storage, false), true)
  assert.equal(memory.get(HUD_STORAGE_KEY), 'off')
  assert.equal(readHudEnabled(storage), false)
  writeHudEnabled(storage, true)
  assert.equal(readHudEnabled(storage), true)
  const blocked = { getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') } }
  assert.equal(readHudEnabled(blocked), true)
  assert.equal(writeHudEnabled(blocked, false), false)
})
