import { useEffect, useState } from 'react'
import { gestures } from '../data/gestures'
import { IMAGE_CYCLE_MS, imagesFor } from '../data/gestureMedia'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Ilustración de un gesto: imagen de una mano real (varias se alternan); si no hay o falla, su emoji. */
export default function GestureMedia({ id, size = 'md' }) {
  const images = imagesFor(id)
  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  const cycle = images.length > 1 && !failed

  useEffect(() => {
    if (!cycle || reducedMotion()) return undefined
    const timer = setInterval(() => setIndex((i) => (i + 1) % images.length), IMAGE_CYCLE_MS)
    return () => clearInterval(timer)
  }, [cycle, images.length])

  if (images.length && !failed) {
    return (
      <img
        className={`gesture-media ${size}`}
        src={`${import.meta.env.BASE_URL}gestos/${images[index % images.length]}`}
        alt=""
        aria-hidden="true"
        draggable="false"
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
