import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { GESTURE_LABELS } from '../data/engineStatus'
import { drawPreview, previewCaption } from '../engine/previewOverlay'

const POLL_MS = 80

function loadImage(base64) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = `data:image/jpeg;base64,${base64}`
  })
}

export function useCameraPreview(engineStatus, visible, technical = false) {
  const canvasRef = useRef(null)
  const fpsRef = useRef(0)
  const [message, setMessage] = useState('')
  useEffect(() => {
    fpsRef.current = engineStatus?.fps || 0
  }, [engineStatus?.fps])
  // Pide un fotograma tras otro mientras la vista está abierta y el motor lo permite.
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    let timer
    const tick = async () => {
      try {
        const frame = await api.enginePreview()
        const canvas = canvasRef.current
        if (!alive || !canvas) return
        const image = frame?.jpeg ? await loadImage(frame.jpeg) : null
        if (!alive) return
        if (image && (canvas.width !== image.width || canvas.height !== image.height)) {
          canvas.width = image.width
          canvas.height = image.height
        }
        const caption =
          technical &&
          previewCaption({
            fps: fpsRef.current,
            gesture: frame?.gesture,
            pinchRatio: frame?.pinchRatio,
            gestureLabels: GESTURE_LABELS,
          })
        drawPreview(
          canvas.getContext('2d'),
          canvas.width,
          canvas.height,
          image,
          image ? frame?.landmarks : null,
          caption,
        )
        setMessage(image ? '' : 'Esperando imagen de la cámara…')
      } catch (error) {
        if (alive) {
          const canvas = canvasRef.current
          canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
          setMessage(error?.message || 'No se pudo leer la cámara.')
        }
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [visible, technical])

  return { canvasRef, message }
}
