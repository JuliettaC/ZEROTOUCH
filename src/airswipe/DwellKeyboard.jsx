import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clickKey,
  createDwell,
  cursorInWindow,
  dwellLayout,
  hitTest,
  needFor,
  stepDwell,
} from './dwell'
import { buildSuggester, planKey, suggest } from './typing'
import { REJECTION_MESSAGES, typingBlocker } from './session'
import terms from './terminos-recetas.json'
import './dwell.css'

// Teclado por permanencia: teclas grandes, el cursor quieto sobre una tecla la escribe (con anillo de
// progreso). También admite la pinza (clic) como atajo. La lógica vive en `dwell.js` y `typing.js`.
const pct = (value, total) => `${(value / total) * 100}%`

function hint(status) {
  const blocker = typingBlocker(status)
  if (blocker) return REJECTION_MESSAGES[blocker]
  if (status.pointerArmed === false) return 'Abre la mano un momento para activar el puntero.'
  return 'Deja el cursor quieto sobre una letra para escribirla.'
}

export default function DwellKeyboard({ ctx, status, lexicon, send, header }) {
  const layout = useMemo(() => dwellLayout(ctx.rect.width, ctx.rect.height), [ctx.rect.width, ctx.rect.height])
  const suggester = useMemo(() => (lexicon ? buildSuggester(terms, lexicon) : null), [lexicon])
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const [hover, setHover] = useState({ key: null, progress: 0 })
  const suggestions = useMemo(() => suggest(suggester, text), [suggester, text])
  const textRef = useRef('')
  const dwellRef = useRef(createDwell())
  const lastFireRef = useRef(null)
  const busyRef = useRef(false)
  const suggestionsRef = useRef(suggestions)
  useEffect(() => {
    suggestionsRef.current = suggestions
  }, [suggestions])

  const enabled = useCallback(
    (key) => key.kind !== 'suggestion' || Boolean(suggestionsRef.current[key.index]),
    [],
  )
  const need = useMemo(() => needFor(layout.keys), [layout])

  // Escribe una tecla: un envío a la vez (si llega otra mientras se envía, se ignora: nunca se encola).
  const press = useCallback(
    async (key) => {
      if (busyRef.current) return
      const resolved = key.kind === 'suggestion' ? { ...key, value: suggestionsRef.current[key.index] } : key
      if (resolved.kind === 'suggestion' && !resolved.value) return
      const plan = planKey(textRef.current, resolved)
      if (plan.effects.length === 0) {
        setNotice(plan.notice || '')
        return
      }
      busyRef.current = true
      try {
        const result = await send(plan.effects)
        if (result.ok) {
          textRef.current = plan.text
          setText(plan.text)
          setNotice(plan.searched !== undefined ? `Buscando «${plan.searched}». Elige un resultado con la pinza.` : '')
        } else setNotice(result.message || 'No se pudo escribir.')
      } finally {
        busyRef.current = false
      }
    },
    [send],
  )

  // Cada telemetría nueva (~10 por segundo): tecla bajo el cursor y avance de la permanencia.
  useEffect(() => {
    if (typingBlocker(status) || status.pointerArmed === false || busyRef.current) {
      if (!busyRef.current) dwellRef.current = createDwell()
      setHover((h) => (h.key === null ? h : { key: null, progress: 0 }))
      return
    }
    const point = cursorInWindow(status, ctx)
    const keyId = hitTest(layout.keys, point, dwellRef.current.key, enabled)
    const now = performance.now()
    const step = stepDwell(dwellRef.current, keyId, now, need)
    dwellRef.current = step.state
    setHover((h) =>
      h.key === step.state.key && Math.abs(h.progress - step.progress) < 0.01
        ? h
        : { key: step.state.key, progress: step.progress },
    )
    if (step.fire) {
      lastFireRef.current = { id: step.fire, at: now }
      const key = layout.keys.find((k) => k.id === step.fire)
      if (key) press(key)
    }
  }, [status, ctx, layout, enabled, need, press])

  const onClick = useCallback(
    (key) => {
      if (!enabled(key)) return
      const result = clickKey(dwellRef.current, key.id, performance.now(), lastFireRef.current)
      dwellRef.current = result.state
      if (result.write) press(key)
    },
    [enabled, press],
  )

  const labelOf = (key) =>
    key.kind === 'letter' ? key.value : key.kind === 'action' ? key.label : suggestions[key.index] || ''

  return (
    <div className="as-overlay as-dwell">
      <div className="dw-top" style={{ height: pct(layout.textH, layout.height) }}>
        <div className="dw-text" aria-live="polite">
          {text ? (
            <span className="dw-typed">
              {text.length > 42 ? `…${text.slice(-42)}` : text}
              <span className="dw-caret" aria-hidden="true" />
            </span>
          ) : (
            <span className="dw-hint">{hint(status)}</span>
          )}
          {notice && <span className="dw-notice">{notice}</span>}
        </div>
        {header}
      </div>
      {layout.keys.map((key) => {
        const label = labelOf(key)
        if (key.kind === 'suggestion' && !label) return null
        const active = hover.key === key.id
        return (
          <div
            key={key.id}
            className="dw-slot"
            style={{
              left: pct(key.x, layout.width),
              top: pct(key.y, layout.height),
              width: pct(key.w, layout.width),
              height: pct(key.h, layout.height),
            }}
          >
            <button
              type="button"
              className={`dw-key ${key.kind} ${active ? 'active' : ''}`}
              style={{ '--p': active ? hover.progress : 0 }}
              aria-label={key.kind === 'letter' ? `Letra ${label}` : label}
              onClick={() => onClick(key)}
            >
              {label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
