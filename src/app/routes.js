export const PAGE_TITLES = {
  '/': 'Inicio',
  '/bienvenida': 'Configuración inicial',
  '/calibracion': 'Gestos',
  '/teclado': 'Teclado Air-Swipe',
  '/ajustes': 'Ajustes',
}
const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '').replace(/^\.$/, '')

export function pageUrl(path) {
  return base + path
}

export function currentPath(pathname) {
  const path = base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname
  if (path === '/prueba') return '/calibracion'
  return !path || path === '/index.html' || path === base ? '/' : path
}

export function restoreRoute(browser) {
  const redirect = browser.sessionStorage.getItem('redirect')
  if (redirect) {
    browser.sessionStorage.removeItem('redirect')
    browser.history.replaceState({}, '', redirect)
  }
  if (browser.location.pathname === pageUrl('/prueba')) {
    browser.history.replaceState({}, '', pageUrl('/calibracion'))
  }
}
