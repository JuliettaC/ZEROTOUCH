import { useId } from 'react'
import { ConfigStatus, Icon, NavLink } from '../components/UI'
import GestureMedia from '../components/GestureMedia'
import { getEngineState, describeHand } from '../data/engineStatus'
import { gestureActionLabel, gestures } from '../data/gestures'
import { BASIC_GESTURES } from '../onboarding/onboarding'

// Inicio del día a día (21-11-2026): una sola acción para empezar. La configuración (cámara, mano,
// gestos, perfiles y modos) se hizo en la bienvenida y vive en Calibrar y Ajustes.
const START_HINT = {
  off: 'Pulsa Empezar: se enciende la cámara y tu mano pasa a controlar el cursor.',
  observe: 'La cámara está encendida pero no controla. Pulsa Empezar a controlar.',
}

export default function DashboardPage({
  view, apply, onRetryApply, locked, assignments, onSelectMode, navigate,
  engineStatus, engineBusy, onQuickStart, onStopEngine, onTogglePause,
}) {
  const modeSelectId = useId()
  const state = getEngineState(engineStatus)
  const hand = describeHand(engineStatus)
  const { modes, activeModeId } = view
  const controlling = state.running && engineStatus.mode === 'CONTROL' && !engineStatus.emergencyStopped
  const hint = !state.running ? START_HINT.off : (!controlling && state.key !== 'error' ? START_HINT.observe : state.hint)

  return <main id="main" tabIndex={-1} className="page home-page simple-home">
    <h1 className="sr-only">Inicio</h1>
    <section className={`start-card panel tone-${state.tone}`} aria-labelledby="start-title" aria-busy={engineBusy}>
      <div className="start-status">
        <span className="engine-icon" aria-hidden="true">{controlling ? '✋' : state.cameraOpen ? '📷' : '⏻'}</span>
        <div>
          <h2 id="start-title" className="engine-title">{state.running ? state.label : 'Todo listo'}</h2>
          <p className="engine-hint">{hint}</p>
          {hand && <p className={`engine-hand ${state.handDetected ? 'ok' : ''}`}>{hand}</p>}
        </div>
      </div>

      <div className="start-actions">
        {!controlling && <button type="button" className="button primary start-button" disabled={engineBusy} onClick={onQuickStart}>
          {engineBusy ? 'Empezando…' : state.running ? 'Empezar a controlar' : 'Empezar'}
        </button>}
        {state.running && <div className="engine-secondary">
          {controlling && <button type="button" className="button secondary" disabled={engineBusy} onClick={onTogglePause}>{engineStatus.paused ? 'Reanudar' : 'Pausar'}</button>}
          <button type="button" className="button danger-text" disabled={engineBusy} onClick={onStopEngine}>Detener</button>
        </div>}
      </div>

      <div className="start-mode">
        <label htmlFor={modeSelectId}>Modo</label>
        <select id={modeSelectId} className="compact-select" value={activeModeId ?? ''} disabled={locked || !modes.length} onChange={event => onSelectMode(event.target.value)}>
          {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.nombre}</option>)}
        </select>
        <span className="kbd-hint"><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> detiene todo al instante</span>
      </div>
    </section>
    <div className="save-status-line"><ConfigStatus apply={apply} onRetry={onRetryApply} /></div>

    <section className="panel basics-panel" aria-labelledby="basics-title">
      <div className="section-line"><h2 id="basics-title">Gestos básicos</h2>
        <NavLink to="/calibracion" navigate={navigate} className="text-link">Practicar y ver todos <Icon name="chevron" /></NavLink>
      </div>
      <ul className="basics-grid">
        {BASIC_GESTURES.map(id => <li key={id} className="basic-gesture">
          <GestureMedia id={id} size="md" />
          <strong>{gestureActionLabel(id, assignments)}</strong>
          <small>{gestures[id].title}</small>
        </li>)}
      </ul>
      <p className="step-hint">Perfiles, modos, temporizadores y ajustes están en <NavLink to="/ajustes" navigate={navigate} className="text-link">Ajustes</NavLink>.</p>
    </section>
  </main>
}
