import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { synchronize } from '../../src/sync/syncEngine.js'
import { IDEMPOTENCY_KEY_PATTERN, idempotencyKeyTime, isIdempotencyKey, newIdempotencyKey } from '../../src/sync/idempotency.js'
import { createDefaultState, normalizeState } from '../../src/data/preferences.js'
// La clave del cliente debe ser aceptada por el validador REAL del servidor, no por una copia.
import { RETENCION_MS, parseIdempotencyKey } from '../../backend/src/domain/idempotencia.js'

const DAY = 24 * 60 * 60 * 1000
const retry = { retries: 2, sleep: async () => {} }
const sync = (api, state, extra = {}) => synchronize({ api, state, retry, ...extra })
const reload = state => normalizeState(JSON.parse(JSON.stringify(state)))
const failure = async promise => {
  try { await promise; assert.fail('Se esperaba una sincronización interrumpida') }
  catch (error) { assert.ok(error.state, 'el error debe entregar el estado parcial'); return error.state }
}
/** Las próximas `times` llamadas a `method` fallan; con `applied` el servidor sí procesó la solicitud (respuesta perdida). */
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
const creations = server => server.log.filter(([name]) => name === 'createProfile' || name === 'createContext')
const keyOf = entry => entry.at(-1)

test('newIdempotencyKey: UUID v7 con la hora incrustada, única y aceptada por el validador del servidor', () => {
  const now = Date.UTC(2026, 10, 12, 15, 30, 45, 123)
  const key = newIdempotencyKey({ now })
  assert.match(key, IDEMPOTENCY_KEY_PATTERN)
  assert.equal(key.length, 36)
  assert.equal(key[14], '7', 'versión 7')
  assert.ok('89ab'.includes(key[19]), 'variante RFC 9562')
  assert.equal(idempotencyKeyTime(key), now)
  assert.equal(parseIdempotencyKey(key, now), key, 'el servidor la acepta')
  assert.equal(parseIdempotencyKey(key, now + RETENCION_MS - 1000), key)
  // Determinista con aleatoriedad inyectada: la hora ocupa los 6 primeros bytes y los bits fijos no se tocan.
  const zeros = newIdempotencyKey({ now: 0, random: bytes => bytes.fill(0) })
  assert.equal(zeros, '00000000-0000-7000-8000-000000000000')
  const ones = newIdempotencyKey({ now: 2 ** 48 - 1, random: bytes => bytes.fill(255) })
  assert.equal(ones, 'ffffffff-ffff-7fff-bfff-ffffffffffff')
  assert.equal(new Set(Array.from({ length: 500 }, () => newIdempotencyKey())).size, 500)
  for (const bad of [-1, 2 ** 48, 1.5, Number.NaN, Infinity]) assert.throws(() => newIdempotencyKey({ now: bad }), RangeError, String(bad))
  for (const invalid of ['', null, undefined, 12, key.toUpperCase(), key.replace('-7', '-4'), `${key} `, key.slice(1)]) {
    assert.equal(isIdempotencyKey(invalid), false, String(invalid))
    assert.equal(idempotencyKeyTime(invalid), null)
  }
})

test('api/client: la clave viaja al puente como idempotencyKey y es null si no hay', async () => {
  const calls = []
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => { calls.push([command, args]); return { data: {} } } } } }
  try {
    const { api } = await import('../../src/api/client.js')
    const key = newIdempotencyKey()
    await api.createProfile({ name: 'A' }, key)
    await api.createProfile({ name: 'B' })
    await api.createContext('11111111-1111-4111-8111-111111111111', { name: 'C' }, key)
    await api.createContext('11111111-1111-4111-8111-111111111111', { name: 'D' })
    assert.deepEqual(calls.map(([command, args]) => [command, args.idempotencyKey]), [
      ['create_profile', key], ['create_profile', null], ['create_context', key], ['create_context', null],
    ])
  } finally { delete globalThis.window }
})

test('con un servidor que lo anuncia, cada creación lleva su propia clave UUID v7 y se consulta /capacidades una vez', async () => {
  const { api, server } = createFakeApi()
  const result = await sync(api, createDefaultState())
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.state.syncOperation, null)
  assert.equal(server.profiles.size, 1)
  assert.equal(server.modes.size, 3)
  const sent = creations(server)
  assert.equal(sent.length, 4, 'un perfil y tres modos')
  const keys = sent.map(keyOf)
  assert.ok(keys.every(isIdempotencyKey))
  assert.equal(new Set(keys).size, 4, 'una clave distinta por creación')
  assert.ok(keys.every(key => Math.abs(idempotencyKeyTime(key) - Date.now()) < 60_000))
  assert.equal(server.records.size, 4)
  assert.equal(server.log.filter(([name]) => name === 'capabilities').length, 1)
})

