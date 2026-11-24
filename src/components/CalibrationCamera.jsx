import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraPreview } from '../hooks/useCameraPreview'

const MAX_CLIP_SECONDS = 120

// Vista de la cámara con los puntos de la mano y los FPS, para encuadrar y grabar una prueba.
// Solo en modo Observar; la imagen se pide al motor, se dibuja en memoria y nunca se sube.
export default function CalibrationCamera({ engineStatus }) {
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const stopTimerRef = useRef(null)
  const [showing, setShowing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [clip, setClip] = useState(null)
  const clipUrl = clip?.url ?? ''

  const ready = Boolean(
    engineStatus?.running && engineStatus?.cameraOpen && engineStatus?.mode === 'OBSERVATION',
  )
  const visible = showing && ready
  const { canvasRef, message } = useCameraPreview(engineStatus, visible, true)
  const canRecord =
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  const fps = engineStatus?.cameraOpen ? engineStatus.fps || 0 : 0

  const stopRecording = useCallback(() => {
    clearTimeout(stopTimerRef.current)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const discardClip = useCallback(() => {
    setClip((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }, [])

  // Si la cámara se cierra o el motor sale de Observar, se corta la grabación y se oculta la vista.
  useEffect(() => {
    if (!ready) stopRecording()
  }, [ready, stopRecording])

  useEffect(
    () => () => {
      clearTimeout(stopTimerRef.current)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null
        recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop())
        recorder.stop()
      }
    },
    [],
  )

  useEffect(
    () => () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl)
    },
    [clipUrl],
  )

  const startRecording = () => {
    const canvas = canvasRef.current
    if (!canvas || !canRecord) return
    discardClip()
    chunksRef.current = []
    const stream = canvas.captureStream(15)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      setRecording(false)
      if (chunksRef.current.length)
        setClip({
          url: URL.createObjectURL(new Blob(chunksRef.current, { type: 'video/webm' })),
          name: `prueba-gestos-${Date.now()}.webm`,
        })
      chunksRef.current = []
    }
    recorderRef.current = recorder
    recorder.start(1000)
    setRecording(true)
    stopTimerRef.current = setTimeout(stopRecording, MAX_CLIP_SECONDS * 1000)
  }

  return (
    <section className="calibration-camera" aria-labelledby="calibration-camera-title">
      <h2 id="calibration-camera-title">Grabar prueba de gestos</h2>
      <p>
        Imágenes por segundo de la cámara: <strong>{ready ? `${fps} FPS` : '—'}</strong>
      </p>
      {!ready && <p>Abre la cámara en modo Observar para ver la imagen y grabar.</p>}
      <div className="calibration-camera-actions">
        <button
          type="button"
          className="btn"
          disabled={!ready || recording}
          onClick={() => setShowing((value) => !value)}
        >
          {visible ? 'Ocultar cámara' : 'Mostrar cámara'}
        </button>
        {visible && canRecord && !recording && (
          <button type="button" className="btn" onClick={startRecording}>
            Grabar clip
          </button>
        )}
        {recording && (
          <button type="button" className="btn" onClick={stopRecording}>
            Detener grabación
          </button>
        )}
      </div>
      {recording && (
        <p className="calibration-camera-recording" role="status">
          Grabando… (máximo {MAX_CLIP_SECONDS} s)
        </p>
      )}
      {visible && (
        <div className="calibration-camera-screen">
          <canvas
            ref={canvasRef}
            width={400}
            height={225}
            aria-label="Imagen de la cámara con los puntos de la mano"
          />
          {message && <span role="status">{message}</span>}
        </div>
      )}
      {clipUrl && (
        <div className="calibration-camera-actions">
          <a className="btn" href={clipUrl} download={clip.name}>
            Descargar clip
          </a>
          <button type="button" className="btn" onClick={discardClip}>
            Descartar clip
          </button>
        </div>
      )}
      <p className="step-hint">
        La imagen solo se guarda en memoria y la descarga es manual. El clip lleva los puntos, los
        FPS y el gesto detectado dibujados.
      </p>
    </section>
  )
}
