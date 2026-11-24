import { loadState } from '../data/preferences'
import SyncConflicts from './SyncConflicts'
import { useEffect, useId, useRef, useState } from 'react'
import { Dialog, DialogHeader } from './DialogFrame'

// Diálogo de cuenta con el flujo habitual: entrar (correo o usuario), crear cuenta, confirmar el
// correo y recuperar la contraseña. La confirmación ocurre en el backend: el enlace del correo abre
// /cuenta/verificar o /cuenta/restablecer en el navegador.
const ACCOUNT_TITLES = {
  login: 'Entrar',
  register: 'Crear cuenta',
  pending: 'Confirma tu correo',
  forgot: 'Recuperar contraseña',
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const validEmail = (value) => value.length >= 6 && value.length <= 254 && EMAIL_PATTERN.test(value)
const validUsername = (value) => /^[a-zA-Z0-9_]{3,40}$/.test(value)

// Copia explícita de los modos de invitado a la cuenta: nunca ocurre sola al iniciar sesión.
function ImportGuest({ disabled, onImport }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming)
    return (
      <button
        type="button"
        className="text-link"
        style={{ alignSelf: 'flex-start' }}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Copiar mis ajustes de invitado a esta cuenta
      </button>
    )
  return (
    <span className="confirm-inline" role="group" aria-label="Copiar ajustes de invitado">
      <span>¿Copiar? Se subirán al sincronizar.</span>
      <button
        type="button"
        className="tiny-button"
        onClick={() => {
          onImport()
          setConfirming(false)
        }}
        autoFocus
      >
        Sí
      </button>
      <button type="button" className="tiny-button ghost" onClick={() => setConfirming(false)}>
        No
      </button>
    </span>
  )
}

