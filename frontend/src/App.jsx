import { useEffect, useState } from 'react'

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const onRoute = () => setRoute(window.location.hash || '#/')
    window.addEventListener('hashchange', onRoute)
    return () => window.removeEventListener('hashchange', onRoute)
  }, [])
  return <main>
    <p className="brand">ZEROTOUCH</p>
    {route === '#/' ? <>
      <h1>Tu espacio de control gestual</h1>
      <p>Estamos preparando la aplicación. La configuración de perfiles y contextos estará disponible en una próxima etapa.</p>
      <p>La cámara permanece apagada. Aún no se reconocen gestos ni se guardan datos.</p>
    </> : <>
      <h1>Página no encontrada</h1>
      <a href="#/">Volver al inicio</a>
    </>}
  </main>
}
