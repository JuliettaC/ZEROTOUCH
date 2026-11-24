import { isGestureLive } from '../data/engineStatus'
import { gestureActionLabel, gestures } from '../data/gestures'
import GestureMedia from './GestureMedia'
/** Lista de gestos reales con su estado en vivo. */
export function GestureList({
  engineStatus,
  settings,
  assignments,
  onOpen,
  favorites,
  onFavorite,
}) {
  const ordered = Object.entries(gestures).sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
  const renderGesture = ([id, g]) => {
    const enabled = !g.toggle || settings?.[g.toggle] !== false
    const live = enabled && isGestureLive(id, engineStatus)
    const badge = !enabled ? 'Apagado' : live ? 'Detectado' : ''
    return (
      <li key={id} className={`gesture-item ${live ? 'live' : ''} ${enabled ? '' : 'disabled'}`}>
        <button
          type="button"
          className="gesture-open"
          onClick={() => onOpen(id)}
          aria-label={`${gestureActionLabel(id, assignments)}: ${g.title}. Ajustar`}
        >
          <GestureMedia id={id} size="sm" />
          <span className="gesture-text">
            <strong>{gestureActionLabel(id, assignments)}</strong>
            <small>{g.title}</small>
          </span>
          {badge && (
            <span className={`gesture-badge ${live ? 'live' : ''}`}>
              {live && <i aria-hidden="true">✓ </i>}
              {badge}
            </span>
          )}
        </button>
        {onFavorite && (
          <button
            type="button"
            className="favorite-button"
            aria-pressed={favorites.includes(id)}
            aria-label={`Favorito: ${gestureActionLabel(id, assignments)}`}
            onClick={() => onFavorite(id)}
          >
            {favorites.includes(id) ? '★' : '☆'}
          </button>
        )}
      </li>
    )
  }
  const frequent = ordered.filter(([, g]) => g.common)
  const occasional = ordered.filter(([, g]) => !g.common)
  return (
    <ul className="gesture-list">
      <li className="gesture-group" role="presentation">
        <small>Más usados</small>
      </li>
      {frequent.map(renderGesture)}
      {occasional.length > 0 && (
        <li className="gesture-group" role="presentation">
          <small>Otros gestos</small>
        </li>
      )}
      {occasional.map(renderGesture)}
    </ul>
  )
}
