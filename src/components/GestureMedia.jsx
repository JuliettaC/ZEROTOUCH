import { useState } from 'react'
import { gestures } from '../data/gestures'
import { clipFor } from '../data/gestureMedia'

/** Ilustración de un gesto: clip en bucle de una mano real si existe; si no (o si falla), su emoji. */
export default function GestureMedia({ id, size = 'md' }) {
  const [failed, setFailed] = useState(false)
  const clip = clipFor(id)
  if (clip && !failed) {
    return (
      <video
        className={`gesture-media ${size}`}
        src={`${import.meta.env.BASE_URL}gestos/${clip}`}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className={`gesture-media emoji ${size}`} aria-hidden="true">
      {gestures[id]?.emoji ?? '✋'}
    </span>
  )
}
