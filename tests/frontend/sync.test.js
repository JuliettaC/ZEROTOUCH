import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeApi } from './fakeApi.js'
import { synchronize } from '../../src/sync/syncEngine.js'
import { createDefaultState, updateActiveSettings, removeMode, addMode, getActiveMode, modesOf, updateMode, hasPendingChanges } from '../../src/data/preferences.js'
import { togglesFrom } from '../../src/data/capabilities.js'

const retry = { retries: 0 }

for (const joint of [true, false]) {
test(`primera sincronización: crea perfil y modos con identidad remota y sube las asignaciones (${joint ? 'mutación conjunta' : 'servidor sin mutación conjunta'})`, async () => {
  const { api, server } = createFakeApi({ jointMode: joint })
  let state = updateActiveSettings(createDefaultState(), { palm: false, pinch: false })
  const localIds = state.modes.map(m => m.id)
  const result = await synchronize({ api, state, retry })
  state = result.state
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.created, 4)
  assert.equal(state.profiles[0].version, 1)
  assert.ok(server.profiles.has(state.profiles[0].id), 'el id local se sustituye por el remoto')
  // Conjunta: una creación por modo (versión 1) y ningún PUT. Sin ella: crear + asignaciones = versión 2 y un PUT por modo.
  assert.ok(state.modes.every(m => server.modes.has(m.id) && !m.dirty && m.version === (joint ? 1 : 2)), joint ? 'un solo paso: versión 1' : 'crear + asignaciones = versión 2')
  assert.equal(server.log.filter(([name]) => name === 'setModeGestures').length, joint ? 0 : 3)
  assert.ok(!state.modes.some(m => localIds.includes(m.id)))
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen')
  const remote = (await api.modeGestures(kitchen.id)).data
  assert.equal(remote.gestos.find(g => g.gesto_codigo === 'palma_abierta').habilitado, false)
  assert.equal(remote.gestos.find(g => g.gesto_codigo === 'micro_pinza').habilitado, false)
  assert.equal(remote.gestos.find(g => g.gesto_codigo === 'dos_dedos').habilitado, true, 'los demás gestos se suben como estaban')
  assert.equal(state.activeModeId, kitchen.id, 'el modo activo sigue la identidad nueva')
  assert.ok(!hasPendingChanges(state))
})
}

test('una edición local se sube como PATCH con la versión conocida y un modo borrado no reaparece', async () => {
  const { api, server } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  const desk = state.modes.find(m => m.plantilla === 'desk')
  state = updateMode(state, desk.id, { nombre: 'Escritorio casa', settings: { sensitivity: 33 } })
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen')
  state = removeMode(state, kitchen.id)
  assert.equal(state.tombstones.length, 1)
  const result = await synchronize({ api, state, retry })
  state = result.state
  assert.deepEqual(result.conflicts, [])
  assert.equal(result.changes.deleted, 1, 'el borrado se envió con If-Match y el servidor lo aceptó')
  assert.equal(server.modes.get(desk.id).nombre, 'Escritorio casa')
  assert.equal(server.modes.get(desk.id).sensibilidad_puntero, 33)
  assert.ok(!server.modes.has(kitchen.id), 'el modo se borró en el servidor')
  assert.equal(server.log.filter(([method]) => method === 'deleteContext').length, 1)
  assert.ok(!state.modes.some(m => m.id === kitchen.id), 'no reaparece tras sincronizar')
  assert.equal(state.tombstones.length, 0, 'la lápida se retira al confirmarse')
  const again = await synchronize({ api, state, retry })
  assert.ok(!again.state.modes.some(m => m.id === kitchen.id))
  assert.equal(server.log.filter(([method]) => method === 'deleteContext').length, 1, 'no se vuelve a enviar')
  assert.equal(again.changes.pulled + again.changes.created + again.changes.updated, 0)
})

test('cambios hechos en otro equipo se descargan: ediciones, modos nuevos, perfiles nuevos y borrados', async () => {
  const { api, server } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  const desk = state.modes.find(m => m.plantilla === 'desk')
  server.editModeElsewhere(desk.id, { estabilizacion_puntero: 12 })
  server.setAssignmentElsewhere(desk.id, 'palma_abierta', 'multimedia_siguiente', true)
  const extra = server.createModeElsewhere(state.profiles[0].id, 'Taller nocturno', { categoria: 'manual' })
  const otherProfile = server.createProfileElsewhere('Oficina')
  server.createModeElsewhere(otherProfile.id, 'Reuniones')
  const assistance = state.modes.find(m => m.plantilla === 'assistance')
  server.deleteModeElsewhere(assistance.id)
  const result = await synchronize({ api, state, retry })
  state = result.state
  assert.deepEqual(result.conflicts, [])
  const pulledDesk = state.modes.find(m => m.id === desk.id)
  assert.equal(pulledDesk.settings.stability, 12)
  assert.equal(pulledDesk.plantilla, 'desk', 'la plantilla local (icono) se conserva al descargar')
  assert.deepEqual(pulledDesk.assignments.palma_abierta, { accion: 'multimedia_siguiente', habilitado: true })
  assert.ok(state.modes.some(m => m.id === extra.id && m.nombre === 'Taller nocturno'))
  assert.ok(state.profiles.some(p => p.id === otherProfile.id))
  assert.equal(modesOf(state, otherProfile.id).length, 1)
  assert.ok(!state.modes.some(m => m.id === assistance.id), 'borrado remoto sin cambios locales se elimina aquí')
})

