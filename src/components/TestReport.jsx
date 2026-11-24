import { useEffect, useRef, useState } from 'react'
import { GESTURE_LABELS } from '../data/engineStatus'
import {
  EVENT_LABELS,
  deliveryDelta,
  feedSession,
  renderReport,
  startSession,
  summarizeSession,
} from '../engine/testSession'

const now = () => performance.now() / 1000

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Prueba medida: la persona repite un gesto y, al terminar, se descarga un informe .md con lo que hizo el motor.
export default function TestReport({ engineStatus }) {
  const sessionRef = useRef(null)
  const statusRef = useRef(engineStatus)
  const [gesture, setGesture] = useState('')
  const [attempts, setAttempts] = useState('10')
  const [notes, setNotes] = useState('')
  const [startCounts, setStartCounts] = useState(null)
  const [startDelivery, setStartDelivery] = useState({})
  const [done, setDone] = useState('')

  const ready = Boolean(engineStatus?.running && engineStatus?.cameraOpen)
  const active = startCounts !== null

  useEffect(() => {
    statusRef.current = engineStatus
    if (sessionRef.current) feedSession(sessionRef.current, engineStatus, now())
  }, [engineStatus])

  const start = () => {
    const status = statusRef.current
    const parsed = Number.parseInt(attempts, 10)
    sessionRef.current = startSession(status, now(), {
      gesture: gesture.trim(),
      attempts: Number.isFinite(parsed) ? parsed : null,
      notes: notes.trim(),
    })
    sessionRef.current.startedAt = new Date().toLocaleString('es-CL')
    setStartCounts({ ...(status?.eventCounts ?? {}) })
    setStartDelivery(sessionRef.current.deliveryBaseline)
    setDone('')
  }

  const finish = () => {
    const session = sessionRef.current
    if (!session) return
    feedSession(session, statusRef.current, now())
    const summary = summarizeSession(session, now())
    const report = renderReport(summary, {
      meta: session.meta,
      labels: GESTURE_LABELS,
      config: session.config,
      startedAt: session.startedAt,
    })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const slug =
      (session.meta.gesture || 'prueba')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'prueba'
    const name = `informe-${slug}-${stamp}.md`
    download(report, name)
    sessionRef.current = null
    setStartCounts(null)
    setDone(name)
  }

  // Si la cámara se cierra a mitad de prueba, la prueba sigue contando; se puede terminar igualmente.
  const live = Object.entries(engineStatus?.eventCounts ?? {})
    .map(([event, value]) => [event, value - (startCounts?.[event] ?? 0)])
    .filter(([, value]) => value > 0)
  const delivered = active ? deliveryDelta(startDelivery, engineStatus?.deliveryCounts) : {}
  const sentToOs = Object.values(delivered).reduce((sum, outcomes) => sum + (outcomes.SO ?? 0), 0)

  return (
    <section className="test-report" aria-labelledby="test-report-title">
      <h2 id="test-report-title">Informe de prueba (.md)</h2>
      <p>
        Repite un gesto y, al terminar, se descarga un informe con los eventos que disparó el motor,
        adónde llegó cada uno (al sistema o bloqueado, y por qué), las posturas vistas y los FPS.
        Así no hace falta analizar videos.
      </p>
      <p className="step-hint">
        Para medir en Controlar: inicia la prueba, pulsa «Controlar» arriba, cambia a la ventana
        donde quieras que actúe el gesto (por ejemplo, el navegador) y repítelo; vuelve aquí para
        terminar. Sobre la propia ventana de ZeroTouch, minimizar y cambiar de pestaña no actúan.
      </p>
      <label>
        Gesto que vas a probar
        <input
          type="text"
          value={gesture}
          disabled={active}
          onChange={(event) => setGesture(event.target.value)}
          placeholder="Ej.: clic derecho"
        />
      </label>
      <label>
        Intentos que vas a hacer
        <input
          type="number"
          min="1"
          max="200"
          value={attempts}
          disabled={active}
          onChange={(event) => setAttempts(event.target.value)}
        />
      </label>
      <label>
        Notas (opcional)
        <input
          type="text"
          value={notes}
          disabled={active}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Ej.: mano derecha, a 50 cm"
        />
      </label>
      <div className="calibration-camera-actions">
        {!active && (
          <button type="button" className="btn" disabled={!ready} onClick={start}>
            Iniciar prueba
          </button>
        )}
        {active && (
          <button type="button" className="btn" onClick={finish}>
            Terminar y descargar informe
          </button>
        )}
      </div>
      {!ready && !active && <p>Abre la cámara para iniciar la prueba.</p>}
      {ready && engineStatus.pointerArmed === false && (
        <p className="calibration-camera-recording" role="status">
          Puntero sin activar: abre la mano y mantenla abierta un momento (~0,4 s) antes de hacer el
          gesto. Sin eso casi ningún gesto actúa.
        </p>
      )}
      {active && (
        <p className="calibration-camera-recording" role="status">
          Midiendo…{' '}
          {live.length
            ? live.map(([event, value]) => `${EVENT_LABELS[event] || event} ×${value}`).join(' · ')
            : 'sin eventos todavía'}
          {live.length > 0 && ` — enviados al sistema: ${sentToOs}`}
        </p>
      )}
      {done && (
        <p role="status">
          Informe descargado: <strong>{done}</strong>. Cópialo a la carpeta del proyecto y avísame.
        </p>
      )}
      <p className="step-hint">
        El informe solo guarda conteos, tiempos y ajustes: no incluye imágenes ni puntos de la mano.
      </p>
    </section>
  )
}
