import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from './components/UI'
import { ContextEditorDialog, GestureCalibrationDialog, OptionalAccountDialog, ProfileDialog } from './components/Dialogs'
import DashboardPage from './pages/DashboardPage'
import CalibrationPage from './pages/CalibrationPage'
import GestureKeyboardPage from './pages/GestureKeyboardPage'
import GesturePlaygroundPage from './pages/GesturePlaygroundPage'
import WelcomePage from './pages/WelcomePage'
import SettingsPage from './pages/SettingsPage'
import { markOnboardingDone, needsOnboarding, resetOnboarding } from './onboarding/onboarding'
import { readMinimizeOnStart, writeMinimizeOnStart } from './engine/quickStart'
import { api } from './api/client'
import {
  addMode, addProfile, clearTombstone, getActiveAssignments, getActiveMode, getActiveProfile, getEffectiveSettings, modesOf, removeMode, removeProfile,
  selectMode, selectProfile, setAssignment, setToggle, settingsPatch, updateActiveSettings, updateMode, updateProfile,
} from './data/preferences'
import { GESTURE_TO_TOGGLE, NO_ACTION } from './data/capabilities'
import { buildEngineConfig } from './engine/engineConfig'
import { syncSummary } from './sync/syncSession'
import { useWorkspace } from './hooks/useWorkspace'
import { useEngine } from './hooks/useEngine'
import { useAccount } from './hooks/useAccount'
import { useAirswipeLink } from './hooks/useAirswipeLink'
import { useAppEvents } from './hooks/useAppEvents'
import { useHudWindow } from './hooks/useHudWindow'
import { TimerDock } from './components/AppTools'
import './App.css'
import './ui-refresh.css'
import './state-ui.css'
import './inicio-sencillo.css'

const PAGE_TITLES = { '/': 'Inicio', '/bienvenida': 'Configuración inicial', '/calibracion': 'Calibrar', '/teclado': 'Teclado Air-Swipe', '/ajustes': 'Ajustes', '/prueba': 'Prueba' }
const storage = () => globalThis.localStorage
const SYNCED_NOTE = 'Se quitará de tu cuenta al sincronizar, solo si no cambió en otro equipo.'

