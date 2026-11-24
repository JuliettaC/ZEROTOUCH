import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { OUTCOME, describeOutcome, isSyncRunning, runSync, syncSummary } from '../../src/sync/syncSession.js'
import { GUEST, createDefaultState, hasPendingChanges, loadState, removeMode, storageKey, updateMode } from '../../src/data/preferences.js'

const retry = { retries: 0, sleep: async () => {} }
const memoryStorage = () => { const map = new Map(); return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), keys: () => [...map.keys()] } }
const run = (api, accountId, state, extra = {}) => runSync({ api, accountId, state, retry, clock: () => '2026-11-11T12:00:00.000Z', ...extra })

test('sincronización completa: «sincronizado» solo sin pendientes y guardado en la cuenta capturada', async () => {
  const { api } = createFakeApi()
  const storage = memoryStorage()
  const result = await run(api, 'usuario-1', createDefaultState(), { storage })
  assert.equal(result.outcome, OUTCOME.SYNCED)
  assert.equal(result.ok, true)
  assert.equal(hasPendingChanges(result.state), false)
  assert.deepEqual(storage.keys(), [storageKey('usuario-1')], 'solo el espacio de la cuenta, nunca el de invitado')
  const reloaded = loadState('usuario-1', storage)
  assert.equal(reloaded.profiles[0].version, result.state.profiles[0].version)
  assert.deepEqual(reloaded.lastSync, { at: '2026-11-11T12:00:00.000Z', status: 'ok' })
  assert.match(describeOutcome(result), /^Sincronizado: /)
})

test('el invitado no sincroniza y no toca el almacenamiento', async () => {
  const { api, server } = createFakeApi()
  const storage = memoryStorage()
  const result = await run(api, null, createDefaultState(), { storage })
  assert.equal(result.outcome, OUTCOME.NO_ACCOUNT)
  assert.equal(server.log.length, 0)
  assert.deepEqual(storage.keys(), [])
  assert.equal(GUEST, 'invitado')
})

test('con un servidor anterior (sin borrado condicional) una lápida nunca se anuncia como éxito ni envía DELETE', async () => {
  const { api, server } = createFakeApi({ conditionalDelete: false })
  const storage = memoryStorage()
  const first = await run(api, 'u', createDefaultState(), { storage })
  const victim = first.state.modes[0]
  const second = await run(api, 'u', removeMode(first.state, victim.id), { storage })
  assert.equal(second.outcome, OUTCOME.CONFLICTS)
  assert.equal(second.ok, false)
  assert.ok(second.conflicts.some(c => c.type === 'borrado_no_seguro' && c.reason === 'servidor' && c.id === victim.id))
  assert.equal(server.log.filter(entry => /^delete/.test(entry[0])).length, 0, 'DELETE bloqueado')
  assert.ok(server.modes.has(victim.id), 'el modo sigue en el servidor')
  assert.equal(loadState('u', storage).tombstones.length, 1, 'la lápida sobrevive a la recarga')
  assert.match(describeOutcome(second), /requiere tu decisión|requieren tu decisión/)
  assert.doesNotMatch(describeOutcome(second), /^Sincronizado/)
})

