// Temporizadores de la interfaz (los inicia el gesto con la acción «temporizador_iniciar» o un botón).
// Puro: sin React ni relojes propios; cada función recibe `now` en milisegundos.
// No se guardan en el almacenamiento: duran lo que dure la aplicación abierta.

export const MAX_TIMERS = 4
export const MIN_MINUTES = 1
export const MAX_MINUTES = 120
const MINUTE = 60_000

const clampMinutes = (minutes) =>
  Number.isFinite(Number(minutes)) && minutes !== null && minutes !== ''
    ? Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(Number(minutes))))
    : 5

/**
 * Añade un temporizador. Si ya hay MAX_TIMERS en marcha no se añade (se devuelve `added: false`).
 * Los terminados no cuentan para el límite y se descartan al añadir uno nuevo.
 */
export function startTimer(timers, { minutes, now, source = 'boton', id }) {
  const active = timers.filter((timer) => !timer.done)
  if (active.length >= MAX_TIMERS) return { timers, added: false }
  const duration = clampMinutes(minutes) * MINUTE
  const timer = {
    id: id ?? `t${now}-${active.length}`,
    duration,
    endsAt: now + duration,
    pausedLeft: null,
    done: false,
    source,
  }
  return { timers: [...active, timer], added: true }
}

/** Milisegundos que faltan (0 si terminó). */
export const remainingMs = (timer, now) =>
  timer.done ? 0 : timer.pausedLeft !== null ? timer.pausedLeft : Math.max(0, timer.endsAt - now)

export const pauseTimer = (timers, id, now) =>
  timers.map((timer) =>
    timer.id === id && !timer.done && timer.pausedLeft === null
      ? { ...timer, pausedLeft: remainingMs(timer, now) }
      : timer,
  )

export const resumeTimer = (timers, id, now) =>
  timers.map((timer) =>
    timer.id === id && !timer.done && timer.pausedLeft !== null
      ? { ...timer, endsAt: now + timer.pausedLeft, pausedLeft: null }
      : timer,
  )

export const cancelTimer = (timers, id) => timers.filter((timer) => timer.id !== id)

/** Suma un minuto (también a uno terminado, que vuelve a correr). */
export function addMinute(timers, id, now) {
  return timers.map((timer) => {
    if (timer.id !== id) return timer
    if (timer.done)
      return {
        ...timer,
        done: false,
        pausedLeft: null,
        endsAt: now + MINUTE,
        duration: timer.duration + MINUTE,
      }
    if (timer.pausedLeft !== null)
      return { ...timer, pausedLeft: timer.pausedLeft + MINUTE, duration: timer.duration + MINUTE }
    return { ...timer, endsAt: timer.endsAt + MINUTE, duration: timer.duration + MINUTE }
  })
}

/** Marca como terminados los que llegaron a cero. Devuelve los recién terminados para avisar una sola vez. */
export function tickTimers(timers, now) {
  const finished = []
  const next = timers.map((timer) => {
    if (timer.done || timer.pausedLeft !== null || timer.endsAt > now) return timer
    finished.push(timer.id)
    return { ...timer, done: true }
  })
  return { timers: finished.length ? next : timers, finished }
}

/** «m:ss» o «h:mm:ss». */
export function formatRemaining(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Acción «temporizador_iniciar» del contrato: «inicia, pausa o reanuda el temporizador activo».
 * Si hay uno sin terminar, el gesto pausa o reanuda el más reciente; si no, inicia uno nuevo.
 * @returns {{timers: object[], action: 'started'|'paused'|'resumed'|'full'}}
 */
export function timerFromGesture(timers, { minutes, now, id }) {
  const current = [...timers].reverse().find((timer) => !timer.done)
  if (current) {
    return current.pausedLeft === null
      ? { timers: pauseTimer(timers, current.id, now), action: 'paused' }
      : { timers: resumeTimer(timers, current.id, now), action: 'resumed' }
  }
  const result = startTimer(timers, { minutes, now, source: 'gesto', id })
  return { timers: result.timers, action: result.added ? 'started' : 'full' }
}
