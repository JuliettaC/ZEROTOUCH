import { allPages } from '../api/paging.js'
import { assignmentsToExport, assignmentsFromExport } from '../data/capabilities.js'
import { upsertRemoteMode } from '../data/preferences.js'

export const lower = (value) => String(value ?? '').toLowerCase()
export const conflictKey = (kind, id) => `${kind}:${id}`
export const sameName = (a, b) =>
  String(a).trim().normalize('NFC').toLowerCase() ===
  String(b).trim().normalize('NFC').toLowerCase()

export const profilePayload = (profile) => ({
  name: profile.nombre,
  description: profile.descripcion,
})
export const modePayload = (mode) => ({
  name: mode.nombre,
  categoria: mode.categoria,
  sensitivity: mode.settings.sensitivity,
  stability: mode.settings.stability,
  pinchTolerance: mode.settings.pinchTolerance,
  deskRest: mode.settings.deskRest,
  gazeAssist: mode.settings.gazeAssist,
})

/**
 * Funciones opcionales que el servidor anuncia en GET /capacidades (`servidor`). Sin el anuncio (o sin la ruta)
 * no se usan: el borrado condicional queda bloqueado y las creaciones no llevan clave de idempotencia.
 */
export async function readServerFeatures(api, call) {
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
export async function currentDeleteTarget(api, call, tomb) {
  try {
    if (tomb.kind === 'mode') {
      const effective = (await call(() => api.modeGestures(tomb.id))).data
      return { version: effective.modo.version, modes: [] }
    }
    const profiles = await call(() => allPages((offset) => api.profiles(offset)))
    const profile = profiles.find((p) => lower(p.id) === tomb.id)
    if (!profile) return null
    const modes = await call(() => allPages((offset) => api.contexts(tomb.id, offset)))
    return {
      version: profile.version,
      modes: modes.map((m) => ({ id: lower(m.id), version: m.version })),
    }
  } catch (error) {
    if (error?.code === 'NO_ENCONTRADO') return null
    throw error
  }
}

/** ¿La solicitud ya lleva las asignaciones del modo (mutación conjunta)? */
export const carriesAssignments = (op) => Array.isArray(op?.args?.at(-1)?.gestos)

/**
 * Sube los cambios de un modo. Con mutación conjunta, campos y asignaciones van en un solo PATCH (una subida de
 * versión, todo o nada); si no, PATCH de campos y después PUT de asignaciones con la versión recibida.
 */
export async function pushMode(write, mode, baseVersion, joint = false) {
  if (joint) {
    const updated = (
      await write(
        'updateContext',
        [
          mode.id,
          {
            ...modePayload(mode),
            gestos: assignmentsToExport(mode.assignments),
            version: baseVersion,
          },
        ],
        'mode',
        mode.id,
      )
    ).data
    return { version: updated.version }
  }
  const updated = (
    await write(
      'updateContext',
      [mode.id, { ...modePayload(mode), version: baseVersion }],
      'mode',
      mode.id,
    )
  ).data
  const effective = (
    await write(
      'setModeGestures',
      [mode.id, { version: updated.version, gestos: assignmentsToExport(mode.assignments) }],
      'mode',
      mode.id,
    )
  ).data
  return { version: effective.modo.version }
}

export async function pullMode(api, call, state, id) {
  const effective = (await call(() => api.modeGestures(id))).data
  return upsertRemoteMode(state, effective.modo, assignmentsFromExport(effective.gestos))
}

export function describeConflict(conflict) {
  const kind = conflict.kind === 'profile' ? 'El perfil' : 'El modo'
  switch (conflict.type) {
    case 'resultado_incierto':
      return 'No se conoce el resultado de una creación. Selecciona explícitamente el recurso remoto antes de continuar.'
    case 'borrado_no_seguro':
      return conflict.reason === 'sin_version'
        ? `${kind} «${conflict.nombre}» se borró aquí antes de registrar su versión: no se puede comprobar qué conocías. Recupéralo o bórralo de todos modos.`
        : 'Borrado pendiente: este servidor no permite comprobar atómicamente la versión y sus dependencias, así que no se envía.'
    case 'borrado_modificado':
      return `${kind} «${conflict.nombre}» cambió en otro equipo después de que lo borraras aquí. No se borró nada en tu cuenta.`
    case 'version':
      return `${kind} «${conflict.nombre}» cambió en otro equipo y también aquí.`
    case 'eliminado_remoto':
      return `${kind} «${conflict.nombre}» se eliminó en otro equipo, pero aquí tiene cambios sin subir.`
    case 'nombre_duplicado':
      return `Ya existe en tu cuenta un ${conflict.kind === 'profile' ? 'perfil' : 'modo'} llamado «${conflict.nombre}».`
    default:
      return `${kind} «${conflict.nombre}» necesita una decisión.`
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
