import { BASIC_GESTURES } from '../onboarding/onboarding.js'
import { gestures } from './gestures.js'

const KEY = 'zerotouch:gestos-favoritos'

export function readFavorites(storage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY))
    if (Array.isArray(saved))
      return [
        ...new Set(saved.filter((id) => typeof id === 'string' && Object.hasOwn(gestures, id))),
      ]
  } catch {
    // Un equipo nuevo o con almacenamiento bloqueado usa la selección inicial.
  }
  return [...BASIC_GESTURES]
}

export function toggleFavorite(current, id) {
  if (!Object.hasOwn(gestures, id)) return current
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
}

export function saveFavorites(storage, favorites) {
  storage.setItem(KEY, JSON.stringify(favorites))
}
