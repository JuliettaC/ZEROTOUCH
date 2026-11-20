// Capa fina entre la interfaz y `synchronize`: aplica el contrato de recuperación de src/sync/README.md.
//
// - Serializa por cuenta: dos ejecuciones simultáneas del mismo espacio no comparten snapshots.
// - Guarda cada punto de control en el espacio de la cuenta CAPTURADA al iniciar, aunque la interfaz
//   cambie de cuenta mientras tanto (la interfaz además lo bloquea).
// - Un error nunca devuelve el estado anterior: entrega `error.state` (identidades, versiones y
//   recibos ya confirmados) y se persiste.
// - Solo declara «sincronizado» si no queda nada pendiente: sin conflictos, sin operación a medias,
//   sin lápidas, sin marcas `dirty` y con el almacenamiento escribiendo.
// Módulo puro (sin React); el `storage` es inyectable para probarlo en Node.
import { synchronize } from './syncEngine.js'
import { hasPendingChanges, saveState } from '../data/preferences.js'

export const OUTCOME = Object.freeze({
  SYNCED: 'sincronizado',
  CONFLICTS: 'con_conflictos',
  INTERRUPTED: 'interrumpido',
  BUSY: 'en_curso',
  NO_ACCOUNT: 'sin_cuenta',
})

const running = new Set()
const emptyChanges = () => ({ created: 0, updated: 0, deleted: 0, pulled: 0, removed: 0 })
const slot = accountId => accountId || null

export const isSyncRunning = accountId => running.has(slot(accountId))

/**
 * @param {object} options
 * @param {object} options.api cliente de la API (ver `synchronize`)
 * @param {string|null} options.accountId espacio local de la cuenta; `null` es el invitado y no sincroniza
 * @param {object} options.state preferencias de ese espacio
 * @param {object} [options.resolutions] decisiones de la persona para conflictos previos
 * @param {object} [options.storage] localStorage o un doble
 * @returns {Promise<{ok:boolean, outcome:string, state:object, conflicts:object[], changes:object, error:object|null, persistFailed:boolean}>}
 */
export async function runSync({ api, accountId, state, resolutions = {}, retry, storage, clock = () => new Date().toISOString() }) {
  // `recovered`: la ejecución parte de una operación que quedó a medias (se retoma antes de nada más).
  const recovered = Boolean(state.syncOperation)
  const base = { ok: false, state, conflicts: [], changes: emptyChanges(), error: null, persistFailed: false, recovered }
  if (!accountId) return { ...base, outcome: OUTCOME.NO_ACCOUNT, error: { code: 'SIN_CUENTA', message: 'Inicia sesión para sincronizar.' } }
  if (running.has(slot(accountId))) {
    return { ...base, outcome: OUTCOME.BUSY, error: { code: 'SYNC_EN_CURSO', message: 'Ya hay una sincronización en curso para esta cuenta.' } }
  }
  running.add(slot(accountId))
  let persistFailed = false
  const persist = snapshot => {
    const saved = saveState(accountId, snapshot, storage)
    if (!saved) persistFailed = true
    return saved
  }
  try {
    const result = await synchronize({ api, state, resolutions, retry, onCheckpoint: persist })
    const pending = hasPendingChanges(result.state) || result.conflicts.length > 0
    const final = { ...result.state, lastSync: { at: clock(), status: pending ? 'pendiente' : 'ok' } }
    persist(final)
    const synced = !pending && !persistFailed
    return {
      ok: synced,
      outcome: synced ? OUTCOME.SYNCED : (persistFailed ? OUTCOME.INTERRUPTED : OUTCOME.CONFLICTS),
      state: final,
      conflicts: result.conflicts,
      changes: result.changes,
      error: persistFailed ? { code: 'SYNC_STORAGE', message: 'No se pudo guardar el estado en este equipo. Los cambios siguen en memoria: no cierres la aplicación.' } : null,
      persistFailed,
      recovered,
    }
  } catch (error) {
    const recovered = error?.state ?? state
    const final = { ...recovered, lastSync: { at: clock(), status: 'interrumpido' } }
    persist(final)
    return {
      ok: false,
      outcome: OUTCOME.INTERRUPTED,
      state: final,
      conflicts: error?.conflicts ?? [],
      changes: error?.changes ?? emptyChanges(),
      error: { code: error?.code ?? 'SYNC_ERROR', message: error?.message || 'Sincronización interrumpida.' },
      persistFailed,
      recovered,
    }
  } finally {
    running.delete(slot(accountId))
  }
}

/** Resumen del estado de sincronización para la cabecera; se deduce del estado guardado, no de la última acción. */
export function syncSummary(state, { account, locked = false, format = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } = {}) {
  if (!account) return { tone: 'local', text: 'Solo en este equipo' }
  if (locked) return { tone: 'busy', text: 'Sincronizando…' }
  const at = state.lastSync?.status === 'ok' && state.lastSync.at ? format(state.lastSync.at) : ''
  if (state.syncOperation) return { tone: 'warning', text: 'Operación a medias: sincroniza para recuperarla' }
  if (hasPendingChanges(state)) return { tone: 'pending', text: at ? `Cambios sin sincronizar · última vez ${at}` : 'Cambios sin sincronizar' }
  return at ? { tone: 'ok', text: `Sincronizado · ${at}` } : { tone: 'ok', text: 'Sin cambios pendientes' }
}

/** Texto para la persona usuaria; nunca presenta como éxito un resultado con conflictos o interrumpido. */
export function describeOutcome(result) {
  const { changes } = result
  const detail = [
    changes.created && `${changes.created} creado${changes.created === 1 ? '' : 's'}`,
    changes.updated && `${changes.updated} actualizado${changes.updated === 1 ? '' : 's'}`,
    changes.pulled && `${changes.pulled} descargado${changes.pulled === 1 ? '' : 's'}`,
    changes.removed && `${changes.removed} quitado${changes.removed === 1 ? '' : 's'} aquí`,
    changes.deleted && `${changes.deleted} borrado${changes.deleted === 1 ? '' : 's'} en tu cuenta`,
  ].filter(Boolean).join(', ')
  switch (result.outcome) {
    case OUTCOME.SYNCED: return detail ? `Sincronizado: ${detail}.` : (result.recovered ? 'Se recuperó la operación que había quedado a medias.' : 'Todo estaba al día.')
    case OUTCOME.CONFLICTS: return `Sincronización incompleta: ${result.conflicts.length} asunto${result.conflicts.length === 1 ? '' : 's'} requiere${result.conflicts.length === 1 ? '' : 'n'} tu decisión${detail ? ` (${detail})` : ''}.`
    case OUTCOME.INTERRUPTED: return `${result.error?.message || 'Sincronización interrumpida.'} Lo confirmado hasta ahora quedó guardado; puedes reintentar.`
    case OUTCOME.BUSY: return result.error.message
    default: return result.error?.message || 'No se pudo sincronizar.'
  }
}
