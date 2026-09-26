import { useEffect, useState } from 'react'
import { Icon, NavLink, SensorPreview } from '../components/UI'
export default function GesturePlaygroundPage({ navigate }) {
  const [running, setRunning] = useState(true)
  const [seconds, setSeconds] = useState(600)
  useEffect(() => {
    if (!running || seconds === 0) return
    const timer = window.setTimeout(() => setSeconds(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [running, seconds])
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <main className="playground-page"><div className="mobile-only mobile-playground"><span className="mode-pill">● Modo Cocina y Taller</span><section className="recipe-card"><h1>Masa de Galletas</h1><p>Amasar 10 min. Usa desplazamiento gestual para leer.</p></section><button className="timer-button" onClick={() => { if (seconds === 0) { setSeconds(600); setRunning(true) } else setRunning(value => !value) }}><Icon name="pause" />{seconds === 0 ? 'Reiniciar Tiempo' : `${running ? 'Pausar' : 'Reanudar'} Tiempo (${time} min)`}<span className="gesture-cursor"><span /><small>Click</small></span></button><section className="playground-sensor"><h2>Vista de Cámara</h2><SensorPreview variant="playground" /></section><NavLink to="/" navigate={navigate} className="back-to-panel"><Icon name="playground-imgImg3" />Volver al Panel Principal</NavLink></div><div className="desktop-only unavailable"><h1>Entorno de prueba</h1><p>Esta experiencia está diseñada para móvil.</p><NavLink to="/calibracion" navigate={navigate} className="button primary">Volver a Calibración</NavLink></div></main>
}
