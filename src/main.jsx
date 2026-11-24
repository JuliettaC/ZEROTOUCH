import { restoreRoute } from './app/routes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const root = createRoot(document.getElementById('root'))

// El puente abre el teclado Air-Swipe como una segunda ventana en `index.html#airswipe`. Esa ventana
// carga su propia interfaz (y el léxico) y no la aplicación principal, que no debe duplicarse.
if (window.location.hash === '#airswipe') {
  document.title = 'ZeroTouch · Air-Swipe'
  import('./airswipe/AirSwipeOverlay.jsx').then(({ default: AirSwipeOverlay }) => {
    root.render(
      <StrictMode>
        <AirSwipeOverlay />
      </StrictMode>,
    )
  })
} else if (window.location.hash === '#hud') {
  // Indicador flotante (HUD): solo lee el estado del motor.
  document.title = 'ZeroTouch · HUD'
  import('./hud/Hud.jsx').then(({ default: Hud }) => {
    root.render(
      <StrictMode>
        <Hud />
      </StrictMode>,
    )
  })
} else {
  restoreRoute(window)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
