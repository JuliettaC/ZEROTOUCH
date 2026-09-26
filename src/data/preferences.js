const STORAGE_KEY = 'zerotouch-preferences-v1'
const defaults = { contexts: [], desktopContext: 'kitchen', mobileContext: 'kitchen', gaze: true, proximity: true,
  settings: { sensitivity: 65, stability: 40, deskRest: true } }

export const contexts = {
  kitchen: { title: 'Modo Cocina y Taller', tab: 'Cocina y Taller', icon: 'kitchen', description: 'Alta tolerancia a manos húmedas o sucias. Navegación por gestos amplios de palma y puño cerrado.', badge: 'Optimizado', indicators: ['moon', 'grid'] },
  desk: { title: 'Modo Desk-Rest Ergonómico', icon: 'desk', description: 'Rastreo con antebrazo apoyado en mesa. Micro-movimientos de dedos y muñeca para alivio de túnel carpiano.', badge: 'Salud Activa', indicators: ['bolt', 'check'] },
  assistance: { title: 'Modo Asistencia Motriz', tab: 'Asistencia Motriz', icon: 'assistance', description: 'Filtro de pulso tranquilo (antitemblores) y micro-pinza adaptable para precisión máxima.', badge: 'Alta Precisión', indicators: ['target'] },
  handsfree: { title: 'Modo Manos Libre', tab: 'Manos Libre', icon: 'hand', description: 'Ángulo de detección amplio y gestos a distancia (hasta 80 cm) para navegar sin tocar el teléfono apoyado.', badge: 'Distancia media', indicators: [] },
}
export function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!stored || !Array.isArray(stored.contexts)) return defaults
    const saved = stored.contexts.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string')
    const valid = (id, mobile) => (mobile ? ['kitchen', 'handsfree', 'assistance'] : ['kitchen', 'desk', 'assistance']).includes(id) || saved.some(c => c.id === id)
    const percent = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
    return { ...defaults, contexts: saved, desktopContext: valid(stored.desktopContext, false) ? stored.desktopContext : 'kitchen', mobileContext: valid(stored.mobileContext, true) ? stored.mobileContext : 'kitchen', gaze: typeof stored.gaze === 'boolean' ? stored.gaze : true, proximity: typeof stored.proximity === 'boolean' ? stored.proximity : true,
      settings: { sensitivity: percent(stored.settings?.sensitivity, 65), stability: percent(stored.settings?.stability, 40), deskRest: stored.settings?.deskRest !== false } }
  } catch { return defaults }
}
export function savePreferences(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Keep session state if storage is unavailable. */ }
}