test('un fallo a medias conserva identidades y versiones confirmadas y se puede reintentar sin duplicar (servidor sin mutación conjunta)', async () => {
  const { api, server } = createFakeApi({ jointMode: false })
  const storage = memoryStorage()
  const original = api.setModeGestures
  let calls = 0
  api.setModeGestures = async (...args) => { calls += 1; if (calls === 2) throw { code: 'SERVICE_OFFLINE', message: 'Sin conexión.' }; return original(...args) }
  const failed = await run(api, 'u', createDefaultState(), { storage })
  assert.equal(failed.outcome, OUTCOME.INTERRUPTED)
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'SERVICE_OFFLINE')
  assert.match(describeOutcome(failed), /quedó guardado/)
  const saved = loadState('u', storage)
  assert.equal(saved.profiles[0].version, 1, 'el perfil confirmado conserva su versión')
  assert.ok(saved.modes.some(m => m.version !== null), 'al menos un modo confirmado conserva identidad y versión')
  assert.ok(hasPendingChanges(saved), 'lo no confirmado sigue pendiente')
  assert.ok(saved.syncOperation, 'queda el registro de la operación a medias')
  const profilesBefore = server.profiles.size, modesBefore = server.modes.size
  const retried = await run(api, 'u', saved, { storage })
  assert.equal(retried.outcome, OUTCOME.SYNCED)
  assert.equal(retried.recovered, true, 'se retomó la operación que había quedado a medias')
  assert.equal(server.profiles.size, profilesBefore, 'sin perfiles duplicados')
  assert.ok(server.modes.size >= modesBefore && server.modes.size === 3, 'sin modos duplicados')
})

test('las ediciones locales hechas tras una interrupción no se pierden al reintentar', async () => {
  const { api, server } = createFakeApi()
  const storage = memoryStorage()
  const first = await run(api, 'u', createDefaultState(), { storage })
  const mode = first.state.modes[0]
  const edited = updateMode(first.state, mode.id, { settings: { sensitivity: 11 } })
  const original = api.updateContext
  api.updateContext = async () => { throw { code: 'SERVICE_OFFLINE', message: 'Sin conexión.' } }
  const failed = await run(api, 'u', edited, { storage })
  assert.equal(failed.outcome, OUTCOME.INTERRUPTED)
  const local = loadState('u', storage).modes.find(m => m.id === mode.id)
  assert.equal(local.settings.sensitivity, 11, 'el cambio local sigue guardado')
  assert.equal(local.dirty, true)
  api.updateContext = original
  const ok = await run(api, 'u', loadState('u', storage), { storage })
  assert.equal(ok.outcome, OUTCOME.SYNCED)
  assert.equal(server.modes.get(mode.id).sensibilidad_puntero, 11)
})

test('dos ejecuciones simultáneas de la misma cuenta se serializan; otras cuentas son independientes', async () => {
  const { api, server } = createFakeApi()
  const storage = memoryStorage()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const original = api.profiles
  api.profiles = async (...args) => { await gate; return original(...args) }
  const state = createDefaultState()
  const a = run(api, 'u', state, { storage })
  assert.equal(isSyncRunning('u'), true)
  const b = await run(api, 'u', state, { storage })
  assert.equal(b.outcome, OUTCOME.BUSY)
  assert.equal(b.state, state, 'la ejecución rechazada no modifica el estado')
  release()
  const done = await a
  assert.equal(done.outcome, OUTCOME.SYNCED)
  assert.equal(isSyncRunning('u'), false, 'la cuenta queda libre al terminar')
  assert.equal(server.profiles.size, 1)
  const other = await run(api, 'otra', createDefaultState(), { storage })
  assert.notEqual(other.outcome, OUTCOME.BUSY)
})

test('la cuenta se libera aunque la sincronización falle', async () => {
  const { api, server } = createFakeApi()
  server.setOffline(true)
  const failed = await run(api, 'u', createDefaultState(), { storage: memoryStorage() })
  assert.equal(failed.outcome, OUTCOME.INTERRUPTED)
  assert.equal(isSyncRunning('u'), false)
  server.setOffline(false)
  assert.equal((await run(api, 'u', failed.state, { storage: memoryStorage() })).outcome, OUTCOME.SYNCED)
})

test('si el almacenamiento falla se conserva el estado en memoria y se avisa; no se anuncia éxito', async () => {
  const { api } = createFakeApi()
  const storage = { getItem: () => null, setItem: () => { throw new Error('cuota llena') } }
  const result = await run(api, 'u', createDefaultState(), { storage })
  assert.equal(result.persistFailed, true)
  assert.equal(result.ok, false)
  assert.equal(result.outcome, OUTCOME.INTERRUPTED)
  assert.equal(result.error.code, 'SYNC_STORAGE')
  assert.ok(result.state.profiles.length === 1, 'el estado en memoria no se pierde')
  assert.match(describeOutcome(result), /guardar/)
})

