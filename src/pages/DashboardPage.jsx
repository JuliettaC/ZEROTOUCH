import { useId } from 'react'
import { ConfigStatus, Icon, NavLink } from '../components/UI'
import GestureMedia from '../components/GestureMedia'
import { getEngineState } from '../data/engineStatus'
import { gestureActionLabel, gestures } from '../data/gestures'
import HandPreview from '../components/HandPreview'

// Inicio del día a día (21-11-2026): una sola acción para empezar. La configuración (cámara, mano,
// gestos, perfiles y modos) se hizo en la bienvenida y vive en Calibrar y Ajustes.
export default function DashboardPage({
  favorites,
  onStartEngine,
  view,
  apply,
  onRetryApply,
  locked,
  assignments,
  onSelectMode,
  navigate,
  engineStatus,
  engineBusy,
  onQuickStart,
  onStopEngine,
  onTogglePause,
}) {
  const modeSelectId = useId()
  const state = getEngineState(engineStatus)
  const { modes, activeModeId } = view
  const controlling =
    state.running && engineStatus.mode === 'CONTROL' && !engineStatus.emergencyStopped
  return (
    <main id="main" tabIndex={-1} className="page home-page simple-home">
      <h1 className="page-title">Inicio</h1>
      <div className="dashboard-grid">
        <div className="dashboard-camera">
          <section
            className={`start-card panel tone-${state.tone}`}
            aria-label="Control de la cámara"
            aria-busy={engineBusy}
          >
            {state.key === 'error' && <p role="alert">{state.hint}</p>}
            {state.key === 'control' && engineStatus.pointerArmed === false && <p>{state.hint}</p>}
            <div className="start-actions">
              {!controlling && (
                <button
                  type="button"
                  className="button primary start-button"
                  disabled={engineBusy}
                  onClick={state.running ? onQuickStart : onStartEngine}
                >
                  {engineBusy ? 'Empezando…' : state.running ? 'Activar control' : 'Iniciar cámara'}
                </button>
              )}
              {state.running && (
                <div className="engine-secondary">
                  {controlling && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={engineBusy}
                      onClick={onTogglePause}
                    >
                      {engineStatus.paused ? 'Reanudar' : 'Pausar'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button danger-text"
                    disabled={engineBusy}
                    onClick={onStopEngine}
                  >
                    Detener
                  </button>
                </div>
              )}
            </div>

            <div className="start-mode">
              <label htmlFor={modeSelectId}>Modo</label>
              <select
                id={modeSelectId}
                className="compact-select"
                value={activeModeId ?? ''}
                disabled={locked || !modes.length}
                onChange={(event) => onSelectMode(event.target.value)}
              >
                {modes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.nombre}
                  </option>
                ))}
              </select>
              <span className="kbd-hint">
                <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> detiene todo al instante
              </span>
            </div>
          </section>
          <HandPreview engineStatus={engineStatus} />
          <div className="save-status-line">
            <ConfigStatus key={apply.state} brief apply={apply} onRetry={onRetryApply} />
          </div>
        </div>

        <section className="panel basics-panel" aria-labelledby="basics-title">
          <div className="section-line">
            <h2 id="basics-title">Mis gestos favoritos</h2>
            <NavLink to="/calibracion" navigate={navigate} className="text-link">
              Editar favoritos <Icon name="chevron" />
            </NavLink>
          </div>
          <ul className="basics-grid">
            {favorites.map((id) => (
              <li key={id} className="basic-gesture">
                <GestureMedia id={id} size="md" />
                <strong>{gestureActionLabel(id, assignments)}</strong>
                <small>{gestures[id].title}</small>
              </li>
            ))}
          </ul>
          {!favorites.length && <p>Marca una estrella en Gestos para ver tus favoritos aquí.</p>}
        </section>
      </div>
    </main>
  )
}
