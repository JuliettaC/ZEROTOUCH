import { useEffect, useState } from 'react'
import { Header } from './components/UI'
import { ContextEditorDialog, ErgonomicSettingsDialog, GestureCalibrationDialog } from './components/Dialogs'
import DashboardPage from './pages/DashboardPage'
import CalibrationPage from './pages/CalibrationPage'
import GestureKeyboardPage from './pages/GestureKeyboardPage'
import GesturePlaygroundPage from './pages/GesturePlaygroundPage'
import { loadPreferences, savePreferences } from './data/preferences'
import './App.css'

export default function App() {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
  const getPath = () => {
  const pathname = window.location.pathname
  const relativePath = pathname.startsWith(BASE)
    ? pathname.slice(BASE.length)
    : pathname
    return relativePath || '/'
  }
  const [path, setPath] = useState(getPath)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [modal, setModal] = useState(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const onPopState = () => { setPath(getPath()); setModal(null) }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => { savePreferences(preferences) }, [preferences])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])
  function navigate(to) {
    const url = `${BASE}${to}`
    if (url !== window.location.pathname) {
    window.history.pushState({}, '', url)
    }

    setPath(to)
    setModal(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function update(patch) { setPreferences(current => ({ ...current, ...patch })) }
  function addContext(context) {
    setPreferences(current => ({ ...current, contexts: [...current.contexts, { ...context, id: crypto.randomUUID() }] }))
    setModal(null)
  }
  function deleteContext(id) {
    setPreferences(current => ({ ...current, contexts: current.contexts.filter(context => context.id !== id),
      desktopContext: current.desktopContext === id ? 'kitchen' : current.desktopContext,
      mobileContext: current.mobileContext === id ? 'kitchen' : current.mobileContext }))
  }
  const props = { preferences, update, navigate, openModal: setModal, deleteContext }
  return <div className="app">
    <Header path={path} navigate={navigate} hasContexts={preferences.contexts.length > 0} />
    {path === '/' && <DashboardPage {...props} />}
    {path === '/calibracion' && <CalibrationPage {...props} />}
    {path === '/teclado' && <GestureKeyboardPage navigate={navigate} />}
    {path === '/prueba' && <GesturePlaygroundPage navigate={navigate} />}
    {!['/', '/calibracion', '/teclado', '/prueba'].includes(path) && <main className="unavailable"><h1>Página no encontrada</h1><button className="button primary" onClick={() => navigate('/')}>Volver al Panel Principal</button></main>}
    {modal?.type === 'context' && <ContextEditorDialog mobile={modal.mobile} onClose={() => setModal(null)} onSave={addContext} />}
    {modal?.type === 'ergonomic' && <ErgonomicSettingsDialog settings={preferences.settings} onClose={() => setModal(null)} onSave={settings => { update({ settings }); setModal(null) }} />}
    {modal?.type === 'gesture' && <GestureCalibrationDialog gesture={modal.gesture} onClose={() => setModal(null)} onSave={() => { setModal(null); setNotice('Calibración guardada') }} />}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>
}
