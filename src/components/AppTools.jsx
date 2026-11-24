// Temporizadores y multimedia en la ventana principal. Los temporizadores los inicia el gesto con la
// acción «Iniciar temporizador» o un botón; la multimedia la envía el motor al sistema (Controlar).
import { actionName, gestureName, gesturesWithAction } from '../data/capabilities'
import { MAX_MINUTES, MIN_MINUTES, formatRemaining, remainingMs } from '../data/timers'
import { NavLink } from './UI'

const QUICK_MINUTES = [1, 5, 10, 15]
const TOOL_ACTIONS = ['temporizador_iniciar', 'multimedia_play_pause', 'multimedia_siguiente']

function TimerRow({ timer, now, onPause, onResume, onPlusMinute, onCancel }) {
  const left = remainingMs(timer, now)
  const paused = timer.pausedLeft !== null
  const state = timer.done
    ? '¡Tiempo!'
    : paused
      ? 'En pausa'
      : timer.source === 'gesto'
        ? 'Iniciado con gesto'
        : 'En marcha'
  return (
    <li className={`timer-row ${timer.done ? 'done' : ''} ${paused ? 'paused' : ''}`}>
      <span className="timer-time" aria-label={`Quedan ${formatRemaining(left)}`}>
        {formatRemaining(left)}
      </span>
      <small className="timer-state">{state}</small>
      <span className="timer-actions">
        {!timer.done &&
          (paused ? (
            <button type="button" className="tiny-button" onClick={() => onResume(timer.id)}>
              Reanudar
            </button>
          ) : (
            <button type="button" className="tiny-button" onClick={() => onPause(timer.id)}>
              Pausar
            </button>
          ))}
        <button type="button" className="tiny-button ghost" onClick={() => onPlusMinute(timer.id)}>
          +1 min
        </button>
        <button
          type="button"
          className="tiny-button ghost"
          aria-label="Quitar temporizador"
          onClick={() => onCancel(timer.id)}
        >
          {timer.done ? 'Listo' : 'Quitar'}
        </button>
      </span>
    </li>
  )
}

export function ToolsPanel({
  tools,
  minutes,
  onChangeMinutes,
  assignments,
  navigate,
  controlActive,
}) {
  const { timers, now } = tools
  const step = (delta) =>
    onChangeMinutes(Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutes + delta)))
  return (
    <details className="panel tools-panel" open={timers.length > 0 || undefined}>
      <summary>Temporizadores y multimedia</summary>

      <div className="timer-quick" role="group" aria-label="Iniciar un temporizador">
        {QUICK_MINUTES.map((value) => (
          <button
            key={value}
            type="button"
            className="button secondary small"
            onClick={() => tools.start(value)}
          >
            {value} min
          </button>
        ))}
      </div>
      {timers.length > 0 ? (
        <ul className="timer-list">
          {timers.map((timer) => (
            <TimerRow
              key={timer.id}
              timer={timer}
              now={now}
              onPause={tools.pause}
              onResume={tools.resume}
              onPlusMinute={tools.plusMinute}
              onCancel={tools.cancel}
            />
          ))}
        </ul>
      ) : (
        <p className="empty-note">Sin temporizadores. Usa un botón o el gesto asignado.</p>
      )}

      <div className="timer-gesture-minutes">
        <span>Duración al iniciarlo con un gesto</span>
        <span className="stepper" role="group" aria-label="Minutos del temporizador por gesto">
          <button
            type="button"
            className="tiny-button ghost"
            aria-label="Un minuto menos"
            disabled={minutes <= MIN_MINUTES}
            onClick={() => step(-1)}
          >
            −
          </button>
          <strong aria-live="polite">{minutes} min</strong>
          <button
            type="button"
            className="tiny-button ghost"
            aria-label="Un minuto más"
            disabled={minutes >= MAX_MINUTES}
            onClick={() => step(1)}
          >
            ＋
          </button>
        </span>
      </div>

      <ul className="tool-gestures">
        {TOOL_ACTIONS.map((action) => {
          const assigned = gesturesWithAction(action, assignments)
          if (!assigned.length) return null
          return (
            <li key={action}>
              <strong>{actionName(action)}</strong>
              <small>Con: {assigned.map(gestureName).join(', ')}</small>
            </li>
          )
        })}
      </ul>
      {!controlActive && (
        <p className="step-hint">
          La multimedia solo llega a otras aplicaciones con <strong>Controlar</strong> activo; los
          temporizadores funcionan también en Observar.
        </p>
      )}
      <NavLink to="/calibracion" navigate={navigate} className="text-link">
        Configurar gestos
      </NavLink>
    </details>
  )
}

/** Temporizadores en marcha visibles desde cualquier página. */
export function TimerDock({ tools, onOpen }) {
  if (!tools.timers.length) return null
  return (
    <aside className="timer-dock" aria-label="Temporizadores">
      {tools.timers.map((timer) => (
        <button
          key={timer.id}
          type="button"
          className={`timer-chip ${timer.done ? 'done' : ''}`}
          onClick={onOpen}
        >
          ⏱ {timer.done ? '¡Tiempo!' : formatRemaining(remainingMs(timer, tools.now))}
          {timer.pausedLeft !== null && !timer.done ? ' ⏸' : ''}
        </button>
      ))}
    </aside>
  )
}
