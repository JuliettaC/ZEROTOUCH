// Sincronización por identidad y versión entre las preferencias locales y la API /api/v1.
//
// Reglas:
// - Cada perfil y modo local conserva el UUID remoto y la `version` conocida en la última sincronización.
// - Un recurso local sin versión se CREA; uno marcado `dirty` se ACTUALIZA solo si la versión remota
//   es la que conocíamos; si cambió en otro equipo se devuelve un CONFLICTO y no se sobreescribe nada.
// - Un borrado local de un recurso sincronizado deja una lápida que se envía como DELETE con `If-Match` (ETag de agregado en
//   perfiles) solo si el servidor lo garantiza; si algo cambió en otro equipo hay conflicto y no se borra nada.
// - Un recurso borrado en el servidor se elimina localmente si no tiene cambios; si los tiene, conflicto.
// - Los modos incorporados son modos normales: se sincronizan igual que los personalizados.
// - Si el servidor anuncia `servidor.idempotencia`, cada creación lleva una clave (UUID v7) guardada con la operación
//   pendiente: un fallo de transporte se reintenta con la misma clave y una creación cuya respuesta se perdió se
//   recupera repitiéndola, sin duplicar ni pedir una adopción manual. Sin el anuncio, todo funciona como antes.
// - Si el servidor anuncia `servidor.modo_con_asignaciones`, un modo y sus asignaciones se crean o se actualizan en UNA sola
//   solicitud atómica (`gestos` dentro del POST/PATCH del modo) con una sola subida de versión: otro equipo nunca ve
//   ajustes nuevos con asignaciones antiguas, y un fallo no deja el modo a medias. Sin el anuncio, siguen los dos pasos.
// Módulo puro: recibe la API y el estado; devuelve el estado nuevo, los conflictos y un resumen.
import { allPages } from '../api/paging.js'
import { withRetry } from './retry.js'
import { uniqueName } from './names.js'
import { modeEtag, profileEtag } from './etag.js'
import { IDEMPOTENCY_UNAVAILABLE_CODES, isIdempotencyKey, newIdempotencyKey } from './idempotency.js'
import { assignmentsToExport, assignmentsFromExport } from '../data/capabilities.js'
import { adoptRemote, clearTombstone, dropLocal, markSynced, modesOf, upsertRemoteMode, upsertRemoteProfile } from '../data/preferences.js'

const lower = value => String(value ?? '').toLowerCase()
export const conflictKey = (kind, id) => `${kind}:${id}`
const sameName = (a, b) => String(a).trim().normalize('NFC').toLowerCase() === String(b).trim().normalize('NFC').toLowerCase()

export const profilePayload = profile => ({ name: profile.nombre, description: profile.descripcion })
export const modePayload = mode => ({
  name: mode.nombre,
  categoria: mode.categoria,
  sensitivity: mode.settings.sensitivity,
  stability: mode.settings.stability,
  pinchTolerance: mode.settings.pinchTolerance,
  deskRest: mode.settings.deskRest,
  gazeAssist: mode.settings.gazeAssist,
})

/**
 * @param {object} options
 * @param {object} options.api cliente con profiles/createProfile/updateProfile/deleteProfile/contexts/createContext/updateContext/deleteContext/modeGestures/setModeGestures
 * @param {object} options.state preferencias locales de la cuenta
 * @param {Record<string,string|{action:string,remoteId:string}>} [options.resolutions] decisiones para conflictos previos: `profile:<id>` o `mode:<id>` → 'local' | 'remoto' | 'recrear' | 'eliminar' | 'adoptar' | 'renombrar'
 * @param {function} [options.onCheckpoint] Persistir estado completo por cuenta; false o rechazo detiene el envío.
 * Errores incluyen state/conflicts/changes. Ver README.md para recuperación y serialización de UI.
 */