test('con un servidor que no lo anuncia no se envía ninguna clave y todo funciona como antes', async () => {
  const { api, server } = createFakeApi({ idempotency: false })
  const result = await sync(api, createDefaultState())
  assert.equal(result.conflicts.length, 0)
  assert.equal(server.profiles.size, 1)
  assert.equal(server.modes.size, 3)
  assert.ok(creations(server).every(entry => entry.length === (entry[0] === 'createProfile' ? 2 : 3)), 'ninguna creación lleva clave')
  assert.equal(server.records.size, 0)
})

test('un fallo de transporte con la solicitud ya aplicada se reintenta con LA MISMA clave sin duplicar', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 1, { applied: true })
  const result = await sync(api, createDefaultState())
  assert.equal(result.conflicts.length, 0)
  assert.equal(server.profiles.size, 1, 'una sola creación pese al reintento')
  const profileCreations = server.log.filter(([name]) => name === 'createProfile')
  assert.equal(profileCreations.length, 2)
  assert.equal(keyOf(profileCreations[0]), keyOf(profileCreations[1]), 'el reintento reutiliza la clave')
  assert.equal(result.state.syncOperation, null)
  assert.equal(result.state.profiles[0].version, 1)
})

for (const [label, applied] of [['respuesta perdida (el servidor creó el recurso)', true], ['solicitud perdida (el servidor no la recibió)', false]]) {
  test(`creación de perfil con ${label} tras agotar los reintentos: la siguiente sincronización la recupera sola`, async () => {
    const { api, server } = createFakeApi()
    const restore = failTimes(api, 'createProfile', 3, { applied }) // 1 intento + 2 reintentos
    const partial = reload(await failure(sync(api, createDefaultState())))
    const key = partial.syncOperation.key
    assert.ok(isIdempotencyKey(key), 'la clave queda guardada con la operación pendiente')
    assert.equal(partial.syncOperation.result, undefined)
    assert.equal(server.profiles.size, applied ? 1 : 0)
    restore()
    const recovered = await sync(api, partial)
    assert.equal(recovered.conflicts.length, 0, 'sin «resultado incierto» ni adopción manual')
    assert.equal(recovered.state.syncOperation, null)
    assert.equal(server.profiles.size, 1, 'exactamente un perfil')
    assert.equal(server.modes.size, 3)
    assert.ok(creations(server).filter(entry => entry[0] === 'createProfile').every(entry => keyOf(entry) === key), 'siempre la misma clave')
    const profile = recovered.state.profiles[0]
    assert.ok(server.profiles.has(profile.id))
    assert.equal(profile.version, server.profiles.get(profile.id).version)
    assert.ok(recovered.changes.created >= 1)
  })
}

test('creación de modo cerrada a mitad (app cerrada tras crear): se recupera repitiendo la clave', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createContext', 1, { applied: true, code: 'APP_CERRADA' }) // no transitorio: no hay reintento
  const partial = reload(await failure(sync(api, createDefaultState())))
  assert.equal(partial.syncOperation.kind, 'mode')
  assert.ok(isIdempotencyKey(partial.syncOperation.key))
  assert.equal(server.modes.size, 1)
  const recovered = await sync(api, partial)
  assert.equal(recovered.conflicts.length, 0)
  assert.equal(server.profiles.size, 1)
  assert.equal(server.modes.size, 3, 'el modo ya creado no se duplicó')
  assert.equal(new Set([...server.modes.values()].map(mode => mode.nombre)).size, 3)
  assert.equal(recovered.state.syncOperation, null)
  assert.ok(recovered.state.modes.every(mode => server.modes.has(mode.id) && mode.version !== null))
})

