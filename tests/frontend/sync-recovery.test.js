import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { synchronize } from '../../src/sync/syncEngine.js'
import { uniqueName } from '../../src/sync/names.js'
import { createDefaultState, updateMode, updateProfile, removeMode, removeProfile, normalizeState, importGuestInto, hasPendingChanges } from '../../src/data/preferences.js'

const retry = { retries: 2, sleep: async () => {} }
const sync = (api, state, extra = {}) => synchronize({ api, state, retry, ...extra })
const reload = state => normalizeState(JSON.parse(JSON.stringify(state)))
const failure = async promise => {
  try { await promise; assert.fail('Se esperaba un error') }
  catch (error) { assert.ok(error.state, 'el error debe entregar el estado parcial'); return error.state }
}
const interruptOnce = (api, method, applied = false, code = 'SERVICE_OFFLINE') => {
  const original = api[method]
  let first = true
  api[method] = async (...args) => {
    if (!first) return original(...args)
    first = false
    if (applied) await original(...args)
    throw { code, message: 'Fallo inyectado' }
  }
}

test('nombres de 60 caracteres: sufijos distintos, NFC e importación sin bucle', () => {
  const name = 'Á'.repeat(60)
  const second = uniqueName(name, [name])
  assert.equal(second.length, 60)
  assert.ok(second.endsWith(' (2)'))
  assert.ok(uniqueName(name, [name, second]).endsWith(' (3)'))
  assert.equal(uniqueName('Cafe\u0301', ['CAFÉ']), 'Café (2)')
  const names = ['😀'.repeat(30)]
  for (let i = 0; i < 12; i += 1) {
    const candidate = uniqueName(names[0], names)
    assert.ok(candidate.length <= 60 && candidate.isWellFormed())
    assert.ok(!names.includes(candidate))
    names.push(candidate)
  }
  const state = createDefaultState()
  state.profiles[0].nombre = name
  const imported = importGuestInto(state, state)
  assert.equal(imported.profiles[1].nombre, second)
})

test('renombrado largo se integra con creación de perfil y modo', async () => {
  const { api, server } = createFakeApi()
  const state = createDefaultState()
  const name = 'p'.repeat(60)
  state.profiles[0].nombre = name
  server.createProfileElsewhere(name)
  const result = await sync(api, state, { resolutions: { [`profile:${state.profiles[0].id}`]: 'renombrar' } })
  assert.equal(result.state.profiles[0].nombre, `${'p'.repeat(56)} (2)`)
  const mode = result.state.modes[0]
  const local = updateMode(result.state, mode.id, { nombre: 'm'.repeat(60) })
  local.modes[0].version = null
  server.createModeElsewhere(mode.profileId, 'm'.repeat(60))
  const renamed = await sync(api, local, { resolutions: { [`mode:${mode.id}`]: 'renombrar' } })
  assert.ok(renamed.state.modes.some(m => m.nombre === `${'m'.repeat(56)} (2)`))
})

// Servidor SIN mutación conjunta: modo y asignaciones son dos solicitudes y puede quedar un estado intermedio.
// Con mutación conjunta ese estado no existe: ver sync-conjunta.test.js.
for (const existing of [false, true]) {
  test(`fallo de asignaciones después de ${existing ? 'PATCH' : 'crear'} conserva identidad, versión y contenido`, async () => {
    const { api, server } = createFakeApi({ jointMode: false })
    let state = createDefaultState()
    if (existing) state = (await sync(api, state)).state
    const mode = state.modes[0]
    state = updateMode(state, mode.id, { settings: { sensitivity: 17 } })
    interruptOnce(api, 'setModeGestures', false, 'ACCION_NO_COMPATIBLE')
    const partial = reload(await failure(sync(api, state)))
    const saved = partial.modes.find(m => m.plantilla === mode.plantilla)
    assert.ok(server.modes.has(saved.id))
    assert.equal(saved.version, server.modes.get(saved.id).version)
    assert.equal(saved.dirty, true)
    assert.equal(saved.settings.sensitivity, 17)
    const creates = server.log.filter(([method]) => method === 'createContext').length
    const recovered = await sync(api, partial)
    assert.equal(recovered.conflicts.length, 0)
    assert.equal(server.log.filter(([method]) => method === 'createContext').length, creates + (existing ? 0 : 2))
    assert.equal(recovered.state.modes.find(m => m.id === saved.id).dirty, false)
  })
}