export async function synchronize({ api, state, resolutions = {}, retry = {}, onCheckpoint = async () => {} }) {
  const call = fn => withRetry(fn, retry)
  const conflicts = []
  const changes = { created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 }
  let next = state
  const skipRemote = new Set()

  const checkpoint = async () => {
    if (await onCheckpoint(structuredClone(next)) === false) throw { code: 'SYNC_STORAGE', message: 'No se pudo guardar el avance de sincronización.' }
  }
  const applyReceipt = (op, data) => {
    const key = op.kind === 'profile' ? 'profiles' : 'modes'
    const current = next[key].find(item => item.id === op.id)
    const edited = op.local && JSON.stringify(current) !== JSON.stringify(op.local)
    const created = op.method.startsWith('create')
    const row = op.method === 'setModeGestures' ? data.modo : data
    next = created ? adoptRemote(next, op.kind, op.id, row) : markSynced(next, op.kind, op.id, row.version)
    const id = created ? lower(row.id) : op.id
    next = { ...next, [key]: next[key].map(item => item.id === id ? {
      ...item, ...(created && !edited ? { nombre: row.nombre } : {}),
      // Sin asignaciones en la misma solicitud, el modo queda pendiente hasta confirmar el PUT de sus asignaciones.
      dirty: Boolean(edited) || (op.kind === 'mode' && op.method !== 'setModeGestures' && !carriesAssignments(op)),
    } : item), syncOperation: null }
    if (op.recreate && op.kind === 'profile') next = { ...next, modes: next.modes.map(m => m.profileId === id ? { ...m, version: null, dirty: true } : m) }
  }
  // Only explicit application rejections prove that no mutation was committed.
  // `IDEMPOTENCIA_*` no está aquí a propósito: «no puedo usar esta clave» no prueba que la creación no ocurriera
  // cuando se repite una recuperación; cada caso lo decide `create` / `replayCreate`.
  const rejected = new Set(['NOMBRE_DUPLICADO', 'VERSION_CONFLICTO', 'NO_ENCONTRADO', 'DATOS_INVALIDOS', 'ACCION_NO_COMPATIBLE'])
  // Lo que el servidor anuncia en GET /capacidades; se consulta una vez por sincronización y solo si hace falta.
  let featuresRead
  const features = () => (featuresRead ??= readServerFeatures(api, call))
  const write = async (method, args, kind, id, recreate = false, recovery = null, key = null) => {
    const op = recovery ?? { method, args, kind, id, recreate, local: structuredClone(next[kind === 'profile' ? 'profiles' : 'modes'].find(item => item.id === id)), ...(key ? { key } : {}) }
    next = { ...next, syncOperation: op }
    await checkpoint()
    let response
    try {
      // Una creación con clave de idempotencia es segura de repetir: el servidor devuelve el resultado original
      // en lugar de crear otro recurso, así que un fallo de transporte se reintenta con LA MISMA clave. Sin clave
      // (servidor anterior) o en cualquier otra escritura, nunca se reintenta a ciegas.
      response = op.key ? await call(() => api[method](...op.args, op.key)) : await api[method](...op.args)
    } catch (error) {
      if (rejected.has(error?.code)) { next = { ...next, syncOperation: null }; await checkpoint() }
      throw error
    }
    // A receipt survives a crash between receiving the response and adopting its identity.
    next = { ...next, syncOperation: { ...op, result: response.data } }
    await checkpoint()
    applyReceipt(op, response.data)
    await checkpoint()
    return response
  }
  // Crea un recurso. Con un servidor que anuncia idempotencia la operación pendiente guarda una clave nueva y la
  // reutiliza en cada reintento y en la recuperación tras un cierre.
  const create = async (method, args, kind, id, recreate = false) => {
    const key = (await features()).idempotency ? newIdempotencyKey() : null
    try { return await write(method, args, kind, id, recreate, null, key) }
    catch (error) {
      if (!key || !IDEMPOTENCY_UNAVAILABLE_CODES.has(error?.code)) throw error
      // El servidor rechazó la CLAVE antes de crear nada (reloj desfasado, base sin la tabla...). No hay nada que
      // recuperar: se descarta la operación y se crea sin idempotencia, como con un servidor anterior.
      next = { ...next, syncOperation: null }
      await checkpoint()
      return write(method, args, kind, id, recreate)
    }
  }
  // Sube un modo nuevo. Con servidor de mutación conjunta lleva sus asignaciones en la propia creación (versión 1);
  // sin ella son dos pasos: crear y luego reemplazar las asignaciones con la versión recibida.
  const createMode = async (profileId, mode, payload, recreate = false) => {
    const joint = (await features()).jointMode
    const body = joint ? { ...payload, gestos: assignmentsToExport(mode.assignments) } : payload
    const created = (await create('createContext', [profileId, body], 'mode', mode.id, recreate)).data
    next = adoptRemote(next, 'mode', mode.id, { id: lower(created.id), version: created.version })
    let version = created.version
    if (!joint) {
      const effective = (await write('setModeGestures', [lower(created.id), { version: created.version, gestos: assignmentsToExport(mode.assignments) }], 'mode', lower(created.id))).data
      version = effective.modo.version
    }
    next = markSynced(next, 'mode', lower(created.id), version)
    return created
  }
  // Recuperación de una creación pendiente repitiendo su clave. Devuelve 'creado' (el servidor creó el recurso o
  // devolvió el que ya había creado, y el recibo está aplicado), 'rechazado' (el servidor la rechazó sin crear nada y
  // la operación ya se descartó) o 'incierto' (no hay clave utilizable: queda la adopción explícita de un candidato).
  const replayCreate = async pending => {
    // Una clave dañada en el almacenamiento no se envía: el puente la rechazaría con DATOS_INVALIDOS, que aquí
    // significaría «no se creó nada» y permitiría duplicar. Se trata como si no hubiera clave.
    if (!isIdempotencyKey(pending.key) || !(await features()).idempotency) return 'incierto'
    try {
      await write(pending.method, pending.args, pending.kind, pending.id, pending.recreate, pending)
      return 'creado'
    } catch (error) {
      if (IDEMPOTENCY_UNAVAILABLE_CODES.has(error?.code)) return 'incierto'
      if (rejected.has(error?.code)) return 'rechazado'
      throw error
    }
  }

  try {
    const pending = next.syncOperation
    if (pending) {
      const methods = { createProfile: 'profile', updateProfile: 'profile', createContext: 'mode', updateContext: 'mode', setModeGestures: 'mode' }
      if (methods[pending.method] !== pending.kind || typeof pending.id !== 'string' || !Array.isArray(pending.args) || !pending.args.at(-1) || typeof pending.args.at(-1) !== 'object') throw { code: 'SYNC_STATE', message: 'Registro de sincronización inválido; conservar para revisión.' }
    }
    if (pending?.result) {
      applyReceipt(pending, pending.result)
      await checkpoint()
    } else if (pending) {
      if (pending.method.startsWith('create')) {
        // Con clave de idempotencia basta repetir la creación: el servidor devuelve el recurso que ya creó (o lo crea
        // una sola vez). Sin clave utilizable, el resultado es incierto y solo la persona usuaria puede adoptar un candidato.
        const replay = await replayCreate(pending)
        if (replay === 'creado') changes.created += 1
        if (replay === 'incierto') {
          const decision = resolutions[conflictKey(pending.kind, pending.id)]
          const rows = await call(() => allPages(offset => pending.kind === 'profile' ? api.profiles(offset) : api.contexts(pending.args[0], offset)))
          const candidates = rows.filter(r => !next[pending.kind === 'profile' ? 'profiles' : 'modes'].some(item => item.id === lower(r.id) && item.id !== pending.id) && !next.tombstones.some(t => t.id === lower(r.id)))
          const remote = decision?.action === 'adoptar' && candidates.find(r => lower(r.id) === lower(decision.remoteId))
          if (!remote) return { state: next, changes, conflicts: [{ kind: pending.kind, id: pending.id, type: 'resultado_incierto', nombre: pending.args.at(-1).name, options: ['adoptar'], candidates }] }
          applyReceipt(pending, remote)
          const key = pending.kind === 'profile' ? 'profiles' : 'modes'
          // Explicit adoption links identity, preserving the local content for the next versioned write.
          const local = state[key].find(item => item.id === pending.id)
          next = { ...next, [key]: next[key].map(item => item.id === lower(remote.id) ? { ...item, nombre: local.nombre, dirty: true } : item) }
          await checkpoint()
        }
      } else {
        // Replaying the identical expected version cannot apply a PATCH/PUT twice.
        try { await write(pending.method, pending.args, pending.kind, pending.id, pending.recreate, pending) }
        catch (error) { if (!['VERSION_CONFLICTO', 'NO_ENCONTRADO'].includes(error?.code)) throw error }
        resolutions = { ...resolutions }
        delete resolutions[conflictKey(pending.kind, pending.id)]
      }
    }

    // 0. Instantánea remota de perfiles.
    const remoteProfiles = (await call(() => allPages(offset => api.profiles(offset)))).map(p => ({ ...p, id: lower(p.id) }))
    const remoteProfileById = new Map(remoteProfiles.map(p => [p.id, p]))

    // 1. Borrados locales pendientes. Solo se envía un DELETE si el servidor lo garantiza: con `If-Match`
    //    comprueba y borra (con la cascada de un perfil) en una misma transacción, y un cambio hecho en otro
    //    equipo (perfil, modos, asignaciones, altas o bajas de modos) da 412 y no borra nada. Sin esa garantía
    //    (servidor anterior o marca sin versión) no se envía nada y la marca permanece.
    if (next.tombstones.length > 0) {
      const conditional = (await features()).conditionalDelete
      // Los modos primero: así el agregado del perfil que los contenía coincide con lo que queda en el servidor.
      const ordered = [...next.tombstones].sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === 'mode' ? -1 : 1)))
      for (const tomb of ordered) {
        const decision = resolutions[conflictKey(tomb.kind, tomb.id)]
        const base = { kind: tomb.kind, id: tomb.id, nombre: tomb.nombre ?? tomb.id, local: tomb, remote: null }
        if (decision === 'recuperar') {
          // Cancelar el borrado: la marca se quita y el elemento se vuelve a descargar en esta misma ejecución.
          next = clearTombstone(next, tomb.kind, tomb.id)
          await checkpoint()
          continue
        }
        skipRemote.add(tomb.id)
        const force = decision === 'borrar'
        if (!conditional) { conflicts.push({ ...base, type: 'borrado_no_seguro', reason: 'servidor', options: [] }); continue }
        if ((tomb.version === null || tomb.version === undefined) && !force) {
          conflicts.push({ ...base, type: 'borrado_no_seguro', reason: 'sin_version', options: ['recuperar', 'borrar'] })
          continue
        }
        try {
          // «Borrar de todos modos» lee el estado actual y borra ESE estado; si vuelve a cambiar, 412 otra vez.
          const known = force ? await currentDeleteTarget(api, call, tomb) : { version: tomb.version, modes: tomb.modes ?? [] }
          if (known === null) { next = clearTombstone(next, tomb.kind, tomb.id); await checkpoint(); continue }
          const ifMatch = tomb.kind === 'profile' ? await profileEtag(tomb.id, known.version, known.modes) : await modeEtag(tomb.id, known.version)
          // DELETE condicional es idempotente: repetirlo tras perder la respuesta da 404 (ya borrado), nunca otro borrado.
          await call(() => (tomb.kind === 'profile' ? api.deleteProfile(tomb.id, ifMatch) : api.deleteContext(tomb.id, ifMatch)))
          changes.deleted += 1
        } catch (error) {
          if (error?.code === 'PRECONDICION_FALLIDA') {
            conflicts.push({ ...base, type: 'borrado_modificado', options: ['recuperar', 'borrar'] })
            continue
          }
          if (error?.code !== 'NO_ENCONTRADO') throw error
          // 404: ya no existe en el servidor (otro equipo lo borró o se aplicó un intento anterior). Objetivo cumplido.
        }
        next = clearTombstone(next, tomb.kind, tomb.id)
        await checkpoint()
      }
    }

    // 2. Perfiles locales → servidor.
    for (const profile of [...next.profiles]) {
      const res = resolutions[conflictKey('profile', profile.id)]
      const remote = remoteProfileById.get(profile.id)
      if (profile.version === null) {
        const duplicate = remoteProfiles.find(r => !next.profiles.some(p => p.id === r.id) && sameName(r.nombre, profile.nombre))
        if (duplicate && res === 'adoptar') {
          next = adoptRemote(next, 'profile', profile.id, { id: duplicate.id, version: duplicate.version })
        if ((duplicate.descripcion ?? '') !== profile.descripcion) {
            const updated = (await write('updateProfile', [duplicate.id, { ...profilePayload(profile), version: duplicate.version }], 'profile', duplicate.id)).data
            next = markSynced(next, 'profile', duplicate.id, updated.version)
            remoteProfileById.set(duplicate.id, { ...duplicate, version: updated.version })
            changes.updated += 1
          }
          next = markSynced(next, 'profile', duplicate.id, next.profiles.find(p => p.id === duplicate.id).version)
          await checkpoint()
          continue
        }
        const payload = profilePayload(profile)
        if (duplicate && res === 'renombrar') payload.name = uniqueName(profile.nombre, remoteProfiles.map(r => r.nombre))
        try {
          const created = (await create('createProfile', [payload], 'profile', profile.id)).data
          next = adoptRemote(next, 'profile', profile.id, { id: lower(created.id), version: created.version })
          if (payload.name !== profile.nombre) next = { ...next, profiles: next.profiles.map(p => (p.id === lower(created.id) ? { ...p, nombre: created.nombre } : p)) }
          remoteProfileById.set(lower(created.id), { ...created, id: lower(created.id) })
          changes.created += 1
        } catch (error) {
          if (error?.code !== 'NOMBRE_DUPLICADO') throw error
          if (duplicate) skipRemote.add(duplicate.id)
          conflicts.push({ kind: 'profile', id: profile.id, type: 'nombre_duplicado', nombre: profile.nombre, local: profile, remote: duplicate ?? null, options: ['adoptar', 'renombrar'] })
        }
        continue
      }
      if (!remote) {
        const pending = profile.dirty || modesOf(next, profile.id).some(m => m.dirty || m.version === null)
        if (!pending || res === 'eliminar') { next = dropLocal(next, 'profile', profile.id); changes.removed += 1; continue }
        if (res === 'recrear') {
          const created = (await create('createProfile', [profilePayload(profile)], 'profile', profile.id, true)).data
          next = adoptRemote(next, 'profile', profile.id, { id: lower(created.id), version: created.version })
          next = { ...next, modes: next.modes.map(m => (m.profileId === lower(created.id) ? { ...m, version: null, dirty: true } : m)) }
          remoteProfileById.set(lower(created.id), { ...created, id: lower(created.id) })
          changes.created += 1
          continue
        }
        conflicts.push({ kind: 'profile', id: profile.id, type: 'eliminado_remoto', nombre: profile.nombre, local: profile, remote: null, options: ['recrear', 'eliminar'] })
        continue
      }
      if (profile.dirty) {
        if (remote.version === profile.version || res === 'local') {
          try {
            const updated = (await write('updateProfile', [profile.id, { ...profilePayload(profile), version: remote.version }], 'profile', profile.id)).data
            next = markSynced(next, 'profile', profile.id, updated.version)
            remoteProfileById.set(profile.id, { ...remote, ...updated, id: profile.id })
            changes.updated += 1
          } catch (error) {
            if (error?.code !== 'VERSION_CONFLICTO') throw error
            conflicts.push({ kind: 'profile', id: profile.id, type: 'version', nombre: profile.nombre, local: profile, remote, options: ['local', 'remoto'] })
          }
        } else if (res === 'remoto') {
          next = upsertRemoteProfile(next, remote); changes.pulled += 1
        } else {
          conflicts.push({ kind: 'profile', id: profile.id, type: 'version', nombre: profile.nombre, local: profile, remote, options: ['local', 'remoto'] })
        }
        continue
      }
      if (remote.version !== profile.version) { next = upsertRemoteProfile(next, remote); changes.pulled += 1 }
    }

    // 3. Perfiles remotos desconocidos localmente.
    for (const remote of remoteProfiles) {
      if (!remoteProfileById.has(remote.id) || skipRemote.has(remote.id) || next.profiles.some(p => p.id === remote.id)) continue
      next = upsertRemoteProfile(next, remote)
      changes.pulled += 1
    }

    // 4. Modos de cada perfil sincronizado.
    for (const profile of next.profiles.filter(p => p.version !== null && !skipRemote.has(p.id))) {
      let remoteModes
      try {
        remoteModes = (await call(() => allPages(offset => api.contexts(profile.id, offset)))).map(m => ({ ...m, id: lower(m.id), perfil_id: lower(m.perfil_id) }))
      } catch (error) {
        if (error?.code === 'NO_ENCONTRADO') continue
        throw error
      }
      const remoteById = new Map(remoteModes.map(m => [m.id, m]))
      for (const mode of modesOf(next, profile.id)) {
        const res = resolutions[conflictKey('mode', mode.id)]
        const remote = remoteById.get(mode.id)
        if (mode.version === null) {
          const duplicate = remoteModes.find(r => !next.modes.some(m => m.id === r.id) && sameName(r.nombre, mode.nombre))
          if (duplicate && res === 'adoptar') {
            next = adoptRemote(next, 'mode', mode.id, { id: duplicate.id, version: duplicate.version })
            const localMode = next.modes.find(m => m.id === duplicate.id)
            const pushed = await pushMode(write, { ...localMode, dirty: true }, duplicate.version, (await features()).jointMode)
            next = markSynced(next, 'mode', duplicate.id, pushed.version)
            changes.updated += 1
            continue
          }
          const payload = modePayload(mode)
          if (duplicate && res === 'renombrar') payload.name = uniqueName(mode.nombre, remoteModes.map(r => r.nombre))
          try {
            const created = await createMode(profile.id, mode, payload)
            if (payload.name !== mode.nombre) next = { ...next, modes: next.modes.map(m => (m.id === lower(created.id) ? { ...m, nombre: created.nombre } : m)) }
            changes.created += 1
          } catch (error) {
            if (error?.code !== 'NOMBRE_DUPLICADO') throw error
            if (duplicate) skipRemote.add(duplicate.id)
            conflicts.push({ kind: 'mode', id: mode.id, type: 'nombre_duplicado', nombre: mode.nombre, local: mode, remote: duplicate ?? null, options: ['adoptar', 'renombrar'] })
          }
          continue
        }
        if (!remote) {
          if (!mode.dirty || res === 'eliminar') { next = dropLocal(next, 'mode', mode.id); changes.removed += 1; continue }
          if (res === 'recrear') {
            await createMode(profile.id, mode, modePayload(mode), true)
            changes.created += 1
            continue
          }
          conflicts.push({ kind: 'mode', id: mode.id, type: 'eliminado_remoto', nombre: mode.nombre, local: mode, remote: null, options: ['recrear', 'eliminar'] })
          continue
        }
        if (mode.dirty) {
          if (remote.version === mode.version || res === 'local') {
            try {
              const pushed = await pushMode(write, mode, remote.version, (await features()).jointMode)
              next = markSynced(next, 'mode', mode.id, pushed.version)
              changes.updated += 1
            } catch (error) {
              if (error?.code !== 'VERSION_CONFLICTO') throw error
              conflicts.push({ kind: 'mode', id: mode.id, type: 'version', nombre: mode.nombre, local: mode, remote, options: ['local', 'remoto'] })
            }
          } else if (res === 'remoto') {
            next = await pullMode(api, call, next, mode.id); changes.pulled += 1
          } else {
            conflicts.push({ kind: 'mode', id: mode.id, type: 'version', nombre: mode.nombre, local: mode, remote, options: ['local', 'remoto'] })
          }
          continue
        }
        if (remote.version !== mode.version) { next = await pullMode(api, call, next, mode.id); changes.pulled += 1 }
      }
      for (const remote of remoteModes) {
        if (skipRemote.has(remote.id) || next.modes.some(m => m.id === remote.id)) continue
        next = await pullMode(api, call, next, remote.id)
        changes.pulled += 1
      }
    }

    await checkpoint()
    return { state: next, conflicts, changes }
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'Sincronización interrumpida'), { code: error?.code, state: next, conflicts, changes, cause: error })
  }
}

