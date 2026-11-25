import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDefaultState, loadState, saveState, storageKey, getEffectiveSettings, updateActiveSettings, selectMode, addMode, removeMode,
  addProfile, removeProfile, importGuestInto, getActiveMode, hasPendingChanges, migrateLegacy, GUEST, normalizeState,
} from '../../src/data/preferences.js'
import { TOGGLE_KEYS, togglesFrom, defaultAssignments, isAllowed, normalizeAssignments } from '../../src/data/capabilities.js'
import { buildEngineConfig, configEquals } from '../../src/engine/engineConfig.js'

const memoryStorage = () => { const map = new Map(); return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), keys: () => [...map.keys()] } }

test('los interruptores se conservan al guardar, recargar y cambiar de modo', () => {
  const storage = memoryStorage()
  let state = createDefaultState()
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen'), desk = state.modes.find(m => m.plantilla === 'desk')
  state = updateActiveSettings(state, { pointer: false, drag: false, fistPause: false, palm: false, rightClick: false })
  saveState(GUEST, state, storage)
  const reloaded = loadState(GUEST, storage)
  const effective = getEffectiveSettings(reloaded)
  for (const key of TOGGLE_KEYS) assert.equal(typeof effective[key], 'boolean', `interruptor ${key} ausente`)
  assert.deepEqual([effective.pointer, effective.drag, effective.fistPause, effective.palm], [false, false, false, false])
  assert.equal(effective.rightClick, false, 'rightClick es un ajuste del equipo y se conserva')
  // Cambiar de modo muestra los interruptores de ese modo, no los del anterior.
  const other = getEffectiveSettings(selectMode(reloaded, desk.id))
  assert.deepEqual([other.pointer, other.palm], [true, true])
  assert.equal(other.rightClick, false, 'el ajuste del equipo no depende del modo')
  const back = getEffectiveSettings(selectMode(reloaded, kitchen.id))
  assert.equal(back.pointer, false)
})

test('los ajustes del equipo y los del modo se guardan por separado', () => {
  let state = createDefaultState()
  state = updateActiveSettings(state, { cameraIndex: 2, preferredHand: 'LEFT', movementArea: 40, sensitivity: 90, deskRest: false })
  const mode = getActiveMode(state)
  assert.equal(mode.settings.sensitivity, 90)
  assert.equal(mode.settings.deskRest, false)
  assert.equal(mode.dirty, true)
  assert.deepEqual([state.device.cameraIndex, state.device.preferredHand, state.device.movementArea], [2, 'LEFT', 40])
  assert.equal('cameraIndex' in mode.settings, false, 'la cámara no viaja con el modo')
  const otherMode = selectMode(state, state.modes[1].id)
  assert.equal(getEffectiveSettings(otherMode).cameraIndex, 2)
  assert.equal(getEffectiveSettings(otherMode).sensitivity, 68)
})

test('cada cuenta y el invitado usan espacios distintos', () => {
  const storage = memoryStorage()
  const guest = updateActiveSettings(createDefaultState(), { sensitivity: 99 })
  saveState(GUEST, guest, storage)
  const accountId = '11111111-1111-4111-8111-111111111111'
  assert.equal(loadState(accountId, storage), null, 'una cuenta nueva no ve los datos de invitado')
  assert.notEqual(storageKey(accountId), storageKey(GUEST))
  let account = createDefaultState()
  account = updateActiveSettings(account, { sensitivity: 10 })
  saveState(accountId, account, storage)
  assert.equal(getEffectiveSettings(loadState(GUEST, storage)).sensitivity, 99)
  assert.equal(getEffectiveSettings(loadState(accountId, storage)).sensitivity, 10)
  // Importar invitado es explícito y copia con identidades nuevas.
  const imported = importGuestInto(account, guest)
  assert.equal(imported.profiles.length, 2)
  assert.ok(imported.profiles.every(p => p.version === null))
  assert.ok(!imported.modes.some(m => guest.modes.some(g => g.id === m.id)), 'no comparte UUID con el invitado')
})

test('borrar un modo sincronizado deja una lápida y uno nuevo no', () => {
  let state = createDefaultState()
  const synced = { ...state.modes[0], version: 3, dirty: false }
  state = { ...state, modes: [synced, ...state.modes.slice(1)] }
  state = removeMode(state, synced.id)
  assert.deepEqual(state.tombstones, [{ kind: 'mode', id: synced.id, version: 3, nombre: synced.nombre, profileId: synced.profileId }])
  state = addMode(state, state.activeProfileId, { nombre: 'Temporal' })
  const temp = getActiveMode(state)
  state = removeMode(state, temp.id)
  assert.equal(state.tombstones.length, 1)
  assert.ok(hasPendingChanges(state))
  state = addProfile(state, { nombre: 'Trabajo' })
  assert.equal(state.activeModeId, null)
  state = removeProfile(state, state.activeProfileId)
  assert.ok(state.activeModeId)
})

