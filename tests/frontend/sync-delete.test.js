import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { synchronize } from '../../src/sync/syncEngine.js'
import { OUTCOME, runSync } from '../../src/sync/syncSession.js'
import { modeEtag, profileEtag } from '../../src/sync/etag.js'
import { createDefaultState, hasPendingChanges, normalizeState, removeMode, removeProfile } from '../../src/data/preferences.js'

const retry = { retries: 2, sleep: async () => {} }
const sync = (api, state, extra = {}) => synchronize({ api, state, retry, ...extra })
const reload = state => normalizeState(JSON.parse(JSON.stringify(state)))
const deletes = server => server.log.filter(([name]) => name.startsWith('delete'))
const memoryStorage = () => { const map = new Map(); return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) } }
async function synced(options) {
  const fake = createFakeApi(options)
  const { state } = await sync(fake.api, createDefaultState())
  return { ...fake, state }
}

test('modo: el DELETE lleva el If-Match del estado conocido, se confirma y la marca se retira', async () => {
  const { api, server, state } = await synced()
  const mode = state.modes[0]
  const result = await sync(api, removeMode(state, mode.id))
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.deleted, 1)
  assert.deepEqual(result.state.tombstones, [])
  assert.ok(!server.modes.has(mode.id))
  assert.deepEqual(deletes(server), [['deleteContext', mode.id, await modeEtag(mode.id, mode.version)]])
  assert.ok(!hasPendingChanges(result.state) || result.state.modes.some(m => m.dirty), 'sin marcas de borrado pendientes')
})

test('perfil: la cascada se envía con el ETag de agregado (perfil + modos conocidos) y borra todo', async () => {
  const { api, server, state } = await synced()
  const profile = state.profiles[0]
  const known = state.modes.map(m => ({ id: m.id, version: m.version }))
  const result = await sync(api, removeProfile(state, profile.id))
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.deleted, 1)
  assert.deepEqual(result.state.tombstones, [])
  assert.deepEqual([server.profiles.size, server.modes.size, server.assignments.size], [0, 0, 0])
  assert.deepEqual(deletes(server), [['deleteProfile', profile.id, await profileEtag(profile.id, profile.version, known)]])
})

test('un modo borrado y luego su perfil: los modos van primero y el agregado del perfil coincide', async () => {
  const { api, server, state } = await synced()
  const [first] = state.modes
  const removed = removeProfile(removeMode(state, first.id), state.profiles[0].id)
  assert.deepEqual(removed.tombstones.map(t => t.kind), ['mode', 'profile'])
  const result = await sync(api, removed)
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(deletes(server).map(([name]) => name), ['deleteContext', 'deleteProfile'], 'primero el modo, después el perfil')
  assert.deepEqual([server.profiles.size, server.modes.size], [0, 0])
  assert.deepEqual(result.state.tombstones, [])
})

test('cambios concurrentes en otro equipo: el servidor rechaza (412), no borra nada y la marca se conserva', async () => {
  const concurrent = {
    'edición del modo': (server, ids) => server.editModeElsewhere(ids.mode, { sensibilidad_puntero: 99 }),
    'edición de sus asignaciones': (server, ids) => server.setAssignmentElsewhere(ids.mode, 'micro_pinza', 'clic', false),
    'modo nuevo en el perfil': (server, ids) => server.createModeElsewhere(ids.profile, 'Creado en otro equipo'),
    'edición del perfil': (server, ids) => server.editProfileElsewhere(ids.profile, { descripcion: 'otro equipo' }),
  }
  for (const [kind, change] of [['mode', 'edición del modo'], ['mode', 'edición de sus asignaciones'], ['profile', 'edición del modo'], ['profile', 'edición de sus asignaciones'], ['profile', 'modo nuevo en el perfil'], ['profile', 'edición del perfil']]) {
    const { api, server, state } = await synced()
    const ids = { mode: state.modes[0].id, profile: state.profiles[0].id }
    const removed = kind === 'mode' ? removeMode(state, ids.mode) : removeProfile(state, ids.profile)
    concurrent[change](server, ids)
    const snapshot = JSON.stringify([...server.profiles.values(), ...server.modes.values(), [...server.assignments.entries()].map(([id, m]) => [id, [...m.entries()]])])
    const result = await sync(api, reload(removed))
    const label = `${kind} / ${change}`
    assert.equal(result.conflicts.length, 1, label)
    assert.deepEqual([result.conflicts[0].type, result.conflicts[0].kind, result.conflicts[0].options], ['borrado_modificado', kind, ['recuperar', 'borrar']], label)
    assert.equal(result.changes.deleted, 0, label)
    assert.equal(result.state.tombstones.length, 1, `${label}: la marca se conserva`)
    assert.ok(hasPendingChanges(result.state))
    assert.equal(deletes(server).length, 1, `${label}: se intentó una vez, con precondición`)
    assert.equal(JSON.stringify([...server.profiles.values(), ...server.modes.values(), [...server.assignments.entries()].map(([id, m]) => [id, [...m.entries()]])]), snapshot, `${label}: el servidor quedó intacto`)
  }
})

