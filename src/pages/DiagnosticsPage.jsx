import { EngineCard, NavLink } from '../components/UI'
import CalibrationCamera from '../components/CalibrationCamera'
import TestReport from '../components/TestReport'
import { getEngineState, GESTURE_LABELS } from '../data/engineStatus'

function TechDetails({ engineStatus }) {
  const state = getEngineState(engineStatus)
  const hand = state.handDetected
  const rows = [
    ['Imágenes por segundo', state.cameraOpen ? `${engineStatus.fps || 0} FPS` : '—'],
    ['Latencia', state.cameraOpen ? `${engineStatus.latencyMs || 0} ms` : '—'],
    ['Puntos de la mano', hand ? '21 / 21' : '0 / 21'],
    ['Confianza', hand ? `${engineStatus.confidence}%` : '—'],
    ['Distancia de pinza', hand ? `${engineStatus.pinchDistancePx} px` : '—'],
    ['Gesto', hand ? GESTURE_LABELS[engineStatus.gesture] || '—' : '—'],
  ]
  return (
    <details className="tech-details">
      <summary>Datos técnicos</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export default function DiagnosticsPage({ navigate, ...engine }) {
  return (
    <main className="page diagnostics-page" id="main" tabIndex={-1}>
      <NavLink to="/ajustes" navigate={navigate} className="text-link">
        Volver a Ajustes
      </NavLink>
      <h1 className="page-title">Diagnósticos</h1>
      <EngineCard {...engine} compact />
      <TechDetails engineStatus={engine.engineStatus} />
      <CalibrationCamera engineStatus={engine.engineStatus} />
      <TestReport engineStatus={engine.engineStatus} />
    </main>
  )
}
