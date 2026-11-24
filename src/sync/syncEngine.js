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
import { modeEtag, profileEtag } from './etag.js'
import {
  IDEMPOTENCY_UNAVAILABLE_CODES,
  isIdempotencyKey,
  newIdempotencyKey,
} from './idempotency.js'
import { assignmentsToExport } from '../data/capabilities.js'
import { adoptRemote, clearTombstone, markSynced } from '../data/preferences.js'
import {
  conflictKey,
  lower,
  readServerFeatures,
  currentDeleteTarget,
  carriesAssignments,
} from './syncProtocol.js'
import { syncProfiles, syncModes } from './syncResources.js'

export {
  conflictKey,
  profilePayload,
  modePayload,
  describeConflict,
  RESOLUTION_LABELS,
} from './syncProtocol.js'

/**
 * @param {object} options
 * @param {object} options.api cliente con profiles/createProfile/updateProfile/deleteProfile/contexts/createContext/updateContext/deleteContext/modeGestures/setModeGestures
 * @param {object} options.state preferencias locales de la cuenta
 * @param {Record<string,string|{action:string,remoteId:string}>} [options.resolutions] decisiones para conflictos previos: `profile:<id>` o `mode:<id>` → 'local' | 'remoto' | 'recrear' | 'eliminar' | 'adoptar' | 'renombrar'
 * @param {function} [options.onCheckpoint] Persistir estado completo por cuenta; false o rechazo detiene el envío.
 * Errores incluyen state/conflicts/changes. Ver README.md para recuperación y serialización de UI.
 */
