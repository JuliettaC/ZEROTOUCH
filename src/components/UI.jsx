import { useId } from 'react'

const iconFiles = { logo: 'home-imgImg2', eye: 'home-imgImg', eyeOff: 'home-imgImg1', wand: 'home-imgImg3', kitchen: 'home-imgImg4', moon: 'home-imgImg5', grid: 'home-imgImg6', desk: 'home-imgImg7', bolt: 'home-imgImg8', check: 'home-imgImg9', assistance: 'home-imgImg10', target: 'home-imgImg11', plus: 'home-imgImg12', phone: 'home-imgImg13', chevron: 'home-imgImg14', tip: 'home-imgImg15', back: 'calibration-imgImg3', next: 'calibration-imgImg4', hand: 'calibration-imgImg1', stable: 'calibration-imgImg2', laptop: 'mobile-calibration-imgLaptop', mobileBack: 'mobile-calibration-imgImg', fullscreen: 'mobile-calibration-imgImg1', mobileHand: 'mobile-calibration-imgImg2', fist: 'mobile-calibration-imgImg4', mobileNext: 'mobile-imgSvg1', close: 'gesture-imgImg', pinch: 'gesture-imgImg1', testHand: 'gesture-imgImg2', ergonomic: 'ergonomic-imgImg', rest: 'ergonomic-imgImg1', pause: 'playground-imgImg1' }
export function Icon({ name, className = '' }) {
  return <img className={`icon ${className}`} src={`/assets/${iconFiles[name] || name}.svg`} alt="" aria-hidden="true" />
}
export function NavLink({ to, navigate, children, className = '', ...props }) {
  return <a href={to} className={className} {...props} onClick={event => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(to) }
  }}>{children}</a>
}
export function Header({ path, navigate, hasContexts }) {
  const calibration = path === '/calibracion', keyboard = path === '/teclado', playground = path === '/prueba'
  const title = calibration ? 'Atajos y Calibración' : keyboard ? 'Air-Swipe' : playground ? 'Entorno de prueba' : 'ZEROTOUCH'
  return <header className={`app-header ${path === '/' ? 'dashboard-header' : ''}`}>
    <NavLink to={playground ? '/calibracion' : '/'} navigate={navigate} className="brand" aria-label={path === '/' ? 'ZeroTouch, panel principal' : 'Volver'}>
      <span className="brand-logo desktop-only"><Icon name="logo" /></span><span className={`brand-logo mobile-only ${path !== '/' ? 'round' : ''}`}><Icon name={path === '/' ? 'mobile-imgSvg' : 'mobileBack'} /></span>
      <span><strong>{title}</strong><small className="desktop-only">{calibration ? 'Ajuste milimétrico de sensibilidad para no forzar articulaciones' : keyboard ? 'Modo Cocina y Taller' : hasContexts ? 'AIRTOUCH CONTROL' : 'PANEL PRINCIPAL'}</small><small className="mobile-only">{path === '/' && !hasContexts ? 'PANEL DE CONTROL' : 'Mobile Hub'}</small></span>
    </NavLink>
    <div className="header-status desktop-only"><span className="status-pill"><i />{keyboard ? '32 PPM (Palabras por minuto) · Precisión 96%' : 'Cámara Activa · 60 FPS (1080p)'}</span>{!keyboard && <span className="profile"><img src="/assets/home-imgLucia.png" alt="" />Lucía S. - Oficina & Cocina</span>}</div>
    <div className="header-status mobile-only"><span className="android-pill"><i />Android Hub</span><img className="avatar" src="/assets/mobile-imgContainer.png" alt="Perfil de Lucía" /></div>
  </header>
}
export function DeviceStatus({ mobile = false }) {
  return <section className="device-status panel"><div className="section-line"><span>Dispositivo Sincronizado</span><strong className="connected">Conectado</strong></div><div className="device"><span className="device-icon"><Icon name={mobile ? 'laptop' : 'phone'} /></span><span><strong>{mobile ? 'PC Principal' : 'Android Hub'}</strong><small>{mobile ? 'Receptor Activo / Wi-Fi Local' : 'Proximidad / Giroscopio'}</small></span></div></section>
}
export function Switch({ checked, onChange, label }) {
  return <button className={`switch ${checked ? 'on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
}
export function RangeControl({ label, value, onChange, description }) {
  const id = useId()
  return <div className="range-control"><div className="section-line"><label htmlFor={id}>{label}</label><output htmlFor={id}>{value}%</output></div><input id={id} type="range" min="0" max="100" value={value} onChange={event => onChange(Number(event.target.value))} style={{ '--range-value': `${value}%` }} />{description && <small>{description}</small>}</div>
}
export function ErgonomicControls({ settings, onChange, detailed = false }) {
  return <div className="ergonomic-controls"><RangeControl label={detailed ? 'Sensibilidad del puntero' : 'Sensibilidad Puntero'} value={settings.sensitivity} onChange={sensitivity => onChange({ ...settings, sensitivity })} description={detailed && 'Reduce el recorrido del brazo moviendo el cursor con giros leves de muñeca.'} /><RangeControl label="Filtro Antitemblor" value={settings.stability} onChange={stability => onChange({ ...settings, stability })} description={detailed && 'Suaviza el movimiento ignorando pequeños espasmos involuntarios.'} />{detailed && <div className="desk-rest"><span className="device-icon"><Icon name="rest" /></span><span><strong>Modo Desk-Rest</strong><small>Antebrazo apoyado en mesa</small></span><Switch checked={settings.deskRest} onChange={deskRest => onChange({ ...settings, deskRest })} label="Modo Desk-Rest" /></div>}</div>
}
function toggleFullscreen(event) {
  if (document.fullscreenElement) document.exitFullscreen?.()
  else event.currentTarget.parentElement.requestFullscreen?.().catch(() => {})
}
export function SensorPreview({ variant }) {
  return <div className={`sensor sensor-${variant}`} aria-label="Vista de sensor simulada con imagen de referencia">
    {variant === 'desktop' && <><img className="sensor-photo" src="/assets/calibration-imgFirstPersonViewOfAHandReachingOutInFrontOfAModernWorkspaceDeskSoftLighting4KDigi.png" alt="Mano frente a un escritorio" /><div className="tracking-overlay"><img src="/assets/tracking-overlay.svg" alt="Puntos de seguimiento de mano simulados" /></div><span className="live-label">● REC LIVE</span><div className="sensor-bottom"><span><Icon name="hand" />MANO DETECTADA: IZQUIERDA</span><span><Icon name="stable" />PUNTERO: ESTABLE</span></div></>}
    {variant === 'home' && <><div className="kitchen-image"><img src="/assets/mobile-imgWarmTonedKitchenWorkspacePrepCounterWoodCuttingBoardSoftDaylightCulinarySceneOverhe.png" alt="Cocina" /></div><img className="home-hand" src="/assets/mobile-imgImage6.png" alt="Palma abierta frente a la cámara" /><div className="home-sensor-shade" /><div className="detected"><Icon name="mobile-imgImg2" />Gesto detectado: Palma Abierta</div></>}
    {variant === 'calibration' && <><img className="mobile-calibration-photo" src="/assets/mobile-calibration-imgImage7.png" alt="Mano abierta para calibración" /><div className="mobile-tracking"><Icon name="mobile-calibration-imgSvg" /></div><span className="distance">Distancia: 38 px</span><span className="live-label">● LIVE</span><button className="fullscreen" aria-label="Ampliar vista del sensor" onClick={toggleFullscreen}><Icon name="fullscreen" /></button></>}
    {variant === 'playground' && <><img className="recipe-photo" src="/assets/playground-imgPovOfHandsMixingCookieDoughInAGlassBowlKitchenBackgroundSoftFocusCinematicLighting.png" alt="Manos preparando masa de galletas" /><span className="live-label">● LIVE 60 FPS · 1.2ms</span><button className="fullscreen" aria-label="Ampliar vista de cámara" onClick={toggleFullscreen}><Icon name="fullscreen" /></button></>}
  </div>
}
export function MobileAction({ to, navigate, children }) {
  return <NavLink to={to} navigate={navigate} className="mobile-action">{children}<span><Icon name="mobileNext" /></span></NavLink>
}
