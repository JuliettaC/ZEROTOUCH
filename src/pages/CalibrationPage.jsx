import { AdvancedSettings, AssignmentEditor, CameraView, ConfigStatus, EngineCard, GestureList, HandSelectionOptions } from '../components/UI'
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
    ['Gesto', hand ? (GESTURE_LABELS[engineStatus.gesture] || '—') : '—'],
  ]
  return <details className="tech-details">
    <summary>Datos técnicos</summary>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  </details>
}

export default function CalibrationPage({ settings, assignments, modeName, locked, apply, onRetryApply, onChangeSettings, onAssign, openModal, engineStatus, engineBusy, onStartEngine, onStopEngine, onToggleControlMode, onTogglePause }) {
  const onChange = onChangeSettings
  return <main id="main" tabIndex={-1} className="page calibration-page">
    <h1 className="page-title">Calibrar</h1>
    <div className="calibration-layout">
      <div className="calibration-view">
        <CameraView engineStatus={engineStatus} showDiagnostic={settings.diagnosticOverlay !== false} />
        <TechDetails engineStatus={engineStatus} />
      </div>
      <div className="calibration-steps">
        <section className="panel step" aria-labelledby="step1">
          <h2 id="step1"><span className="step-num" aria-hidden="true">1</span>Cámara y mano</h2>
          <HandSelectionOptions settings={settings} onChange={onChange} />
          <EngineCard compact headingLevel={3} engineStatus={engineStatus} engineBusy={engineBusy} onStartEngine={onStartEngine} onStopEngine={onStopEngine} onToggleControlMode={onToggleControlMode} onTogglePause={onTogglePause} />
        </section>
        <section className="panel step" aria-labelledby="step2">
          <h2 id="step2"><span className="step-num" aria-hidden="true">2</span>Prueba cada gesto</h2>
          <p className="step-hint">Haz el gesto: se marcará como <strong>Detectado</strong>. Ábrelo para ajustarlo.</p>
          <GestureList engineStatus={engineStatus} settings={settings} assignments={assignments} onOpen={gesture => openModal({ type: 'gesture', gesture })} onToggle={(key, value) => onChange({ ...settings, [key]: value })} />
        </section>
        <section className="panel step">
          <details className="advanced">
            <summary className="step-summary"><span className="step-num" aria-hidden="true">3</span>Ajustes finos <small>(opcional)</small></summary>
            <p className="step-hint">Se aplican al instante al modo «{modeName}». Cámara, mano, recorrido y exigencia de detección son de este equipo y no se sincronizan.</p>
            <AdvancedSettings settings={settings} onChange={onChange} />
          </details>
        </section>
        <section className="panel step">
          <details className="advanced">
            <summary className="step-summary"><span className="step-num" aria-hidden="true">4</span>Qué hace cada gesto <small>(opcional)</small></summary>
            <p className="step-hint">Asignaciones del modo «{modeName}». Solo se ofrecen las acciones que el motor ejecuta de verdad.</p>
            <AssignmentEditor assignments={assignments} disabled={locked} onChange={onAssign} />
          </details>
          <ConfigStatus apply={apply} onRetry={onRetryApply} />
        </section>
      </div>
    </div>
  </main>
}