export async function synchronize({
  api,
  state,
  resolutions = {},
  retry = {},
  onCheckpoint = async () => {},
}) {
  const call = (fn) => withRetry(fn, retry)
  const conflicts = []
  const changes = { created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 }
  const session = { state }
  const skipRemote = new Set()

  const checkpoint = async () => {
    if ((await onCheckpoint(structuredClone(session.state))) === false)
      throw { code: 'SYNC_STORAGE', message: 'No se pudo guardar el avance de sincronización.' }
  }
  const applyReceipt = (op, data) => {
    const key = op.kind === 'profile' ? 'profiles' : 'modes'
    const current = session.state[key].find((item) => item.id === op.id)
    const edited = op.local && JSON.stringify(current) !== JSON.stringify(op.local)
    const created = op.method.startsWith('create')
    const row = op.method === 'setModeGestures' ? data.modo : data
    session.state = created
      ? adoptRemote(session.state, op.kind, op.id, row)
      : markSynced(session.state, op.kind, op.id, row.version)
    const id = created ? lower(row.id) : op.id
    session.state = {
      ...session.state,
      [key]: session.state[key].map((item) =>
        item.id === id
          ? {
              ...item,
              ...(created && !edited ? { nombre: row.nombre } : {}),
              // Sin asignaciones en la misma solicitud, el modo queda pendiente hasta confirmar el PUT de sus asignaciones.
              dirty:
                Boolean(edited) ||
                (op.kind === 'mode' && op.method !== 'setModeGestures' && !carriesAssignments(op)),
            }
          : item,
      ),
      syncOperation: null,
    }
    if (op.recreate && op.kind === 'profile')
      session.state = {
        ...session.state,
        modes: session.state.modes.map((m) =>
          m.profileId === id ? { ...m, version: null, dirty: true } : m,
        ),
      }
  }
  // Only explicit application rejections prove that no mutation was committed.
  // `IDEMPOTENCIA_*` no está aquí a propósito: «no puedo usar esta clave» no prueba que la creación no ocurriera
  // cuando se repite una recuperación; cada caso lo decide `create` / `replayCreate`.
  const rejected = new Set([
    'NOMBRE_DUPLICADO',
    'VERSION_CONFLICTO',
    'NO_ENCONTRADO',
    'DATOS_INVALIDOS',
    'ACCION_NO_COMPATIBLE',
  ])
  // Lo que el servidor anuncia en GET /capacidades; se consulta una vez por sincronización y solo si hace falta.
  let featuresRead
  const features = () => (featuresRead ??= readServerFeatures(api, call))
  const write = async (method, args, kind, id, recreate = false, recovery = null, key = null) => {
    const op = recovery ?? {
      method,
      args,
      kind,
      id,
      recreate,
      local: structuredClone(
        session.state[kind === 'profile' ? 'profiles' : 'modes'].find((item) => item.id === id),
      ),
      ...(key ? { key } : {}),
    }
    session.state = { ...session.state, syncOperation: op }
    await checkpoint()
    let response
    try {
      // Una creación con clave de idempotencia es segura de repetir: el servidor devuelve el resultado original
      // en lugar de crear otro recurso, así que un fallo de transporte se reintenta con LA MISMA clave. Sin clave
      // (servidor anterior) o en cualquier otra escritura, nunca se reintenta a ciegas.
      response = op.key
        ? await call(() => api[method](...op.args, op.key))
        : await api[method](...op.args)
    } catch (error) {
      if (rejected.has(error?.code)) {
        session.state = { ...session.state, syncOperation: null }
        await checkpoint()
      }
      throw error
    }
    // A receipt survives a crash between receiving the response and adopting its identity.
    session.state = { ...session.state, syncOperation: { ...op, result: response.data } }
    await checkpoint()
    applyReceipt(op, response.data)
    await checkpoint()
    return response
  }
  // Crea un recurso. Con un servidor que anuncia idempotencia la operación pendiente guarda una clave nueva y la
  // reutiliza en cada reintento y en la recuperación tras un cierre.
  const create = async (method, args, kind, id, recreate = false) => {
    const key = (await features()).idempotency ? newIdempotencyKey() : null
    try {
      return await write(method, args, kind, id, recreate, null, key)
    } catch (error) {
      if (!key || !IDEMPOTENCY_UNAVAILABLE_CODES.has(error?.code)) throw error
      // El servidor rechazó la CLAVE antes de crear nada (reloj desfasado, base sin la tabla...). No hay nada que
      // recuperar: se descarta la operación y se crea sin idempotencia, como con un servidor anterior.
      session.state = { ...session.state, syncOperation: null }
      await checkpoint()
      return write(method, args, kind, id, recreate)
    }
  }
  // Sube un modo nuevo. Con servidor de mutación conjunta lleva sus asignaciones en la propia creación (versión 1);
  // sin ella son dos pasos: crear y luego reemplazar las asignaciones con la versión recibida.
  const createMode = async (profileId, mode, payload, recreate = false) => {
    const joint = (await features()).jointMode
    const body = joint ? { ...payload, gestos: assignmentsToExport(mode.assignments) } : payload
    const created = (await create('createContext', [profileId, body], 'mode', mode.id, recreate))
      .data
    session.state = adoptRemote(session.state, 'mode', mode.id, {
      id: lower(created.id),
      version: created.version,
    })
    let version = created.version
    if (!joint) {
      const effective = (
        await write(
          'setModeGestures',
          [
            lower(created.id),
            { version: created.version, gestos: assignmentsToExport(mode.assignments) },
          ],
          'mode',
          lower(created.id),
        )
      ).data
      version = effective.modo.version
    }
    session.state = markSynced(session.state, 'mode', lower(created.id), version)
    return created
  }
  // Recuperación de una creación pendiente repitiendo su clave. Devuelve 'creado' (el servidor creó el recurso o
  // devolvió el que ya había creado, y el recibo está aplicado), 'rechazado' (el servidor la rechazó sin crear nada y
  // la operación ya se descartó) o 'incierto' (no hay clave utilizable: queda la adopción explícita de un candidato).
  const replayCreate = async (pending) => {
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
    const pending = session.state.syncOperation
    if (pending) {
      const methods = {
        createProfile: 'profile',
        updateProfile: 'profile',
        createContext: 'mode',
        updateContext: 'mode',
        setModeGestures: 'mode',
      }
      if (
        methods[pending.method] !== pending.kind ||
        typeof pending.id !== 'string' ||
        !Array.isArray(pending.args) ||
        !pending.args.at(-1) ||
        typeof pending.args.at(-1) !== 'object'
      )
        throw {
          code: 'SYNC_STATE',
          message: 'Registro de sincronización inválido; conservar para revisión.',
        }
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
          const rows = await call(() =>
            allPages((offset) =>
              pending.kind === 'profile'
                ? api.profiles(offset)
                : api.contexts(pending.args[0], offset),
            ),
          )
          const candidates = rows.filter(
            (r) =>
              !session.state[pending.kind === 'profile' ? 'profiles' : 'modes'].some(
                (item) => item.id === lower(r.id) && item.id !== pending.id,
              ) && !session.state.tombstones.some((t) => t.id === lower(r.id)),
          )
          const remote =
            decision?.action === 'adoptar' &&
            candidates.find((r) => lower(r.id) === lower(decision.remoteId))
          if (!remote)
            return {
              state: session.state,
              changes,
              conflicts: [
                {
                  kind: pending.kind,
                  id: pending.id,
                  type: 'resultado_incierto',
                  nombre: pending.args.at(-1).name,
                  options: ['adoptar'],
                  candidates,
                },
              ],
            }
          applyReceipt(pending, remote)
          const key = pending.kind === 'profile' ? 'profiles' : 'modes'
          // Explicit adoption links identity, preserving the local content for the session.state versioned write.
          const local = state[key].find((item) => item.id === pending.id)
          session.state = {
            ...session.state,
            [key]: session.state[key].map((item) =>
              item.id === lower(remote.id) ? { ...item, nombre: local.nombre, dirty: true } : item,
            ),
          }
          await checkpoint()
        }
      } else {
        // Replaying the identical expected version cannot apply a PATCH/PUT twice.
        try {
          await write(
            pending.method,
            pending.args,
            pending.kind,
            pending.id,
            pending.recreate,
            pending,
          )
        } catch (error) {
          if (!['VERSION_CONFLICTO', 'NO_ENCONTRADO'].includes(error?.code)) throw error
        }
        resolutions = { ...resolutions }
        delete resolutions[conflictKey(pending.kind, pending.id)]
      }
    }

    // 0. Instantánea remota de perfiles.
    const remoteProfiles = (await call(() => allPages((offset) => api.profiles(offset)))).map(
      (p) => ({ ...p, id: lower(p.id) }),
    )
    const remoteProfileById = new Map(remoteProfiles.map((p) => [p.id, p]))

    // 1. Borrados locales pendientes. Solo se envía un DELETE si el servidor lo garantiza: con `If-Match`
    //    comprueba y borra (con la cascada de un perfil) en una misma transacción, y un cambio hecho en otro
    //    equipo (perfil, modos, asignaciones, altas o bajas de modos) da 412 y no borra nada. Sin esa garantía
    //    (servidor anterior o marca sin versión) no se envía nada y la marca permanece.
    if (session.state.tombstones.length > 0) {
      const conditional = (await features()).conditionalDelete
      // Los modos primero: así el agregado del perfil que los contenía coincide con lo que queda en el servidor.
      const ordered = [...session.state.tombstones].sort((a, b) =>
        a.kind === b.kind ? 0 : a.kind === 'mode' ? -1 : 1,
      )
      for (const tomb of ordered) {
        const decision = resolutions[conflictKey(tomb.kind, tomb.id)]
        const base = {
          kind: tomb.kind,
          id: tomb.id,
          nombre: tomb.nombre ?? tomb.id,
          local: tomb,
          remote: null,
        }
        if (decision === 'recuperar') {
          // Cancelar el borrado: la marca se quita y el elemento se vuelve a descargar en esta misma ejecución.
          session.state = clearTombstone(session.state, tomb.kind, tomb.id)
          await checkpoint()
          continue
        }
        skipRemote.add(tomb.id)
        const force = decision === 'borrar'
        if (!conditional) {
          conflicts.push({ ...base, type: 'borrado_no_seguro', reason: 'servidor', options: [] })
          continue
        }
        if ((tomb.version === null || tomb.version === undefined) && !force) {
          conflicts.push({
            ...base,
            type: 'borrado_no_seguro',
            reason: 'sin_version',
            options: ['recuperar', 'borrar'],
          })
          continue
        }
        try {
          // «Borrar de todos modos» lee el estado actual y borra ESE estado; si vuelve a cambiar, 412 otra vez.
          const known = force
            ? await currentDeleteTarget(api, call, tomb)
            : { version: tomb.version, modes: tomb.modes ?? [] }
          if (known === null) {
            session.state = clearTombstone(session.state, tomb.kind, tomb.id)
            await checkpoint()
            continue
          }
          const ifMatch =
            tomb.kind === 'profile'
              ? await profileEtag(tomb.id, known.version, known.modes)
              : await modeEtag(tomb.id, known.version)
          // DELETE condicional es idempotente: repetirlo tras perder la respuesta da 404 (ya borrado), nunca otro borrado.
          await call(() =>
            tomb.kind === 'profile'
              ? api.deleteProfile(tomb.id, ifMatch)
              : api.deleteContext(tomb.id, ifMatch),
          )
          changes.deleted += 1
        } catch (error) {
          if (error?.code === 'PRECONDICION_FALLIDA') {
            conflicts.push({
              ...base,
              type: 'borrado_modificado',
              options: ['recuperar', 'borrar'],
            })
            continue
          }
          if (error?.code !== 'NO_ENCONTRADO') throw error
          // 404: ya no existe en el servidor (otro equipo lo borró o se aplicó un intento anterior). Objetivo cumplido.
        }
        session.state = clearTombstone(session.state, tomb.kind, tomb.id)
        await checkpoint()
      }
    }

    await syncProfiles({
      session,
      resolutions,
      remoteProfiles,
      remoteProfileById,
      changes,
      conflicts,
      skipRemote,
      write,
      create,
      checkpoint,
    })
    await syncModes({
      session,
      api,
      call,
      resolutions,
      changes,
      conflicts,
      skipRemote,
      write,
      createMode,
      features,
    })

    await checkpoint()
    return { state: session.state, conflicts, changes }
  } catch (error) {
    throw Object.assign(new Error(error?.message || 'Sincronización interrumpida'), {
      code: error?.code,
      state: session.state,
      conflicts,
      changes,
      cause: error,
    })
  }
}
