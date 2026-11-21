// Configuración de primera vez (asistente «Bienvenida»). Se hace UNA vez por equipo: la cámara y la mano
// son de este equipo y no se sincronizan. Después, el inicio solo pide «Empezar».
// Lógica pura: el almacenamiento se inyecta para probarla en Node.
import { isGestureLive } from '../data/engineStatus.js'

export const ONBOARDING_KEY = 'zerotouch:bienvenida'
export const ONBOARDING_VERSION = 1
export const STEPS = ['bienvenida', 'camara', 'gestos', 'uso', 'listo']
/** Los cuatro gestos que se practican al empezar (ids de src/data/gestures.js). */
export const BASIC_GESTURES = ['pointer', 'click', 'scroll', 'pause']

export function readOnboarding(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(ONBOARDING_KEY) ?? 'null')
    return { done: Boolean(raw?.done) && raw?.version === ONBOARDING_VERSION }
  } catch {
    return { done: false }
  }
}

export function markOnboardingDone(storage, now = Date.now(), { skipped = false } = {}) {
  try {
    storage.setItem(ONBOARDING_KEY, JSON.stringify({ version: ONBOARDING_VERSION, done: true, skipped, at: new Date(now).toISOString() }))
    return true
  } catch {
    return false
  }
}

export function resetOnboarding(storage) {
  try { storage.removeItem(ONBOARDING_KEY); return true } catch { return false }
}

export const needsOnboarding = storage => !readOnboarding(storage).done

export function stepIndex(step) {
  const index = STEPS.indexOf(step)
  return index < 0 ? 0 : index
}
export const nextStep = step => STEPS[Math.min(STEPS.length - 1, stepIndex(step) + 1)]
export const previousStep = step => STEPS[Math.max(0, stepIndex(step) - 1)]

/**
 * Práctica de gestos: devuelve la lista (sin repetir, en el orden de BASIC_GESTURES) de gestos ya
 * reconocidos. Es acumulativa: un gesto reconocido una vez queda marcado aunque la mano cambie.
 * Solo cuenta gestos habilitados en `enabled` (ajustes del modo/equipo).
 */
export function practiceProgress(done, status, enabled = BASIC_GESTURES) {
  const seen = new Set(done)
  for (const id of BASIC_GESTURES) if (enabled.includes(id) && isGestureLive(id, status)) seen.add(id)
  return BASIC_GESTURES.filter(id => seen.has(id))
}
