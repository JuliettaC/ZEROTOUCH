import { useState } from 'react'
import { CameraView, HandSelectionOptions, Icon } from '../components/UI'
import GestureMedia from '../components/GestureMedia'
import { gestures } from '../data/gestures'
import { getEngineState } from '../data/engineStatus'
import { presets } from '../data/preferences'
import { BASIC_GESTURES, STEPS, nextStep, practiceProgress, previousStep, stepIndex } from '../onboarding/onboarding'

// Configuración de primera vez: se hace una vez por equipo y deja todo listo para que, después, el inicio
// solo pida «Empezar». Todo ocurre en Observar: nada mueve el cursor mientras se configura.
const TITLES = {
  bienvenida: 'Te damos la bienvenida a ZeroTouch',
  camara: 'Cámara y mano',
  gestos: 'Practica los cuatro gestos básicos',
  uso: '¿Dónde lo vas a usar?',
  listo: 'Todo listo',
}

function CameraButton({ engineStatus, engineBusy, onStartEngine }) {
  if (engineStatus?.running) return null
  return <button type="button" className="button primary" disabled={engineBusy} onClick={onStartEngine}>{engineBusy ? 'Encendiendo…' : 'Encender cámara'}</button>
}

export default function WelcomePage({ settings, onChangeSettings, engineStatus, engineBusy, onStartEngine, modes, activeModeId, onSelectMode, onFinish }) {
  const [step, setStep] = useState(STEPS[0])
  const [practiced, setPracticed] = useState([])
  const state = getEngineState(engineStatus)
  const enabled = BASIC_GESTURES.filter(id => settings?.[gestures[id]?.toggle] !== false)

  // La práctica es acumulativa: cada gesto que la cámara reconoce una vez queda marcado. Estado derivado de la
  // telemetría, ajustado durante el render (patrón de React para «ajustar estado cuando cambia una prop»).
  if (step === 'gestos') {
    const next = practiceProgress(practiced, engineStatus, enabled)
    if (next.length !== practiced.length) setPracticed(next)
  }

  const go = target => { setStep(target); window.requestAnimationFrame(() => document.getElementById('welcome-title')?.focus()) }
  const index = stepIndex(step)
  const presetModes = modes.filter(mode => mode.plantilla && presets[mode.plantilla])
  const choices = presetModes.length ? presetModes : modes

  return <main id="main" tabIndex={-1} className="page welcome-page">
    <section className="panel welcome-card" aria-labelledby="welcome-title">
      <ol className="welcome-progress" aria-label={`Paso ${index + 1} de ${STEPS.length}`}>
        {STEPS.map((id, i) => <li key={id} className={i < index ? 'done' : i === index ? 'current' : ''} aria-current={i === index ? 'step' : undefined}><span className="sr-only">{TITLES[id]}</span></li>)}
      </ol>
      <p className="welcome-step-label">Paso {index + 1} de {STEPS.length}</p>
      <h1 id="welcome-title" tabIndex={-1}>{TITLES[step]}</h1>

      {step === 'bienvenida' && <div className="welcome-body">
        <p className="welcome-lead">Vas a controlar el computador con la mano frente a la cámara, sin tocar el ratón.</p>
        <ul className="welcome-points">
          <li><strong>Se configura una sola vez</strong>: cámara, mano y cuatro gestos (unos 3 minutos). Después solo pulsarás «Empezar».</li>
          <li><strong>Tu imagen no se guarda</strong> ni sale de este equipo: la cámara solo se usa para ubicar tu mano.</li>
          <li><strong>Mientras configuras, nada se mueve</strong>: la cámara mira, pero no controla el cursor.</li>
        </ul>
      </div>}

      {step === 'camara' && <div className="welcome-body welcome-split">
        <div>
          <HandSelectionOptions settings={settings} onChange={onChangeSettings} />
          <p className="step-hint">Siéntate como lo harás al usarlo y deja la mano dentro del recuadro.</p>
          <CameraButton engineStatus={engineStatus} engineBusy={engineBusy} onStartEngine={onStartEngine} />
          {state.cameraOpen && <p className={`welcome-check ${state.handDetected ? 'ok' : ''}`} role="status">{state.handDetected ? '✓ Te vemos la mano. Puedes seguir.' : 'Muestra la mano a la cámara…'}</p>}
        </div>
        <CameraView engineStatus={engineStatus} showDiagnostic />
      </div>}

      {step === 'gestos' && <div className="welcome-body">
        <p className="welcome-lead">Haz cada gesto frente a la cámara; se marcará al reconocerlo. Llevas {practiced.length} de {enabled.length}.</p>
        {!engineStatus?.running && <CameraButton engineStatus={engineStatus} engineBusy={engineBusy} onStartEngine={onStartEngine} />}
        <ul className="practice-grid">
          {BASIC_GESTURES.map(id => {
            const g = gestures[id]
            const ok = practiced.includes(id)
            const off = !enabled.includes(id)
            return <li key={id} className={`practice-card ${ok ? 'ok' : ''} ${off ? 'off' : ''}`}>
              <GestureMedia id={id} size="lg" />
              <strong>{g.action}</strong>
              <small>{g.instruction}</small>
              <span className="practice-state" role="status">{off ? 'Apagado en tus ajustes' : ok ? '✓ Reconocido' : 'Pendiente'}</span>
            </li>
          })}
        </ul>
        <p className="step-hint">Si un gesto no se marca, puedes seguir igual y practicarlo después en «Calibrar».</p>
      </div>}

      {step === 'uso' && <div className="welcome-body">
        <p className="welcome-lead">Ajusta la velocidad y la estabilidad del cursor a tu situación. Puedes cambiarlo cuando quieras.</p>
        <div className="use-grid" role="radiogroup" aria-label="Modo de uso">
          {choices.map(mode => {
            const preset = presets[mode.plantilla]
            const checked = mode.id === activeModeId
            return <button key={mode.id} type="button" role="radio" aria-checked={checked} className={`use-card ${checked ? 'checked' : ''}`} onClick={() => onSelectMode(mode.id)}>
              <span className="context-icon" aria-hidden="true">{preset ? <Icon name={preset.icon} /> : '★'}</span>
              <strong>{mode.nombre}</strong>
              {preset && <small>{preset.description}</small>}
            </button>
          })}
        </div>
      </div>}

      {step === 'listo' && <div className="welcome-body">
        <p className="welcome-lead">Desde ahora, cada vez que abras ZeroTouch solo tienes que pulsar <strong>Empezar</strong>.</p>
        <ul className="recap-list">
          {BASIC_GESTURES.map(id => <li key={id}><GestureMedia id={id} size="sm" /><span><strong>{gestures[id].action}</strong> · {gestures[id].title}</span></li>)}
          <li><span className="gesture-media emoji sm" aria-hidden="true">⌨</span><span><strong>Detener todo</strong> · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd></span></li>
        </ul>
        <p className="step-hint">Perfiles, modos, temporizadores y ajustes finos están en «Ajustes». Puedes repetir esta configuración desde ahí.</p>
      </div>}

      <div className="welcome-actions">
        {step === 'bienvenida'
          ? <button type="button" className="button ghost-link" onClick={() => onFinish({ skipped: true })}>Ya lo configuré: saltar</button>
          : <button type="button" className="button secondary" onClick={() => go(previousStep(step))}>Atrás</button>}
        {step === 'listo'
          ? <button type="button" className="button primary big" onClick={() => onFinish({ skipped: false })}>Ir al inicio</button>
          : <button type="button" className="button primary big" onClick={() => go(nextStep(step))}>{step === 'bienvenida' ? 'Comenzar' : 'Siguiente'}</button>}
      </div>
    </section>
  </main>
}
