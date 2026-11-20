// Doble en memoria de la API /api/v1 con las mismas reglas que el backend: identidad UUID, versión
// optimista (409 VERSION_CONFLICTO), nombres únicos por ámbito (409 NOMBRE_DUPLICADO), propiedad
// (404 NO_ENCONTRADO) y configuración efectiva de gestos. Permite simular otro equipo editando.
import { randomUUID } from 'node:crypto'
import contract from '../../contracts/capacidades.json' with { type: 'json' }
// El doble usa el algoritmo REAL del servidor para el borrado condicional (no una copia).
import { modeEtag, profileEtag } from '../../backend/src/domain/etag.js'
// ... y el de la idempotencia: validación de la clave, huella y retención son los del servidor, no una copia.
import { RETENCION_DIAS, fingerprint, parseIdempotencyKey } from '../../backend/src/domain/idempotencia.js'

const err = (code, message) => ({ code, message })
const norm = value => String(value ?? '').trim().normalize('NFC')
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase()

/**
 * @param {{conditionalDelete?: boolean, idempotency?: boolean, jointMode?: boolean, now?: () => number}} [options]
 * `conditionalDelete: false` simula un backend anterior: no anuncia `servidor.borrado_condicional` y su DELETE
 * ignora If-Match (borra siempre). El cliente nunca debe enviarlo.
 * `idempotency: false` simula una base sin la tabla (esquema v2): no anuncia `servidor.idempotencia` y responde 501
 * a cualquier `Idempotency-Key`. `jointMode: false` simula un backend sin la mutación conjunta: no anuncia
 * `servidor.modo_con_asignaciones` y rechaza `gestos` dentro de POST/PATCH del modo (400 DATOS_INVALIDOS). `now` es el reloj del servidor (para probar relojes desfasados y claves expiradas).
 */
