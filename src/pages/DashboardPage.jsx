import { contexts } from '../data/preferences'
import { DeviceStatus, Icon, MobileAction, NavLink, SensorPreview } from '../components/UI'

const gestures = [
  ['Desplazamiento', 'Palma abierta + Giro vertical', 'imgMinimalistLineArtIllustrationOfAnOpenHandPalmGestureSoftColors'],
  ['Click / Selección', 'Micro-pinza índice y pulgar', 'imgMinimalistLineArtIllustrationOfAPinchGestureFingersTogetherSoftColors'],
  ['Volver / Cerrar', 'Puño cerrado rápido', 'imgMinimalistLineArtIllustrationOfAFistGestureSoftColors'],
]
function ContextCard({ context, active, onSelect, mobile = false }) {
  return <article className={`context-card ${active ? 'selected' : ''} ${mobile ? 'mobile-card' : ''}`}>
    {!mobile && active && <span className="active-tag">ACTIVO AHORA</span>}
    <div className="card-top"><span className="context-icon"><Icon name={context.icon} /></span>{!mobile && !active && <button className="tiny-button" onClick={onSelect}>SELECCIONAR</button>}</div>
    <h3>{context.title}</h3><p>{context.description}</p><div className="card-footer"><span>{context.badge}</span><span className="indicators">{context.indicators.map(icon => <span key={icon}><Icon name={icon} /></span>)}</span></div>
  </article>
}
function CustomContexts({ preferences, openModal, deleteContext, update, mobile = false }) {
  return <section className={`custom-contexts ${mobile ? '' : 'panel'}`}>
    {!mobile && <div className="section-line"><span>Crear Nuevo Contexto</span><button className="new-preset" onClick={() => openModal({ type: 'context', mobile })}>+ Nuevo Preset</button></div>}
    {preferences.contexts.map(context => <div className={`custom-context ${preferences[mobile ? 'mobileContext' : 'desktopContext'] === context.id ? 'active-custom' : ''}`} key={context.id}>
      <button className="custom-select" onClick={() => update({ [mobile ? 'mobileContext' : 'desktopContext']: context.id })} aria-pressed={preferences[mobile ? 'mobileContext' : 'desktopContext'] === context.id}><span className="custom-icon">◉</span><strong>{context.name}</strong></button>
      {!mobile && <button className="tiny-button" onClick={() => update({ desktopContext: context.id })}>{preferences.desktopContext === context.id ? 'ACTIVO' : 'SELECCIONAR'}</button>}
      <button className="delete-context" onClick={() => deleteContext(context.id)} aria-label={`Eliminar ${context.name}`}>Eliminar</button>
    </div>)}
    {(!preferences.contexts.length || mobile) && <button className={`add-context ${mobile && preferences.contexts.length ? 'additional-context' : ''}`} onClick={() => openModal({ type: 'context', mobile })}><span className="device-icon"><Icon name="plus" /></span><span><strong>Agregar Modo Personalizado</strong><small>Configura tolerancia, sensibilidad y gestos a tu medida</small></span></button>}
  </section>
}
function DetectionBanner({ mobile, enabled, onChange }) {
  return <section className={`detection-banner ${!enabled ? 'inactive' : ''}`}><span className="detection-icon">{mobile ? <span className="pause-bars">Ⅱ</span> : <Icon name={enabled ? 'eye' : 'eyeOff'} />}</span><div><strong>{mobile ? 'Reposo por Proximidad' : `Detección Inteligente: Gaze-Gating ${enabled ? 'activo' : 'inactivo'}`}</strong><p>{mobile ? 'La cámara se suspende para ahorrar batería y se activa al acercar tu mano.' : 'El puntero se suspende automáticamente si desvías la mirada de la pantalla para evitar falsos positivos.'}</p></div><button className="outline-tiny" onClick={() => onChange(!enabled)} aria-pressed={enabled}>{enabled ? 'DESACTIVAR' : 'ACTIVAR'}</button></section>
}
export default function DashboardPage({ preferences, update, navigate, openModal, deleteContext }) {
  const customProps = { preferences, update, openModal, deleteContext }
  const mobileContext = contexts[preferences.mobileContext] || { title: preferences.contexts.find(c => c.id === preferences.mobileContext)?.name, icon: 'hand', description: 'Contexto personalizado con tus ajustes de sensibilidad, estabilidad y gestos.', badge: 'Personalizado', indicators: [] }
  return <main className="dashboard-page"><div className="desktop-dashboard desktop-only">
    <DetectionBanner enabled={preferences.gaze} onChange={gaze => update({ gaze })} />
    <div className="dashboard-grid"><div className="dashboard-left"><div className="contexts-heading"><div><h1>Contextos de Trabajo</h1><p>Presets optimizados según tu actividad y entorno actual.</p></div><NavLink to="/calibracion" navigate={navigate} className="button primary calibrate-button"><Icon name="wand" />Iniciar Calibración Anatómica y Gestos</NavLink></div><div className="context-grid">{['kitchen', 'desk', 'assistance'].map(id => <ContextCard key={id} context={contexts[id]} active={preferences.desktopContext === id} onSelect={() => update({ desktopContext: id })} />)}</div><CustomContexts {...customProps} /></div>
    <aside className="dashboard-aside"><DeviceStatus /><section className="memory panel"><h2>Gestos en Memoria</h2>{gestures.map(([title, subtitle, image]) => <button className="memory-gesture" key={title} onClick={() => openModal({ type: 'gesture', gesture: title })}><img src={`/assets/home-${image}.png`} alt="" /><span><strong>{title}</strong><small>{subtitle}</small></span><Icon name="chevron" /></button>)}</section><section className="tip"><h2>Consejo</h2><p>Usa el <strong>"Modo Desk-Rest"</strong> mientras escribes para alternar entre<br /> teclado y navegación sin levantar las muñecas.</p><Icon name="tip" /></section></aside></div>
    </div><div className="mobile-dashboard mobile-only"><DetectionBanner mobile enabled={preferences.proximity} onChange={proximity => update({ proximity })} /><section className="mobile-contexts"><h1>Contexto de Trabajo</h1><div className="context-tabs" aria-label="Contexto de trabajo">{['kitchen', 'handsfree', 'assistance'].map(id => <button key={id} aria-pressed={preferences.mobileContext === id} className={preferences.mobileContext === id ? 'active' : ''} onClick={() => update({ mobileContext: id })}>{contexts[id].tab}</button>)}</div><ContextCard context={mobileContext} mobile active /></section><CustomContexts {...customProps} mobile /><section className="mobile-sensor-section"><div className="section-line"><h2>Vista de Sensor</h2><span className="connected">● LIVE · 60 FPS</span></div><SensorPreview variant="home" /></section><MobileAction to="/calibracion" navigate={navigate}>Ver Atajos y Calibración</MobileAction></div></main>
}
