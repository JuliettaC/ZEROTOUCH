import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { DEFAULT_ENGINE_STATUS } from '../data/engineStatus'
import { buildIndex, withExtras } from './decoder'
import DwellKeyboard from './DwellKeyboard'
import { LETTERS, keyboardGeometry } from './layout'
import {
  afterSend,
  createKeyboardState,
  discard,
  ingest,
  pick,
  resetSession,
  runEffects,
} from './keyboard'
import { REJECTION_MESSAGES, airswipeTransition, closeAirswipe, typingBlocker } from './session'
import {
  HEARTBEAT_EVERY_MS,
  clearHeartbeat,
  otherKeyboardSize,
  readKeyboardMode,
  readKeyboardSize,
  writeHeartbeat,
  writeKeyboardMode,
  writeKeyboardSize,
} from './link'
import './overlay.css'

// Ventana del teclado Air-Swipe (no activable, siempre encima; la crea el puente en `#airswipe`).
// Lee la telemetría del motor, propone palabras a partir del trazo y escribe SOLO al confirmar.
// El decodificador y el léxico (40 000 palabras, local) se cargan aquí y no en la ventana principal.
const POLL_MS = 100
const RECT_REFRESH_MS = 2500
const TRAIL_MAX = 80
const pct = (value, total) => `${(value / total) * 100}%`

