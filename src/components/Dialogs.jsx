import { useEffect, useId, useRef, useState } from 'react'
import { gestureActionLabel, gestures } from '../data/gestures'
import SyncConflicts from './SyncConflicts'
import { getEngineState, isGestureLive } from '../data/engineStatus'
import { Icon, SettingSlider, ToggleRow } from './UI'

function Dialog({ children, onClose, className = '', titleId }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current, trigger = document.activeElement
    dialog.showModal()
    // showModal() enfoca el primer elemento enfocable (el botón Cerrar) y anula el autoFocus de React:
    // el campo principal se enfoca de forma explícita para poder escribir sin tocar nada.
    dialog.querySelector('[data-autofocus]')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; trigger?.focus?.() }
  }, [])
  return <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) { const box = ref.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose() } }}>{children}</dialog>
}

function DialogHeader({ id, title, subtitle, onClose }) {
  return <header className="dialog-header">
    <div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    <button type="button" className="close-dialog" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
  </header>
}

const nameKey = value => String(value).trim().normalize('NFC').toLowerCase()

const CATEGORY_OPTIONS = [
  ['personalizado', 'Personalizado'],
  ['manual', 'Manos ocupadas (cocina, taller)'],
  ['oficina', 'Oficina / escritorio'],
  ['accesibilidad', 'Accesibilidad'],
]