test('recuperar: cancela el borrado y descarga lo que hay ahora, incluidos los cambios de otro equipo', async () => {
  const { api, server, state } = await synced()
  const mode = state.modes[0]
  server.editModeElsewhere(mode.id, { sensibilidad_puntero: 99 })
  const blocked = await sync(api, removeMode(state, mode.id))
  assert.equal(blocked.conflicts[0].type, 'borrado_modificado')
  const result = await sync(api, blocked.state, { resolutions: { [`mode:${mode.id}`]: 'recuperar' } })
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(result.state.tombstones, [])
  const back = result.state.modes.find(m => m.id === mode.id)
  assert.equal(back.settings.sensitivity, 99, 'vuelve con el cambio del otro equipo')
  assert.ok(server.modes.has(mode.id))
  assert.equal(deletes(server).length, 1, 'no se envió ningún otro DELETE')
})

test('borrar de todos modos: lee el estado actual y borra ESE estado; si vuelve a cambiar, otro 412', async () => {
  const { api, server, state } = await synced()
  const mode = state.modes[0]
  server.editModeElsewhere(mode.id, { sensibilidad_puntero: 99 })
  const blocked = await sync(api, removeMode(state, mode.id))
  const forced = await sync(api, blocked.state, { resolutions: { [`mode:${mode.id}`]: 'borrar' } })
  assert.deepEqual(forced.conflicts, [])
  assert.equal(forced.changes.deleted, 1)
  assert.ok(!server.modes.has(mode.id))
  assert.deepEqual(forced.state.tombstones, [])
  assert.equal(deletes(server).at(-1)[2], await modeEtag(mode.id, mode.version + 1), 'la precondición es la versión que se leyó en ese momento')

  // Perfil: entre la lectura y el DELETE otro equipo vuelve a cambiar algo → 412 de nuevo, sin borrar.
  const second = await synced()
  const profile = second.state.profiles[0]
  second.server.editModeElsewhere(second.state.modes[1].id, { sensibilidad_puntero: 5 })
  const first412 = await sync(second.api, removeProfile(second.state, profile.id))
  assert.equal(first412.conflicts[0].type, 'borrado_modificado')
  const original = second.api.contexts
  second.api.contexts = async (...args) => { const r = await original(...args); second.server.createModeElsewhere(profile.id, 'Llegó justo ahora'); return r }
  const again = await sync(second.api, first412.state, { resolutions: { [`profile:${profile.id}`]: 'borrar' } })
  assert.equal(again.conflicts[0].type, 'borrado_modificado')
  assert.ok(second.server.profiles.has(profile.id), 'el perfil sigue en el servidor')
  assert.equal(again.state.tombstones.length, 1)
})

test('404 = ya borrado: otro equipo lo borró antes; la marca se retira sin error ni recuento', async () => {
  const { api, server, state } = await synced()
  const mode = state.modes[0]
  const removed = removeMode(state, mode.id)
  server.deleteModeElsewhere(mode.id)
  const result = await sync(api, removed)
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.deleted, 0)
  assert.deepEqual(result.state.tombstones, [])
})

test('respuesta perdida tras aplicarse el DELETE: el reintento da 404 y no es un error ni un segundo borrado', async () => {
  const { api, server, state } = await synced()
  const profile = state.profiles[0]
  const original = api.deleteProfile
  let lost = false
  api.deleteProfile = async (...args) => { const r = await original(...args); if (!lost) { lost = true; throw { code: 'SERVICE_RESPONSE', message: 'Respuesta perdida' } } return r }
  const result = await sync(api, removeProfile(state, profile.id))
  assert.equal(lost, true)
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(result.state.tombstones, [])
  assert.deepEqual([server.profiles.size, server.modes.size], [0, 0])
  assert.equal(deletes(server).length, 2, 'el segundo intento encontró el perfil ya borrado (404)')
})