test('claves distintas por operación: ninguna se reutiliza entre recursos diferentes', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createContext', 1, { applied: true })
  failTimes(api, 'createProfile', 1, { applied: false })
  await sync(api, createDefaultState())
  const byResource = new Map()
  for (const entry of creations(server)) {
    const resource = entry[0] === 'createProfile' ? 'perfil' : `modo:${entry[2].name}`
    byResource.set(resource, new Set([...(byResource.get(resource) ?? []), keyOf(entry)]))
  }
  assert.equal(byResource.size, 4)
  assert.ok([...byResource.values()].every(keys => keys.size === 1), 'cada recurso usa una única clave, también al reintentar')
  assert.equal(new Set([...byResource.values()].map(keys => [...keys][0])).size, 4, 'y no se comparte entre recursos')
})

test('reloj desfasado: si el servidor rechaza la clave antes de crear nada, se crea sin idempotencia en vez de bloquear', async () => {
  const { api, server } = createFakeApi({ now: () => Date.now() - 60 * 60 * 1000 }) // el servidor va una hora por detrás
  const result = await sync(api, createDefaultState())
  assert.equal(result.conflicts.length, 0)
  assert.equal(result.state.syncOperation, null)
  assert.equal(server.profiles.size, 1)
  assert.equal(server.modes.size, 3)
  assert.equal(server.records.size, 0, 'nada se registró con clave')
  const profileCreations = server.log.filter(([name]) => name === 'createProfile')
  assert.equal(profileCreations.length, 2, 'primero con clave (rechazada) y luego sin ella')
  assert.ok(isIdempotencyKey(keyOf(profileCreations[0])))
  assert.equal(profileCreations[1].length, 2, 'el segundo intento no lleva clave')
})

test('clave expirada (más de 30 días): no se puede recuperar por repetición y queda la adopción explícita', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 3, { applied: true })
  const partial = reload(await failure(sync(api, createDefaultState())))
  partial.syncOperation.key = newIdempotencyKey({ now: Date.now() - 31 * DAY })
  const blocked = await sync(api, partial)
  assert.equal(blocked.conflicts[0].type, 'resultado_incierto')
  assert.equal(blocked.conflicts[0].candidates.length, 1, 'el perfil que sí se creó aparece como candidato')
  assert.equal(server.profiles.size, 1, 'no se creó otro')
  assert.ok(blocked.state.syncOperation, 'el registro se conserva')
  const candidate = blocked.conflicts[0].candidates[0]
  const adopted = await sync(api, blocked.state, { resolutions: { [`profile:${partial.syncOperation.id}`]: { action: 'adoptar', remoteId: candidate.id } } })
  assert.equal(adopted.conflicts.length, 0)
  assert.equal(server.profiles.size, 1)
})

test('una clave guardada dañada nunca se envía: el resultado se trata como incierto y no se duplica', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 3, { applied: true })
  const partial = reload(await failure(sync(api, createDefaultState())))
  const before = creations(server).length
  partial.syncOperation.key = 'esto-no-es-una-clave'
  const blocked = await sync(api, partial)
  assert.equal(blocked.conflicts[0].type, 'resultado_incierto')
  assert.equal(creations(server).length, before, 'no se envió ninguna creación más')
  assert.equal(server.profiles.size, 1)
  assert.ok(blocked.state.syncOperation)
})

test('una operación pendiente de una versión anterior (sin clave) sigue la vía de adopción explícita', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 3, { applied: true })
  const partial = reload(await failure(sync(api, createDefaultState())))
  delete partial.syncOperation.key
  const before = creations(server).length
  const blocked = await sync(api, partial)
  assert.equal(blocked.conflicts[0].type, 'resultado_incierto')
  assert.equal(creations(server).length, before)
})

test('si el servidor ya no anuncia la idempotencia, una operación con clave no se repite a ciegas', async () => {
  const modern = createFakeApi()
  failTimes(modern.api, 'createProfile', 3, { applied: true })
  const partial = reload(await failure(sync(modern.api, createDefaultState())))
  assert.ok(isIdempotencyKey(partial.syncOperation.key))
  const downgraded = createFakeApi({ idempotency: false })
  downgraded.server.createProfileElsewhere(partial.profiles[0].nombre)
  const blocked = await sync(downgraded.api, partial)
  assert.equal(blocked.conflicts[0].type, 'resultado_incierto')
  assert.equal(creations(downgraded.server).length, 0, 'ni una creación enviada')
  assert.equal(blocked.conflicts[0].candidates.length, 1)
})

