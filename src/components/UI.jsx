import { useId } from 'react'
import { describeHand, getEngineState, HAND_LABELS, isGestureLive } from '../data/engineStatus'
import { GESTURE_HELP, gestureActionLabel, gestures, settingLabels } from '../data/gestures'
import { GESTURE_CODES, NO_ACTION, actionName, allowedActions, capabilities, gestureName } from '../data/capabilities'
import { APPLY, APPLY_LABELS } from '../engine/engineApply'

const ASSETS = `${import.meta.env.BASE_URL}assets/`
const iconFiles = { logo: 'home-imgImg2', eye: 'home-imgImg', eyeOff: 'home-imgImg1', wand: 'home-imgImg3', kitchen: 'home-imgImg4', moon: 'home-imgImg5', grid: 'home-imgImg6', desk: 'home-imgImg7', bolt: 'home-imgImg8', check: 'home-imgImg9', assistance: 'home-imgImg10', target: 'home-imgImg11', plus: 'home-imgImg12', phone: 'home-imgImg13', chevron: 'home-imgImg14', tip: 'home-imgImg15', back: 'calibration-imgImg3', next: 'calibration-imgImg4', hand: 'calibration-imgImg1', stable: 'calibration-imgImg2', laptop: 'mobile-calibration-imgLaptop', mobileBack: 'mobile-calibration-imgImg', fullscreen: 'mobile-calibration-imgImg1', mobileHand: 'mobile-calibration-imgImg2', fist: 'mobile-calibration-imgImg4', mobileNext: 'mobile-imgSvg1', close: 'gesture-imgImg', pinch: 'gesture-imgImg1', testHand: 'gesture-imgImg2', ergonomic: 'ergonomic-imgImg', rest: 'ergonomic-imgImg1', pause: 'playground-imgImg1' }

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

export function Icon({ name, className = '', muted = false }) {
  if (name === 'logo') return <img className={`icon ${className}`} src={`${ASSETS}zerotouch-dark.png`} width={25} height={20} style={{ objectFit: 'contain' }} alt="" aria-hidden="true" />
  return <img className={`icon ${className}`} src={`${ASSETS}${iconFiles[name] || name}${muted ? '-muted' : ''}.svg`} alt="" aria-hidden="true" />
}