test('servidor anterior: nunca se envía un DELETE; recuperar sigue funcionando', async () => {
  const { api, server, state } = await synced({ conditionalDelete: false })
  const mode = state.modes[0]
  const blocked = await sync(api, removeMode(state, mode.id))
  assert.equal(blocked.conflicts[0].type, 'borrado_no_seguro')
  assert.equal(blocked.conflicts[0].reason, 'servidor')
  assert.deepEqual(blocked.conflicts[0].options, [])
  assert.equal(deletes(server).length, 0)
  const forced = await sync(api, blocked.state, { resolutions: { [`mode:${mode.id}`]: 'borrar' } })
  assert.equal(forced.conflicts[0].type, 'borrado_no_seguro', 'tampoco se puede forzar en un servidor sin garantía')
  assert.equal(deletes(server).length, 0)
  const recovered = await sync(api, forced.state, { resolutions: { [`mode:${mode.id}`]: 'recuperar' } })
  assert.deepEqual(recovered.conflicts, [])
  assert.ok(recovered.state.modes.some(m => m.id === mode.id))
})

test('sin anuncio fiable del servidor no se borra: sin ruta, sin cliente o con respuesta inesperada', async () => {
  for (const break_ of [
    api => { delete api.capabilities },
    api => { api.capabilities = async () => { throw { code: 'RUTA_NO_ENCONTRADA', message: 'No existe.' } } },
    api => { api.capabilities = async () => ({ data: { servidor: { borrado_condicional: 'si' } } }) },
    api => { api.capabilities = async () => ({ data: {} }) },
  ]) {
    const { api, server, state } = await synced()
    break_(api)
    const result = await sync(api, removeMode(state, state.modes[0].id))
    assert.equal(result.conflicts[0].type, 'borrado_no_seguro')
    assert.equal(deletes(server).length, 0)
    assert.equal(result.state.tombstones.length, 1)
  }
})

test('un fallo transitorio al consultar las capacidades interrumpe la sincronización: no se confunde con «sin garantía»', async () => {
  const { api, server, state } = await synced()
  api.capabilities = async () => { throw { code: 'SERVICE_OFFLINE', message: 'Sin conexión.' } }
  await assert.rejects(sync(api, removeMode(state, state.modes[0].id)), error => error.code === 'SERVICE_OFFLINE' && error.state.tombstones.length === 1)
  assert.equal(deletes(server).length, 0)
})

test('marca antigua sin versión: no se envía a ciegas; recuperar o borrar de todos modos con el estado actual', async () => {
  for (const [decision, remains] of [['recuperar', true], ['borrar', false]]) {
    const { api, server, state } = await synced()
    const mode = state.modes[0]
    const old = removeMode(state, mode.id)
    old.tombstones = [{ kind: 'mode', id: mode.id }]
    const blocked = await sync(api, reload(old))
    assert.deepEqual([blocked.conflicts[0].type, blocked.conflicts[0].reason, blocked.conflicts[0].options], ['borrado_no_seguro', 'sin_version', ['recuperar', 'borrar']])
    assert.equal(deletes(server).length, 0)
    const result = await sync(api, blocked.state, { resolutions: { [`mode:${mode.id}`]: decision } })
    assert.deepEqual(result.conflicts, [], decision)
    assert.equal(server.modes.has(mode.id), remains, decision)
    assert.equal(result.state.modes.some(m => m.id === mode.id), remains, decision)
    assert.deepEqual(result.state.tombstones, [], decision)
  }
})

test('runSync: un borrado confirmado cuenta como sincronizado; uno rechazado (412) nunca se anuncia como éxito', async () => {
  const storage = memoryStorage()
  const ok = await synced()
  const done = await runSync({ api: ok.api, accountId: 'u', state: removeMode(ok.state, ok.state.modes[0].id), retry, storage })
  assert.equal(done.outcome, OUTCOME.SYNCED)
  assert.equal(done.changes.deleted, 1)
  assert.deepEqual(done.state.tombstones, [])

  const clash = await synced()
  clash.server.editModeElsewhere(clash.state.modes[0].id, { sensibilidad_puntero: 7 })
  const blocked = await runSync({ api: clash.api, accountId: 'v', state: removeMode(clash.state, clash.state.modes[0].id), retry, storage })
  assert.equal(blocked.outcome, OUTCOME.CONFLICTS)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.conflicts[0].type, 'borrado_modificado')
  assert.equal(blocked.state.tombstones.length, 1, 'la marca sobrevive y se guarda')
})
