// Cuándo debe existir la ventana HUD (lógica pura; el hook `useHudWindow` solo ejecuta la decisión).
// La preferencia es del equipo y vive en localStorage; por defecto el HUD se muestra mientras el motor corre.

export const HUD_STORAGE_KEY = 'zerotouch:hud'

/** Lee la preferencia; ante un almacenamiento bloqueado o un valor extraño, activado. */
export function readHudEnabled(storage) {
  try { return storage?.getItem(HUD_STORAGE_KEY) !== 'off' } catch { return true }
}

export function writeHudEnabled(storage, enabled) {
  try { storage?.setItem(HUD_STORAGE_KEY, enabled ? 'on' : 'off'); return true } catch { return false }
}

/** El HUD se muestra solo con el motor en marcha y la preferencia activada. */
export function hudShouldBeOpen({ running, enabled }) {
  return Boolean(running && enabled)
}

/** Orden para el puente, o null si no hay que hacer nada (evita repetir la misma llamada en cada sondeo). */
export function hudCommand(previous, next) {
  if (previous === next) return null
  return next ? 'open' : 'close'
}
