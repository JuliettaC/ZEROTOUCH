import { useState } from 'react'
import { HandSelectionOptions } from '../components/UI'
import HandPreview from '../components/HandPreview'
import GestureMedia from '../components/GestureMedia'
import { gestures } from '../data/gestures'
import {
  BASIC_GESTURES,
  STEPS,
  nextStep,
  practiceProgress,
  previousStep,
  stepIndex,
} from '../onboarding/onboarding'

// Configuración de primera vez: se hace una vez por equipo y deja todo listo para que, después, el inicio
// solo pida «Empezar». Todo ocurre en Observar: nada mueve el cursor mientras se configura.
const TITLES = {
  camara: 'Encuadra tu mano',
  gestos: 'Practica los cuatro gestos básicos',
}

function CameraButton({ engineStatus, engineBusy, onStartEngine }) {
  if (engineStatus?.running) return null
  return (
    <button type="button" className="button primary" disabled={engineBusy} onClick={onStartEngine}>
      {engineBusy ? 'Encendiendo…' : 'Encender cámara'}
    </button>
  )
}

export default function WelcomePage({
  settings,
  onChangeSettings,
  engineStatus,
  engineBusy,
  onStartEngine,
  onFinish,
}) {
  const [step, setStep] = useState(STEPS[0])
  const [practiced, setPracticed] = useState([])
  const enabled = BASIC_GESTURES.filter((id) => settings?.[gestures[id]?.toggle] !== false)

  // La práctica es acumulativa: cada gesto que la cámara reconoce una vez queda marcado. Estado derivado de la
  // telemetría, ajustado durante el render (patrón de React para «ajustar estado cuando cambia una prop»).
  if (step === 'gestos') {
    const next = practiceProgress(practiced, engineStatus, enabled)
    if (next.length !== practiced.length) setPracticed(next)
  }

  const go = (target) => {
    setStep(target)
    window.requestAnimationFrame(() => document.getElementById('welcome-title')?.focus())
  }
  const index = stepIndex(step)
  return (
    <main id="main" tabIndex={-1} className="page welcome-page">
      <section className="panel welcome-card" aria-labelledby="welcome-title">
        <ol className="welcome-progress" aria-label={`Paso ${index + 1} de ${STEPS.length}`}>
          {STEPS.map((id, i) => (
            <li
              key={id}
              className={i < index ? 'done' : i === index ? 'current' : ''}
              aria-current={i === index ? 'step' : undefined}
            >
              <span className="sr-only">{TITLES[id]}</span>
            </li>
          ))}
        </ol>
        <p className="welcome-step-label">
          Paso {index + 1} de {STEPS.length}
        </p>
        <h1 id="welcome-title" tabIndex={-1}>
          {TITLES[step]}
        </h1>

        {step === 'camara' && (
          <div className="welcome-body welcome-split">
            <div>
              <HandSelectionOptions settings={settings} onChange={onChangeSettings} />
              <p className="step-hint">Coloca la mano a la vista de la cámara.</p>
              <CameraButton
                engineStatus={engineStatus}
                engineBusy={engineBusy}
                onStartEngine={onStartEngine}
              />
            </div>
            <HandPreview engineStatus={engineStatus} />
          </div>
        )}

        {step === 'gestos' && (
          <div className="welcome-body">
            <p className="welcome-lead">
              Haz cada gesto frente a la cámara; se marcará al reconocerlo. Llevas{' '}
              {practiced.length} de {enabled.length}.
            </p>
            {!engineStatus?.running && (
              <CameraButton
                engineStatus={engineStatus}
                engineBusy={engineBusy}
                onStartEngine={onStartEngine}
              />
            )}
            <ul className="practice-grid">
              {BASIC_GESTURES.map((id) => {
                const g = gestures[id]
                const ok = practiced.includes(id)
                const off = !enabled.includes(id)
                return (
                  <li key={id} className={`practice-card ${ok ? 'ok' : ''} ${off ? 'off' : ''}`}>
                    <GestureMedia id={id} size="lg" />
                    <strong>{g.action}</strong>
                    <small>{g.instruction}</small>
                    <span className="practice-state" role="status">
                      {off ? 'Apagado en tus ajustes' : ok ? '✓ Reconocido' : 'Pendiente'}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="step-hint">
              Si un gesto no se marca, puedes seguir igual y practicarlo después en «Gestos».
            </p>
          </div>
        )}

        <div className="welcome-actions">
          {step === 'camara' ? (
            <button
              type="button"
              className="button ghost-link"
              onClick={() => onFinish({ skipped: true })}
            >
              Saltar configuración
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              onClick={() => go(previousStep(step))}
            >
              Atrás
            </button>
          )}
          {step === 'gestos' ? (
            <button
              type="button"
              className="button primary big"
              onClick={() => onFinish({ skipped: false })}
            >
              Ir al inicio
            </button>
          ) : (
            <button type="button" className="button primary big" onClick={() => go(nextStep(step))}>
              Siguiente
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