export function NavLink({ to, navigate, children, className = '', ...props }) {
  return <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${to}`} className={className} {...props} onClick={event => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(to) }
  }}>{children}</a>
}

export function StatusBadge({ state, className = '' }) {
  return <span className={`status-badge tone-${state.tone} ${className}`}><i aria-hidden="true" />{state.label}</span>
}

export function Header({ path, navigate, engineStatus, account, onOpenAccount }) {
  const state = getEngineState(engineStatus)
  const accountName = account?.nombre_usuario || account?.username
  const links = [['/', 'Inicio'], ['/calibracion', 'Calibrar'], ['/teclado', 'Teclado']]
  return <>
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <header className="app-header">
      <NavLink to="/" navigate={navigate} className="brand" aria-label="ZeroTouch, inicio">
        <span className="brand-logo"><Icon name="logo" /></span><strong>ZEROTOUCH</strong>
      </NavLink>
      <nav className="main-nav" aria-label="Principal">
        {links.map(([to, label]) => <NavLink key={to} to={to} navigate={navigate} aria-current={path === to ? 'page' : undefined}>{label}</NavLink>)}
      </nav>
      <div className="header-status">
        <StatusBadge state={state} />
        <span className="sr-only" aria-live="polite">{`Estado: ${state.label}`}</span>
        <button type="button" className="account-button" onClick={() => onOpenAccount(false)} aria-label={accountName ? `Cuenta: ${accountName}` : 'Cuenta (opcional)'}>
          <span className="account-avatar" aria-hidden="true">{accountName ? accountName.slice(0, 1).toUpperCase() : <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg>}</span><span>{accountName || 'Cuenta'}</span>
        </button>
      </div>
    </header>
  </>
}

/** Panel principal de la cámara: estado + acciones, siempre en el mismo orden. */
export function EngineCard({ engineStatus, engineBusy, onStartEngine, onStopEngine, onToggleControlMode, onTogglePause, hud, compact = false, headingLevel = 2 }) {
  const state = getEngineState(engineStatus)
  const hand = describeHand(engineStatus)
  const Heading = `h${headingLevel}`
  const headingId = useId()
  const setMode = mode => { if ((engineStatus?.mode === 'CONTROL') !== (mode === 'CONTROL')) onToggleControlMode() }
  return <section className={`engine-card panel tone-${state.tone} ${compact ? 'compact' : ''}`} aria-labelledby={headingId} aria-busy={engineBusy}>
    <div className="engine-summary">
      <span className="engine-icon" aria-hidden="true">{state.cameraOpen ? '📷' : '⏻'}</span>
      <div>
        <Heading id={headingId} className="engine-title">{state.label}</Heading>
        <p className="engine-hint">{state.hint}</p>
        {hand && <p className={`engine-hand ${state.handDetected ? 'ok' : ''}`}>{hand}</p>}
      </div>
    </div>
    <div className="engine-actions">
      {!state.running ? (
        <button type="button" className="button primary big" disabled={engineBusy} onClick={onStartEngine}>
          {engineBusy ? 'Activando…' : 'Activar cámara'}
        </button>
      ) : <>
        {state.cameraOpen && <div className="mode-switch" role="group" aria-label="Modo">
          <button type="button" aria-pressed={!state.control} disabled={engineBusy} onClick={() => setMode('OBSERVATION')}>Observar</button>
          <button type="button" aria-pressed={state.control} disabled={engineBusy} onClick={() => setMode('CONTROL')}>Controlar</button>
        </div>}
        <div className="engine-secondary">
          {state.cameraOpen && onTogglePause && <button type="button" className="button secondary" disabled={engineBusy} onClick={onTogglePause}>{engineStatus.paused ? 'Reanudar' : 'Pausar'}</button>}
          <button type="button" className="button danger-text" disabled={engineBusy} onClick={onStopEngine}>Apagar cámara</button>
          {hud && <button type="button" className="button secondary hud-toggle" aria-pressed={hud.enabled} onClick={hud.toggle}>{hud.enabled ? 'Ocultar indicador flotante' : 'Mostrar indicador flotante'}</button>}
        </div>
      </>}
    </div>
    {state.running && <p className="kbd-hint"><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> detiene el control al instante</p>}
  </section>
}

export function HandSelectionOptions({ settings, onChange }) {
  const name = useId()
  const camId = useId()
  const currentHand = settings.preferredHand || 'RIGHT'
  const currentCam = Number.isFinite(settings.cameraIndex) ? settings.cameraIndex : 0
  return <div className="hand-selection-group">
    <fieldset className="radio-pills">
      <legend>Mano que usarás</legend>
      <div>
        {Object.entries(HAND_LABELS).map(([code, label]) => (
          <label key={code} className={currentHand === code ? 'checked' : ''}>
            <input type="radio" name={name} value={code} checked={currentHand === code} onChange={() => onChange({ ...settings, preferredHand: code })} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
    <div className="field-row">
      <label htmlFor={camId}>Cámara</label>
      <select id={camId} className="compact-select" value={currentCam} onChange={e => onChange({ ...settings, cameraIndex: Number(e.target.value) })}>
        <option value={0}>Principal</option>
        <option value={1}>Segunda</option>
        <option value={2}>Tercera (externa)</option>
      </select>
    </div>
    <ToggleRow label="Vista espejo" checked={settings.mirrorCamera !== false} onChange={mirrorCamera => onChange({ ...settings, mirrorCamera })} />
    <ToggleRow label="Cursor con aceleración (lento = preciso)" checked={settings.pointerAcceleration !== false} onChange={pointerAcceleration => onChange({ ...settings, pointerAcceleration })} />
  </div>
}

export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled }) {
  return <button className={`switch ${checked ? 'on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
}

export function ToggleRow({ label, help, checked, onChange }) {
  const id = useId()
  return <div className="toggle-row">
    <span><span id={`${id}-l`}>{label}</span>{help && <small id={`${id}-h`}>{help}</small>}</span>
    <Switch checked={checked} onChange={onChange} labelledBy={`${id}-l`} describedBy={help ? `${id}-h` : undefined} />
  </div>
}

export function RangeControl({ label, value, onChange, min = 0, max = 100, description, minLabel, maxLabel }) {
  const id = useId()
  const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100)
  return <div className="range-control">
    <div className="section-line"><label htmlFor={id}>{label}</label><output htmlFor={id}>{value}%</output></div>
    <input id={id} type="range" min={min} max={max} value={value} aria-describedby={description ? `${id}-d` : undefined} aria-valuetext={`${value}%`} onChange={event => onChange(Number(event.target.value))} style={{ '--range-value': `${pct}%` }} />
    {(minLabel || maxLabel) && <div className="range-ends" aria-hidden="true"><span>{minLabel}</span><span>{maxLabel}</span></div>}
    {description && <small id={`${id}-d`}>{description}</small>}
  </div>
}