/**
 * Funciones opcionales que el servidor anuncia en GET /capacidades (`servidor`). Sin el anuncio (o sin la ruta)
 * no se usan: el borrado condicional queda bloqueado y las creaciones no llevan clave de idempotencia.
 */
async function readServerFeatures(api, call) {
  try {
    const servidor = (await call(() => api.capabilities()))?.data?.servidor
    return {
      conditionalDelete: servidor?.borrado_condicional === true,
      idempotency: servidor?.idempotencia?.clave === 'uuid-v7',
      jointMode: servidor?.modo_con_asignaciones === true,
    }
  } catch (error) {
    // Solo la AUSENCIA de la ruta (servidor anterior) o un cliente sin `capabilities` prueban que no hay funciones
    // opcionales. Cualquier otro fallo —sesión caducada, 403, 500, red— interrumpe la sincronización: tratarlo como
    // «el servidor no lo tiene» enviaría creaciones sin clave y bloquearía borrados con un aviso engañoso.
    const missing = error?.code === undefined || ROUTE_MISSING_CODES.has(error.code)
    if (!missing) throw error
    return { conditionalDelete: false, idempotency: false, jointMode: false }
  }
}

/** Códigos con los que un servidor anterior indica que GET /capacidades no existe. */
const ROUTE_MISSING_CODES = new Set(['RUTA_NO_ENCONTRADA', 'NO_ENCONTRADO'])