// Servidor SIN idempotencia (base v2 o anterior): una creación con respuesta perdida es incierta y nunca se repite.
// Con idempotencia se recupera sola: ver sync-idempotency.test.js.
for (const method of ['createProfile', 'createContext']) {
  test(`${method}: respuesta perdida bloquea repetición incluso tras recargar; adopción explícita recupera`, async () => {
    const { api, server } = createFakeApi({ idempotency: false })
    interruptOnce(api, method, true)
    let partial = reload(await failure(sync(api, createDefaultState())))
    assert.equal(server.log.filter(([name]) => name === method).length, 1)
    const blocked = await sync(api, partial)
    assert.equal(blocked.conflicts[0].type, 'resultado_incierto')
    assert.equal(server.log.filter(([name]) => name === method).length, 1)
    const op = partial.syncOperation
    const remote = [...(op.kind === 'profile' ? server.profiles : server.modes).values()][0]
    const result = await sync(api, partial, { resolutions: { [`${op.kind}:${op.id}`]: { action: 'adoptar', remoteId: remote.id } } })
    assert.equal(result.conflicts.length, 0)
    assert.equal(result.state.syncOperation, null)
    assert.equal(server.profiles.size, 1)
    assert.equal(server.modes.size, 3)
  })
}

test('creación incierta sin candidato permanece bloqueada y no duplica una solicitud en vuelo', async () => {
  const { api, server } = createFakeApi({ idempotency: false })
  interruptOnce(api, 'createProfile')
  const partial = reload(await failure(sync(api, createDefaultState())))
  const result = await sync(api, partial)
  assert.equal(result.conflicts[0].type, 'resultado_incierto')
  assert.equal(server.profiles.size, 0)
  assert.ok(result.state.syncOperation)
  assert.throws(() => removeProfile(partial, partial.profiles[0].id), /pendiente/)
})

for (const method of ['updateProfile', 'updateContext', 'setModeGestures']) {
  test(`${method}: respuesta perdida no repite la mutación aplicada ni pierde cambios locales`, async () => {
    // El PUT de asignaciones suelto solo existe sin mutación conjunta; PATCH del modo ya incluye las asignaciones.
    const { api, server } = createFakeApi({ jointMode: method !== 'setModeGestures' })
    let state = (await sync(api, createDefaultState())).state
    const kind = method === 'updateProfile' ? 'profile' : 'mode'
    const item = kind === 'profile' ? state.profiles[0] : state.modes[0]
    state = kind === 'profile' ? updateProfile(state, item.id, { descripcion: 'Cambio local' }) : updateMode(state, item.id, { settings: { sensitivity: 19 } })
    interruptOnce(api, method, true)
    const partial = reload(await failure(sync(api, state)))
    const remote = kind === 'profile' ? server.profiles.get(item.id) : server.modes.get(item.id)
    const version = remote.version
    const result = await sync(api, partial)
    assert.equal(remote.version, version, 'el reintento CAS no vuelve a aplicar')
    assert.equal(result.conflicts[0].type, 'version')
    const retained = kind === 'profile' ? result.state.profiles[0] : result.state.modes[0]
    assert.equal(retained.dirty, true)
    assert.equal(kind === 'profile' ? retained.descripcion : retained.settings.sensitivity, kind === 'profile' ? 'Cambio local' : 19)
    const recovered = await sync(api, result.state, { resolutions: { [`${kind}:${item.id}`]: 'local' } })
    assert.equal(recovered.conflicts.length, 0)
  })
}