/** Control deslizante a partir de la clave del parámetro (etiquetas sencillas centralizadas). */
export function SettingSlider({ name, settings, onChange, fallback = 50 }) {
  const meta = settingLabels[name]
  const [min, max] = meta.range || [0, 100]
  return <RangeControl label={meta.label} description={meta.help} minLabel={meta.min} maxLabel={meta.max} min={min} max={max} value={settings[name] ?? fallback} onChange={value => onChange({ ...settings, [name]: value })} />
}

export function AdvancedSettings({ settings, onChange }) {
  return <div className="advanced-settings">
    <SettingSlider name="sensitivity" settings={settings} onChange={onChange} fallback={65} />
    <SettingSlider name="stability" settings={settings} onChange={onChange} fallback={40} />
    <SettingSlider name="movementArea" settings={settings} onChange={onChange} fallback={65} />
    <SettingSlider name="pinchTolerance" settings={settings} onChange={onChange} />
    <SettingSlider name="confidenceThreshold" settings={settings} onChange={onChange} fallback={65} />
    <ToggleRow label="Brazo apoyado (Desk-Rest)" help="Recorrido corto con el antebrazo en la mesa." checked={Boolean(settings.deskRest)} onChange={deskRest => onChange({ ...settings, deskRest })} />
    <ToggleRow label="Mostrar puntos de la mano" checked={settings.diagnosticOverlay !== false} onChange={diagnosticOverlay => onChange({ ...settings, diagnosticOverlay })} />
  </div>
}

/** Estado de la configuración: guardada en este equipo y, si el motor está activo, aplicada o rechazada. */
export function ConfigStatus({ apply, onRetry }) {
  const rejected = apply.state === APPLY.REJECTED
  return <p className={`config-status tone-${apply.state}`} role={rejected ? 'alert' : 'status'}>
    <i aria-hidden="true" />
    <span>{APPLY_LABELS[apply.state]}{rejected && apply.message ? ` ${apply.message}` : ''}</span>
    {rejected && <button type="button" className="tiny-button ghost" onClick={onRetry}>Reintentar</button>}
  </p>
}

/**
 * Editor de asignaciones gesto → acción del modo activo. Solo ofrece las acciones que el contrato
 * permite para cada gesto; encender un gesto que estaba sin acción restaura su acción predeterminada.
 */
export function AssignmentEditor({ assignments, onChange, disabled = false }) {
  return <ul className="assignment-list">
    {GESTURE_CODES.map(code => {
      const item = assignments[code]
      const options = allowedActions(code)
      const active = item.habilitado && item.accion !== NO_ACTION
      const hasSwitch = Boolean(capabilities.gestos[code].interruptor)
      const choosable = options.length > 2
      return <li key={code} className={`assignment-item ${active ? '' : 'off'}`}>
        <span className="assignment-text">
          <strong>{gestureName(code)}</strong>
          <small>{active ? actionName(item.accion) : (hasSwitch ? 'Apagado' : 'Siempre activo')}</small>
          {GESTURE_HELP[code] && <small className="assignment-help">{GESTURE_HELP[code]}</small>}
          {active && capabilities.acciones[item.accion]?.efecto && choosable && <small className="assignment-effect">Efecto: {capabilities.acciones[item.accion].efecto}</small>}
        </span>
        {choosable && <select className="compact-select" aria-label={`Acción de ${gestureName(code)}`} disabled={disabled} value={item.accion} onChange={event => onChange(code, { accion: event.target.value })}>
          {options.map(option => <option key={option} value={option}>{actionName(option)}</option>)}
        </select>}
        {hasSwitch && <Switch checked={active} disabled={disabled} onChange={value => onChange(code, { toggle: value })} label={`Activar ${gestureName(code).toLowerCase()}`} />}
      </li>
    })}
  </ul>
}

