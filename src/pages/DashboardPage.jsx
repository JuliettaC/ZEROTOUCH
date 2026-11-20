import { useId, useState } from 'react'
import { CATEGORY_ICON, presets } from '../data/preferences'
import { ConfigStatus, EngineCard, GestureList, Icon, NavLink } from '../components/UI'
import { ToolsPanel } from '../components/AppTools'

// Textos breves para elegir modo de un vistazo (las descripciones completas siguen en preferences.js).
const PRESET_SUMMARY = {
  kitchen: 'Mano a media distancia',
  desk: 'Antebrazo apoyado, movimientos cortos',
  assistance: 'Más estable ante temblores',
}
const CATEGORY_LABEL = { manual: 'Manos ocupadas', oficina: 'Oficina', accesibilidad: 'Accesibilidad', personalizado: 'Personalizado' }

function ModeOption({ name, value, checked, disabled, onSelect, icon, title, summary, status, children }) {
  return <div className={`mode-option ${checked ? 'checked' : ''}`}>
    <label>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="context-icon" aria-hidden="true">{icon}</span>
      <span className="mode-text"><strong>{title}</strong>{summary && <small>{summary}</small>}</span>
      {status && <span className="sync-chip">{status}</span>}
      {checked && <span className="mode-check" aria-hidden="true">✓</span>}
    </label>
    {children}
  </div>
}

function ConfirmDelete({ label, note, disabled, onConfirm }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) return <button type="button" className="icon-button" disabled={disabled} onClick={() => setConfirming(true)} aria-label={`Eliminar ${label}`}>✕</button>
  return <span className="confirm-inline" role="group" aria-label={`¿Eliminar ${label}?`} title={note}>
    <span>¿Eliminar aquí?</span>
    <button type="button" className="tiny-button danger" onClick={onConfirm} autoFocus>Sí</button>
    <button type="button" className="tiny-button ghost" onClick={() => setConfirming(false)}>No</button>
  </span>
}

const modeStatus = mode => (mode.version === null ? 'Sin subir' : mode.dirty ? 'Cambios sin subir' : '')

export default function DashboardPage({
  view, settings, assignments, locked, apply, onRetryApply, syncSummary, account,
  onSelectProfile, onSelectMode, onDeleteMode, onDeleteProfile, openModal, navigate,
  engineStatus, engineBusy, onStartEngine, onStopEngine, onToggleControlMode, onTogglePause, hud,
  tools, onChangeTimerMinutes,
}) {
  const radioName = useId()
  const profileId = useId()
  const { profiles, activeProfile, modes, activeModeId, tombstones } = view
  return <main id="main" tabIndex={-1} className="page home-page">
    <h1 className="sr-only">Inicio</h1>
    <EngineCard engineStatus={engineStatus} engineBusy={engineBusy} onStartEngine={onStartEngine} onStopEngine={onStopEngine} onToggleControlMode={onToggleControlMode} onTogglePause={onTogglePause} hud={hud} />
    <div className="save-status-line">
      <ConfigStatus apply={apply} onRetry={onRetryApply} />
      <p className={`sync-summary sync-${syncSummary.tone}`}>{account ? 'Cuenta: ' : ''}{syncSummary.text}</p>
    </div>

    <div className="home-grid">
      <section className="panel" aria-labelledby="modes-title">
        <div className="section-line"><h2 id="modes-title">Modo de uso</h2>
          <button type="button" className="text-link" disabled={locked || !activeProfile} onClick={() => openModal({ type: 'context' })}><span aria-hidden="true">＋</span> Nuevo modo</button>
        </div>

        <div className="profile-bar">
          {activeProfile ? <>
            <label htmlFor={profileId}>Perfil</label>
            <select id={profileId} className="compact-select" value={activeProfile.id} disabled={locked} onChange={event => onSelectProfile(event.target.value)}>
              {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.nombre}</option>)}
            </select>
            <button type="button" className="text-link" disabled={locked} onClick={() => openModal({ type: 'profile', profile: activeProfile })}>Editar</button>
            <ConfirmDelete label={`el perfil ${activeProfile.nombre}`} disabled={locked} note="Se quita de este equipo y de tu cuenta al sincronizar, solo si no cambió en otro equipo (con todos sus modos)." onConfirm={() => onDeleteProfile(activeProfile.id)} />
          </> : <p className="empty-note">No hay ningún perfil.</p>}
          <button type="button" className="text-link" disabled={locked} onClick={() => openModal({ type: 'profile' })}><span aria-hidden="true">＋</span> Nuevo perfil</button>
        </div>

        {activeProfile && modes.length === 0 && <p className="empty-note">Este perfil no tiene modos. Crea uno con «Nuevo modo».</p>}
        {modes.length > 0 && <fieldset className="mode-list">
          <legend className="sr-only">Elige un modo de uso</legend>
          {modes.map(mode => {
            const preset = mode.plantilla ? presets[mode.plantilla] : null
            const icon = preset ? <Icon name={preset.icon} /> : CATEGORY_ICON[mode.categoria] === 'star' ? <span className="custom-glyph">★</span> : <Icon name={CATEGORY_ICON[mode.categoria]} />
            return <ModeOption key={mode.id} name={radioName} value={mode.id} checked={activeModeId === mode.id} disabled={locked} onSelect={() => onSelectMode(mode.id)} icon={icon} title={mode.nombre} summary={(mode.plantilla && PRESET_SUMMARY[mode.plantilla]) || CATEGORY_LABEL[mode.categoria]} status={account ? modeStatus(mode) : ''}>
              <button type="button" className="icon-button" disabled={locked} onClick={() => openModal({ type: 'context', mode })} aria-label={`Editar ${mode.nombre}`} title="Cambiar nombre o categoría">✎</button>
              <ConfirmDelete label={mode.nombre} disabled={locked} note="Se quita de este equipo y, si ya estaba sincronizado, de tu cuenta al sincronizar, solo si no cambió en otro equipo." onConfirm={() => onDeleteMode(mode.id)} />
            </ModeOption>
          })}
        </fieldset>}
        {account && tombstones > 0 && <p className="pending-note" role="status">{tombstones} elemento{tombstones === 1 ? '' : 's'} eliminado{tombstones === 1 ? '' : 's'} aquí se quitará{tombstones === 1 ? '' : 'n'} de tu cuenta al sincronizar, solo si no cambió en otro equipo.</p>}
      </section>

      <section className="panel" aria-labelledby="gestures-title">
        <div className="section-line"><h2 id="gestures-title">Gestos</h2>
          <NavLink to="/calibracion" navigate={navigate} className="text-link">Calibrar <Icon name="chevron" /></NavLink>
        </div>
        <GestureList engineStatus={engineStatus} settings={settings} assignments={assignments} onOpen={gesture => openModal({ type: 'gesture', gesture })} />
      </section>

      {tools && <ToolsPanel tools={tools} minutes={settings.timerMinutes ?? 5} onChangeMinutes={onChangeTimerMinutes} assignments={assignments} navigate={navigate}
        controlActive={engineStatus.mode === 'CONTROL' && !engineStatus.emergencyStopped} />}
    </div>
  </main>
}