test('recuperación de recibo guardado tras cierre y ediciones posteriores', async () => {
  const { api, server } = createFakeApi()
  let durable
  const partial = await failure(sync(api, createDefaultState(), { onCheckpoint: snapshot => {
    durable = reload(snapshot)
    if (snapshot.syncOperation?.result) throw new Error('Cierre simulado')
  } }))
  assert.ok(partial.syncOperation.result)
  durable = updateProfile(durable, durable.profiles[0].id, { nombre: 'Editado tras cierre' })
  const recovered = await sync(api, durable)
  assert.equal(recovered.conflicts.length, 0)
  assert.equal(server.profiles.size, 1)
  assert.equal([...server.profiles.values()][0].nombre, 'Editado tras cierre')
})

test('fallo de persistencia antes de enviar impide mutaciones', async () => {
  const { api, server } = createFakeApi()
  const partial = await failure(sync(api, createDefaultState(), { onCheckpoint: () => false }))
  assert.equal(server.profiles.size, 0)
  assert.ok(hasPendingChanges(partial))
})

test('reintento de PATCH no aplicado preserva ediciones realizadas durante la interrupción', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  const id = state.profiles[0].id
  state = updateProfile(state, id, { descripcion: 'Primera edición' })
  interruptOnce(api, 'updateProfile')
  let partial = reload(await failure(sync(api, state)))
  partial = updateProfile(partial, id, { descripcion: 'Segunda edición' })
  const result = await sync(api, partial)
  assert.equal(result.conflicts.length, 0)
  assert.equal(server.profiles.get(id).descripcion, 'Segunda edición')
  assert.equal(result.state.profiles[0].dirty, false)
})

test('una creación incierta no puede adoptar una identidad local ya existente', async () => {
  const { api } = createFakeApi({ idempotency: false })
  let state = (await sync(api, createDefaultState())).state
  const existing = state.modes[1].id
  state.modes[0] = { ...state.modes[0], nombre: 'Nuevo', version: null, dirty: true }
  interruptOnce(api, 'createContext', true)
  const partial = await failure(sync(api, state))
  const op = partial.syncOperation
  const result = await sync(api, partial, { resolutions: { [`mode:${op.id}`]: { action: 'adoptar', remoteId: existing } } })
  assert.equal(result.conflicts[0].type, 'resultado_incierto')
  assert.equal(new Set(result.state.modes.map(m => m.id)).size, result.state.modes.length)
})

test('borrados concurrentes de modo, asignaciones y cascada de perfil: el servidor rechaza con 412 y no borra nada', async () => {
  for (const kind of ['mode', 'profile']) {
    const { api, server } = createFakeApi()
    const initial = (await sync(api, createDefaultState())).state
    const mode = initial.modes[0], profile = initial.profiles[0]
    const removed = kind === 'mode' ? removeMode(initial, mode.id) : removeProfile(initial, profile.id)
    server.editModeElsewhere(mode.id, { sensibilidad_puntero: 99 })
    server.setAssignmentElsewhere(mode.id, 'micro_pinza', 'clic', false)
    server.createModeElsewhere(profile.id, 'Creado en otro equipo')
    const result = await sync(api, reload(removed))
    assert.equal(result.conflicts[0].type, 'borrado_modificado', kind)
    assert.deepEqual(result.conflicts[0].options, ['recuperar', 'borrar'])
    assert.equal(result.state.tombstones[0].version, kind === 'mode' ? mode.version : profile.version)
    if (kind === 'profile') assert.equal(result.state.tombstones[0].modes.length, 3)
    assert.ok(server.modes.has(mode.id), 'nada se borró en el servidor')
    assert.ok(server.profiles.has(profile.id))
    assert.equal(server.modes.get(mode.id).sensibilidad_puntero, 99, 'el cambio de otro equipo sigue ahí')
    assert.equal(server.log.filter(([name]) => name.startsWith('delete')).length, 1, 'se intentó una vez, con la precondición, y el servidor la rechazó')
    assert.ok(!result.state.modes.some(m => m.id === mode.id), 'no reaparece localmente mientras se decide')
  }
})

