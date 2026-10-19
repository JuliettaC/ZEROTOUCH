import { useEffect, useRef, useState } from 'react'
import { gestures } from '../data/gestures'
import { ErgonomicControls, Icon, RangeControl, Switch } from './UI'
function Dialog({ children, onClose, className, title }) {
  const ref = useRef(null)
  useEffect(() => {
    if (className !== 'context-dialog') return
    const dialog = ref.current, viewport = window.visualViewport
    const resize = () => { dialog.style.setProperty('--context-height', `${viewport?.height ?? window.innerHeight}px`); dialog.style.setProperty('--context-bottom', `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`) }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('resize', resize) }
  }, [className])
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
  return <Dialog onClose={onClose} title="Configurar Nuevo Contexto" className="context-dialog"><div className="sheet-handle mobile-only" /><form onSubmit={event => { event.preventDefault(); if (!form.name.trim()) { setError('Escribe un nombre para el contexto.'); return } onSave({ ...form, name: form.name.trim() }) }}><div className="context-dialog-content"><header><h2>Configurar Nuevo Contexto</h2><p>Define sensibilidad y gestos para este preset</p></header><label className="name-field">Nombre del Modo<input autoFocus={!mobile} maxLength={60} value={form.name} onChange={event => { update({ name: event.target.value }); setError('') }} aria-invalid={Boolean(error)} required /></label>{error && <p role="alert">{error}</p>}<div className="context-ranges"><RangeControl label="Sensibilidad de Rastreo" value={form.sensitivity} onChange={sensitivity => update({ sensitivity })} /><RangeControl label="Filtro de Temblor y Estabilidad" value={form.stability} onChange={stability => update({ stability })} /></div><div className="context-switches"><div><span>Clic con micro-pinza</span><Switch label="Clic con micro-pinza" checked={form.pinch} onChange={pinch => update({ pinch })} /></div><div><span>Desplazamiento con dos dedos</span><Switch label="Desplazamiento con dos dedos" checked={form.scroll} onChange={scroll => update({ scroll })} /></div></div></div><footer className="dialog-actions"><button type="button" className="button text-button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit">Guardar Contexto</button></footer></form></Dialog>
}
export function ErgonomicSettingsDialog({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings)
  return <Dialog onClose={onClose} title="Control Ergonómico" className="ergonomic-dialog"><header className="section-line"><h2>Control Ergonómico</h2><Icon name="ergonomic" /></header><ErgonomicControls settings={draft} onChange={setDraft} detailed /><footer className="dialog-actions"><button className="button text-button" onClick={onClose}>Cancelar</button><button className="button primary" onClick={() => onSave(draft)}>Guardar</button></footer></Dialog>
}
export function GestureCalibrationDialog({ gesture = 'click', onClose, onSave }) {
  const [clicks, setClicks] = useState(0)
  const item = gestures[gesture] || gestures.click
  return <Dialog onClose={onClose} title={`Calibrar Gesto: ${item.title}`} className="gesture-dialog"><header className="section-line"><div><h2>Calibrar Gesto: {item.title}</h2><p>Ensayo de interfaz con clic o toque; no se utiliza la cámara</p></div><button className="close-dialog" aria-label="Cerrar calibración" onClick={onClose}><Icon name="close" /></button></header><div className="gesture-instruction"><span className="pinch-circle"><Icon name={item.icon} /></span><strong>{item.title}</strong><small>{item.instruction}</small></div><div className="gesture-test"><button className={`test-area ${clicks ? 'tested' : ''}`} onClick={() => setClicks(value => value + 1)}><Icon name="testHand" /><span aria-live="polite">{clicks ? `Prueba simulada · ${clicks} ${clicks === 1 ? 'prueba' : 'pruebas'}` : `Pulsar para simular: ${item.action}`}</span></button><span className="status-pill"><i />Sensor no conectado · Simulación</span></div><footer className="dialog-actions"><button className="button text-button" onClick={() => setClicks(0)}>Restablecer</button><button className="button primary" disabled={clicks === 0} onClick={onSave}>Finalizar prueba simulada</button></footer></Dialog>
}
