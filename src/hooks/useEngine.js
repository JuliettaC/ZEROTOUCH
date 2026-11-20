// Motor gestual local desde la interfaz: telemetría, comandos y estado de la configuración enviada.
//
// - La configuración deseada (`desired`, formato IPC 2) se envía una vez por cambio y solo cuando el
//   motor ya confirmó su estado inicial (READY). Un rechazo o una confirmación distinta quedan
//   visibles y no se reintentan en bucle; cambiar la configuración o pulsar «Reintentar» lo permite.
// - Air-Swipe: si el motor conserva el modo teclado sin que haya un teclado abierto (`isKeyboardOpen`,
//   por el latido de la ventana overlay), se apaga: en ese modo Confirmar/Cancelar/Atrás/Adelante
//   no llegan al sistema.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isDesktop } from '../api/client'
import { DEFAULT_ENGINE_STATUS } from '../data/engineStatus'
import { appliedMatches, applyState, shouldSend } from '../engine/engineApply'
import { closeAirswipe, isOrphanedAirswipe } from '../airswipe/session'

const POLL_MS = 150
const ORPHAN_RETRY_MS = 2000

export function useEngine({ desired, isKeyboardOpen = () => false, onNotice }) {
  const [engineStatus, setEngineStatus] = useState(DEFAULT_ENGINE_STATUS)
  const [engineBusy, setEngineBusy] = useState(false)
  const [rejection, setRejection] = useState(null)
  const sendingRef = useRef(null)
  const orphanUntilRef = useRef(0)
  const keyboardOpenRef = useRef(isKeyboardOpen)
  useEffect(() => { keyboardOpenRef.current = isKeyboardOpen }, [isKeyboardOpen])

  // Telemetría. Una petición a la vez: no se solapan si el puente tarda más que el intervalo.
  useEffect(() => {
    if (!isDesktop()) return undefined
    let cancelled = false, timer = 0
    const tick = async () => {
      try {
        const status = await api.engineStatus()
        if (cancelled || !status) return
        setEngineStatus(status)
        if (!status.running) setRejection(null)
        if (isOrphanedAirswipe(status, keyboardOpenRef.current()) && Date.now() >= orphanUntilRef.current) {
          orphanUntilRef.current = Date.now() + ORPHAN_RETRY_MS
          closeAirswipe(api)
          onNotice('Se apagó el modo teclado Air-Swipe porque su ventana ya no está abierta.')
        }
      } catch { /* el puente no responde: se conserva la última telemetría */ } finally {
        if (!cancelled) timer = window.setTimeout(tick, POLL_MS)
      }
    }
    tick()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [onNotice])

  const apply = applyState({ desired, engineStatus, rejection })
  const { state: applyStatus, key: applyKey } = apply
  useEffect(() => {
    if (!shouldSend({ state: applyStatus }) || sendingRef.current === applyKey) return
    sendingRef.current = applyKey
    api.engineUpdateConfig(desired)
      .then(status => {
        setEngineStatus(status)
        // El ACK devuelve la configuración que el motor aplicó: si no equivale a la pedida, se dice.
        if (!appliedMatches(desired, status.appliedConfig)) setRejection({ key: applyKey, code: 'CONFIG_DIVERGENTE', message: 'El motor confirmó una configuración distinta a la solicitada.' })
      })
      .catch(error => setRejection({ key: applyKey, code: error?.code || 'ENGINE_ERROR', message: error?.message || 'El motor no confirmó la configuración.' }))
      .finally(() => { sendingRef.current = null })
  }, [applyStatus, applyKey, desired])

  const run = useCallback(async (work, failure) => {
    setEngineBusy(true)
    try { return await work() } catch (error) { onNotice(error?.message || failure, 'error'); return null } finally { setEngineBusy(false) }
  }, [onNotice])

  const startEngine = useCallback(async () => {
    const status = await run(() => api.engineStart(desired), 'No se pudo activar la cámara. Revisa que esté conectada y libre.')
    if (status) { setEngineStatus(status); setRejection(null); onNotice('Cámara activada. Modo Observar: el cursor no se mueve.') }
  }, [run, desired, onNotice])

  const stopEngine = useCallback(async () => {
    const status = await run(() => api.engineStop(), 'No se pudo apagar la cámara. Usa Ctrl+Alt+Z.')
    if (status) { setEngineStatus(status); setRejection(null); onNotice('Cámara apagada.') }
  }, [run, onNotice])

  const toggleControl = useCallback(async () => {
    const next = engineStatus.mode === 'CONTROL' ? 'OBSERVATION' : 'CONTROL'
    const status = await run(() => api.engineSetMode(next), 'No se pudo cambiar el modo.')
    if (status) {
      setEngineStatus(status)
      onNotice(next === 'CONTROL' ? 'Control activo. Mantén la mano abierta para activar el puntero; Ctrl+Alt+Z detiene el control.' : 'Modo Observar: el cursor ya no se mueve.')
    }
  }, [run, engineStatus.mode, onNotice])

  const togglePause = useCallback(async () => {
    const status = await run(() => api.engineSetPaused(!engineStatus.paused), 'No se pudo pausar.')
    if (status) setEngineStatus(status)
  }, [run, engineStatus.paused])

  const retryApply = useCallback(() => setRejection(null), [])

  return { engineStatus, engineBusy, apply, retryApply, startEngine, stopEngine, toggleControl, togglePause }
}
