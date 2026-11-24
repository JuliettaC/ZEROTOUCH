import { getEngineState, describeHand } from '../data/engineStatus'
import { HAND_CONNECTIONS } from '../engine/handConnections'
import { StatusBadge } from './UI'
/**
 * Editor de asignaciones gesto → acción del modo activo. Solo ofrece las acciones que el contrato
 * permite para cada gesto; encender un gesto que estaba sin acción restaura su acción predeterminada.
 */
function LiveDiagnosticOverlay({ engineStatus }) {
  const bounds =
    engineStatus?.activeBounds?.length === 4 ? engineStatus.activeBounds : [0.18, 0.82, 0.24, 0.84]
  const [xMin, xMax, yMin, yMax] = bounds
  const lms = Array.isArray(engineStatus?.landmarks) ? engineStatus.landmarks : []
  const hasHand = Boolean(engineStatus?.handDetected && lms.length >= 21)
  return (
    <svg
      className="live-diagnostic-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        x={xMin * 100}
        y={yMin * 100}
        width={(xMax - xMin) * 100}
        height={(yMax - yMin) * 100}
        rx="2"
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="0.4"
        strokeDasharray="1.5 1.5"
      />
      {hasHand && (
        <>
          {HAND_CONNECTIONS.map(([a, b], idx) => {
            const pa = lms[a],
              pb = lms[b]
            if (!pa || !pb) return null
            return (
              <line
                key={idx}
                x1={pa[0] * 100}
                y1={pa[1] * 100}
                x2={pb[0] * 100}
                y2={pb[1] * 100}
                stroke="#9DB5A4"
                strokeWidth="0.7"
                strokeLinecap="round"
              />
            )
          })}
          {lms.map((pt, idx) => (
            <circle
              key={idx}
              cx={pt[0] * 100}
              cy={pt[1] * 100}
              r={idx === 4 || idx === 8 ? 1.35 : 0.85}
              fill={idx === 4 || idx === 8 ? '#FFFFFF' : '#D9DEE4'}
              stroke="#343942"
              strokeWidth="0.3"
            />
          ))}
          <circle
            cx={(engineStatus.cursorX ?? 0.5) * 100}
            cy={(engineStatus.cursorY ?? 0.5) * 100}
            r="1.9"
            fill={engineStatus.mode === 'CONTROL' ? '#748D7C' : '#A1A5AD'}
            stroke="#FFFFFF"
            strokeWidth="0.5"
          />
        </>
      )}
    </svg>
  )
}

/**
 * Vista del sensor. El motor no envía imagen de video, solo puntos de la mano;
 * por eso se muestra un lienzo neutro y no una fotografía que simule la cámara.
 */
export function CameraView({ engineStatus, showDiagnostic = true, engineBusy, onStartEngine }) {
  const state = getEngineState(engineStatus)
  const hand = describeHand(engineStatus)
  const summary = state.cameraOpen ? `${state.label}. ${hand}` : state.label
  return (
    <figure className={`camera-view tone-${state.tone}`}>
      <figcaption className="sr-only">{`Vista del sensor: ${summary}`}</figcaption>
      {state.cameraOpen ? (
        <>
          {showDiagnostic && <LiveDiagnosticOverlay engineStatus={engineStatus} />}
          <StatusBadge state={state} className="on-dark" />
          <span className={`camera-caption ${state.handDetected ? 'ok' : ''}`}>
            {state.handDetected ? hand : 'Coloca la mano dentro del recuadro'}
          </span>
        </>
      ) : (
        <div className="camera-empty">
          <span aria-hidden="true">✋</span>
          <strong>{state.label}</strong>
          <small>{state.key === 'off' ? 'Aquí verás tu mano en tiempo real.' : state.hint}</small>
          {onStartEngine && !state.running && (
            <button
              type="button"
              className="button light"
              disabled={engineBusy}
              onClick={onStartEngine}
            >
              {engineBusy ? 'Activando…' : 'Activar cámara'}
            </button>
          )}
        </div>
      )}
    </figure>
  )
}
