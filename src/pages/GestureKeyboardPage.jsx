import { getEngineState } from '../data/engineStatus'

// Teclado Air-Swipe: control de la ventana overlay y requisitos. La escritura la hace el motor en la
// aplicación que tenga el foco (aquí, el campo de práctica); este texto no se guarda en ninguna parte.
export default function GestureKeyboardPage({
  navigate,
  engineStatus,
  settings,
  keyboard,
  engineBusy,
  locked,
  onStartCamera,
  onActivateControl,
  onEnableTrace,
}) {
  const state = getEngineState(engineStatus)
  const camera = state.running && state.cameraOpen
  const control = camera && engineStatus.mode === 'CONTROL' && !engineStatus.emergencyStopped
  const enabled = settings.airswipe === true
  return (
    <main id="main" tabIndex={-1} className="page airswipe-page">
      <h1 className="page-title">Teclado Air-Swipe</h1>
      <section className="panel airswipe-start">
        <p>
          Teclas grandes: deja el cursor quieto sobre cada letra (se llena de verde y se escribe).
          El botón «Trazo» del teclado vuelve a la escritura trazando palabras.
        </p>
        {keyboard.open ? (
          <button
            className="button secondary"
            disabled={keyboard.busy}
            onClick={keyboard.closeKeyboard}
          >
            Cerrar teclado
          </button>
        ) : engineStatus.emergencyStopped || (state.running && !camera) ? (
          <button className="button primary" onClick={() => navigate('/')}>
            Revisar cámara en Inicio
          </button>
        ) : !camera ? (
          <button className="button primary" disabled={engineBusy} onClick={onStartCamera}>
            Iniciar cámara
          </button>
        ) : !enabled ? (
          <button className="button primary" disabled={locked} onClick={onEnableTrace}>
            Habilitar trazo en este modo
          </button>
        ) : (
          <button
            className="button primary"
            disabled={keyboard.busy}
            onClick={keyboard.openKeyboard}
          >
            Abrir teclado
          </button>
        )}
        {camera && enabled && !control && !engineStatus.emergencyStopped && (
          <button className="button secondary" disabled={engineBusy} onClick={onActivateControl}>
            Activar control para escribir
          </button>
        )}
        {engineStatus.emergencyStopped && (
          <p role="alert">Parada de emergencia. Reinicia el motor desde Inicio.</p>
        )}
      </section>
      <details className="panel">
        <summary>Cómo usar Air-Swipe</summary>
        <ol className="steps-list">
          <li>
            En Inicio, activa la cámara y pulsa <strong>Activar control</strong>. Mantén la mano
            abierta un momento para activar el puntero.
          </li>
          <li>
            Haz clic con la pinza donde quieras escribir: el teclado se abre solo, abajo y sin
            quitarle el foco al campo. Al salir del campo se cierra.
          </li>
          <li>
            Apunta con el índice (los demás dedos plegados) y recorre las letras de la palabra; al
            soltar la postura aparece una propuesta.
          </li>
          <li>
            Toca la palabra correcta con la pinza para escribirla. Borrar, Espacio e Intro están en
            la barra.
          </li>
        </ol>
        <p className="step-hint">
          Nada se escribe hasta que confirmas, y no se guarda ni se registra lo que escribes.
        </p>
        <p>Función experimental con léxico local en español.</p>
      </details>

      <section className="panel" aria-labelledby="airswipe-practice">
        <h2 id="airswipe-practice">Campo de práctica</h2>
        <textarea
          className="practice-field"
          aria-labelledby="airswipe-practice"
          rows={4}
          spellCheck={false}
          placeholder="Escribe aquí para practicar…"
        />
      </section>
    </main>
  )
}
