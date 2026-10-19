const STORAGE_KEY = 'zerotouch-preferences-v1'
const defaults = { contexts: [], desktopContext: 'kitchen', mobileContext: 'kitchen', gaze: true, proximity: true,
  settings: { sensitivity: 65, stability: 40, deskRest: true } }

export const contexts = {
  kitchen: { title: 'Modo Cocina y Taller', tab: 'Cocina y Taller', icon: 'kitchen', description: 'Demostración para consultar recetas e instrucciones. Mano abierta para puntero, dos dedos para desplazar y puño para pausar.', badge: 'Optimizado', indicators: ['moon', 'grid'] },
  desk: { title: 'Modo Desk-Rest Ergonómico', icon: 'desk', description: 'Rastreo con antebrazo apoyado en mesa. Propone movimientos breves de dedos y muñeca; beneficios ergonómicos por validar.', badge: 'Salud Activa', indicators: ['bolt', 'check'] },
  assistance: { title: 'Modo Asistencia Motriz', tab: 'Asistencia Motriz', icon: 'assistance', description: 'Ajustes propuestos de estabilidad y micro-pinza. Adecuación a cada usuario pendiente de validación.', badge: 'Alta Precisión', indicators: ['target'] },
  handsfree: { title: 'Modo Manos Libre', tab: 'Manos Libre', icon: 'hand', description: 'Interacción propuesta con el teléfono apoyado; distancia y precisión pendientes de validación.', badge: 'Distancia media', indicators: [] },
}
export function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!stored || !Array.isArray(stored.contexts)) return defaults
    const saved = stored.contexts.filter(c => c && typeof c.id === 'string' && typeof c.name === 'string')
    const valid = (id, mobile) => (mobile ? ['kitchen', 'handsfree', 'assistance'] : ['kitchen', 'desk', 'assistance']).includes(id) || saved.some(c => c.id === id)
    const percent = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
    return { ...defaults, contexts: saved, desktopContext: valid(stored.desktopContext, false) ? stored.desktopContext : 'kitchen', mobileContext: valid(stored.mobileContext, true) ? stored.mobileContext : 'kitchen', gaze: typeof stored.gaze === 'boolean' ? stored.gaze : true, proximity: typeof stored.proximity === 'boolean' ? stored.proximity : true,
      contextSettings: stored.contextSettings && typeof stored.contextSettings === 'object' ? stored.contextSettings : {},
      settings: { sensitivity: percent(stored.settings?.sensitivity, 65), stability: percent(stored.settings?.stability, 40), deskRest: stored.settings?.deskRest !== false } }
  } catch { return defaults }
}
export function savePreferences(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Keep session state if storage is unavailable. */ }
}

// Legacy global settings remain the fallback; edits belong to the selected context.
export function getContextSettings(preferences, id) {
  const custom = preferences.contexts.find(context => context.id === id)
  const source = custom || preferences.contextSettings?.[id] || preferences.settings
  const percent = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
  return { sensitivity: percent(source.sensitivity, preferences.settings.sensitivity),
    stability: percent(source.stability, preferences.settings.stability),
    deskRest: source.deskRest ?? preferences.settings.deskRest,
    pinch: source.pinch !== false, scroll: source.scroll !== false }
}

export function updateContextSettings(preferences, id, settings) {
  if (preferences.contexts.some(context => context.id === id)) {
    return { ...preferences, contexts: preferences.contexts.map(context => context.id === id ? { ...context, ...settings } : context) }
  }
  return { ...preferences, contextSettings: { ...preferences.contextSettings, [id]: settings } }
}
