import { useCameraPreview } from '../hooks/useCameraPreview'
import { CameraView } from './CameraView'
import { describeHand, getEngineState } from '../data/engineStatus'
import { StatusBadge } from './UI'

export default function HandPreview({ engineStatus }) {
  const visible = Boolean(
    engineStatus?.cameraOpen && engineStatus?.running && !engineStatus.emergencyStopped,
  )
  const { canvasRef, message } = useCameraPreview(engineStatus, visible)
  if (!visible) return <CameraView engineStatus={engineStatus} showDiagnostic={false} />
  return (
    <figure className="hand-preview">
      <canvas
        ref={canvasRef}
        width={400}
        height={225}
        aria-label="Encuadre completo de la cámara con seguimiento de la mano"
      />
      <StatusBadge state={getEngineState(engineStatus)} />
      <figcaption>{message || describeHand(engineStatus)}</figcaption>
    </figure>
  )
}