test('el mensaje distingue «al día» de «operación recuperada» y no se confunde con éxito si hay conflictos', () => {
  const zero = { created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 }
  assert.equal(describeOutcome({ outcome: OUTCOME.SYNCED, changes: zero, recovered: false }), 'Todo estaba al día.')
  assert.match(describeOutcome({ outcome: OUTCOME.SYNCED, changes: zero, recovered: true }), /recuperó la operación/)
  assert.equal(describeOutcome({ outcome: OUTCOME.SYNCED, changes: { ...zero, created: 2, pulled: 1 }, recovered: true }), 'Sincronizado: 2 creados, 1 descargado.')
})

test('el resumen de cabecera sale del estado guardado y nunca dice «sincronizado» con pendientes', async () => {
  const { api } = createFakeApi()
  const format = () => '12:00'
  const fresh = createDefaultState()
  assert.deepEqual(syncSummary(fresh, { account: null }), { tone: 'local', text: 'Solo en este equipo' })
  assert.equal(syncSummary(fresh, { account: { id: 'u' }, format }).tone, 'pending', 'recién creado: todo pendiente')
  assert.equal(syncSummary(fresh, { account: { id: 'u' }, locked: true }).text, 'Sincronizando…')
  const synced = await run(api, 'u', fresh, { storage: memoryStorage() })
  assert.deepEqual(syncSummary(synced.state, { account: { id: 'u' }, format }), { tone: 'ok', text: 'Sincronizado · 12:00' })
  const edited = updateMode(synced.state, synced.state.modes[0].id, { settings: { stability: 3 } })
  assert.deepEqual(syncSummary(edited, { account: { id: 'u' }, format }), { tone: 'pending', text: 'Cambios sin sincronizar · última vez 12:00' })
  const deleted = removeMode(synced.state, synced.state.modes[0].id)
  assert.equal(syncSummary(deleted, { account: { id: 'u' }, format }).tone, 'pending', 'una lápida sin enviar es un cambio pendiente')
  const halfway = { ...synced.state, syncOperation: { method: 'createContext', kind: 'mode', id: synced.state.modes[0].id, args: [] } }
  assert.equal(syncSummary(halfway, { account: { id: 'u' }, format }).tone, 'warning')
})

test('un resultado incierto conserva el registro y no se declara éxito (servidor sin idempotencia)', async () => {
  const { api, server } = createFakeApi({ idempotency: false })
  const storage = memoryStorage()
  const original = api.createProfile
  api.createProfile = async (...args) => { await original(...args); throw { code: 'SERVICE_RESPONSE', message: 'Respuesta perdida' } }
  const failed = await run(api, 'u', createDefaultState(), { storage })
  assert.equal(failed.outcome, OUTCOME.INTERRUPTED)
  assert.ok(failed.state.syncOperation, 'queda el registro de la operación incierta')
  api.createProfile = original
  const blocked = await run(api, 'u', loadState('u', storage), { storage })
  assert.equal(blocked.outcome, OUTCOME.CONFLICTS)
  assert.ok(blocked.conflicts.some(c => c.type === 'resultado_incierto'))
  assert.equal(server.profiles.size, 1, 'no se repitió el POST')
  const candidate = blocked.conflicts[0].candidates[0]
  const resolved = await run(api, 'u', blocked.state, { storage, resolutions: { [`profile:${blocked.conflicts[0].id}`]: { action: 'adoptar', remoteId: candidate.id } } })
  assert.equal(resolved.state.syncOperation, null)
  assert.equal(server.profiles.size, 1, 'adoptar no crea otro perfil')
})
