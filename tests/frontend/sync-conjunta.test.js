import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { synchronize } from '../../src/sync/syncEngine.js'
import { assignmentsToExport } from '../../src/data/capabilities.js'
import { createDefaultState, normalizeState, updateMode } from '../../src/data/preferences.js'

// Mutación conjunta: un modo y sus asignaciones viajan en UNA solicitud (gestos dentro de POST/PATCH del modo) cuando
// el servidor anuncia `servidor.modo_con_asignaciones`; sin el anuncio siguen los dos pasos de siempre.
const retry = { retries: 2, sleep: async () => {} }
const sync = (api, state, extra = {}) => synchronize({ api, state, retry, ...extra })
const reload = state => normalizeState(JSON.parse(JSON.stringify(state)))
const failure = async promise => {
  try { await promise; assert.fail('Se esperaba una sincronización interrumpida') }
  catch (error) { assert.ok(error.state, 'el error debe entregar el estado parcial'); return { state: error.state, error } }
}
function failTimes(api, method, times, { applied = false, code = 'SERVICE_OFFLINE' } = {}) {
  const original = api[method]
  let left = times
  api[method] = async (...args) => {
    if (left <= 0) return original(...args)
    left -= 1
    if (applied) await original(...args)
    throw { code, message: 'Fallo inyectado' }
  }
  return () => { api[method] = original }
}
const calls = (server, name) => server.log.filter(([method]) => method === name)
/** Asignación local que el motor no ejecuta: la interfaz no la permitiría, se inyecta a mano para provocar el rechazo del servidor. */
const withIncompatible = (state, modeId) => ({
  ...state,
  modes: state.modes.map(m => (m.id === modeId ? { ...m, assignments: { ...m.assignments, deslizamiento_derecha: { accion: 'activar_puntero', habilitado: true } } } : m)),
})

test('con el anuncio, cada modo nuevo se crea CON sus 13 asignaciones, en la versión 1 y sin ningún PUT', async () => {
  const { api, server } = createFakeApi()
  const initial = createDefaultState()
  const result = await sync(api, initial)
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.created, 4)
  assert.equal(calls(server, 'setModeGestures').length, 0, 'ni un PUT de asignaciones')
  const creations = calls(server, 'createContext')
  assert.equal(creations.length, 3)
  for (const [, , body] of creations) {
    assert.equal(body.gestos.length, 13)
    assert.deepEqual(body.gestos.map(g => g.gesto_codigo), [...body.gestos.map(g => g.gesto_codigo)].sort(), 'ordenadas por gesto')
    assert.ok(body.gestos.every(g => typeof g.gesto_codigo === 'string' && typeof g.accion_codigo === 'string' && typeof g.habilitado === 'boolean'))
  }
  assert.ok(result.state.modes.every(m => m.version === 1 && !m.dirty && server.modes.has(m.id)), 'versión 1 y sin pendientes')
  assert.ok(result.state.modes.every(m => server.assignments.get(m.id)?.size === 13), 'el servidor tiene las 13 asignaciones de cada modo')
  assert.equal(server.log.filter(([name]) => name === 'capabilities').length, 1, 'una sola consulta de capacidades')
  // Lo que se envió es exactamente lo que había en local.
  for (const mode of initial.modes) {
    const sent = creations.find(([, , body]) => body.name === mode.nombre)
    assert.deepEqual(sent[2].gestos, assignmentsToExport(mode.assignments), mode.nombre)
  }
})

test('sin el anuncio no se envía jamás `gestos` en el modo: crear y luego PUT, como antes', async () => {
  const { api, server } = createFakeApi({ jointMode: false })
  const result = await sync(api, createDefaultState())
  assert.deepEqual(result.conflicts, [])
  assert.equal(calls(server, 'setModeGestures').length, 3)
  assert.ok(calls(server, 'createContext').every(([, , body]) => !('gestos' in body)))
  let state = result.state
  const id = state.modes[0].id
  const versionBefore = server.modes.get(id).version
  assert.equal(versionBefore, 2, 'sin conjunta, crear + PUT de asignaciones deja el modo en la versión 2')
  state = updateMode(state, id, { settings: { sensitivity: 12 } })
  const second = await sync(api, state)
  assert.deepEqual(second.conflicts, [])
  assert.ok(calls(server, 'updateContext').every(([, , body]) => !('gestos' in body)), 'tampoco al editar')
  assert.equal(calls(server, 'setModeGestures').length, 4, 'la edición usa PATCH + PUT')
  assert.equal(server.modes.get(id).version, versionBefore + 2, 'PATCH + PUT = dos subidas')
})