export function OptionalAccountDialog({
  initialRegister = false,
  account,
  summary,
  syncWarning,
  report,
  outcomeText,
  locked = false,
  busy,
  onLogin,
  onRegister,
  onAccountAction,
  onLogout,
  onSync,
  onCancelDelete,
  onImportGuest,
  onClearWarning,
  onClose,
}) {
  const titleId = useId(),
    passHint = useId(),
    errId = useId(),
    passId = useId()
  const [guestModes] = useState(() => loadState(null)?.modes.length || 0)
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
  useEffect(
    () => () => {
      pendingCreds.current = null
    },
    [],
  )
  const accountName = account?.nombre_usuario || account?.username
  const needsName = view === 'login' || view === 'register'
  const needsEmail = view !== 'login'
  const needsPassword = view === 'login' || view === 'register'

  function go(next) {
    if (next !== 'pending') pendingCreds.current = null
    // Un correo escrito en "Correo o usuario" pasa al campo Correo, no al de Usuario.
    if (next !== 'login' && username.includes('@')) {
      setEmail((current) => current || username.trim())
      setUsername('')
    }
    setView(next)
    setLocalMsg('')
    setFieldError('')
    setPassword('')
    onClearWarning?.()
  }
  function awaitConfirmation(creds, origin) {
    pendingCreds.current = creds
    setCameFrom(origin)
    setView('pending')
    setLocalMsg('')
    onClearWarning?.()
  }

  function validate(name, mail) {
    if (view === 'login') {
      if (!name) return 'Escribe tu correo o usuario.'
      if (name.includes('@') ? !validEmail(name) : !validUsername(name))
        return 'Revisa el correo o usuario.'
      return password ? '' : 'Escribe tu contraseña.'
    }
    if (view === 'register' && !validUsername(name))
      return 'Usuario: de 3 a 40 letras, números o _.'
    if (!validEmail(mail)) return 'Correo: escribe una dirección válida.'
    if (view === 'register' && [...password].length < 8) return 'Contraseña: mínimo 8 caracteres.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLocalMsg('')
    const name = username.trim(),
      mail = email.trim()
    const problem = validate(name, mail)
    if (problem) {
      setFieldError(problem)
      return
    }
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
      if (result?.ok)
        setLocalMsg(
          'Listo. Si el correo es correcto, te llegará un enlace nuevo en unos minutos. Revisa también la carpeta de spam.',
        )
      return
    }
    const result = await onAccountAction?.('recuperar', { correo: mail })
    if (result?.ok)
      setLocalMsg(
        'Si ese correo pertenece a una cuenta, te enviamos un enlace para crear una contraseña nueva.',
      )
  }

  const error = fieldError || syncWarning
  const submitLabel = {
    login: 'Entrar',
    register: 'Crear cuenta',
    pending: 'Reenviar enlace',
    forgot: 'Enviar enlace',
  }[view]
  const switchLink = {
    login: ['¿No tienes cuenta?', 'Crear cuenta', 'register'],
    register: ['¿Ya tienes cuenta?', 'Entrar', 'login'],
    pending: ['¿Ya la confirmaste?', 'Entrar', 'login'],
    forgot: ['¿La recordaste?', 'Entrar', 'login'],
  }[view]
  return (
    <Dialog onClose={onClose} titleId={titleId} className="account-dialog">
      <DialogHeader
        id={titleId}
        title={accountName ? 'Tu cuenta' : ACCOUNT_TITLES[view]}
        subtitle={
          !account && view === 'register' ? 'Sincroniza tus modos entre equipos.' : undefined
        }
        onClose={onClose}
      />
      {error && (
        <p id={errId} className="field-error" role="alert">
          {error}
        </p>
      )}
      {accountName ? (
        <div className="dialog-body">
          <p className="account-name">
            <strong>{accountName}</strong>
            <small className={`sync-tone sync-${summary?.tone}`}>{summary?.text}</small>
          </p>
          {localMsg && (
            <p className="account-feedback" role="status">
              {localMsg}
            </p>
          )}
          {report && outcomeText && (
            <p
              className={`account-feedback sync-result ${report.ok ? 'ok' : 'attention'}`}
              role="status"
            >
              {outcomeText}
            </p>
          )}
          {report?.conflicts?.length > 0 && (
            <SyncConflicts
              key={report.at}
              conflicts={report.conflicts}
              busy={busy || locked}
              onApply={onSync}
              onCancelDelete={onCancelDelete}
            />
          )}
          {guestModes > 0 && <ImportGuest disabled={busy || locked} onImport={onImportGuest} />}
          <footer className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || locked}
              onClick={onLogout}
            >
              Cerrar sesión
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || locked}
              onClick={() => onSync()}
            >
              {busy || locked ? 'Sincronizando…' : 'Sincronizar'}
            </button>
          </footer>
        </div>
      ) : (
        <form className="dialog-body" noValidate onSubmit={handleSubmit}>
          {view === 'pending' && (
            <p>
              {cameFrom === 'register'
                ? 'Te enviamos un enlace para activar tu cuenta. Ábrelo en este equipo y luego vuelve para entrar.'
                : 'Tu cuenta aún no está confirmada. Escribe tu correo y te enviaremos un enlace para activarla.'}
            </p>
          )}
          {view === 'forgot' && (
            <p>
              Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña
              nueva.
            </p>
          )}
          {needsName && (
            <label className="name-field">
              {view === 'login' ? 'Correo o usuario' : 'Usuario'}
              <input
                name="username"
                data-autofocus
                autoComplete="username"
                required
                maxLength={view === 'login' ? 254 : 40}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setFieldError('')
                }}
                aria-describedby={error ? errId : undefined}
                aria-invalid={/usuario/i.test(fieldError)}
              />
            </label>
          )}
          {needsEmail && (
            <label className="name-field">
              Correo
              <input
                name="email"
                type="email"
                data-autofocus={!needsName || undefined}
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setFieldError('')
                }}
                aria-describedby={error ? errId : undefined}
                aria-invalid={fieldError.startsWith('Correo')}
              />
            </label>
          )}
          {needsPassword && (
            <div className="name-field">
              <label htmlFor={passId}>Contraseña</label>
              <span className="password-field">
                <input
                  id={passId}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setFieldError('')
                  }}
                  aria-describedby={
                    [view === 'register' && passHint, error && errId].filter(Boolean).join(' ') ||
                    undefined
                  }
                  aria-invalid={/contraseña/i.test(fieldError)}
                />
                <button
                  type="button"
                  className="tiny-button ghost"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </span>
            </div>
          )}
          {view === 'register' && (
            <small id={passHint} className="field-hint">
              Mínimo 8 caracteres
            </small>
          )}
          {view === 'login' && (
            <button
              type="button"
              className="text-link"
              style={{ alignSelf: 'flex-end' }}
              disabled={busy}
              onClick={() => go('forgot')}
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}
          {localMsg && (
            <p className="account-feedback" role="status">
              {localMsg}
            </p>
          )}
          <footer className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Ahora no
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Conectando…' : submitLabel}
            </button>
          </footer>
          <p style={{ margin: 0, textAlign: 'center' }}>
            {switchLink[0]}{' '}
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => go(switchLink[2])}
            >
              {switchLink[1]}
            </button>
          </p>
        </form>
      )}
    </Dialog>
  )
}