/** Crear un modo o, con `mode`, cambiarle el nombre y la categoría (los ajustes finos están en Calibrar). */
export function ContextEditorDialog({ mode = null, onClose, onSave, existingNames = [] }) {
  const titleId = useId(), errorId = useId(), categoryId = useId()
  const [form, setForm] = useState({ name: mode?.nombre ?? '', categoria: mode?.categoria ?? 'personalizado', sensitivity: 65, stability: 40, pinchTolerance: 50, pinch: true, scroll: true })
  const [error, setError] = useState('')
  const input = useRef(null)
  const update = patch => setForm(current => ({ ...current, ...patch }))
  function submit(event) {
    event.preventDefault()
    const name = form.name.trim()
    const message = !name ? 'Escribe un nombre.' : existingNames.some(n => nameKey(n) === nameKey(name)) ? 'Ya existe un modo con ese nombre en este perfil.' : ''
    if (message) { setError(message); input.current?.focus(); return }
    if (mode) onSave({ nombre: name, categoria: form.categoria })
    else onSave({ nombre: name, categoria: form.categoria, settings: { sensitivity: form.sensitivity, stability: form.stability }, toggles: { pinch: form.pinch, scroll: form.scroll } })
  }
  return <Dialog onClose={onClose} titleId={titleId} className="context-dialog">
    <form noValidate onSubmit={submit}>
      <DialogHeader id={titleId} title={mode ? 'Editar modo' : 'Nuevo modo'} subtitle={mode ? 'Cambia el nombre o la categoría. Los ajustes del gesto están en Calibrar.' : 'Ponle nombre y ajusta lo básico.'} onClose={onClose} />
      <div className="dialog-body">
        <label className="name-field">Nombre
          <input ref={input} data-autofocus autoFocus maxLength={60} value={form.name} placeholder="Ej.: Presentaciones" onChange={event => { update({ name: event.target.value }); setError('') }} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} required />
        </label>
        {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
        <label className="name-field" htmlFor={categoryId}>Categoría</label>
        <select id={categoryId} className="compact-select" value={form.categoria} onChange={event => update({ categoria: event.target.value })}>
          {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {!mode && <>
          <SettingSlider name="sensitivity" settings={form} onChange={setForm} />
          <SettingSlider name="stability" settings={form} onChange={setForm} />
          <ToggleRow label="Clic con pinza" checked={form.pinch} onChange={pinch => update({ pinch })} />
          <ToggleRow label="Desplazar con dos dedos" checked={form.scroll} onChange={scroll => update({ scroll })} />
        </>}
      </div>
      <footer className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" type="submit">{mode ? 'Guardar' : 'Crear modo'}</button>
      </footer>
    </form>
  </Dialog>
}

export function ProfileDialog({ profile = null, existingNames = [], onClose, onSave }) {
  const titleId = useId(), errorId = useId()
  const [name, setName] = useState(profile?.nombre ?? '')
  const [description, setDescription] = useState(profile?.descripcion ?? '')
  const [error, setError] = useState('')
  const input = useRef(null)
  function submit(event) {
    event.preventDefault()
    const clean = name.trim()
    const message = !clean ? 'Escribe un nombre.' : existingNames.some(n => nameKey(n) === nameKey(clean)) ? 'Ya existe un perfil con ese nombre.' : ''
    if (message) { setError(message); input.current?.focus(); return }
    onSave({ nombre: clean, descripcion: description.trim() })
  }
  return <Dialog onClose={onClose} titleId={titleId} className="context-dialog">
    <form noValidate onSubmit={submit}>
      <DialogHeader id={titleId} title={profile ? 'Editar perfil' : 'Nuevo perfil'} subtitle="Un perfil agrupa los modos de uso que quieres sincronizar." onClose={onClose} />
      <div className="dialog-body">
        <label className="name-field">Nombre
          <input ref={input} data-autofocus autoFocus maxLength={60} value={name} placeholder="Ej.: Cocina de casa" onChange={event => { setName(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} required />
        </label>
        {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
        <label className="name-field">Descripción (opcional)
          <input maxLength={300} value={description} onChange={event => setDescription(event.target.value)} />
        </label>
      </div>
      <footer className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" type="submit">{profile ? 'Guardar' : 'Crear perfil'}</button>
      </footer>
    </form>
  </Dialog>
}

export function GestureCalibrationDialog({ gesture = 'click', engineStatus, engineBusy, settings, assignments, onUpdateSettings, onStartEngine, onClose }) {
  const titleId = useId()
  const item = gestures[gesture] || gestures.click
  const state = getEngineState(engineStatus)
  const enabled = !item.toggle || settings?.[item.toggle] !== false
  const live = enabled && isGestureLive(gesture, engineStatus)
  const feedback = !enabled ? 'Este gesto está apagado.'
    : !state.cameraOpen ? 'Activa la cámara para probarlo.'
      : !state.handDetected ? 'Muestra tu mano a la cámara.'
        : live ? '¡Detectado!' : item.live === false ? 'Este gesto se comprueba al usarlo en la aplicación.' : 'Haz el gesto ahora.'
  return <Dialog onClose={onClose} titleId={titleId} className="gesture-dialog">
    <DialogHeader id={titleId} title={gestureActionLabel(gesture in gestures ? gesture : 'click', assignments)} subtitle={item.title} onClose={onClose} />
    <div className="dialog-body">
      <div className={`gesture-live ${live ? 'ok' : ''}`}>
        <span className="gesture-emoji" aria-hidden="true">{item.emoji}</span>
        <div>
          <p className="gesture-how">{item.instruction}</p>
          <p className="gesture-feedback" role="status">{live && <span aria-hidden="true">✓ </span>}{feedback}</p>
        </div>
      </div>
      {!state.running && onStartEngine && <button type="button" className="button secondary full" disabled={engineBusy} onClick={onStartEngine}>{engineBusy ? 'Activando…' : 'Activar cámara'}</button>}
      {item.toggle && <ToggleRow label="Gesto activado" checked={enabled} onChange={value => onUpdateSettings({ ...settings, [item.toggle]: value })} />}
      {settings && onUpdateSettings && item.setting && <SettingSlider name={item.setting} settings={settings} onChange={onUpdateSettings} />}
      <p className="autosave"><span aria-hidden="true">✓</span> Los cambios se guardan solos.</p>
    </div>
    <footer className="dialog-actions">
      <button type="button" className="button primary" onClick={onClose}>Listo</button>
    </footer>
  </Dialog>
}

// Diálogo de cuenta con el flujo habitual: entrar (correo o usuario), crear cuenta, confirmar el
// correo y recuperar la contraseña. La confirmación ocurre en el backend: el enlace del correo abre
// /cuenta/verificar o /cuenta/restablecer en el navegador.
const ACCOUNT_TITLES = { login: 'Entrar', register: 'Crear cuenta', pending: 'Confirma tu correo', forgot: 'Recuperar contraseña' }
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const validEmail = value => value.length >= 6 && value.length <= 254 && EMAIL_PATTERN.test(value)
const validUsername = value => /^[a-zA-Z0-9_]{3,40}$/.test(value)

// Copia explícita de los modos de invitado a la cuenta: nunca ocurre sola al iniciar sesión.
function ImportGuest({ disabled, onImport }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) return <button type="button" className="text-link" style={{ alignSelf: 'flex-start' }} disabled={disabled} onClick={() => setConfirming(true)}>Copiar mis ajustes de invitado a esta cuenta</button>
  return <span className="confirm-inline" role="group" aria-label="Copiar ajustes de invitado">
    <span>¿Copiar? Se subirán al sincronizar.</span>
    <button type="button" className="tiny-button" onClick={() => { onImport(); setConfirming(false) }} autoFocus>Sí</button>
    <button type="button" className="tiny-button ghost" onClick={() => setConfirming(false)}>No</button>
  </span>
}

export function OptionalAccountDialog({ initialRegister = false, account, summary, syncWarning, report, outcomeText, locked = false, busy, onLogin, onRegister, onAccountAction, onLogout, onSync, onCancelDelete, onImportGuest, onClearWarning, onClose }) {
  const titleId = useId(), passHint = useId(), errId = useId(), passId = useId()
  const [view, setView] = useState(initialRegister ? 'register' : 'login')
  const [cameFrom, setCameFrom] = useState('register')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localMsg, setLocalMsg] = useState('')
  const [fieldError, setFieldError] = useState('')
  // Credenciales recién escritas, solo en memoria mientras se espera la confirmación del correo,
  // para reenviar el enlace (o corregir un correo equivocado) sin volver a pedirlas.
  const pendingCreds = useRef(null)
  useEffect(() => () => { pendingCreds.current = null }, [])
  const accountName = account?.nombre_usuario || account?.username
  const needsName = view === 'login' || view === 'register'
  const needsEmail = view !== 'login'
  const needsPassword = view === 'login' || view === 'register'

  function go(next) {
    if (next !== 'pending') pendingCreds.current = null
    // Un correo escrito en "Correo o usuario" pasa al campo Correo, no al de Usuario.
    if (next !== 'login' && username.includes('@')) { setEmail(current => current || username.trim()); setUsername('') }
    setView(next); setLocalMsg(''); setFieldError(''); setPassword(''); onClearWarning?.()
  }
  function awaitConfirmation(creds, origin) {
    pendingCreds.current = creds
    setCameFrom(origin); setView('pending'); setLocalMsg(''); onClearWarning?.()
  }

  function validate(name, mail) {
    if (view === 'login') {
      if (!name) return 'Escribe tu correo o usuario.'
      if (name.includes('@') ? !validEmail(name) : !validUsername(name)) return 'Revisa el correo o usuario.'
      return password ? '' : 'Escribe tu contraseña.'
    }
    if (view === 'register' && !validUsername(name)) return 'Usuario: de 3 a 40 letras, números o _.'
    if (!validEmail(mail)) return 'Correo: escribe una dirección válida.'
    if (view === 'register' && [...password].length < 8) return 'Contraseña: mínimo 8 caracteres.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLocalMsg('')
    const name = username.trim(), mail = email.trim()
    const problem = validate(name, mail)
    if (problem) { setFieldError(problem); return }
    setFieldError('')
    const secret = password
    setPassword('')
    if (view === 'login') {
      const result = await onLogin({ nombre_usuario: name, contrasena: secret })
      if (result?.code === 'CUENTA_NO_VERIFICADA') {
        if (name.includes('@')) setEmail(name)
        awaitConfirmation({ nombre_usuario: name, contrasena: secret }, 'login')
      }
      return
    }
    if (view === 'register') {
      const result = await onRegister({ nombre_usuario: name, correo: mail, contrasena: secret })
      if (result?.ok) awaitConfirmation({ nombre_usuario: name, contrasena: secret }, 'register')
      return
    }
    if (view === 'pending') {
      const creds = pendingCreds.current
      const result = creds
        ? await onAccountAction?.('vincular', { ...creds, correo: mail })
        : await onAccountAction?.('reenviar', { correo: mail })
      if (result?.ok) setLocalMsg('Listo. Si el correo es correcto, te llegará un enlace nuevo en unos minutos. Revisa también la carpeta de spam.')
      return
    }
    const result = await onAccountAction?.('recuperar', { correo: mail })
    if (result?.ok) setLocalMsg('Si ese correo pertenece a una cuenta, te enviamos un enlace para crear una contraseña nueva.')
  }

  const error = fieldError || syncWarning
  const submitLabel = { login: 'Entrar', register: 'Crear cuenta', pending: 'Reenviar enlace', forgot: 'Enviar enlace' }[view]
  const switchLink = {
    login: ['¿No tienes cuenta?', 'Crear cuenta', 'register'],
    register: ['¿Ya tienes cuenta?', 'Entrar', 'login'],
    pending: ['¿Ya la confirmaste?', 'Entrar', 'login'],
    forgot: ['¿La recordaste?', 'Entrar', 'login'],
  }[view]
  return <Dialog onClose={onClose} titleId={titleId} className="account-dialog">
    <DialogHeader id={titleId} title={accountName ? 'Tu cuenta' : ACCOUNT_TITLES[view]} subtitle="Opcional: solo sirve para sincronizar tus modos." onClose={onClose} />
    {error && <p id={errId} className="field-error" role="alert">{error}</p>}
    {accountName ? (
      <div className="dialog-body">
        <p className="account-name"><strong>{accountName}</strong><small className={`sync-tone sync-${summary?.tone}`}>{summary?.text}</small></p>
        {localMsg && <p className="account-feedback" role="status">{localMsg}</p>}
        {report && outcomeText && <p className={`account-feedback sync-result ${report.ok ? 'ok' : 'attention'}`} role="status">{outcomeText}</p>}
        {report?.conflicts?.length > 0 && <SyncConflicts key={report.at} conflicts={report.conflicts} busy={busy || locked} onApply={onSync} onCancelDelete={onCancelDelete} />}
        <ImportGuest disabled={busy || locked} onImport={onImportGuest} />
        <footer className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy || locked} onClick={onLogout}>Cerrar sesión</button>
          <button type="button" className="button primary" disabled={busy || locked} onClick={() => onSync()}>
            {busy || locked ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </footer>
      </div>
    ) : (
      <form className="dialog-body" noValidate onSubmit={handleSubmit}>
        {view === 'pending' && <p>{cameFrom === 'register'
          ? 'Te enviamos un enlace para activar tu cuenta. Ábrelo en este equipo y luego vuelve para entrar.'
          : 'Tu cuenta aún no está confirmada. Escribe tu correo y te enviaremos un enlace para activarla.'}</p>}
        {view === 'forgot' && <p>Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p>}
        {needsName && <label className="name-field">{view === 'login' ? 'Correo o usuario' : 'Usuario'}
          <input name="username" data-autofocus autoComplete="username" required maxLength={view === 'login' ? 254 : 40} value={username} onChange={e => { setUsername(e.target.value); setFieldError('') }} aria-describedby={error ? errId : undefined} aria-invalid={/usuario/i.test(fieldError)} />
        </label>}
        {needsEmail && <label className="name-field">Correo
          <input name="email" type="email" data-autofocus={!needsName || undefined} autoComplete="email" required maxLength={254} value={email} onChange={e => { setEmail(e.target.value); setFieldError('') }} aria-describedby={error ? errId : undefined} aria-invalid={fieldError.startsWith('Correo')} />
        </label>}
        {needsPassword && <div className="name-field">
          <label htmlFor={passId}>Contraseña</label>
          <span className="password-field">
            <input id={passId} name="password" type={showPassword ? 'text' : 'password'} autoComplete={view === 'register' ? 'new-password' : 'current-password'} required maxLength={128} value={password} onChange={e => { setPassword(e.target.value); setFieldError('') }} aria-describedby={[view === 'register' && passHint, error && errId].filter(Boolean).join(' ') || undefined} aria-invalid={/contraseña/i.test(fieldError)} />
            <button type="button" className="tiny-button ghost" aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
          </span>
        </div>}
        {view === 'register' && <small id={passHint} className="field-hint">Mínimo 8 caracteres</small>}
        {view === 'login' && <button type="button" className="text-link" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={() => go('forgot')}>¿Olvidaste tu contraseña?</button>}
        {localMsg && <p className="account-feedback" role="status">{localMsg}</p>}
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>Ahora no</button>
          <button type="submit" className="button primary" disabled={busy}>{busy ? 'Conectando…' : submitLabel}</button>
        </footer>
        <p style={{ margin: 0, textAlign: 'center' }}>
          {switchLink[0]} <button type="button" className="text-link" disabled={busy} onClick={() => go(switchLink[2])}>{switchLink[1]}</button>
        </p>
      </form>
    )}
  </Dialog>
}