test('editar un modo: UN PATCH con campos y asignaciones, UNA subida de versión y nada pendiente', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  const mode = state.modes[0]
  state = updateMode(state, mode.id, { nombre: 'Editado', settings: { sensitivity: 17 } })
  state = { ...state, modes: state.modes.map(m => (m.id === mode.id ? { ...m, assignments: { ...m.assignments, pulgar_arriba: { ...m.assignments.pulgar_arriba, habilitado: !m.assignments.pulgar_arriba.habilitado } } } : m)) }
  const edited = state.modes.find(m => m.id === mode.id)
  const patchesBefore = calls(server, 'updateContext').length
  const result = await sync(api, state)
  assert.deepEqual(result.conflicts, [])
  assert.equal(calls(server, 'updateContext').length, patchesBefore + 1, 'una sola solicitud')
  assert.equal(calls(server, 'setModeGestures').length, 0)
  const [, , body] = calls(server, 'updateContext').at(-1)
  assert.equal(body.version, mode.version, 'con la versión conocida')
  assert.deepEqual(body.gestos, assignmentsToExport(edited.assignments))
  const remote = server.modes.get(mode.id)
  assert.equal(remote.version, mode.version + 1, 'UNA subida (antes PATCH + PUT daban dos)')
  assert.equal(remote.nombre, 'Editado')
  assert.equal(remote.sensibilidad_puntero, 17)
  assert.equal(server.assignments.get(mode.id).get('pulgar_arriba').habilitado, edited.assignments.pulgar_arriba.habilitado)
  const local = result.state.modes.find(m => m.id === mode.id)
  assert.equal(local.version, remote.version)
  assert.equal(local.dirty, false, 'ya incluye sus asignaciones: no queda a medias')
})

test('una asignación rechazada por el servidor no deja NADA aplicado (con el servidor anterior sí quedaba el PATCH)', async () => {
  for (const joint of [true, false]) {
    const { api, server } = createFakeApi({ jointMode: joint })
    let state = (await sync(api, createDefaultState())).state
    const mode = state.modes[0]
    const before = { ...server.modes.get(mode.id) }
    state = withIncompatible(updateMode(state, mode.id, { settings: { sensitivity: 17 } }), mode.id)
    const { error, state: partial } = await failure(sync(api, state))
    assert.equal(error.code, 'ACCION_NO_COMPATIBLE')
    const remote = server.modes.get(mode.id)
    if (joint) {
      assert.deepEqual(remote, before, 'conjunta: ni los campos ni la versión cambiaron')
    } else {
      assert.equal(remote.sensibilidad_puntero, 17, 'sin conjunta: el PATCH ya se había aplicado')
      assert.equal(remote.version, before.version + 1)
    }
    const local = partial.modes.find(m => m.id === mode.id)
    assert.equal(local.dirty, true, 'el contenido local sigue pendiente')
    assert.equal(local.settings.sensitivity, 17)
    assert.equal(local.assignments.deslizamiento_derecha.accion, 'activar_puntero', 'y no se perdió')
  }
})

test('creación rechazada: con la mutación conjunta no queda un modo huérfano en el servidor', async () => {
  const { api, server } = createFakeApi()
  const state = createDefaultState()
  const target = state.modes[0]
  const broken = withIncompatible(state, target.id)
  const { error } = await failure(sync(api, broken))
  assert.equal(error.code, 'ACCION_NO_COMPATIBLE')
  assert.equal(server.modes.size, [...server.modes.values()].filter(m => m.nombre !== target.nombre).length, 'ningún modo con ese nombre')
  assert.ok(![...server.modes.values()].some(m => m.nombre === target.nombre))
})

