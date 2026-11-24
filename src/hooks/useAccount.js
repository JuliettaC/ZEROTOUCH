// Cuenta opcional y sincronización. Cada cuenta tiene su propio espacio local (`useWorkspace`);
// cambiar de cuenta nunca muestra ni sube datos de otra, y el invitado no sincroniza.
//
// La sincronización sigue el contrato de src/sync/README.md: se serializa (el espacio queda
// bloqueado), cada punto de control se guarda en la cuenta capturada, un error entrega el estado
// parcial y no se anuncia éxito si queda algo pendiente (conflictos, resultado incierto, borrados).
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { importGuestInto, loadState } from '../data/preferences'
import { describeOutcome, OUTCOME, runSync } from '../sync/syncSession'

const normalizeUser = (user) => {
  const name = user.nombre_usuario || user.username
  return { ...user, nombre_usuario: name, username: name }
}

export function useAccount({ workspace, onNotice }) {
  const { switchAccount, mutate, lock, unlock } = workspace
  const [account, setAccount] = useState(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [warning, setWarning] = useState('')
  const [report, setReport] = useState(null)

  // Sesión previa (cookie del puente): no bloquea la interfaz y no sincroniza sola.
  useEffect(() => {
    let cancelled = false
    api
      .account()
      .then((user) => {
        if (cancelled) return
        setAccount(normalizeUser(user))
        switchAccount(user.id)
      })
      .catch(() => {
        /* sin sesión o sin puente: modo local */
      })
    return () => {
      cancelled = true
    }
  }, [switchAccount])

  const login = useCallback(
    async (credentials) => {
      if (workspace.locked) return { ok: false }
      setAuthBusy(true)
      setWarning('')
      try {
        const user = await api.login(credentials)
        switchAccount(user.id)
        setAccount(normalizeUser(user))
        setReport(null)
        onNotice(
          `Sesión iniciada: ${user.nombre_usuario}. Tus ajustes son los de esta cuenta en este equipo.`,
        )
        return { ok: true }
      } catch (error) {
        // Cuenta sin confirmar (solo se informa tras una contraseña correcta): el diálogo muestra «Confirma tu correo».
        if (error?.code !== 'CUENTA_NO_VERIFICADA')
          setWarning(
            error?.message || 'No se pudo conectar. Tus ajustes siguen guardados en este equipo.',
          )
        return { ok: false, code: error?.code }
      } finally {
        setAuthBusy(false)
      }
    },
    [workspace.locked, switchAccount, onNotice],
  )

  const register = useCallback(async (credentials) => {
    setAuthBusy(true)
    setWarning('')
    try {
      // 202 genérico: la cuenta queda pendiente hasta confirmar el correo; no se inicia sesión.
      const pending = await api.register(credentials)
      return { ok: true, message: pending?.mensaje }
    } catch (error) {
      setWarning(error?.message || 'No se pudo crear la cuenta. Puedes seguir sin cuenta.')
      return { ok: false }
    } finally {
      setAuthBusy(false)
    }
  }, [])

  // Reenvío de verificación, recuperación de contraseña y vinculación de correo. El backend responde
  // igual exista o no la cuenta; aquí solo se muestra su mensaje.
  const accountAction = useCallback(async (kind, payload) => {
    const call = {
      reenviar: api.resendVerification,
      recuperar: api.forgotPassword,
      vincular: api.linkEmail,
    }[kind]
    if (!call) return { ok: false }
    setAuthBusy(true)
    setWarning('')
    try {
      const result = await call(payload)
      return { ok: true, message: result?.mensaje }
    } catch (error) {
      setWarning(error?.message || 'No se pudo completar la solicitud. Inténtalo más tarde.')
      return { ok: false }
    } finally {
      setAuthBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    if (workspace.locked) {
      onNotice('Espera a que termine la sincronización antes de cerrar sesión.', 'error')
      return
    }
    setAuthBusy(true)
    try {
      await api.logout()
    } catch {
      /* el cierre local siempre procede */
    } finally {
      switchAccount(null)
      setAccount(null)
      setReport(null)
      setAuthBusy(false)
      onNotice('Sesión cerrada. Ahora usas los ajustes de invitado de este equipo.')
    }
  }, [workspace.locked, switchAccount, onNotice])

  /** `resolutions`: decisiones de la persona para los conflictos del informe anterior. */
  const sync = useCallback(
    async (resolutions = {}) => {
      if (!account) return { ok: false }
      const space = lock()
      if (!space) return { ok: false, outcome: OUTCOME.BUSY }
      setWarning('')
      let result
      try {
        result = await runSync({ api, accountId: space.accountId, state: space.state, resolutions })
      } finally {
        // runSync no lanza; este bloque libera el espacio aunque algo inesperado ocurra.
        unlock(space.accountId, result?.state)
      }
      setReport({ ...result, at: new Date().toISOString() })
      // Los conflictos se muestran como decisiones pendientes, no como error; una interrupción sí es un aviso.
      if (result.error && result.outcome !== OUTCOME.CONFLICTS) setWarning(result.error.message)
      return result
    },
    [account, lock, unlock],
  )

  /** Copia explícita de los modos de invitado a esta cuenta, con identidades nuevas (se suben al sincronizar). */
  const importGuest = useCallback(() => {
    const guest = loadState(null)
    if (!guest || guest.modes.length === 0) {
      onNotice('No hay ajustes de invitado que copiar.')
      return { ok: false, count: 0 }
    }
    const outcome = mutate((state) => importGuestInto(state, guest))
    if (!outcome.ok) {
      onNotice(outcome.message, 'error')
      return { ok: false, count: 0 }
    }
    onNotice(
      `Se copiaron ${guest.profiles.length} perfil${guest.profiles.length === 1 ? '' : 'es'} de invitado. Sincroniza para subirlos.`,
    )
    return { ok: true, count: guest.profiles.length }
  }, [mutate, onNotice])

  const clearWarning = useCallback(() => setWarning(''), [])
  const outcomeText = report ? describeOutcome(report) : ''
  return {
    account,
    authBusy,
    warning,
    clearWarning,
    report,
    outcomeText,
    login,
    register,
    accountAction,
    logout,
    sync,
    importGuest,
  }
}
