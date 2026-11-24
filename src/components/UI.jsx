import { pageUrl } from '../app/routes'
import { useId, useEffect, useState } from 'react'
import { describeHand, getEngineState, HAND_LABELS } from '../data/engineStatus'
import { settingLabels } from '../data/gestures'
import { APPLY, APPLY_LABELS } from '../engine/engineApply'

const ASSETS = `${import.meta.env.BASE_URL}assets/`
const iconFiles = {
  logo: 'home-imgImg2',
  eye: 'home-imgImg',
  eyeOff: 'home-imgImg1',
  wand: 'home-imgImg3',
  kitchen: 'home-imgImg4',
  moon: 'home-imgImg5',
  grid: 'home-imgImg6',
  desk: 'home-imgImg7',
  bolt: 'home-imgImg8',
  check: 'home-imgImg9',
  assistance: 'home-imgImg10',
  target: 'home-imgImg11',
  plus: 'home-imgImg12',
  phone: 'home-imgImg13',
  chevron: 'home-imgImg14',
  tip: 'home-imgImg15',
  back: 'calibration-imgImg3',
  next: 'calibration-imgImg4',
  hand: 'calibration-imgImg1',
  stable: 'calibration-imgImg2',
  laptop: 'mobile-calibration-imgLaptop',
  mobileBack: 'mobile-calibration-imgImg',
  fullscreen: 'mobile-calibration-imgImg1',
  mobileHand: 'mobile-calibration-imgImg2',
  fist: 'mobile-calibration-imgImg4',
  mobileNext: 'mobile-imgSvg1',
  close: 'gesture-imgImg',
  pinch: 'gesture-imgImg1',
  testHand: 'gesture-imgImg2',
  ergonomic: 'ergonomic-imgImg',
  rest: 'ergonomic-imgImg1',
  pause: 'playground-imgImg1',
}

export function Icon({ name, className = '', muted = false }) {
  if (name === 'logo')
    return (
      <img
        className={`icon ${className}`}
        src={`${ASSETS}zerotouch-light.png`}
        width={25}
        height={20}
        style={{ objectFit: 'contain' }}
        alt=""
        aria-hidden="true"
      />
    )
  return (
    <img
      className={`icon ${className}`}
      src={`${ASSETS}${iconFiles[name] || name}${muted ? '-muted' : ''}.svg`}
      alt=""
      aria-hidden="true"
    />
  )
}

export function NavLink({ to, navigate, children, className = '', ...props }) {
  return (
    <a
      href={pageUrl(to)}
      className={className}
      {...props}
      onClick={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault()
          navigate(to)
        }
      }}
    >
      {children}
    </a>
  )
}

export function StatusBadge({ state, className = '' }) {
  return (
    <span className={`status-badge tone-${state.tone} ${className}`}>
      <i aria-hidden="true" />
      {state.label}
    </span>
  )
}