test('lápidas antiguas sin versión no se envían a ciegas y no reaparecen', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  const mode = state.modes[0]
  state = removeMode(state, mode.id)
  state.tombstones = [{ kind: 'mode', id: mode.id }]
  const result = await sync(api, reload(state))
  assert.equal(result.state.tombstones[0].version, null)
  assert.ok(server.modes.has(mode.id))
  assert.equal(result.conflicts[0].type, 'borrado_no_seguro')
  assert.equal(result.conflicts[0].reason, 'sin_version')
  assert.ok(!server.log.some(([name]) => name.startsWith('delete')), 'sin versión conocida no hay precondición que enviar')
})

test('cambio concurrente entre PATCH y asignaciones conserva avance confirmado y conflicto (servidor sin mutación conjunta)', async () => {
  const { api, server } = createFakeApi({ jointMode: false })
  let state = (await sync(api, createDefaultState())).state
  const mode = state.modes[0]
  state = updateMode(state, mode.id, { settings: { sensitivity: 21 } })
  const put = api.setModeGestures
  api.setModeGestures = async (id, body) => {
    server.setAssignmentElsewhere(id, 'micro_pinza', 'clic', false)
    return put(id, body)
  }
  const result = await sync(api, state)
  const local = result.state.modes.find(m => m.id === mode.id)
  assert.equal(result.conflicts[0].type, 'version')
  assert.equal(local.version, mode.version + 1)
  assert.equal(local.dirty, true)
  assert.equal(local.assignments.micro_pinza.habilitado, true)
  assert.equal(server.assignments.get(mode.id).get('micro_pinza').habilitado, false)
  assert.equal(server.modes.get(mode.id).sensibilidad_puntero, 21)
})

test('adopción de duplicado con PATCH rechazado conserva identidad y dirty', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  const mode = state.modes[0]
  server.deleteModeElsewhere(mode.id)
  state = updateMode(state, mode.id, { nombre: 'Duplicado', settings: { sensitivity: 3 } })
  state.modes[0].version = null
  const duplicate = server.createModeElsewhere(mode.profileId, 'Duplicado')
  interruptOnce(api, 'updateContext', false, 'DATOS_INVALIDOS')
  const partial = await failure(sync(api, state, { resolutions: { [`mode:${mode.id}`]: 'adoptar' } }))
  const local = partial.modes.find(m => m.id === duplicate.id)
  assert.equal(local.dirty, true)
  assert.equal(local.settings.sensitivity, 3)
  const result = await sync(api, reload(partial))
  assert.equal(result.conflicts.length, 0)
  assert.equal(server.modes.get(duplicate.id).sensibilidad_puntero, 3)
})

test('recrear perfil y fallar después conserva nueva identidad y modos pendientes', async () => {
  const { api, server } = createFakeApi()
  let state = (await sync(api, createDefaultState())).state
  const profile = state.profiles[0]
  state = updateMode(state, state.modes[0].id, { settings: { sensitivity: 11 } })
  server.deleteProfileElsewhere(profile.id)
  interruptOnce(api, 'createContext', false, 'DATOS_INVALIDOS')
  const partial = reload(await failure(sync(api, state, { resolutions: { [`profile:${profile.id}`]: 'recrear' } })))
  assert.notEqual(partial.profiles[0].id, profile.id)
  assert.ok(partial.modes.every(m => m.profileId === partial.profiles[0].id && m.version === null && m.dirty))
  const result = await sync(api, partial)
  assert.equal(result.conflicts.length, 0)
  assert.equal(server.profiles.size, 1)
  assert.equal(server.modes.size, 3)
  assert.equal(result.state.modes[0].settings.sensitivity, 11)
})