export default function App() {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
  const redirect = sessionStorage.getItem('redirect')
  if (redirect) {
    sessionStorage.removeItem('redirect')
    window.history.replaceState({}, '', redirect)
  }
  const getPath = useCallback(() => {
    const pathname = window.location.pathname
    const relativePath = pathname.startsWith(BASE)
      ? pathname.slice(BASE.length)
      : pathname
    return (!relativePath || relativePath === '/index.html') ? '/' : relativePath
  }, [BASE])
  const [path, setPath] = useState(getPath)
  const [modal, setModal] = useState(null)
  const [notice, setNoticeState] = useState(null)
  const setNotice = useCallback((text, tone = 'info') => setNoticeState(text ? { text, tone } : null), [])

  // Preferencias v2 de la cuenta activa (o del invitado), motor local y cuenta con sincronización.
  const workspace = useWorkspace()
  const { state, locked, storageFailed, mutate } = workspace
  const mode = getActiveMode(state)
  const activeProfile = getActiveProfile(state)
  const settings = useMemo(() => getEffectiveSettings(state), [state])
  const assignments = useMemo(() => getActiveAssignments(state), [state])
  const desired = useMemo(() => buildEngineConfig(settings, assignments), [settings, assignments])
  const keyboard = useAirswipeLink({ onNotice: setNotice })
  const engine = useEngine({ desired, isKeyboardOpen: keyboard.isKeyboardOpen, onNotice: setNotice })
  const { engineStatus } = engine
  const hud = useHudWindow({ running: Boolean(engineStatus.running), onNotice: setNotice })
  const acct = useAccount({ workspace, onNotice: setNotice })
  const { account } = acct
  // Temporizadores y avisos de los eventos del motor (multimedia, ventanas, precisión).
  const tools = useAppEvents({ engineStatus, timerMinutes: settings.timerMinutes ?? 5, onNotice: setNotice })
  const summary = syncSummary(state, { account, locked })
  // Configuración de primera vez (una vez por equipo) y preferencia de minimizar al empezar.
  const [onboarded, setOnboarded] = useState(() => !needsOnboarding(storage()))
  const [minimizeOnStart, setMinimizeOnStart] = useState(() => readMinimizeOnStart(storage()))

  useEffect(() => {
    document.title = `${PAGE_TITLES[path] || 'Página no encontrada'} · ZeroTouch`
  }, [path])
  useEffect(() => {
    const onPopState = () => { setPath(getPath()); setModal(null) }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [getPath])
  useEffect(() => {
    if (!notice) return
    // Los errores permanecen hasta cerrarlos; los avisos se ocultan solos.
    if (notice.tone === 'error') return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])

  // Toda edición pasa por aquí: se guarda al instante y se rechaza mientras se sincroniza.
  const edit = useCallback(change => {
    const result = mutate(change)
    if (!result.ok) setNotice(result.message, 'error')
    return result
  }, [mutate, setNotice])

  const changeSettings = next => edit(current => updateActiveSettings(current, settingsPatch(settings, next)))
  const assign = (code, patch) => edit(current => {
    if (!current.activeModeId) return current
    if (patch.toggle !== undefined) {
      const toggle = GESTURE_TO_TOGGLE[code]
      return toggle ? setToggle(current, current.activeModeId, toggle, patch.toggle) : current
    }
    return setAssignment(current, current.activeModeId, code, { accion: patch.accion, habilitado: patch.accion !== NO_ACTION })
  })
  const createMode = ({ nombre, categoria = 'personalizado', settings: modeSettings, toggles }) => {
    const editing = modal?.mode
    if (editing) {
      const result = edit(current => updateMode(current, editing.id, { nombre, categoria }))
      if (result.ok) { setModal(null); setNotice(`Modo «${nombre}» actualizado.`) }
      return
    }
    if (!activeProfile) return
    const result = edit(current => {
      let next = addMode(current, activeProfile.id, { nombre, categoria, settings: modeSettings })
      for (const [toggle, value] of Object.entries(toggles)) next = setToggle(next, next.activeModeId, toggle, value)
      return next
    })
    if (result.ok) { setModal(null); setNotice(`Modo «${nombre}» creado y listo para usar.`) }
  }
  const deleteMode = id => {
    const target = state.modes.find(m => m.id === id)
    const result = edit(current => removeMode(current, id))
    if (result.ok && target) setNotice(target.version === null ? `Modo «${target.nombre}» eliminado.` : `Modo «${target.nombre}» quitado de este equipo. ${SYNCED_NOTE}`)
  }
  const saveProfile = data => {
    const editing = modal?.profile
    const result = edit(current => (editing ? updateProfile(current, editing.id, data) : addProfile(current, data)))
    if (result.ok) { setModal(null); setNotice(editing ? 'Perfil actualizado.' : `Perfil «${data.nombre}» creado. Aún no tiene modos.`) }
  }
  const deleteProfile = id => {
    const target = state.profiles.find(p => p.id === id)
    const result = edit(current => removeProfile(current, id))
    if (result.ok && target) setNotice(target.version === null ? `Perfil «${target.nombre}» eliminado.` : `Perfil «${target.nombre}» quitado de este equipo. ${SYNCED_NOTE}`)
  }

  // Cancelar un borrado bloqueado solo quita la marca local; la sincronización siguiente recupera el elemento.
  const cancelDelete = async conflict => {
    const result = edit(current => clearTombstone(current, conflict.kind, conflict.id))
    if (result.ok) await acct.sync()
  }

  function navigate(to) {
    const url = `${BASE}${to}`
    if (url !== window.location.pathname) {
      window.history.pushState({}, '', url)
    }
    setPath(to)
    setModal(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
    // Mueve el foco al contenido nuevo para lectores de pantalla y teclado.
    window.requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true }))
  }
  const openAccount = (register = false) => {
    acct.clearWarning()
    setModal({ type: 'account', register: Boolean(register) })
  }

  const view = {
    profiles: state.profiles,
    activeProfile,
    modes: activeProfile ? modesOf(state, activeProfile.id) : [],
    activeModeId: state.activeModeId,
    tombstones: state.tombstones.length,
  }
  const engineProps = {
    engineStatus,
    engineBusy: engine.engineBusy,
    onStartEngine: engine.startEngine,
    onStopEngine: engine.stopEngine,
    onToggleControlMode: engine.toggleControl,
    onTogglePause: engine.togglePause,
    hud,
  }
  // «Empezar»: cámara + control en una acción. Solo si el motor confirmó CONTROL se minimiza la ventana, y solo
  // con el indicador flotante activo, para que el estado siga a la vista.
  const quickStart = async () => {
    const result = await engine.quickStart()
    if (result.ok && minimizeOnStart && hud.enabled) api.minimizeMainWindow().catch(() => {})
  }
  const finishOnboarding = ({ skipped }) => {
    if (!markOnboardingDone(storage(), Date.now(), { skipped })) setNotice('No se pudo guardar en este equipo que ya configuraste ZeroTouch; se volverá a mostrar la bienvenida.', 'error')
    setOnboarded(true)
    navigate('/')
  }
  const repeatOnboarding = () => { resetOnboarding(storage()); setOnboarded(false); navigate('/bienvenida') }
  const selectModeById = id => edit(current => selectMode(current, id))
  const showWelcome = path === '/bienvenida' || (path === '/' && !onboarded)
  return <div className="app">
    <Header path={showWelcome ? '/bienvenida' : path} navigate={navigate} engineStatus={engineStatus} account={account} onOpenAccount={openAccount} />
    {storageFailed && <p className="storage-warning" role="alert">No se pudo guardar en este equipo (almacenamiento lleno o bloqueado). Tus cambios siguen en memoria: no cierres la aplicación hasta resolverlo.</p>}
    {showWelcome && <WelcomePage settings={settings} onChangeSettings={changeSettings} engineStatus={engineStatus} engineBusy={engine.engineBusy} onStartEngine={engine.startEngine}
      modes={view.modes} activeModeId={view.activeModeId} onSelectMode={selectModeById} onFinish={finishOnboarding} />}
    {path === '/' && !showWelcome && <DashboardPage {...engineProps} view={view} assignments={assignments} locked={locked} apply={engine.apply} onRetryApply={engine.retryApply}
      onSelectMode={selectModeById} navigate={navigate} onQuickStart={quickStart} />}
    {path === '/ajustes' && <SettingsPage view={view} settings={settings} assignments={assignments} locked={locked} apply={engine.apply} onRetryApply={engine.retryApply} syncSummary={summary} account={account}
      onSelectProfile={id => edit(current => selectProfile(current, id))} onSelectMode={selectModeById}
      onDeleteMode={deleteMode} onDeleteProfile={deleteProfile} openModal={setModal} navigate={navigate} engineStatus={engineStatus}
      tools={tools} onChangeTimerMinutes={value => edit(current => updateActiveSettings(current, { timerMinutes: value }))}
      hud={hud} minimizeOnStart={minimizeOnStart} onToggleMinimize={value => { writeMinimizeOnStart(storage(), value); setMinimizeOnStart(value) }} onRepeatOnboarding={repeatOnboarding} />}
    {path === '/calibracion' && <CalibrationPage {...engineProps} settings={settings} assignments={assignments} modeName={mode?.nombre ?? 'sin modo'} locked={locked} apply={engine.apply} onRetryApply={engine.retryApply}
      onChangeSettings={changeSettings} onAssign={assign} openModal={setModal} />}
    {path === '/teclado' && <GestureKeyboardPage navigate={navigate} engineStatus={engineStatus} settings={settings} keyboard={keyboard} />}
    {path === '/prueba' && <GesturePlaygroundPage navigate={navigate} activeContext={mode?.nombre ?? ''} engineStatus={engineStatus} settings={settings} />}
    {!Object.keys(PAGE_TITLES).includes(path) && <main id="main" tabIndex={-1} className="page unavailable"><h1>Página no encontrada</h1><button className="button primary" onClick={() => navigate('/')}>Ir al inicio</button></main>}
    {modal?.type === 'context' && <ContextEditorDialog mode={modal.mode ?? null} existingNames={view.modes.filter(m => m.id !== modal.mode?.id).map(m => m.nombre)} onClose={() => setModal(null)} onSave={createMode} />}
    {modal?.type === 'profile' && <ProfileDialog profile={modal.profile} existingNames={state.profiles.filter(p => p.id !== modal.profile?.id).map(p => p.nombre)} onClose={() => setModal(null)} onSave={saveProfile} />}
    {modal?.type === 'gesture' && <GestureCalibrationDialog gesture={modal.gesture} engineStatus={engineStatus} engineBusy={engine.engineBusy} settings={settings} assignments={assignments} onUpdateSettings={changeSettings} onStartEngine={engine.startEngine} onClose={() => setModal(null)} />}
    {modal?.type === 'account' && <OptionalAccountDialog initialRegister={modal.register} account={account} summary={summary} syncWarning={acct.warning} report={acct.report} outcomeText={acct.outcomeText} locked={locked} busy={acct.authBusy}
      onLogin={async credentials => { const result = await acct.login(credentials); if (result.ok) setModal(null); return result }} onRegister={acct.register} onAccountAction={acct.accountAction} onLogout={acct.logout}
      onSync={acct.sync} onCancelDelete={cancelDelete} onImportGuest={acct.importGuest} onClearWarning={acct.clearWarning} onClose={() => setModal(null)} />}
    {path !== '/ajustes' && <TimerDock tools={tools} onOpen={() => navigate('/ajustes')} />}
    <div className="toast-region" aria-live="polite">
      {notice && notice.tone !== 'error' && <div className="toast">{notice.text}</div>}
    </div>
    {notice?.tone === 'error' && <div className="toast toast-error" role="alert"><span>{notice.text}</span><button type="button" className="tiny-button ghost" onClick={() => setNotice('')}>Cerrar</button></div>}
  </div>
}