function useOverlay() {
  const [ctx, setCtx] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState(DEFAULT_ENGINE_STATUS)
  const [bridgeDown, setBridgeDown] = useState(false)
  const [kb, setKb] = useState(() => createKeyboardState(null))
  const [trail, setTrail] = useState([])
  const kbRef = useRef(kb)
  const ctxRef = useRef(null)
  const prevRef = useRef(null)
  const indexRef = useRef(null)
  const refreshRectRef = useRef(null)
  const [edge, setEdge] = useState('bottom')
  const [size, setSize] = useState(() => readKeyboardSize(globalThis.localStorage))
  const [mode, setMode] = useState(() => readKeyboardMode(globalThis.localStorage))
  const [lexicon, setLexicon] = useState(null)
  const modeRef = useRef(mode)

  const commit = useCallback((next) => {
    kbRef.current = next
    setKb(next)
  }, [])
  const execute = useCallback(
    async (effects, live) => {
      const result = await runEffects(api, effects)
      commit(afterSend(kbRef.current, result, live))
    },
    [commit],
  )

  // Léxico (una vez) y geometría real de la ventana (se vuelve a leer por si cambia de monitor o posición).
  useEffect(() => {
    let cancelled = false
    const readRect = async () => {
      const rect = await api.airswipeWindowRect()
      return {
        screen: rect.screen,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        geometry: keyboardGeometry(rect.width, rect.height),
      }
    }
    const publish = (geometry) => {
      const next = { index: indexRef.current, ...geometry }
      ctxRef.current = next
      setCtx(next)
    }
    refreshRectRef.current = () =>
      readRect().then((geometry) => {
        if (!cancelled && indexRef.current) publish(geometry)
      })
    Promise.all([import('./lexico-es.json'), import('./lexico-extra-es.json'), readRect()])
      .then(([lexicon, extra, geometry]) => {
        if (cancelled) return
        const merged = withExtras(lexicon.default, extra.default)
        indexRef.current = buildIndex(merged)
        setLexicon(merged)
        publish(geometry)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error?.message || 'No se pudo preparar el teclado.')
      })
    const timer = window.setInterval(() => {
      if (!indexRef.current) return
      readRect()
        .then((geometry) => {
          const current = ctxRef.current?.rect
          if (
            !cancelled &&
            current &&
            (current.x !== geometry.rect.x ||
              current.y !== geometry.rect.y ||
              current.width !== geometry.rect.width ||
              current.height !== geometry.rect.height)
          )
            publish(geometry)
        })
        .catch(() => {})
    }, RECT_REFRESH_MS)
    return () => {
      cancelled = true
      refreshRectRef.current = null
      window.clearInterval(timer)
    }
  }, [])

  // Latido para la ventana principal; al descargar la página se apaga el modo teclado en el motor.
  useEffect(() => {
    const beat = () => writeHeartbeat(globalThis.localStorage)
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_EVERY_MS)
    const onHide = () => {
      clearHeartbeat(globalThis.localStorage)
      api.engineAirswipe(false).catch(() => {})
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', onHide)
      clearHeartbeat(globalThis.localStorage)
    }
  }, [])

  // Telemetría: una petición a la vez; cada estado nuevo pasa por las transiciones de sesión y `ingest`.
  useEffect(() => {
    let cancelled = false,
      timer = 0
    const handle = async (next) => {
      const prev = prevRef.current
      prevRef.current = next
      setStatus(next)
      setTrail((current) =>
        next.tracing
          ? [...current.slice(-TRAIL_MAX), [next.cursorX, next.cursorY]]
          : current.length
            ? []
            : current,
      )
      let state = kbRef.current
      let effects = []
      const transition = airswipeTransition(prev, next, {
        wantOpen: true,
        airswipeEnabled: next.appliedConfig?.airswipe !== false,
      })
      // El primer estado y los previos a tener léxico solo fijan la línea base: no se aplican eventos anteriores.
      if (prev === null || !ctxRef.current || transition.clearPending)
        state = resetSession(state, next)
      else ({ state, effects } = ingest(state, next, ctxRef.current))
      // Con el teclado por permanencia los trazos y los gestos de propuesta no escriben: solo avanza la línea base.
      if (modeRef.current === 'dwell') {
        state = { ...state, pending: null, notice: '' }
        effects = []
      }
      commit(state)
      if (effects.length) await execute(effects, next)
      if (transition.reengage) {
        try {
          await api.engineAirswipe(true)
        } catch (error) {
          commit({ ...kbRef.current, notice: error?.message || 'No se pudo reactivar el teclado.' })
        }
      }
    }
    const tick = async () => {
      try {
        const next = await api.engineStatus()
        if (cancelled || !next) return
        setBridgeDown(false)
        await handle(next)
      } catch {
        if (!cancelled) setBridgeDown(true)
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, POLL_MS)
      }
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [commit, execute])

  const actions = {
    // Envío del teclado por permanencia: mismo contrato de rechazos que el trazo (afterSend).
    send: async (effects) => {
      const result = await runEffects(api, effects)
      commit(afterSend(kbRef.current, result, prevRef.current))
      return result
    },
    // Permanencia (teclas grandes, siempre en la ventana grande) o trazo (tamaño guardado).
    switchMode: async () => {
      const next = modeRef.current === 'dwell' ? 'trace' : 'dwell'
      try {
        await api.airswipeWindowOpen(edge, next === 'dwell' ? 'large' : size)
        modeRef.current = next
        setMode(next)
        writeKeyboardMode(globalThis.localStorage, next)
        await refreshRectRef.current?.()
      } catch (error) {
        commit({ ...kbRef.current, notice: error?.message || 'No se pudo cambiar el teclado.' })
      }
    },
    pick: async (index) => {
      const result = pick(kbRef.current, index)
      commit(result.state)
      if (result.effects.length) await execute(result.effects, prevRef.current)
    },
    letter: (letter) => execute([{ type: 'text', text: letter }], prevRef.current),
    key: (key) => execute([{ type: 'key', key }], prevRef.current),
    discard: () => commit(discard(kbRef.current)),
    close: async () => {
      clearHeartbeat(globalThis.localStorage)
      await closeAirswipe(api)
    },
    // Sube o baja el teclado para que no tape lo que se está escribiendo; la geometría del trazo se relee al momento.
    move: async () => {
      const next = edge === 'bottom' ? 'top' : 'bottom'
      try {
        await api.airswipeWindowOpen(next, modeRef.current === 'dwell' ? 'large' : size)
        setEdge(next)
        await refreshRectRef.current?.()
      } catch (error) {
        commit({ ...kbRef.current, notice: error?.message || 'No se pudo mover el teclado.' })
      }
    },
    // Compacto (por defecto, deja ver la aplicación) o grande (teclas más grandes para trazar). Se recuerda por equipo.
    resize: async () => {
      const next = otherKeyboardSize(size)
      try {
        await api.airswipeWindowOpen(edge, next)
        setSize(next)
        writeKeyboardSize(globalThis.localStorage, next)
        await refreshRectRef.current?.()
      } catch (error) {
        commit({
          ...kbRef.current,
          notice: error?.message || 'No se pudo cambiar el tamaño del teclado.',
        })
      }
    },
    reactivate: async () => {
      try {
        await api.engineAirswipe(true)
      } catch (error) {
        commit({ ...kbRef.current, notice: error?.message || 'No se pudo reactivar el teclado.' })
      }
    },
  }
  return { ctx, loadError, status, bridgeDown, kb, trail, edge, size, mode, lexicon, actions }
}

function messageFor({ status, bridgeDown, loadError, kb, ctx }) {
  if (loadError) return { text: loadError, tone: 'error' }
  if (bridgeDown) return { text: 'Sin conexión con el motor gestual.', tone: 'error' }
  if (!ctx) return { text: 'Preparando el teclado…', tone: 'info' }
  if (!status.running) return { text: 'Activa la cámara en ZeroTouch.', tone: 'warn' }
  if (kb.notice) return { text: kb.notice, tone: 'warn' }
  const blocker = typingBlocker(status)
  if (blocker) return { text: REJECTION_MESSAGES[blocker], tone: 'warn', blocker }
  return {
    text: status.tracing ? 'Trazando…' : 'Apunta con el índice y recorre las letras de la palabra.',
    tone: 'info',
  }
}