/** Panel principal de la cámara: estado + acciones, siempre en el mismo orden. */
export function EngineCard({
  engineStatus,
  engineBusy,
  onStartEngine,
  onStopEngine,
  onToggleControlMode,
  onTogglePause,
  hud,
  compact = false,
  headingLevel = 2,
}) {
  const state = getEngineState(engineStatus)
  const hand = describeHand(engineStatus)
  const Heading = `h${headingLevel}`
  const headingId = useId()
  const setMode = (mode) => {
    if ((engineStatus?.mode === 'CONTROL') !== (mode === 'CONTROL')) onToggleControlMode()
  }
  return (
    <section
      className={`engine-card panel tone-${state.tone} ${compact ? 'compact' : ''}`}
      aria-labelledby={headingId}
      aria-busy={engineBusy}
    >
      <div className="engine-summary">
        <span className="engine-icon" aria-hidden="true">
          {state.cameraOpen ? '📷' : '⏻'}
        </span>
        <div>
          <Heading id={headingId} className="engine-title">
            {state.label}
          </Heading>
          <p className="engine-hint">{state.hint}</p>
          {hand && <p className={`engine-hand ${state.handDetected ? 'ok' : ''}`}>{hand}</p>}
        </div>
      </div>
      <div className="engine-actions">
        {!state.running ? (
          <button
            type="button"
            className="button primary big"
            disabled={engineBusy}
            onClick={onStartEngine}
          >
            {engineBusy ? 'Activando…' : 'Activar cámara'}
          </button>
        ) : (
          <>
            {state.cameraOpen && (
              <div className="mode-switch" role="group" aria-label="Modo">
                <button
                  type="button"
                  aria-pressed={!state.control}
                  disabled={engineBusy}
                  onClick={() => setMode('OBSERVATION')}
                >
                  Observar
                </button>
                <button
                  type="button"
                  aria-pressed={state.control}
                  disabled={engineBusy}
                  onClick={() => setMode('CONTROL')}
                >
                  Controlar
                </button>
              </div>
            )}
            <div className="engine-secondary">
              {state.cameraOpen && onTogglePause && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={engineBusy}
                  onClick={onTogglePause}
                >
                  {engineStatus.paused ? 'Reanudar' : 'Pausar'}
                </button>
              )}
              <button
                type="button"
                className="button danger-text"
                disabled={engineBusy}
                onClick={onStopEngine}
              >
                Apagar cámara
              </button>
              {hud && (
                <button
                  type="button"
                  className="button secondary hud-toggle"
                  aria-pressed={hud.enabled}
                  onClick={hud.toggle}
                >
                  {hud.enabled ? 'Ocultar indicador flotante' : 'Mostrar indicador flotante'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {state.running && (
        <p className="kbd-hint">
          <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> detiene el control al instante
        </p>
      )}
    </section>
  )
}

export function HandSelectionOptions({ settings, onChange }) {
  const name = useId()
  const camId = useId()
  const currentHand = settings.preferredHand || 'RIGHT'
  const currentCam = Number.isFinite(settings.cameraIndex) ? settings.cameraIndex : 0
  return (
    <div className="hand-selection-group">
      <fieldset className="radio-pills">
        <legend>Mano que usarás</legend>
        <div>
          {Object.entries(HAND_LABELS).map(([code, label]) => (
            <label key={code} className={currentHand === code ? 'checked' : ''}>
              <input
                type="radio"
                name={name}
                value={code}
                checked={currentHand === code}
                onChange={() => onChange({ ...settings, preferredHand: code })}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field-row">
        <label htmlFor={camId}>Cámara</label>
        <select
          id={camId}
          className="compact-select"
          value={currentCam}
          onChange={(e) => onChange({ ...settings, cameraIndex: Number(e.target.value) })}
        >
          <option value={0}>Principal</option>
          <option value={1}>Segunda</option>
          <option value={2}>Tercera (externa)</option>
        </select>
      </div>
      <ToggleRow
        label="Vista espejo"
        checked={settings.mirrorCamera !== false}
        onChange={(mirrorCamera) => onChange({ ...settings, mirrorCamera })}
      />
      <ToggleRow
        label="Cursor con aceleración (lento = preciso)"
        checked={settings.pointerAcceleration !== false}
        onChange={(pointerAcceleration) => onChange({ ...settings, pointerAcceleration })}
      />
    </div>
  )
}

export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled }) {
  return (
    <button
      className={`switch ${checked ? 'on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function ToggleRow({ label, help, checked, onChange }) {
  const id = useId()
  return (
    <div className="toggle-row">
      <span>
        <span id={`${id}-l`}>{label}</span>
        {help && <small id={`${id}-h`}>{help}</small>}
      </span>
      <Switch
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-l`}
        describedBy={help ? `${id}-h` : undefined}
      />
    </div>
  )
}

export function RangeControl({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  description,
  minLabel,
  maxLabel,
}) {
  const id = useId()
  const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100)
  return (
    <div className="range-control">
      <div className="section-line">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{value}%</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        aria-describedby={description ? `${id}-d` : undefined}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--range-value': `${pct}%` }}
      />
      {(minLabel || maxLabel) && (
        <div className="range-ends" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
      {description && <small id={`${id}-d`}>{description}</small>}
    </div>
  )
}

/** Control deslizante a partir de la clave del parámetro (etiquetas sencillas centralizadas). */
export function SettingSlider({ name, settings, onChange, fallback = 50 }) {
  const meta = settingLabels[name]
  const [min, max] = meta.range || [0, 100]
  return (
    <RangeControl
      label={meta.label}
      description={meta.help}
      minLabel={meta.min}
      maxLabel={meta.max}
      min={min}
      max={max}
      value={settings[name] ?? fallback}
      onChange={(value) => onChange({ ...settings, [name]: value })}
    />
  )
}

export function AdvancedSettings({ settings, onChange }) {
  return (
    <div className="advanced-settings">
      <SettingSlider name="sensitivity" settings={settings} onChange={onChange} fallback={65} />
      <SettingSlider name="stability" settings={settings} onChange={onChange} fallback={40} />
      <SettingSlider name="movementArea" settings={settings} onChange={onChange} fallback={65} />
      <SettingSlider name="pinchTolerance" settings={settings} onChange={onChange} />
      <SettingSlider
        name="confidenceThreshold"
        settings={settings}
        onChange={onChange}
        fallback={65}
      />
      <ToggleRow
        label="Brazo apoyado (Desk-Rest)"
        help="Recorrido corto con el antebrazo en la mesa."
        checked={Boolean(settings.deskRest)}
        onChange={(deskRest) => onChange({ ...settings, deskRest })}
      />
      <ToggleRow
        label="Mostrar puntos de la mano"
        checked={settings.diagnosticOverlay !== false}
        onChange={(diagnosticOverlay) => onChange({ ...settings, diagnosticOverlay })}
      />
    </div>
  )
}

/** Estado de la configuración: guardada en este equipo y, si el motor está activo, aplicada o rechazada. */
export function ConfigStatus({ apply, onRetry, brief = false }) {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!brief || apply.state !== APPLY.APPLIED) return
    const timer = setTimeout(() => setExpired(true), 3000)
    return () => clearTimeout(timer)
  }, [brief, apply.state])
  if (brief && (apply.state === APPLY.NO_ENGINE || (apply.state === APPLY.APPLIED && expired)))
    return null
  const rejected = apply.state === APPLY.REJECTED
  return (
    <p className={`config-status tone-${apply.state}`} role={rejected ? 'alert' : 'status'}>
      <i aria-hidden="true" />
      <span>
        {APPLY_LABELS[apply.state]}
        {rejected && apply.message ? ` ${apply.message}` : ''}
      </span>
      {rejected && (
        <button type="button" className="tiny-button ghost" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </p>
  )
}
