import { useState } from 'react'
import { getEngineState } from '../data/engineStatus'
import { NavLink, StatusBadge } from './UI'

const links = [
  ['/', 'Inicio', 'M3 10l9-7 9 7v10h-6v-7H9v7H3z'],
  [
    '/calibracion',
    'Gestos',
    'M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 5-2 8-7 8-3 0-4-1-6-4l-3-5a1.5 1.5 0 0 1 2-2z',
  ],
  ['/ajustes', 'Ajustes', 'M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m6 4v6'],
]

function Glyph({ path }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

const sidebarKey = 'zerotouch:barra-expandida'

export function Header({ path, navigate, engineStatus, onOpenAccount, accountName, showStatus }) {
  const desktopWindow = window.__TAURI__?.window?.getCurrentWindow?.()
  const state = getEngineState(engineStatus)
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(sidebarKey) === 'true'
    } catch {
      return false
    }
  })
  function toggleSidebar() {
    setExpanded(!expanded)
    try {
      localStorage.setItem(sidebarKey, String(!expanded))
    } catch {
      // La barra sigue funcionando durante la sesión.
    }
  }
  const toggleLabel = expanded ? 'Plegar barra lateral' : 'Expandir barra lateral'
  return (
    <>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <header className="app-header" data-expanded={expanded}>
        <button
          className="brand"
          type="button"
          aria-controls="primary-nav"
          aria-expanded={expanded}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={toggleSidebar}
        >
          <img
            src={`${import.meta.env.BASE_URL}assets/zerotouch-dark.png`}
            width="20"
            height="20"
            alt=""
          />
          {expanded && <strong>ZEROTOUCH</strong>}
        </button>
        <nav id="primary-nav" className="main-nav" aria-label="Principal">
          {links.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              navigate={navigate}
              title={label}
              aria-label={label}
              aria-current={path === to ? 'page' : undefined}
            >
              <Glyph path={icon} />
              {expanded && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="profile-trigger"
          title={accountName ? `Mi cuenta: ${accountName}` : 'Mi cuenta'}
          aria-haspopup="dialog"
          onClick={() => onOpenAccount()}
          aria-label={accountName ? `Mi cuenta: ${accountName}` : 'Mi cuenta'}
        >
          <i aria-hidden="true">
            {expanded && accountName ? (
              accountName.slice(0, 1).toUpperCase()
            ) : (
              <Glyph path="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21a8 8 0 0 1 16 0" />
            )}
          </i>
          {expanded && <span>{accountName || 'Mi cuenta'}</span>}
        </button>
      </header>
      <div className="workspace-toolbar" data-tauri-drag-region>
        {showStatus && <StatusBadge state={state} />}
        <span className="sr-only" aria-live="polite">{`Estado: ${state.label}`}</span>
        {desktopWindow && (
          <div className="window-actions" aria-label="Ventana" role="group">
            <button
              title="Minimizar"
              aria-label="Minimizar"
              onClick={() => desktopWindow.minimize()}
            >
              <Glyph path="M5 12h14" />
            </button>
            <button
              title="Maximizar o restaurar"
              aria-label="Maximizar o restaurar"
              onClick={() => desktopWindow.toggleMaximize()}
            >
              <Glyph path="M5 5h14v14H5z" />
            </button>
            <button
              title="Cerrar ventana"
              aria-label="Cerrar ventana"
              onClick={() => desktopWindow.close()}
            >
              <Glyph path="m6 6 12 12M18 6 6 18" />
            </button>
          </div>
        )}
      </div>
    </>
  )
}
