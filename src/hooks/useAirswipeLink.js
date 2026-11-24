// Teclado Air-Swipe visto desde la ventana principal: abrir, cerrar y saber si sigue vivo.
//
// «Vivo» = la ventana overlay escribe su latido en localStorage (src/airswipe/link.js). `useEngine` usa
// `isKeyboardOpen` para apagar el modo teclado del motor si queda encendido sin ventana (huérfano);
// tras pedir la apertura hay un margen para que la ventana cargue antes de su primer latido.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { closeAirswipe } from '../airswipe/session'
import {
  HEARTBEAT_EVERY_MS,
  OPEN_GRACE_MS,
  clearHeartbeat,
  heartbeatFresh,
  readKeyboardMode,
  windowSizeFor,
} from '../airswipe/link'

const storage = () => globalThis.localStorage

export function useAirswipeLink({ onNotice }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const graceUntilRef = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(
      () => setOpen(heartbeatFresh(storage(), Date.now())),
      HEARTBEAT_EVERY_MS / 2,
    )
    return () => window.clearInterval(timer)
  }, [])

  const isKeyboardOpen = useCallback(
    () => heartbeatFresh(storage(), Date.now()) || Date.now() < graceUntilRef.current,
    [],
  )

  const openKeyboard = useCallback(async () => {
    setBusy(true)
    graceUntilRef.current = Date.now() + OPEN_GRACE_MS
    try {
      await api.airswipeWindowOpen(undefined, windowSizeFor(storage()))
      await api.engineAirswipe(true)
      onNotice(
        readKeyboardMode(storage()) === 'dwell'
          ? 'Teclado abierto. Haz clic con la pinza en el campo donde quieras escribir y deja el cursor quieto sobre cada letra.'
          : 'Teclado Air-Swipe abierto. Haz clic con la pinza donde quieras escribir y traza la palabra con el índice.',
      )
    } catch (error) {
      // Si el motor lo rechaza (trazo deshabilitado, motor parado…) no queda ni la ventana ni el modo.
      graceUntilRef.current = 0
      await closeAirswipe(api)
      onNotice(error?.message || 'No se pudo abrir el teclado Air-Swipe.', 'error')
    } finally {
      setBusy(false)
    }
  }, [onNotice])

  const closeKeyboard = useCallback(async () => {
    setBusy(true)
    graceUntilRef.current = 0
    clearHeartbeat(storage())
    try {
      await closeAirswipe(api)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }, [])

  return { open, busy, isKeyboardOpen, openKeyboard, closeKeyboard }
}
