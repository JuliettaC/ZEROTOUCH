// Eventos de aplicación del motor (telemetría `recentEvents` / `eventSeq`) para la ventana principal.
// Puro: sin React ni Tauri. El teclado Air-Swipe lleva su propio cursor de eventos (src/airswipe/keyboard.js);
// este módulo solo cubre los avisos de la ventana principal y el temporizador.
//
// - Al conectar (o cuando el motor se reinicia y `eventSeq` baja) se fija la línea base: nunca se
//   aplican eventos anteriores, para no arrancar temporizadores viejos.
// - Cada evento se entrega una sola vez, en orden de `seq`.

const seqOf = status => (Number.isInteger(status?.eventSeq) && status.eventSeq >= 0 ? status.eventSeq : 0)

/** Cursor inicial. Hasta ver el motor en marcha no hay línea base fiable (`primed: false`). */
export const createEventCursor = status => ({ baseline: seqOf(status), primed: Boolean(status?.running) })

/**
 * Eventos nuevos desde el cursor, en orden.
 * - El primer estado con el motor en marcha solo fija la línea base: lo que ya estaba en la lista
 *   (p. ej. al recargar la interfaz) nunca se vuelve a aplicar.
 * - Con el motor detenido se olvida la línea base; al arrancar de nuevo se vuelve a fijar.
 * - Si `eventSeq` baja sin pasar por «detenido», el motor se reinició: sus eventos son nuevos.
 * @returns {{cursor: {baseline:number, primed:boolean}, events: object[]}}
 */
export function takeNewEvents(cursor, status) {
  const seq = seqOf(status)
  if (!status?.running) return { cursor: { baseline: seq, primed: false }, events: [] }
  if (!cursor.primed) return { cursor: { baseline: seq, primed: true }, events: [] }
  const baseline = seq < cursor.baseline ? 0 : cursor.baseline
  const events = (Array.isArray(status?.recentEvents) ? status.recentEvents : [])
    .filter(event => Number.isInteger(event?.seq) && event.seq > baseline && typeof event.event === 'string')
    .sort((a, b) => a.seq - b.seq)
  return { cursor: { baseline: events.length ? events[events.length - 1].seq : baseline, primed: true }, events }
}

const WINDOW_RESULTS = {
  MINIMIZED: null,
  RESTORED: null,
  ALREADY_MINIMIZED: 'La ventana ya estaba minimizada.',
  OWN_WINDOW: 'ZeroTouch no se minimiza a sí misma: elige antes otra ventana.',
  NO_WINDOW: 'No hay ninguna ventana activa que minimizar.',
  NOTHING_TO_RESTORE: 'No hay ninguna ventana que traer de vuelta.',
  UNAVAILABLE: 'El control de ventanas no está disponible en este equipo.',
}

/** Aviso breve para la persona usuaria, o null si el evento no se anuncia. */
export function describeEvent(event) {
  switch (event?.event) {
    case 'MEDIA_PLAY_PAUSE':
      return event.injected ? { text: '⏯ Reproducir / pausar', tone: 'info' } : { text: '⏯ Reproducir / pausar (no enviado: activa Controlar)', tone: 'warn' }
    case 'MEDIA_NEXT':
      return event.injected ? { text: '⏭ Siguiente pista', tone: 'info' } : { text: '⏭ Siguiente pista (no enviado: activa Controlar)', tone: 'warn' }
    case 'MINIMIZE_WINDOW':
    case 'RESTORE_WINDOW': {
      const down = event.event === 'MINIMIZE_WINDOW'
      if (!event.injected) return { text: `${down ? 'Bajar' : 'Traer'} ventana: activa Controlar para que funcione.`, tone: 'warn' }
      const problem = WINDOW_RESULTS[event.result]
      if (problem) return { text: problem, tone: 'warn' }
      return { text: down ? 'Ventana minimizada. Sube la mano abierta para traerla de vuelta.' : 'Ventana restaurada.', tone: 'info' }
    }
    case 'NEXT_TAB':
    case 'PREV_TAB': {
      const label = event.event === 'NEXT_TAB' ? 'Pestaña siguiente' : 'Pestaña anterior'
      return event.injected ? { text: `🤙 ${label}`, tone: 'info' } : { text: `🤙 ${label} (no enviado: activa Controlar)`, tone: 'warn' }
    }
    case 'PRECISION':
      return { text: event.active ? 'Modo precisión activado: el cursor va más lento.' : 'Modo precisión desactivado.', tone: 'info' }
    case 'GAZE_CALIBRATED':
      return { text: 'Orientación de la cabeza calibrada.', tone: 'info' }
    default:
      return null
  }
}