test('si la repetición es rechazada con un error de aplicación, nada se creó y se sigue el flujo normal', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 3, { applied: false })
  const partial = reload(await failure(sync(api, createDefaultState())))
  assert.equal(server.profiles.size, 0)
  server.createProfileElsewhere(partial.profiles[0].nombre) // otro equipo creó uno con el mismo nombre mientras tanto
  const result = await sync(api, partial)
  assert.equal(result.state.syncOperation, null, 'el rechazo prueba que no se creó nada: la operación se descarta')
  assert.equal(result.conflicts[0].type, 'nombre_duplicado', 'y el choque de nombres se resuelve como siempre')
  assert.equal(server.profiles.size, 1, 'no se creó un segundo perfil')
})

test('un fallo de transporte persistente deja la operación con su clave y no declara éxito', async () => {
  const { api, server } = createFakeApi()
  failTimes(api, 'createProfile', 10, { applied: true })
  const partial = reload(await failure(sync(api, createDefaultState())))
  assert.equal(partial.syncOperation.method, 'createProfile')
  assert.ok(isIdempotencyKey(partial.syncOperation.key))
  assert.equal(server.profiles.size, 1, 'los 3 intentos con la misma clave crearon un único perfil')
  assert.equal(partial.profiles[0].version, null, 'localmente sigue pendiente de recibo')
})

for (const code of ['IDEMPOTENCIA_CONFLICTO', 'IDEMPOTENCIA_NO_DISPONIBLE', 'IDEMPOTENCIA_CLAVE_INVALIDA', 'IDEMPOTENCIA_CLAVE_EXPIRADA']) {
  test(`la repetición recibe ${code} del servidor: no se duplica, la operación se conserva y queda la adopción explícita`, async () => {
    const { api, server } = createFakeApi()
    failTimes(api, 'createProfile', 3, { applied: true })
    const partial = reload(await failure(sync(api, createDefaultState())))
    const before = creations(server).length
    api.createProfile = async (...args) => { server.log.push(['createProfile', ...args]); throw { code, message: 'Respuesta del servidor' } }
    const blocked = await sync(api, partial)
    assert.equal(blocked.conflicts[0].type, 'resultado_incierto', 'el servidor no pudo usar la clave: se cae a la vía manual')
    assert.equal(creations(server).length, before + 1, 'la repetición se intentó una sola vez y no se reenvió sin clave')
    assert.equal(server.profiles.size, 1, 'sin duplicados')
    assert.ok(blocked.state.syncOperation, 'la operación se conserva: no se descarta por un error de la clave')
    assert.equal(blocked.conflicts[0].candidates.length, 1)
  })
}

test('fallos de /capacidades que no son «la ruta no existe» interrumpen la sincronización en vez de desactivar funciones', async () => {
  for (const code of ['SESION_INVALIDA', 'REQUEST_FAILED', 'PERMISO_DENEGADO']) {
    const { api, server } = createFakeApi()
    api.capabilities = async () => { throw { code, message: 'Fallo del servidor' } }
    let caught
    try { await sync(api, createDefaultState()) } catch (error) { caught = error }
    assert.ok(caught, `${code}: la sincronización debía interrumpirse`)
    assert.equal(caught.code, code)
    assert.equal(creations(server).length, 0, `${code}: no se envió ninguna creación (ni siquiera sin clave)`)
    assert.equal(caught.state.syncOperation ?? null, null, 'no queda una operación a medias')
  }
})

test('solo la ausencia de la ruta /capacidades (servidor anterior) o un cliente sin `capabilities` crean sin clave y sin mutación conjunta', async () => {
  const variants = [
    api => { api.capabilities = async () => { throw { code: 'RUTA_NO_ENCONTRADA', message: 'No existe.' } } },
    api => { api.capabilities = async () => { throw { code: 'NO_ENCONTRADO', message: 'No existe.' } } },
    api => { delete api.capabilities },
  ]
  for (const [index, mutate] of variants.entries()) {
    const { api, server } = createFakeApi()
    mutate(api)
    const result = await sync(api, createDefaultState())
    assert.deepEqual(result.conflicts, [], `variante ${index}`)
    assert.equal(server.profiles.size, 1)
    assert.equal(server.modes.size, 3)
    assert.ok(creations(server).every(entry => entry.length === (entry[0] === 'createProfile' ? 2 : 3)), `variante ${index}: ninguna clave`)
    assert.equal(server.log.filter(([name]) => name === 'setModeGestures').length, 3, `variante ${index}: dos pasos`)
  }
})
