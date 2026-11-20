import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addMode, createDefaultState, getActiveAssignments, getActiveMode, getEffectiveSettings, setAssignment, setToggle, settingsPatch, updateActiveSettings,
} from '../../src/data/preferences.js'
import { gestureActionLabel, gestures } from '../../src/data/gestures.js'
import { GESTURE_CODES, GESTURE_TO_TOGGLE, NO_ACTION, allowedActions } from '../../src/data/capabilities.js'
import { DEFAULT_ENGINE_STATUS, getEngineState } from '../../src/data/engineStatus.js'

test('settingsPatch envía solo lo que cambió y updateActiveSettings lo reparte entre equipo, modo e interruptores', () => {
  const state = createDefaultState()
  const current = getEffectiveSettings(state)
  const next = { ...current, sensitivity: 20, pinch: false, cameraIndex: 2, gaze: { ...current.gaze, enabled: true } }
  const patch = settingsPatch(current, next)
  assert.deepEqual(Object.keys(patch).sort(), ['cameraIndex', 'gaze', 'pinch', 'sensitivity'])
  const after = getEffectiveSettings(updateActiveSettings(state, patch))
  assert.equal(after.sensitivity, 20)
  assert.equal(after.pinch, false)
  assert.equal(after.cameraIndex, 2)
  assert.equal(after.gaze.enabled, true)
  assert.deepEqual(settingsPatch(after, after), {}, 'sin cambios no hay parche')
  assert.equal(updateActiveSettings(state, {}), state, 'un parche vacío no crea un estado nuevo (no marca el modo como pendiente)')
})

test('crear un modo desde el diálogo: ajustes básicos, interruptores y modo activo', () => {
  const state = createDefaultState()
  const profileId = state.profiles[0].id
  let next = addMode(state, profileId, { nombre: 'Presentaciones', categoria: 'personalizado', settings: { sensitivity: 30, stability: 70 } })
  for (const [toggle, value] of Object.entries({ pinch: false, scroll: true })) next = setToggle(next, next.activeModeId, toggle, value)
  const mode = getActiveMode(next)
  assert.equal(mode.nombre, 'Presentaciones')
  assert.deepEqual([mode.settings.sensitivity, mode.settings.stability], [30, 70])
  assert.equal(getEffectiveSettings(next).pinch, false)
  assert.equal(getEffectiveSettings(next).scroll, true)
  assert.equal(mode.version, null)
  assert.equal(mode.dirty, true)
  assert.equal(next.modes.length, state.modes.length + 1)
})

test('el editor de asignaciones: elegir una acción enciende el gesto; «sin acción» lo apaga; encender restaura la predeterminada', () => {
  const state = createDefaultState()
  const id = state.activeModeId
  const palm = 'palma_abierta'
  let next = setAssignment(state, id, palm, { accion: 'multimedia_play_pause', habilitado: 'multimedia_play_pause' !== NO_ACTION })
  assert.deepEqual(getActiveAssignments(next)[palm], { accion: 'multimedia_play_pause', habilitado: true })
  next = setAssignment(next, id, palm, { accion: NO_ACTION, habilitado: NO_ACTION !== NO_ACTION })
  assert.equal(getEffectiveSettings(next).palm, false)
  next = setToggle(next, id, GESTURE_TO_TOGGLE[palm], true)
  assert.equal(getActiveAssignments(next)[palm].accion, 'navegacion', 'vuelve a su acción predeterminada')
  assert.equal(getEffectiveSettings(next).palm, true)
  // Una acción que el contrato no permite para ese gesto no se aplica.
  assert.deepEqual(getActiveAssignments(setAssignment(next, id, 'micro_pinza', { accion: 'atras', habilitado: true })), getActiveAssignments(next))
  assert.deepEqual(allowedActions('micro_pinza'), ['clic', NO_ACTION])
})

test('la lista de gestos nombra la acción asignada cuando el gesto admite varias', () => {
  const state = createDefaultState()
  const id = state.activeModeId
  assert.equal(gestureActionLabel('swipeLeft', getActiveAssignments(state)), 'Atrás', 'apagado: etiqueta por defecto')
  let next = setToggle(state, id, 'swipeLeft', true)
  next = setAssignment(next, id, 'deslizamiento_izquierda', { accion: 'multimedia_siguiente', habilitado: true })
  assert.equal(gestureActionLabel('swipeLeft', getActiveAssignments(next)), 'Siguiente elemento multimedia')
  assert.equal(gestureActionLabel('click', getActiveAssignments(next)), gestures.click.action, 'un gesto de acción única conserva su texto')
  assert.equal(gestureActionLabel('threeFingers', getActiveAssignments(next)), gestures.threeFingers.action, 'sin gesto del contrato asociado')
  for (const [name, gesture] of Object.entries(gestures)) {
    if (gesture.code) assert.ok(GESTURE_CODES.includes(gesture.code), `${name} apunta a un gesto del contrato`)
  }
})

test('el estado del motor explica que el puntero necesita la mano abierta sostenida', () => {
  const control = { ...DEFAULT_ENGINE_STATUS, running: true, cameraOpen: true, mode: 'CONTROL' }
  assert.match(getEngineState({ ...control, pointerArmed: false }).hint, /mano abierta/)
  assert.equal(getEngineState({ ...control, pointerArmed: true }).label, 'Controlando el cursor')
  assert.equal(getEngineState({ ...control, pointerArmed: false }).control, true)
  assert.equal(getEngineState(DEFAULT_ENGINE_STATUS).key, 'off')
  assert.equal(DEFAULT_ENGINE_STATUS.appliedConfig, null, 'sin READY no hay configuración confirmada')
})
