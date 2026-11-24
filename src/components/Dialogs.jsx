import { useId, useRef, useState } from 'react'
import { SettingSlider, ToggleRow } from './UI'
import { gestureActionLabel, gestures } from '../data/gestures'
import { getEngineState, isGestureLive } from '../data/engineStatus'
import { actionName, allowedActions, capabilities, NO_ACTION } from '../data/capabilities'
import GestureMedia from './GestureMedia'
import { Dialog, DialogHeader } from './DialogFrame'

const nameKey = (value) => String(value).trim().normalize('NFC').toLowerCase()

const CATEGORY_OPTIONS = [
  ['personalizado', 'Personalizado'],
  ['manual', 'Manos ocupadas (cocina, taller)'],
  ['oficina', 'Oficina / escritorio'],
  ['accesibilidad', 'Accesibilidad'],
]

/** Crear un modo o, con `mode`, cambiarle el nombre y la categoría (los ajustes finos están en Calibrar). */
export function ContextEditorDialog({ mode = null, onClose, onSave, existingNames = [] }) {
  const titleId = useId(),
    errorId = useId(),
    categoryId = useId()
  const [form, setForm] = useState({
    name: mode?.nombre ?? '',
    categoria: mode?.categoria ?? 'personalizado',
    sensitivity: 65,
    stability: 40,
    pinchTolerance: 50,
    pinch: true,
    scroll: true,
  })
  const [error, setError] = useState('')
  const input = useRef(null)
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))
  function submit(event) {
    event.preventDefault()
    const name = form.name.trim()
    const message = !name
      ? 'Escribe un nombre.'
      : existingNames.some((n) => nameKey(n) === nameKey(name))
        ? 'Ya existe un modo con ese nombre en este perfil.'
        : ''
    if (message) {
      setError(message)
      input.current?.focus()
      return
    }
    if (mode) onSave({ nombre: name, categoria: form.categoria })
    else
      onSave({
        nombre: name,
        categoria: form.categoria,
        settings: { sensitivity: form.sensitivity, stability: form.stability },
        toggles: { pinch: form.pinch, scroll: form.scroll },
      })
  }
  return (
    <Dialog onClose={onClose} titleId={titleId} className="context-dialog">
      <form noValidate onSubmit={submit}>
        <DialogHeader id={titleId} title={mode ? 'Editar modo' : 'Nuevo modo'} onClose={onClose} />
        <div className="dialog-body">
          <label className="name-field">
            Nombre
            <input
              ref={input}
              data-autofocus
              autoFocus
              maxLength={60}
              value={form.name}
              placeholder="Ej.: Presentaciones"
              onChange={(event) => {
                update({ name: event.target.value })
                setError('')
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              required
            />
          </label>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <details open={mode ? true : undefined}>
            <summary>Personalizar modo</summary>
            <label className="name-field" htmlFor={categoryId}>
              Categoría
            </label>
            <select
              id={categoryId}
              className="compact-select"
              value={form.categoria}
              onChange={(event) => update({ categoria: event.target.value })}
            >
              {CATEGORY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {!mode && (
              <>
                <SettingSlider name="sensitivity" settings={form} onChange={setForm} />
                <SettingSlider name="stability" settings={form} onChange={setForm} />
                <ToggleRow
                  label="Clic con pinza"
                  checked={form.pinch}
                  onChange={(pinch) => update({ pinch })}
                />
                <ToggleRow
                  label="Desplazar con dos dedos"
                  checked={form.scroll}
                  onChange={(scroll) => update({ scroll })}
                />
              </>
            )}
          </details>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit">
            {mode ? 'Guardar' : 'Crear modo'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

export function ProfileDialog({ profile = null, existingNames = [], onClose, onSave }) {
  const titleId = useId(),
    errorId = useId()
  const [name, setName] = useState(profile?.nombre ?? '')
  const [description, setDescription] = useState(profile?.descripcion ?? '')
  const [error, setError] = useState('')
  const input = useRef(null)
  function submit(event) {
    event.preventDefault()
    const clean = name.trim()
    const message = !clean
      ? 'Escribe un nombre.'
      : existingNames.some((n) => nameKey(n) === nameKey(clean))
        ? 'Ya existe un perfil con ese nombre.'
        : ''
    if (message) {
      setError(message)
      input.current?.focus()
      return
    }
    onSave({ nombre: clean, descripcion: description.trim() })
  }
  return (
    <Dialog onClose={onClose} titleId={titleId} className="context-dialog">
      <form noValidate onSubmit={submit}>
        <DialogHeader
          id={titleId}
          title={profile ? 'Editar perfil' : 'Nuevo perfil'}
          subtitle="Un perfil agrupa los modos de uso que quieres sincronizar."
          onClose={onClose}
        />
        <div className="dialog-body">
          <label className="name-field">
            Nombre
            <input
              ref={input}
              data-autofocus
              autoFocus
              maxLength={60}
              value={name}
              placeholder="Ej.: Cocina de casa"
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              required
            />
          </label>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <label className="name-field">
            Descripción (opcional)
            <input
              maxLength={300}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit">
            {profile ? 'Guardar' : 'Crear perfil'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

export function GestureCalibrationDialog({
  gesture = 'click',
  engineStatus,
  engineBusy,
  settings,
  assignments,
  onUpdateSettings,
  onAssign,
  locked,
  onStartEngine,
  onClose,
}) {
  const titleId = useId()
  const item = gestures[gesture] || gestures.click
  const [saved, setSaved] = useState(false)
  const assignment = assignments?.[item.code]
  const options = item.code ? allowedActions(item.code) : []
  function changed(result) {
    setSaved(Boolean(result?.ok))
  }
  const state = getEngineState(engineStatus)
  const enabled = !item.toggle || settings?.[item.toggle] !== false
  const live = enabled && isGestureLive(gesture, engineStatus)
  const feedback = !enabled
    ? 'Este gesto está apagado.'
    : !state.cameraOpen
      ? 'Activa la cámara para probarlo.'
      : !state.handDetected
        ? 'Muestra tu mano a la cámara.'
        : live
          ? '¡Detectado!'
          : item.live === false
            ? 'Este gesto se comprueba al usarlo en la aplicación.'
            : 'Haz el gesto ahora.'
  return (
    <Dialog onClose={onClose} titleId={titleId} className="gesture-dialog">
      <DialogHeader
        id={titleId}
        title={gestureActionLabel(gesture in gestures ? gesture : 'click', assignments)}
        subtitle={item.title}
        onClose={onClose}
      />
      <div className="dialog-body">
        <div className={`gesture-live ${live ? 'ok' : ''}`}>
          <GestureMedia id={gesture} size="md" />
          <div>
            <p className="gesture-how">{item.instruction}</p>
            <p className="gesture-feedback" role="status">
              {live && <span aria-hidden="true">✓ </span>}
              {feedback}
            </p>
          </div>
        </div>
        {!state.running && onStartEngine && (
          <button
            type="button"
            className="button secondary full"
            disabled={engineBusy}
            onClick={onStartEngine}
          >
            {engineBusy ? 'Activando…' : 'Activar cámara'}
          </button>
        )}
        <fieldset className="gesture-options" disabled={locked}>
          {item.toggle && (
            <ToggleRow
              label="Gesto activado"
              checked={enabled}
              onChange={(value) => changed(onUpdateSettings({ ...settings, [item.toggle]: value }))}
            />
          )}
          {assignment && options.length > 2 && (
            <label className="name-field">
              Acción
              <select
                className="compact-select"
                value={enabled ? assignment.accion : NO_ACTION}
                onChange={(event) => changed(onAssign(item.code, { accion: event.target.value }))}
              >
                {options.map((code) => (
                  <option key={code} value={code}>
                    {actionName(code)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {enabled && options.length > 2 && (
            <small>{capabilities.acciones[assignment?.accion]?.efecto}</small>
          )}
          {settings && onUpdateSettings && item.setting && (
            <SettingSlider
              name={item.setting}
              settings={settings}
              onChange={(next) => changed(onUpdateSettings(next))}
            />
          )}
        </fieldset>
        {saved && (
          <p className="autosave" role="status">
            Cambios guardados en este equipo.
          </p>
        )}
      </div>
      <footer className="dialog-actions">
        <button type="button" className="button primary" onClick={onClose}>
          Cerrar
        </button>
      </footer>
    </Dialog>
  )
}
