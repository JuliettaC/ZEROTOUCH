import { HAND_CONNECTIONS } from './handConnections.js'

// Texto que se dibuja sobre la imagen (y por tanto queda dentro del clip grabado).
export function previewCaption({ fps, gesture, pinchRatio, gestureLabels = {} }) {
  const parts = [`${Number.isFinite(fps) ? fps : 0} FPS`]
  parts.push(gesture && gesture !== 'NONE' ? gestureLabels[gesture] || gesture : 'Sin gesto')
  if (Number.isFinite(pinchRatio)) parts.push(`pinza ${pinchRatio.toFixed(2)}`)
  return parts.join(' · ')
}

// Dibuja un fotograma, los puntos de la mano y la leyenda en un contexto 2D.
export function drawPreview(ctx, width, height, image, landmarks, caption) {
  ctx.clearRect(0, 0, width, height)
  if (image) ctx.drawImage(image, 0, 0, width, height)
  else {
    ctx.fillStyle = '#343942'
    ctx.fillRect(0, 0, width, height)
  }
  if (Array.isArray(landmarks) && landmarks.length === 21) {
    ctx.strokeStyle = '#f4f4f6'
    ctx.shadowColor = '#343942'
    ctx.shadowBlur = 3
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(landmarks[a][0] * width, landmarks[a][1] * height)
      ctx.lineTo(landmarks[b][0] * width, landmarks[b][1] * height)
    }
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    for (const [x, y] of landmarks) {
      ctx.beginPath()
      ctx.arc(x * width, y * height, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.shadowBlur = 0
  }
  if (!caption) return
  ctx.font = '600 16px sans-serif'
  const w = ctx.measureText(caption).width + 16
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(0, 0, w, 28)
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(caption, 8, 15)
}