export default function AirSwipeOverlay() {
  const { ctx, loadError, status, bridgeDown, kb, trail, edge, size, mode, lexicon, actions } = useOverlay()
  const message = messageFor({ status, bridgeDown, loadError, kb, ctx })
  const geometry = ctx?.geometry
  const canReactivate = !bridgeDown && status.running && !status.airswipe

  if (mode === 'dwell' && ctx && !loadError && !bridgeDown)
    return (
      <DwellKeyboard
        ctx={ctx}
        status={status}
        lexicon={lexicon}
        send={actions.send}
        header={
          <div className="as-actions">
            {canReactivate && (
              <button type="button" className="as-action" onClick={actions.reactivate}>
                Reactivar
              </button>
            )}
            <button
              type="button"
              className="as-action"
              aria-label="Cambiar al teclado de trazo"
              title="Escribir trazando palabras"
              onClick={actions.switchMode}
            >
              Trazo
            </button>
            <button
              type="button"
              className="as-action"
              aria-label={edge === 'bottom' ? 'Mover el teclado arriba' : 'Mover el teclado abajo'}
              onClick={actions.move}
            >
              {edge === 'bottom' ? '▲' : '▼'}
            </button>
            <button type="button" className="as-action close" aria-label="Cerrar teclado" onClick={actions.close}>
              ✕
            </button>
          </div>
        }
      />
    )

  return (
    <div className="as-overlay">
      <div
        className="as-bar"
        style={geometry ? { height: pct(geometry.bar, geometry.height) } : undefined}
      >
        <div
          className="as-proposals"
          role="group"
          aria-label="Propuestas de palabra"
          aria-live="polite"
        >
          {kb.pending ? (
            <>
              {kb.pending.candidates.map((word, index) => (
                <button
                  key={word}
                  type="button"
                  className={`as-chip ${index === kb.pending.chosen ? 'chosen' : ''}`}
                  onClick={() => actions.pick(index)}
                >
                  {word}
                </button>
              ))}
              <button
                type="button"
                className="as-chip ghost"
                aria-label="Descartar propuesta"
                onClick={actions.discard}
              >
                ✕
              </button>
            </>
          ) : (
            <p className={`as-message ${message.tone}`}>{message.text}</p>
          )}
        </div>
        <div className="as-actions">
          {canReactivate && (
            <button type="button" className="as-action" onClick={actions.reactivate}>
              Reactivar
            </button>
          )}
          <button type="button" className="as-action" onClick={() => actions.key('backspace')}>
            Borrar
          </button>
          <button type="button" className="as-action" onClick={() => actions.key('space')}>
            Espacio
          </button>
          <button type="button" className="as-action" onClick={() => actions.key('enter')}>
            Intro
          </button>
          <button
            type="button"
            className="as-action"
            aria-label={edge === 'bottom' ? 'Mover el teclado arriba' : 'Mover el teclado abajo'}
            onClick={actions.move}
          >
            {edge === 'bottom' ? '▲' : '▼'}
          </button>
          <button
            type="button"
            className="as-action"
            aria-label={size === 'large' ? 'Achicar el teclado' : 'Agrandar el teclado'}
            title={size === 'large' ? 'Achicar' : 'Agrandar'}
            onClick={actions.resize}
          >
            {size === 'large' ? '⤡' : '⤢'}
          </button>
          <button
            type="button"
            className="as-action"
            aria-label="Cambiar al teclado de teclas grandes"
            title="Teclas grandes: deja el cursor quieto sobre cada letra"
            onClick={actions.switchMode}
          >
            Teclas
          </button>
          <button
            type="button"
            className="as-action close"
            aria-label="Cerrar teclado"
            onClick={actions.close}
          >
            ✕
          </button>
        </div>
      </div>
      {geometry &&
        LETTERS.map((letter) => {
          const r = geometry.rects[letter]
          return (
            <div
              key={letter}
              className="as-key-slot"
              style={{
                left: pct(r.x, geometry.width),
                top: pct(r.y, geometry.height),
                width: pct(r.w, geometry.width),
                height: pct(r.h, geometry.height),
              }}
            >
              <button
                type="button"
                className="as-key"
                aria-label={`Tecla ${letter}`}
                onClick={() => actions.letter(letter)}
              >
                {letter}
              </button>
            </div>
          )
        })}
      {ctx && trail.length > 1 && (
        <svg
          className="as-trail"
          viewBox={`0 0 ${ctx.rect.width} ${ctx.rect.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={trail
              .map(
                ([nx, ny]) =>
                  `${ctx.screen.left + nx * ctx.screen.width - ctx.rect.x},${ctx.screen.top + ny * ctx.screen.height - ctx.rect.y}`,
              )
              .join(' ')}
          />
        </svg>
      )}
    </div>
  )
}
