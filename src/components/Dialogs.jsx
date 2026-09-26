import { useEffect, useRef, useState } from 'react'
import { ErgonomicControls, Icon, RangeControl, Switch } from './UI'
function Dialog({ children, onClose, className, title }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current, trigger = document.activeElement
    dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; trigger?.focus() }
  }, [])
  return <dialog ref={ref} className={`dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) { const box = ref.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose() } }}>{children}</dialog>
}
export function ContextEditorDialog({ mobile, onClose, onSave }) {
  const [form, setForm] = useState({ name: mobile ? 'Modo Multimedia' : 'Modo Presentación y Sala', sensitivity: 65, stability: 40, pinch: true, scroll: true })
  const [error, setError] = useState('')
  const update = patch => setForm(current => ({ ...current, ...patch }))
  return <Dialog onClose={onClose} title="Configurar Nuevo Contexto" className="context-dialog"><div className="sheet-handle mobile-only" /><form onSubmit={event => { event.preventDefault(); if (!form.name.trim()) { setError('Escribe un nombre para el contexto.'); return } onSave({ ...form, name: form.name.trim() }) }}><header><h2>Configurar Nuevo Contexto</h2><p>Define sensibilidad y gestos para este preset</p></header><label className="name-field">Nombre del Modo<input autoFocus maxLength={60} value={form.name} onChange={event => { update({ name: event.target.value }); setError('') }} aria-invalid={Boolean(error)} required /></label>{error && <p role="alert">{error}</p>}<div className="context-ranges"><RangeControl label="Sensibilidad de Rastreo" value={form.sensitivity} onChange={sensitivity => update({ sensitivity })} /><RangeControl label="Filtro de Temblor y Estabilidad" value={form.stability} onChange={stability => update({ stability })} /></div><div className="context-switches"><div><span>Click con pinza rápida</span><Switch label="Click con pinza rápida" checked={form.pinch} onChange={pinch => update({ pinch })} /></div><div><span>Desplazamiento con palma abierta</span><Switch label="Desplazamiento con palma abierta" checked={form.scroll} onChange={scroll => update({ scroll })} /></div></div><footer className="dialog-actions"><button type="button" className="button text-button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit">Guardar Contexto</button></footer></form></Dialog>
}
export function ErgonomicSettingsDialog({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings)
  return <Dialog onClose={onClose} title="Control Ergonómico" className="ergonomic-dialog"><header className="section-line"><h2>Control Ergonómico</h2><Icon name="ergonomic" /></header><ErgonomicControls settings={draft} onChange={setDraft} detailed /><footer className="dialog-actions"><button className="button text-button" onClick={onClose}>Cancelar</button><button className="button primary" onClick={() => onSave(draft)}>Guardar</button></footer></Dialog>
}
export function GestureCalibrationDialog({ gesture = 'Click / Selección', onClose, onSave }) {
  const [clicks, setClicks] = useState(0)
  return <Dialog onClose={onClose} title={`Calibrar Gesto: ${gesture}`} className="gesture-dialog"><header className="section-line"><div><h2>Calibrar Gesto: {gesture}</h2><p>Ajusta y prueba la respuesta del sensor en tiempo real</p></div><button className="close-dialog" aria-label="Cerrar calibración" onClick={onClose}><Icon name="close" /></button></header><div className="gesture-instruction"><span className="pinch-circle"><Icon name="pinch" /></span><strong>{gesture === 'Click / Selección' ? 'Micro-pinza índice y pulgar' : gesture}</strong><small>Mantén los dedos a 30-50 cm de la cámara</small></div><div className="gesture-test"><button className={`test-area ${clicks ? 'tested' : ''}`} onClick={() => setClicks(value => value + 1)}><Icon name="testHand" /><span aria-live="polite">{clicks ? `Gesto registrado · ${clicks} ${clicks === 1 ? 'prueba' : 'pruebas'}` : 'Área de Prueba: Junta tus dedos aquí para simular el click'}</span></button><span className="status-pill"><i />Sensor: Detectando mano (60 FPS)</span></div><footer className="dialog-actions"><button className="button text-button" onClick={() => setClicks(0)}>Restablecer</button><button className="button primary" onClick={onSave}>Confirmar Calibración</button></footer></Dialog>
}