test('migra el formato antiguo conservando contextos, interruptores y modo activo', () => {
  const legacy = {
    contexts: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Presentaciones', sensitivity: 80, stability: 30, pinchTolerance: 40, pinch: false, scroll: true }],
    desktopContext: 'desk', mobileContext: 'kitchen', gaze: false, proximity: false,
    contextSettings: { kitchen: { sensitivity: 77, palm: false } },
    settings: { preferredHand: 'LEFT', mirrorCamera: false, cameraIndex: 1, sensitivity: 65, stability: 40, pinchTolerance: 50, movementArea: 50, confidenceThreshold: 70, deskRest: true, diagnosticOverlay: false, pinch: true, scroll: true, pointer: true, drag: false, fistPause: true, swipeLeft: false, swipeRight: false, windowGestures: true },
  }
  const state = migrateLegacy(legacy)
  assert.equal(state.schema, 2)
  assert.equal(getActiveMode(state).plantilla, 'desk')
  assert.deepEqual([state.device.preferredHand, state.device.mirrorCamera, state.device.cameraIndex, state.device.diagnosticOverlay], ['LEFT', false, 1, false])
  assert.equal('windowGestures' in state.device, false, 'el ajuste retirado del formato antiguo se descarta')
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen')
  assert.equal(kitchen.settings.sensitivity, 77)
  assert.equal(togglesFrom(kitchen.assignments).palm, false)
  const custom = state.modes.find(m => m.nombre === 'Presentaciones')
  assert.equal(custom.id, '22222222-2222-4222-8222-222222222222')
  assert.equal(togglesFrom(custom.assignments).pinch, false)
  assert.equal(togglesFrom(custom.assignments).drag, false, 'hereda el interruptor global antiguo')
  // El formato antiguo se lee solo para invitado y solo si no existe el nuevo.
  const storage = memoryStorage()
  storage.setItem('zerotouch-preferences-v1', JSON.stringify(legacy))
  assert.equal(loadState(GUEST, storage).modes.length, 4)
  assert.equal(loadState('33333333-3333-4333-8333-333333333333', storage), null)
})

test('la configuración del motor lleva todos los interruptores, el mapa de gestos y valores coherentes', () => {
  const state = createDefaultState()
  const config = buildEngineConfig(getEffectiveSettings(state), getActiveMode(state).assignments)
  for (const key of TOGGLE_KEYS) assert.equal(typeof config[key], 'boolean', key)
  assert.equal(Object.keys(config.gestos).length, 8)
  assert.equal(config.gestos.palma_abierta.habilitado, true)
  assert.equal(config.gestos.micro_pinza.accion, 'clic')
  assert.equal(config.format_version, 2)
  assert.ok(configEquals(config, JSON.parse(JSON.stringify(config))))
  assert.ok(!configEquals(config, { ...config, sensitivity: 1 }))
})

test('las asignaciones solo aceptan combinaciones del contrato', () => {
  assert.ok(isAllowed('palma_abierta', 'confirmar'))
  assert.ok(isAllowed('palma_abierta', 'multimedia_siguiente'))
  assert.ok(!isAllowed('pulgar_arriba', 'confirmar'), 'gesto retirado el 24-11-2026')
  assert.ok(!isAllowed('micro_pinza', 'arrastrar'))
  assert.ok(isAllowed('micro_pinza', 'sin_accion'))
  assert.ok(isAllowed('micro_pinza', 'arrastrar', false), 'deshabilitada se acepta aunque no sea ejecutable')
  const fixed = normalizeAssignments({ micro_pinza: { accion: 'arrastrar', habilitado: true }, palma_abierta: { accion: 'cancelar', habilitado: true }, pulgar_abajo: { accion: 'cancelar', habilitado: true } })
  assert.equal(fixed.micro_pinza.habilitado, false, 'una combinación no permitida queda deshabilitada, nunca sustituida en silencio por otra acción')
  assert.equal(fixed.palma_abierta.habilitado, true)
  assert.equal(fixed.pulgar_abajo, undefined, 'una asignación guardada de un gesto retirado se descarta')
  assert.deepEqual(Object.keys(defaultAssignments()).length, 8)
  assert.equal(normalizeState({ schema: 1 }), null)
})