/** Estado actual en el servidor de lo que se va a borrar (`null` si ya no existe), para «borrar de todos modos». */
async function currentDeleteTarget(api, call, tomb) {
  try {
    if (tomb.kind === 'mode') {
      const effective = (await call(() => api.modeGestures(tomb.id))).data
      return { version: effective.modo.version, modes: [] }
    }
    const profiles = await call(() => allPages(offset => api.profiles(offset)))
    const profile = profiles.find(p => lower(p.id) === tomb.id)
    if (!profile) return null
    const modes = await call(() => allPages(offset => api.contexts(tomb.id, offset)))
    return { version: profile.version, modes: modes.map(m => ({ id: lower(m.id), version: m.version })) }
  } catch (error) {
    if (error?.code === 'NO_ENCONTRADO') return null
    throw error
  }
}

/** ¿La solicitud ya lleva las asignaciones del modo (mutación conjunta)? */
const carriesAssignments = op => Array.isArray(op?.args?.at(-1)?.gestos)

/**
 * Sube los cambios de un modo. Con mutación conjunta, campos y asignaciones van en un solo PATCH (una subida de
 * versión, todo o nada); si no, PATCH de campos y después PUT de asignaciones con la versión recibida.
 */
async function pushMode(write, mode, baseVersion, joint = false) {
  if (joint) {
    const updated = (await write('updateContext', [mode.id, { ...modePayload(mode), gestos: assignmentsToExport(mode.assignments), version: baseVersion }], 'mode', mode.id)).data
    return { version: updated.version }
  }
  const updated = (await write('updateContext', [mode.id, { ...modePayload(mode), version: baseVersion }], 'mode', mode.id)).data
  const effective = (await write('setModeGestures', [mode.id, { version: updated.version, gestos: assignmentsToExport(mode.assignments) }], 'mode', mode.id)).data
  return { version: effective.modo.version }
}