/** Lista de gestos reales con su estado en vivo. */
export function GestureList({ engineStatus, settings, assignments, onOpen, onToggle }) {
  const running = Boolean(engineStatus?.running && engineStatus?.cameraOpen)
  const ordered = Object.entries(gestures).sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99))
  const renderGesture = ([id, g]) => {
      const enabled = !g.toggle || settings?.[g.toggle] !== false
      const live = enabled && isGestureLive(id, engineStatus)
      const badge = !enabled ? 'Apagado' : live ? 'Detectado' : running ? 'Listo' : ''
      return <li key={id} className={`gesture-item ${live ? 'live' : ''} ${enabled ? '' : 'disabled'}`}>
        <button type="button" className="gesture-open" onClick={() => onOpen(id)} aria-label={`${gestureActionLabel(id, assignments)}: ${g.title}. Ajustar`}>
          <span className="emoji-icon" aria-hidden="true">{g.emoji}</span>
          <span className="gesture-text"><strong>{gestureActionLabel(id, assignments)}</strong><small>{g.title}</small></span>
          {badge && <span className={`gesture-badge ${live ? 'live' : ''}`}>{live && <i aria-hidden="true">✓ </i>}{badge}</span>}
          <Icon name="chevron" />
        </button>
        {g.toggle && onToggle && <Switch checked={enabled} onChange={value => onToggle(g.toggle, value)} label={`Activar ${gestureActionLabel(id, assignments).toLowerCase()}`} />}
      </li>
  }
  const frequent = ordered.filter(([, g]) => g.common)
  const occasional = ordered.filter(([, g]) => !g.common)
  return <ul className="gesture-list">
    <li className="gesture-group" role="presentation"><small>Más usados</small></li>
    {frequent.map(renderGesture)}
    {occasional.length > 0 && <li className="gesture-group" role="presentation"><small>Otros gestos</small></li>}
    {occasional.map(renderGesture)}
  </ul>
}

function LiveDiagnosticOverlay({ engineStatus }) {
  const bounds = engineStatus?.activeBounds?.length === 4 ? engineStatus.activeBounds : [0.18, 0.82, 0.24, 0.84]
  const [xMin, xMax, yMin, yMax] = bounds
  const lms = Array.isArray(engineStatus?.landmarks) ? engineStatus.landmarks : []
  const hasHand = Boolean(engineStatus?.handDetected && lms.length >= 21)
  return <svg className="live-diagnostic-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <rect x={xMin * 100} y={yMin * 100} width={(xMax - xMin) * 100} height={(yMax - yMin) * 100} rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.6)" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
    {hasHand && <>
      {HAND_CONNECTIONS.map(([a, b], idx) => {
        const pa = lms[a], pb = lms[b]
        if (!pa || !pb) return null
        return <line key={idx} x1={pa[0] * 100} y1={pa[1] * 100} x2={pb[0] * 100} y2={pb[1] * 100} stroke="#9DB5A4" strokeWidth="0.7" strokeLinecap="round" />
      })}
      {lms.map((pt, idx) => <circle key={idx} cx={pt[0] * 100} cy={pt[1] * 100} r={idx === 4 || idx === 8 ? 1.35 : 0.85} fill={idx === 4 || idx === 8 ? '#FFFFFF' : '#E2DAD3'} stroke="#5F4D47" strokeWidth="0.3" />)}
      <circle cx={(engineStatus.cursorX ?? 0.5) * 100} cy={(engineStatus.cursorY ?? 0.5) * 100} r="1.9" fill={engineStatus.mode === 'CONTROL' ? '#748D7C' : '#BDB3AA'} stroke="#FFFFFF" strokeWidth="0.5" />
    </>}
  </svg>
}

/**
 * Vista del sensor. El motor no envía imagen de video, solo puntos de la mano;
 * por eso se muestra un lienzo neutro y no una fotografía que simule la cámara.
 */
export function CameraView({ engineStatus, showDiagnostic = true, engineBusy, onStartEngine }) {
  const state = getEngineState(engineStatus)
  const hand = describeHand(engineStatus)
  const summary = state.cameraOpen ? `${state.label}. ${hand}` : state.label
  return <figure className={`camera-view tone-${state.tone}`}>
    <figcaption className="sr-only">{`Vista del sensor: ${summary}`}</figcaption>
    {state.cameraOpen ? <>
      {showDiagnostic && <LiveDiagnosticOverlay engineStatus={engineStatus} />}
      <StatusBadge state={state} className="on-dark" />
      <span className={`camera-caption ${state.handDetected ? 'ok' : ''}`}>{state.handDetected ? hand : 'Coloca la mano dentro del recuadro'}</span>
    </> : <div className="camera-empty">
      <span aria-hidden="true">✋</span>
      <strong>{state.label}</strong>
      <small>{state.key === 'off' ? 'Aquí verás tu mano en tiempo real.' : state.hint}</small>
      {onStartEngine && !state.running && <button type="button" className="button light" disabled={engineBusy} onClick={onStartEngine}>{engineBusy ? 'Activando…' : 'Activar cámara'}</button>}
    </div>}
  </figure>
}