export function createFakeApi({ conditionalDelete = true, idempotency = true, jointMode = true, now = Date.now } = {}) {
  let joint = jointMode // puede cambiar en caliente: el servidor se actualiza entre dos sincronizaciones
  const profiles = new Map()
  const modes = new Map()
  const assignments = new Map() // modeId -> Map(gesto -> {accion, habilitado})
  const log = []
  const records = new Map() // clave de idempotencia -> { huella, data } (solo creaciones que terminaron bien)
  let offline = false
  const dto = mode => ({ ...mode })

  /** Como el backend: sin clave se crea; con clave se registra el resultado y una repetición lo devuelve intacto. */
  function createOnce(ruta, cuerpo, key, make) {
    if (key === undefined || key === null) return { data: make() }
    if (!idempotency) throw err('IDEMPOTENCIA_NO_DISPONIBLE', 'Este servidor no tiene habilitada la idempotencia.')
    try { parseIdempotencyKey(key, now()) } catch (error) { throw err(error.code, error.message) }
    const huella = fingerprint({ metodo: 'POST', ruta, cuerpo })
    const found = records.get(key)
    if (found) {
      if (found.huella !== huella) throw err('IDEMPOTENCIA_CONFLICTO', 'Esta Idempotency-Key ya se usó con una solicitud distinta.')
      return { data: structuredClone(found.data), repetida: true }
    }
    const row = make()
    records.set(key, { huella, data: structuredClone(row) })
    return { data: row }
  }

  function requireProfile(id) { const p = profiles.get(String(id).toLowerCase()); if (!p) throw err('NO_ENCONTRADO', 'Recurso inexistente.'); return p }
  function requireMode(id) { const m = modes.get(String(id).toLowerCase()); if (!m) throw err('NO_ENCONTRADO', 'Recurso inexistente.'); return m }
  function guard(name, args) { log.push([name, ...args]); if (offline) throw err('SERVICE_OFFLINE', 'Sin conexión.') }
  /** Valida una lista completa de asignaciones y devuelve el mapa a guardar; lanza antes de cambiar nada. */
  function parseAssignments(gestos) {
    const map = new Map()
    for (const g of gestos) {
      const entry = contract.gestos[g.gesto_codigo]
      if (!entry || map.has(g.gesto_codigo)) throw err('DATOS_INVALIDOS', 'Gesto desconocido o repetido.')
      if (g.habilitado && g.accion_codigo !== 'sin_accion' && !entry.acciones.includes(g.accion_codigo)) throw err('ACCION_NO_COMPATIBLE', 'Acción no compatible.')
      map.set(g.gesto_codigo, { accion: g.accion_codigo, habilitado: g.habilitado })
    }
    return map
  }
  function rejectJointIfUnsupported(c) {
    if (c.gestos !== undefined && !joint) throw err('DATOS_INVALIDOS', 'Campo no permitido.')
  }
  function effective(mode) {
    const over = assignments.get(mode.id) || new Map()
    return {
      formato_version: 1,
      modo: dto(mode),
      gestos: Object.keys(contract.gestos).sort().map(code => {
        const o = over.get(code)
        return { gesto_codigo: code, nombre: contract.gestos[code].nombre, accion_codigo: o ? o.accion : contract.gestos[code].predeterminada, habilitado: o ? o.habilitado : true, asignacion_version: o ? 1 : null }
      }),
    }
  }

  const server = {
    profiles, modes, assignments, log, records,
    setOffline(value) { offline = value },
    /** Simula actualizar (o degradar) el servidor: desde ahora anuncia o no la mutación conjunta. */
    setJointMode(value) { joint = value },
    /** Simula otro equipo: edita el recurso directamente y sube su versión. */
    editProfileElsewhere(id, patch) { const p = requireProfile(id); Object.assign(p, patch, { version: p.version + 1 }) },
    editModeElsewhere(id, patch) { const m = requireMode(id); Object.assign(m, patch, { version: m.version + 1 }) },
    deleteProfileElsewhere(id) { for (const m of [...modes.values()]) if (m.perfil_id === id) { modes.delete(m.id); assignments.delete(m.id) } profiles.delete(id) },
    deleteModeElsewhere(id) { modes.delete(id); assignments.delete(id) },
    createProfileElsewhere(nombre, descripcion = '') { const p = { id: randomUUID(), nombre: norm(nombre), descripcion, version: 1 }; profiles.set(p.id, p); return p },
    createModeElsewhere(profileId, nombre, extra = {}) {
      const m = { id: randomUUID(), perfil_id: profileId, nombre: norm(nombre), categoria: 'personalizado', plataforma: 'pc', sensibilidad_puntero: 65, estabilizacion_puntero: 40, tolerancia_micro_pinza: 50, desk_rest_habilitado: false, asistencia_mirada_habilitada: false, activacion_contextual_movil: false, version: 1, ...extra }
      modes.set(m.id, m); return m
    },
    setAssignmentElsewhere(modeId, gesto, accion, habilitado) { const m = requireMode(modeId); if (!assignments.has(m.id)) assignments.set(m.id, new Map()); assignments.get(m.id).set(gesto, { accion, habilitado }); m.version += 1 },
  }

  const api = {
    async profiles(offset) { guard('profiles', [offset]); return { data: [...profiles.values()].slice(offset, offset + 100).map(dto), paginacion: { limite: 100, offset } } },
    async createProfile(p, key) {
      guard('createProfile', key === undefined ? [p] : [p, key])
      return createOnce('/perfiles', p, key, () => {
        if ([...profiles.values()].some(x => same(x.nombre, p.name))) throw err('NOMBRE_DUPLICADO', 'Ya existe un recurso con ese nombre en este ámbito.')
        const row = { id: randomUUID(), nombre: norm(p.name), descripcion: p.description ?? '', version: 1 }
        profiles.set(row.id, row); return dto(row)
      })
    },
    async updateProfile(id, p) {
      guard('updateProfile', [id, p]); const row = requireProfile(id)
      if (row.version !== p.version) throw err('VERSION_CONFLICTO', 'El recurso cambió; vuelve a consultarlo.')
      if ([...profiles.values()].some(x => x.id !== row.id && same(x.nombre, p.name))) throw err('NOMBRE_DUPLICADO', 'Duplicado.')
      Object.assign(row, { nombre: norm(p.name), descripcion: p.description ?? row.descripcion, version: row.version + 1 }); return { data: dto(row) }
    },
    async deleteProfile(id, ifMatch) {
      guard('deleteProfile', [id, ifMatch]); const row = requireProfile(id)
      if (conditionalDelete) {
        if (ifMatch === undefined) throw err('PRECONDICION_REQUERIDA', 'Falta If-Match.')
        const children = [...modes.values()].filter(m => m.perfil_id === row.id)
        if (profileEtag(row.id, row.version, children) !== ifMatch) throw err('PRECONDICION_FALLIDA', 'El recurso cambió; no se borró nada.')
      }
      server.deleteProfileElsewhere(row.id); return null
    },
    async contexts(profileId, offset) { guard('contexts', [profileId, offset]); const p = requireProfile(profileId); return { data: [...modes.values()].filter(m => m.perfil_id === p.id).slice(offset, offset + 100).map(dto), paginacion: { limite: 100, offset } } },
    async createContext(profileId, c, key) {
      guard('createContext', key === undefined ? [profileId, c] : [profileId, c, key]); const p = requireProfile(profileId)
      rejectJointIfUnsupported(c)
      const parsed = c.gestos === undefined ? null : parseAssignments(c.gestos)
      return createOnce(`/perfiles/${p.id}/modos`, c, key, () => {
        if ([...modes.values()].some(m => m.perfil_id === p.id && same(m.nombre, c.name))) throw err('NOMBRE_DUPLICADO', 'Duplicado.')
        const row = { id: randomUUID(), perfil_id: p.id, nombre: norm(c.name), categoria: c.categoria ?? 'personalizado', plataforma: 'pc', sensibilidad_puntero: c.sensitivity, estabilizacion_puntero: c.stability, tolerancia_micro_pinza: c.pinchTolerance, desk_rest_habilitado: c.deskRest, asistencia_mirada_habilitada: Boolean(c.gazeAssist), activacion_contextual_movil: false, version: 1 }
        modes.set(row.id, row); if (parsed) assignments.set(row.id, parsed); return dto(row)
      })
    },
    async updateContext(id, c) {
      guard('updateContext', [id, c]); const row = requireMode(id)
      rejectJointIfUnsupported(c)
      const parsed = c.gestos === undefined ? null : parseAssignments(c.gestos)
      if (row.version !== c.version) throw err('VERSION_CONFLICTO', 'El recurso cambió; vuelve a consultarlo.')
      if (parsed) assignments.set(row.id, parsed)
      Object.assign(row, { nombre: norm(c.name), categoria: c.categoria ?? row.categoria, sensibilidad_puntero: c.sensitivity, estabilizacion_puntero: c.stability, tolerancia_micro_pinza: c.pinchTolerance, desk_rest_habilitado: c.deskRest, asistencia_mirada_habilitada: Boolean(c.gazeAssist), version: row.version + 1 })
      return { data: dto(row) }
    },
    async deleteContext(id, ifMatch) {
      guard('deleteContext', [id, ifMatch]); const row = requireMode(id)
      if (conditionalDelete) {
        if (ifMatch === undefined) throw err('PRECONDICION_REQUERIDA', 'Falta If-Match.')
        if (modeEtag(row.id, row.version) !== ifMatch) throw err('PRECONDICION_FALLIDA', 'El recurso cambió; no se borró nada.')
      }
      server.deleteModeElsewhere(row.id); return null
    },
    async capabilities() { guard('capabilities', []); return { data: { ...contract, servidor: { borrado_condicional: conditionalDelete, modo_con_asignaciones: joint, idempotencia: idempotency ? { clave: 'uuid-v7', retencion_dias: RETENCION_DIAS } : false } } } },
    async modeGestures(id) { guard('modeGestures', [id]); return { data: effective(requireMode(id)) } },
    async setModeGestures(id, body) {
      guard('setModeGestures', [id, body]); const row = requireMode(id)
      if (row.version !== body.version) throw err('VERSION_CONFLICTO', 'El recurso cambió; vuelve a consultarlo.')
      const map = parseAssignments(body.gestos)
      assignments.set(row.id, map); row.version += 1
      return { data: effective(row) }
    },
  }
  return { api, server }
}
