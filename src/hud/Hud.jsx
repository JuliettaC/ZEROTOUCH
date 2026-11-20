import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { DEFAULT_ENGINE_STATUS } from '../data/engineStatus'
import { actionSignature, describeHud } from './hudModel'
import './hud.css'

// Ventana HUD (`index.html#hud`): pequeña, siempre encima, no activable y transparente a los clics.
// Solo lee `engine_status`; no envía ningún comando al motor.
const POLL_MS = 250
const FLASH_MS = 1200

export default function Hud() {
  const [status, setStatus] = useState(DEFAULT_ENGINE_STATUS)
  const [bridgeDown, setBridgeDown] = useState(false)
  const [flash, setFlash] = useState(false)
  const signatureRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const next = await api.engineStatus()
        if (cancelled) return
        setStatus(next)
        setBridgeDown(false)
        const signature = actionSignature(next)
        if (signatureRef.current !== null && signature !== signatureRef.current) setFlash(true)
        signatureRef.current = signature
      } catch {
        if (!cancelled) setBridgeDown(true)
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  const hud = describeHud(status, { bridgeDown })
  return <div className={`hud tone-${hud.tone} ${flash ? 'flash' : ''}`} role="status" aria-live="polite">
    <span className="hud-dot" aria-hidden="true" />
    <div className="hud-text">
      <strong className="hud-state">{hud.state}</strong>
      {hud.action && <span className="hud-action">{hud.action}</span>}
    </div>
  </div>
}
