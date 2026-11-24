// Abre o cierra la ventana HUD según el motor y la preferencia del equipo (decisión en src/hud/hudWindow.js).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { hudCommand, hudShouldBeOpen, readHudEnabled, writeHudEnabled } from '../hud/hudWindow'

const storage = () => globalThis.localStorage

export function useHudWindow({ running, onNotice }) {
  const [enabled, setEnabled] = useState(() => readHudEnabled(storage()))
  const appliedRef = useRef(null)
  const want = hudShouldBeOpen({ running, enabled })

  useEffect(() => {
    const command = hudCommand(appliedRef.current, want)
    if (!command) return
    appliedRef.current = want
    const call = command === 'open' ? api.hudWindowOpen : api.hudWindowClose
    Promise.resolve()
      .then(call)
      .catch((error) => {
        appliedRef.current = null
        if (command === 'open')
          onNotice?.(error?.message || 'No se pudo mostrar el indicador flotante.', 'error')
      })
  }, [want, onNotice])

  const toggle = useCallback(
    () =>
      setEnabled((current) => {
        const next = !current
        writeHudEnabled(storage(), next)
        return next
      }),
    [],
  )

  return { enabled, toggle }
}
