// Sesión del teclado Air-Swipe: convierte los eventos del motor en propuestas de palabras y en
// efectos de escritura. Puro (sin React ni Tauri): la ventana overlay solo lo conecta a la telemetría.
//
// Modelo de escritura (explícito a propósito; la precisión del decodificador aún no se ha medido):
//  - Un trazo (AIRSWIPE_TRACE) genera una PROPUESTA con hasta 5 candidatos; no escribe nada.
//  - Se escribe solo al confirmar: tocar un candidato, o el evento CONFIRM (si la persona lo habilitó).
//  - Un trazo nuevo sustituye la propuesta; CANCEL la descarta; BACK/FORWARD recorren los candidatos
//    (sin propuesta equivalen a Borrar y Espacio).
//  - Nada se encola entre sesiones: tras un rechazo de sesión, una parada de emergencia o un reinicio
//    del motor se descarta la propuesta y se ignoran los eventos anteriores.
//  - No se conserva el texto escrito: solo la propuesta pendiente (palabras del léxico) y un aviso.
import { decode, traceToKeyUnits } from './decoder.js'
import { sendKey, sendText } from './session.js'

export const MAX_CANDIDATES = 5
const MIN_TRACE_POINTS = 4
const MAX_TRACE_POINTS = 600 // igual que TRACE_MAX_POINTS del motor

const baselineOf = status => (Number.isInteger(status?.eventSeq) && status.eventSeq >= 0 ? status.eventSeq : 0)
export const createKeyboardState = status => ({ baseline: baselineOf(status), pending: null, notice: '' })

/** Descarta propuesta y eventos anteriores: lo que ya llegó no se aplica a la sesión nueva. */
export const resetSession = (state, status, notice = '') => ({ baseline: baselineOf(status), pending: null, notice })

const validPoint = point => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
const validTrace = points => Array.isArray(points) && points.length >= MIN_TRACE_POINTS && points.length <= MAX_TRACE_POINTS && points.every(validPoint)
const cycle = (pending, step) => ({ ...pending, chosen: (pending.chosen + step + pending.candidates.length) % pending.candidates.length })
const word = pending => `${pending.candidates[pending.chosen]} `

/**
 * Aplica los eventos nuevos de la telemetría (`recentEvents` con `seq` mayor que el ya visto).
 * @param {object} ctx { index, screen, rect, geometry }: léxico indexado y geometría de la ventana
 * @returns {{state:object, effects:Array<{type:'text', text:string}|{type:'key', key:string}>}}
 */
export function ingest(state, status, ctx) {
  // Un `eventSeq` menor que el visto significa que el motor se reinició: sesión nueva.
  let current = baselineOf(status) < state.baseline ? { baseline: 0, pending: null, notice: '' } : state
  const events = (Array.isArray(status?.recentEvents) ? status.recentEvents : [])
    .filter(event => Number.isInteger(event?.seq) && event.seq > current.baseline)
    .sort((a, b) => a.seq - b.seq)
  if (events.length === 0) return { state: current, effects: [] }
  const effects = []
  let { pending, notice } = current
  let baseline = current.baseline
  for (const event of events) {
    baseline = event.seq
    switch (event.event) {
      case 'AIRSWIPE_TRACE': {
        if (!validTrace(event.points)) break
        const candidates = decode(traceToKeyUnits(event.points, ctx), ctx.index, { max: MAX_CANDIDATES }).map(c => c.word)
        pending = candidates.length ? { candidates, chosen: 0 } : null
        notice = candidates.length ? '' : 'No reconocí ninguna palabra. Repite el trazo.'
        break
      }
      case 'CONFIRM':
        if (pending) { effects.push({ type: 'text', text: word(pending) }); pending = null; notice = '' }
        break
      case 'CANCEL':
        if (pending) { pending = null; notice = 'Propuesta descartada.' }
        break
      case 'BACK':
        if (pending) pending = cycle(pending, -1)
        else effects.push({ type: 'key', key: 'backspace' })
        break
      case 'FORWARD':
        if (pending) pending = cycle(pending, 1)
        else effects.push({ type: 'key', key: 'space' })
        break
      default:
        break
    }
  }
  return { state: { baseline, pending, notice }, effects }
}

/** Toque sobre un candidato: escribe esa palabra con un espacio y limpia la propuesta. */
export function pick(state, index) {
  const candidate = state.pending?.candidates[index]
  if (!candidate) return { state, effects: [] }
  return { state: { ...state, pending: null, notice: '' }, effects: [{ type: 'text', text: `${candidate} ` }] }
}

/** Descarta la propuesta pendiente (botón o evento CANCEL). */
export const discard = state => (state.pending ? { ...state, pending: null, notice: 'Propuesta descartada.' } : state)

/**
 * Resultado de enviar un efecto al motor. Un rechazo de sesión descarta la propuesta y los eventos
 * anteriores y NO se reintenta; otros errores solo se muestran.
 */
export function afterSend(state, result, status) {
  if (result.ok) return state
  if (result.discard) return resetSession(state, status, result.message)
  return { ...state, notice: result.message }
}

/** Ejecuta los efectos en orden y se detiene en el primer fallo (sin reintentos). */
export async function runEffects(api, effects) {
  let last = { ok: true }
  for (const effect of effects) {
    last = effect.type === 'text' ? await sendText(api, effect.text) : await sendKey(api, effect.key)
    if (!last.ok) return last
  }
  return last
}
