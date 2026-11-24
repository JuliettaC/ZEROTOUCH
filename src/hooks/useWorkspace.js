// Espacio de trabajo local: las preferencias v2 de UNA cuenta (o del invitado) y su guardado.
//
// - `{ accountId, state }` viaja siempre junto: un guardado nunca mezcla el estado de una cuenta con
//   la clave de otra. El guardado ocurre en la misma acción que el cambio (no en un efecto).
// - Mientras corre una sincronización (`lock`) no se permiten ediciones ni cambio de cuenta: los
//   snapshots de `synchronize` no se fusionan con cambios hechos en vuelo (ver src/sync/README.md).
// - Las funciones de edición lanzan si no procede (p. ej. borrar un recurso con una operación sin
//   recuperar); aquí se convierten en `{ ok:false, message }` para mostrarlas, sin perder el estado.
import { useCallback, useRef, useState } from 'react'
import { createDefaultState, loadState, saveState } from '../data/preferences'

const openSpace = (accountId) => ({
  accountId: accountId || null,
  state: loadState(accountId) ?? createDefaultState(),
})
export const LOCKED_MESSAGE = 'Hay una sincronización en curso. Espera a que termine para editar.'

export function useWorkspace() {
  const [space, setSpace] = useState(() => openSpace(null))
  const spaceRef = useRef(space)
  const lockRef = useRef(false)
  const [locked, setLocked] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)

  const publish = useCallback((next) => {
    spaceRef.current = next
    setSpace(next)
  }, [])

  /** Aplica una función pura de `preferences.js` al estado actual y lo guarda. */
  const mutate = useCallback(
    (change) => {
      if (lockRef.current) return { ok: false, message: LOCKED_MESSAGE }
      const current = spaceRef.current
      let next
      try {
        next = change(current.state)
      } catch (error) {
        return { ok: false, message: error?.message || 'No se pudo aplicar el cambio.' }
      }
      if (next === current.state) return { ok: true, changed: false }
      publish({ accountId: current.accountId, state: next })
      setStorageFailed(!saveState(current.accountId, next))
      return { ok: true, changed: true }
    },
    [publish],
  )

  /** Abre el espacio de otra cuenta (o del invitado con `null`). Devuelve false si hay una sincronización. */
  const switchAccount = useCallback(
    (accountId) => {
      if (lockRef.current) return false
      if ((accountId || null) === spaceRef.current.accountId) return true
      publish(openSpace(accountId))
      setStorageFailed(false)
      return true
    },
    [publish],
  )

  /** Reserva el espacio para sincronizar. Devuelve la cuenta y el estado a sincronizar, o null si ya está reservado. */
  const lock = useCallback(() => {
    if (lockRef.current) return null
    lockRef.current = true
    setLocked(true)
    return spaceRef.current
  }, [])

  /** Libera la reserva e incorpora el estado resultante si la cuenta sigue siendo la misma. */
  const unlock = useCallback(
    (accountId, state) => {
      lockRef.current = false
      setLocked(false)
      if (state && spaceRef.current.accountId === (accountId || null))
        publish({ accountId: accountId || null, state })
    },
    [publish],
  )

  return {
    accountId: space.accountId,
    state: space.state,
    locked,
    storageFailed,
    mutate,
    switchAccount,
    lock,
    unlock,
  }
}