test('edición concurrente produce un conflicto comprensible y no sobreescribe en silencio', async () => {
  const { api, server } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen')
  state = updateMode(state, kitchen.id, { settings: { sensitivity: 20 } })
  server.editModeElsewhere(kitchen.id, { sensibilidad_puntero: 80 })
  const first = await synchronize({ api, state, retry })
  assert.equal(first.conflicts.length, 1)
  assert.equal(first.conflicts[0].type, 'version')
  assert.deepEqual(first.conflicts[0].options, ['local', 'remoto'])
  assert.equal(server.modes.get(kitchen.id).sensibilidad_puntero, 80, 'el servidor no cambió')
  assert.equal(getActiveMode(first.state).settings.sensitivity, 20, 'lo local tampoco')
  // Decisión: conservar lo local.
  const keepLocal = await synchronize({ api, state: first.state, retry, resolutions: { [`mode:${kitchen.id}`]: 'local' } })
  assert.deepEqual(keepLocal.conflicts, [])
  assert.equal(server.modes.get(kitchen.id).sensibilidad_puntero, 20)
  assert.equal(keepLocal.state.modes.find(m => m.id === kitchen.id).version, server.modes.get(kitchen.id).version)
  // Otra edición concurrente, decisión: usar el servidor.
  state = updateMode(keepLocal.state, kitchen.id, { settings: { sensitivity: 5 } })
  server.editModeElsewhere(kitchen.id, { sensibilidad_puntero: 60 })
  const useRemote = await synchronize({ api, state, retry, resolutions: { [`mode:${kitchen.id}`]: 'remoto' } })
  assert.deepEqual(useRemote.conflicts, [])
  assert.equal(useRemote.state.modes.find(m => m.id === kitchen.id).settings.sensitivity, 60)
  assert.equal(server.modes.get(kitchen.id).sensibilidad_puntero, 60)
})

test('borrado remoto con cambios locales pregunta; nombre duplicado ofrece adoptar o renombrar', async () => {
  const { api, server } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  const desk = state.modes.find(m => m.plantilla === 'desk')
  state = updateMode(state, desk.id, { settings: { stability: 1 } })
  server.deleteModeElsewhere(desk.id)
  const result = await synchronize({ api, state, retry })
  assert.equal(result.conflicts[0].type, 'eliminado_remoto')
  assert.ok(result.state.modes.some(m => m.id === desk.id), 'no se pierde en silencio')
  const recreated = await synchronize({ api, state: result.state, retry, resolutions: { [`mode:${desk.id}`]: 'recrear' } })
  assert.deepEqual(recreated.conflicts, [])
  const reborn = recreated.state.modes.find(m => m.plantilla === 'desk')
  assert.ok(server.modes.has(reborn.id))
  assert.notEqual(reborn.id, desk.id)

  // Nombre duplicado: otro equipo creó "Taller" y aquí también.
  server.createModeElsewhere(recreated.state.profiles[0].id, 'Taller', { sensibilidad_puntero: 42 })
  state = addMode(recreated.state, recreated.state.profiles[0].id, { nombre: 'Taller', settings: { sensitivity: 7 } })
  const dup = await synchronize({ api, state, retry })
  assert.equal(dup.conflicts[0].type, 'nombre_duplicado')
  assert.equal(dup.state.modes.filter(m => m.nombre === 'Taller').length, 1, 'no descarga el duplicado mientras se decide')
  const renamed = await synchronize({ api, state: dup.state, retry, resolutions: { [`mode:${getActiveMode(dup.state).id}`]: 'renombrar' } })
  assert.deepEqual(renamed.conflicts, [])
  assert.deepEqual(renamed.state.modes.filter(m => m.nombre.startsWith('Taller')).map(m => m.nombre).sort(), ['Taller', 'Taller (2)'])
  assert.equal(renamed.state.modes.find(m => m.nombre === 'Taller (2)').settings.sensitivity, 7)
  assert.equal(renamed.state.modes.find(m => m.nombre === 'Taller').settings.sensitivity, 42)
})

test('sin conexión no se pierde nada: el error se propaga y las lápidas siguen pendientes', async () => {
  const { api, server } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  state = removeMode(state, state.modes[0].id)
  server.setOffline(true)
  await assert.rejects(synchronize({ api, state, retry }), err => err.code === 'SERVICE_OFFLINE')
  assert.equal(state.tombstones.length, 1)
  assert.ok(!server.log.some(([method]) => method.startsWith('delete')), 'sin conexión no se envió nada')
  server.setOffline(false)
  const result = await synchronize({ api, state, retry })
  assert.equal(result.changes.deleted, 1)
  assert.equal(result.state.tombstones.length, 0)
})

test('sincronizar los modos incorporados y sus interruptores en ambos sentidos', async () => {
  const { api } = createFakeApi()
  let state = (await synchronize({ api, state: createDefaultState(), retry })).state
  const kitchen = state.modes.find(m => m.plantilla === 'kitchen')
  state = updateActiveSettings(state, { scroll: false })
  state = (await synchronize({ api, state, retry })).state
  // Segundo equipo: estado vacío de la misma cuenta.
  const second = (await synchronize({ api, state: { ...createDefaultState(), profiles: [], modes: [], activeModeId: null, activeProfileId: null }, retry })).state
  const pulled = second.modes.find(m => m.id === kitchen.id)
  assert.ok(pulled)
  assert.equal(togglesFrom(pulled.assignments).scroll, false)
  assert.equal(pulled.settings.sensitivity, 70)
  assert.equal(second.activeModeId, pulled.id)
})
