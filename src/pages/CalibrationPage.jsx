import { AdvancedSettings, NavLink, ConfigStatus, EngineCard } from '../components/UI'
import { GestureList } from '../components/GestureCatalog'
import { usesEssentialGestures, withEssentialGestures } from '../data/essentialGestures'

export default function CalibrationPage({
  favorites,
  onFavorite,
  navigate,
  settings,
  assignments,
  modeName,
  apply,
  onRetryApply,
  onChangeSettings,
  openModal,
  engineStatus,
  engineBusy,
  onStartEngine,
  onStopEngine,
  onToggleControlMode,
  onTogglePause,
}) {
  const onChange = onChangeSettings
  return (
    <main id="main" tabIndex={-1} className="page calibration-page">
      <div className="section-line">
        <h1 className="page-title">Gestos</h1>{' '}
        <NavLink to="/teclado" navigate={navigate} className="text-link">
          Escritura Air-Swipe →
        </NavLink>
      </div>
      <div>
        <div className="calibration-steps">
          <section className="panel step" aria-labelledby="step1">
            <h2 id="step1" className="sr-only">
              Control de la cámara
            </h2>

            <EngineCard
              compact
              headingLevel={3}
              engineStatus={engineStatus}
              engineBusy={engineBusy}
              onStartEngine={onStartEngine}
              onStopEngine={onStopEngine}
              onToggleControlMode={onToggleControlMode}
              onTogglePause={onTogglePause}
            />
          </section>
          <section className="panel step" aria-labelledby="step2">
            <h2 id="step2">Prueba cada gesto</h2>
            <p className="step-hint">
              Haz el gesto: se marcará como <strong>Detectado</strong>. Ábrelo para ajustarlo.
            </p>
            <p className="step-hint">
              <button
                type="button"
                className="button secondary"
                disabled={usesEssentialGestures(settings)}
                onClick={() => onChange(withEssentialGestures(settings))}
              >
                {usesEssentialGestures(settings) ? '✓ Solo gestos esenciales' : 'Usar solo gestos esenciales'}
              </button>{' '}
              Mover, clic, desplazar, pausar y abrir el teclado (el dictado, Alt + Tab y las pestañas quedan como estén).
              Apaga el resto, que puede dispararse solo al mover el cursor; cada gesto se vuelve a
              encender desde esta lista.
            </p>
            <GestureList
              favorites={favorites}
              onFavorite={onFavorite}
              engineStatus={engineStatus}
              settings={settings}
              assignments={assignments}
              onOpen={(gesture) => openModal({ type: 'gesture', gesture })}
            />
          </section>
          <section className="panel step">
            <details className="advanced">
              <summary className="step-summary">
                Ajustes finos <small>(opcional)</small>
              </summary>
              <p className="step-hint">
                Se aplican al instante al modo «{modeName}». Cámara, mano, recorrido y exigencia de
                detección son de este equipo y no se sincronizan.
              </p>
              <AdvancedSettings settings={settings} onChange={onChange} />
            </details>
            <ConfigStatus apply={apply} onRetry={onRetryApply} />
          </section>
        </div>
      </div>
    </main>
  )
}