test('respuesta perdida al crear un modo: la siguiente sincronización lo recupera completo, con su clave y sin PUT', async () => {
  const { api, server } = createFakeApi()
  const restore = failTimes(api, 'createContext', 3, { applied: true }) // el servidor creó el primer modo; la respuesta se perdió 3 veces
  const { state: interrupted } = await failure(sync(api, createDefaultState()))
  const partial = reload(interrupted)
  assert.equal(partial.syncOperation.method, 'createContext')
  assert.equal(partial.syncOperation.args.at(-1).gestos.length, 13, 'la operación pendiente conserva las asignaciones')
  assert.equal(server.modes.size, 1)
  restore()
  const recovered = await sync(api, partial)
  assert.deepEqual(recovered.conflicts, [])
  assert.equal(recovered.state.syncOperation, null)
  assert.equal(server.modes.size, 3, 'sin duplicados')
  assert.equal(calls(server, 'setModeGestures').length, 0)
  assert.ok(recovered.state.modes.every(m => m.version === 1 && !m.dirty), 'completos desde la recuperación, no a medias')
  assert.ok(recovered.state.modes.every(m => server.assignments.get(m.id)?.size === 13))
  const firstKey = calls(server, 'createContext').find(([, , body]) => body.name === partial.syncOperation.args.at(-1).name).at(-1)
  assert.equal(calls(server, 'createContext').filter(entry => entry.at(-1) === firstKey).length, 4, 'tres intentos y la recuperación, todos con la misma clave')
})

test('mutación conjunta e idempotencia: un servidor con conjunta pero sin idempotencia también funciona', async () => {
  const { api, server } = createFakeApi({ idempotency: false })
  const result = await sync(api, createDefaultState())
  assert.deepEqual(result.conflicts, [])
  assert.equal(calls(server, 'setModeGestures').length, 0)
  assert.ok(calls(server, 'createContext').every(entry => entry.length === 3), 'sin clave de idempotencia')
  assert.ok(result.state.modes.every(m => m.version === 1 && !m.dirty))
})

test('una creación de dos pasos interrumpida se completa con un PATCH conjunto si el servidor se actualiza entre tanto', async () => {
  const { api, server } = createFakeApi({ jointMode: false })
  const restore = failTimes(api, 'createContext', 3, { applied: true }) // el servidor (sin conjunta) creó el primer modo; la respuesta se perdió
  const { state: interrupted } = await failure(sync(api, createDefaultState()))
  const partial = reload(interrupted)
  assert.equal('gestos' in partial.syncOperation.args.at(-1), false, 'la operación pendiente se envió en la forma antigua')
  assert.equal(server.assignments.size, 0, 'el modo existe pero sin asignaciones')
  restore()
  server.setJointMode(true) // el servidor se actualiza
  const setsBefore = calls(server, 'setModeGestures').length
  const recovered = await sync(api, partial)
  assert.deepEqual(recovered.conflicts, [])
  assert.equal(server.modes.size, 3, 'sin duplicados')
  assert.equal(calls(server, 'setModeGestures').length, setsBefore, 'ningún PUT: las asignaciones del modo recuperado van en un PATCH conjunto')
  const recoveredId = [...server.modes.values()].find(m => m.nombre === partial.syncOperation.args.at(-1).name).id
  assert.equal(server.modes.get(recoveredId).version, 2, 'creado (v1) + PATCH conjunto (v2)')
  assert.equal(server.assignments.get(recoveredId)?.size, 13)
  assert.ok(recovered.state.modes.every(m => !m.dirty && server.assignments.get(m.id)?.size === 13))
})

test('si el servidor pierde la mutación conjunta entre dos sincronizaciones, el cliente vuelve a los dos pasos', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  server.setJointMode(false) // se degrada el servidor
  const id = state.modes[0].id
  state = updateMode(state, id, { settings: { sensitivity: 21 } })
  const result = await sync(api, state)
  assert.deepEqual(result.conflicts, [])
  const lastPatch = calls(server, 'updateContext').at(-1)[2]
  assert.equal('gestos' in lastPatch, false, 'ya no se manda gestos')
  assert.equal(calls(server, 'setModeGestures').length, 1)
  assert.equal(server.modes.get(id).sensibilidad_puntero, 21)
  assert.equal(result.state.modes.find(m => m.id === id).dirty, false)
})
