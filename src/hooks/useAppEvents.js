// Eventos de aplicación del motor en la ventana principal: avisos (multimedia, ventanas, precisión)
// y temporizadores. La lógica vive en módulos puros (src/engine/appEvents.js, src/data/timers.js);
// este hook solo los conecta con la telemetría, un reloj y el aviso sonoro.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createEventCursor, describeEvent, takeNewEvents } from '../engine/appEvents'
import { addMinute, cancelTimer, pauseTimer, resumeTimer, startTimer, tickTimers, timerFromGesture } from '../data/timers'

const TICK_MS = 500
const TIMER_GESTURE_TEXT = {
  started: minutes => `⏱ Temporizador de ${minutes} min iniciado. El mismo gesto lo pausa.`,
  paused: () => '⏸ Temporizador en pausa. Repite el gesto para reanudarlo.',
  resumed: () => '⏱ Temporizador reanudado.',
  full: () => 'Ya hay 4 temporizadores en marcha.',
}

function beep() {
  try {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Context) return
    const ctx = new Context()
    const now = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, now + i * 0.35)
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.35 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.35)
      osc.stop(now + i * 0.35 + 0.26)
    }
    window.setTimeout(() => ctx.close().catch(() => {}), 1500)
  } catch { /* sin audio: el aviso visual basta */ }
}

export function useAppEvents({ engineStatus, timerMinutes = 5, onNotice }) {
  const [timers, setTimersState] = useState([])
  const timersRef = useRef(timers)
  // Una sola fuente de verdad sin efectos dentro de los actualizadores de estado (StrictMode los repite).
  const setTimers = useCallback(change => {
    const next = typeof change === 'function' ? change(timersRef.current) : change
    timersRef.current = next
    setTimersState(next)
  }, [])
  const [now, setNow] = useState(() => Date.now())
  const cursorRef = useRef(null)
  const minutesRef = useRef(timerMinutes)
  useEffect(() => { minutesRef.current = timerMinutes }, [timerMinutes])

  // Eventos nuevos de la telemetría: cada uno se aplica una sola vez.
  useEffect(() => {
    if (cursorRef.current === null) { cursorRef.current = createEventCursor(engineStatus); return }
    const { cursor, events } = takeNewEvents(cursorRef.current, engineStatus)
    cursorRef.current = cursor
    for (const event of events) {
      if (event.event === 'TIMER') {
        const at = Date.now()
        const result = timerFromGesture(timersRef.current, { minutes: minutesRef.current, now: at, id: `g${event.seq}` })
        setNow(at)
        setTimers(result.timers)
        onNotice(TIMER_GESTURE_TEXT[result.action](minutesRef.current))
        continue
      }
      const message = describeEvent(event)
      if (message) onNotice(message.text, message.tone === 'warn' ? 'info' : message.tone)
    }
  }, [engineStatus, onNotice, setTimers])

  // Reloj: solo mientras haya algún temporizador corriendo.
  const running = timers.some(timer => !timer.done && timer.pausedLeft === null)
  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      const { timers: next, finished } = tickTimers(timersRef.current, at)
      setTimers(next)
      if (finished.length) { beep(); onNotice('⏰ ¡Tiempo! Un temporizador llegó a cero.') }
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [running, onNotice, setTimers])

  const start = useCallback(minutes => {
    const at = Date.now()
    setNow(at)
    const result = startTimer(timersRef.current, { minutes, now: at })
    if (!result.added) onNotice('Ya hay 4 temporizadores en marcha.', 'error')
    setTimers(result.timers)
  }, [onNotice, setTimers])
  const pause = useCallback(id => setTimers(current => pauseTimer(current, id, Date.now())), [setTimers])
  const resume = useCallback(id => { const at = Date.now(); setNow(at); setTimers(current => resumeTimer(current, id, at)) }, [setTimers])
  const plusMinute = useCallback(id => { const at = Date.now(); setNow(at); setTimers(current => addMinute(current, id, at)) }, [setTimers])
  const cancel = useCallback(id => setTimers(current => cancelTimer(current, id)), [setTimers])

  return { timers, now, start, pause, resume, plusMinute, cancel }
}
