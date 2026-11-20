// Enlace entre la ventana principal y la ventana del teclado Air-Swipe.
//
// Ambas ventanas comparten origen y, por tanto, `localStorage`. La ventana del teclado escribe un
// latido (solo una marca de tiempo; nunca texto) mientras vive; la principal lo consulta para saber si
// hay un teclado abierto. Si el latido caduca (ventana cerrada, colgada o fallida), el modo teclado que
// quede encendido en el motor se considera huérfano y se apaga (ver `isOrphanedAirswipe`).
// Puro: el `storage` y el reloj se inyectan para probarlo en Node.
export const HEARTBEAT_KEY = 'zerotouch:airswipe:heartbeat'
export const HEARTBEAT_EVERY_MS = 1000
export const STALE_AFTER_MS = 3500
/** Margen tras pedir la apertura: la ventana tarda en cargar el léxico antes de su primer latido. */
export const OPEN_GRACE_MS = 8000

export function writeHeartbeat(storage, now = Date.now()) {
  try { storage.setItem(HEARTBEAT_KEY, String(now)); return true } catch { return false }
}

export function clearHeartbeat(storage) {
  try { storage.removeItem(HEARTBEAT_KEY); return true } catch { return false }
}

export function heartbeatFresh(storage, now = Date.now(), staleAfter = STALE_AFTER_MS) {
  try {
    const stamp = Number(storage.getItem(HEARTBEAT_KEY))
    return Number.isFinite(stamp) && stamp > 0 && now - stamp >= 0 && now - stamp <= staleAfter
  } catch {
    return false
  }
}