async function pullMode(api, call, state, id) {
  const effective = (await call(() => api.modeGestures(id))).data
  return upsertRemoteMode(state, effective.modo, assignmentsFromExport(effective.gestos))
}

export function describeConflict(conflict) {
  const kind = conflict.kind === 'profile' ? 'El perfil' : 'El modo'
  switch (conflict.type) {
    case 'resultado_incierto': return 'No se conoce el resultado de una creación. Selecciona explícitamente el recurso remoto antes de continuar.'
    case 'borrado_no_seguro': return conflict.reason === 'sin_version'
      ? `${kind} «${conflict.nombre}» se borró aquí antes de registrar su versión: no se puede comprobar qué conocías. Recupéralo o bórralo de todos modos.`
      : 'Borrado pendiente: este servidor no permite comprobar atómicamente la versión y sus dependencias, así que no se envía.'
    case 'borrado_modificado': return `${kind} «${conflict.nombre}» cambió en otro equipo después de que lo borraras aquí. No se borró nada en tu cuenta.`
    case 'version': return `${kind} «${conflict.nombre}» cambió en otro equipo y también aquí.`
    case 'eliminado_remoto': return `${kind} «${conflict.nombre}» se eliminó en otro equipo, pero aquí tiene cambios sin subir.`
    case 'nombre_duplicado': return `Ya existe en tu cuenta un ${conflict.kind === 'profile' ? 'perfil' : 'modo'} llamado «${conflict.nombre}».`
    default: return `${kind} «${conflict.nombre}» necesita una decisión.`
  }
}

export const RESOLUTION_LABELS = {
  recuperar: 'Recuperarlo (cancelar el borrado)',
  borrar: 'Borrarlo de todos modos (con lo que hay ahora)',
  local: 'Conservar mis cambios',
  remoto: 'Usar la versión del servidor',
  recrear: 'Volver a subirlo',
  eliminar: 'Eliminarlo aquí también',
  adoptar: 'Usar el existente',
  renombrar: 'Subir con otro nombre',
}
