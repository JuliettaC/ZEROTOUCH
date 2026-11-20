import { getEngineState } from '../data/engineStatus'
import { Icon, NavLink } from '../components/UI'

// Teclado Air-Swipe: control de la ventana overlay y requisitos. La escritura la hace el motor en la
// aplicación que tenga el foco (aquí, el campo de práctica); este texto no se guarda en ninguna parte.
export default function GestureKeyboardPage({ navigate, engineStatus, settings, keyboard }) {
  const state = getEngineState(engineStatus)
  const camera = state.running && state.cameraOpen
  const control = camera && engineStatus.mode === 'CONTROL' && !engineStatus.emergencyStopped
  const enabled = settings.airswipe === true
  const checks = [
    [camera, 'Cámara activa', 'Actívala en Inicio.'],
    [enabled, 'Trazo Air-Swipe habilitado en este modo', 'Enciende «Trazo en teclado Air-Swipe» en Calibrar › Qué hace cada gesto.'],
    [control, 'Modo Controlar', 'Sin Controlar, el teclado solo propone palabras: no escribe.'],
  ]
  const cannotOpen = !keyboard.open && !(camera && enabled)
  return <main id="main" tabIndex={-1} className="page airswipe-page">
    <h1 className="page-title">Teclado Air-Swipe</h1>
    <p className="experimental-note"><strong>Experimental.</strong> El trazo se interpreta con un léxico local en español; su precisión y el gesto de apuntar con el índice aún no se han medido con una cámara real.</p>
    <div className="airswipe-grid">
      <section className="panel" aria-labelledby="airswipe-state">
        <h2 id="airswipe-state">Estado</h2>
        <ul className="checklist">
          {checks.map(([ok, label, hint]) => <li key={label} className={ok ? 'ok' : 'pending'}>
            <span aria-hidden="true">{ok ? '✓' : '○'}</span>
            <span><strong>{label}</strong>{!ok && <small>{hint}</small>}</span>
          </li>)}
        </ul>
        <button type="button" className="button primary big" disabled={keyboard.busy || cannotOpen} onClick={keyboard.open ? keyboard.closeKeyboard : keyboard.openKeyboard}>
          {keyboard.busy ? 'Un momento…' : keyboard.open ? 'Cerrar teclado' : 'Abrir teclado'}
        </button>
        <p className="airswipe-state-line" role="status">{keyboard.open ? 'El teclado está abierto en la parte inferior de la pantalla.' : 'El teclado está cerrado.'}</p>
      </section>

      <section className="panel" aria-labelledby="airswipe-how">
        <h2 id="airswipe-how">Cómo se usa</h2>
        <ol className="steps-list">
          <li>En Inicio, activa la cámara y pulsa <strong>Controlar</strong>. Mantén la mano abierta un momento para activar el puntero.</li>
          <li>Abre el teclado: aparece abajo y no le quita el foco a lo que estés escribiendo.</li>
          <li>Haz clic con la pinza donde quieras escribir.</li>
          <li>Apunta con el índice (los demás dedos plegados) y recorre las letras de la palabra; al soltar la postura aparece una propuesta.</li>
          <li>Toca la palabra correcta con la pinza para escribirla. Borrar, Espacio e Intro están en la barra. Con pulgar arriba (si lo activas en Calibrar) confirmas la primera propuesta.</li>
        </ol>
        <p className="step-hint">Nada se escribe hasta que confirmas, y no se guarda ni se registra lo que escribes.</p>
      </section>
    </div>

    <section className="panel" aria-labelledby="airswipe-practice">
      <h2 id="airswipe-practice">Campo de práctica</h2>
      <p className="step-hint">Haz clic aquí con la pinza y escribe con el trazo. El texto se escribe en la aplicación que tenga el foco; este campo solo existe para practicar.</p>
      <textarea className="practice-field" aria-labelledby="airswipe-practice" rows={4} spellCheck={false} placeholder="Escribe aquí para practicar…" />
    </section>

    <nav className="page-actions"><NavLink to="/" navigate={navigate} className="button secondary"><Icon name="back" />Volver al inicio</NavLink></nav>
  </main>
}
