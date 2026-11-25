// Video promocional de ZeroTouch (24 s). Estilo de «claude-launchvideo» (Leonxlnx, MIT): un solo punto de color que
// pasa de plano en plano, palabras que entran al compás y la música sintetizada con código.
// Todo lo que se ve de la aplicación son CAPTURAS REALES del .exe (video-promo/capturar-app.mjs): no hay maquetas.
import React from 'react'
import { AbsoluteFill, Audio, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { CORTES, GOLPES_GESTOS, GOLPE_SYNC, f } from './tiempos.js'

const PX = 175, PY = 860 // dónde vive el punto verde al comienzo
const TINTA = '#343942'
const PAPEL = '#f4f4f6'
const VERDE = '#748d7c'
const FUENTE = 'Outfit, sans-serif'
const ease = Easing.bezier(0.22, 1, 0.36, 1)
const lerp = (fr: number, a: number, b: number, from: number, to: number, e = ease) =>
  interpolate(fr, [a, b], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e })

const Fuente = () => (
  <style>{`@font-face { font-family: 'Outfit'; src: url('${staticFile('Outfit.ttf')}') format('truetype'); font-weight: 100 900; }`}</style>
)

// Palabra que entra desde abajo con un pequeño rebote y sale hacia arriba.
const Palabra: React.FC<{ desde: number; hasta?: number; size: number; color?: string; peso?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ desde, hasta = 1e9, size, color = TINTA, peso = 700, style, children }) => {
  const fr = useCurrentFrame()
  const { fps } = useVideoConfig()
  const entra = spring({ frame: fr - desde, fps, config: { damping: 14, stiffness: 160, mass: 0.6 } })
  const sale = lerp(fr, hasta, hasta + 8, 0, 1)
  return (
    <div style={{ overflow: 'hidden', paddingBottom: size * 0.12, ...style }}>
      <div style={{ fontFamily: FUENTE, fontWeight: peso, fontSize: size, color, letterSpacing: -size * 0.03, lineHeight: 1.05, transform: `translateY(${(1 - entra) * 110 + sale * -110}%)`, opacity: fr < desde ? 0 : 1 }}>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 1. Problema: manos ocupadas (0–5 s)
const Problema: React.FC = () => {
  const fr = useCurrentFrame()
  const fin = f(CORTES.marca)
  // Campo verde que se cierra en el punto (iris), como el campo rojo de la referencia.
  const iris = lerp(fr, 0, 18, 2400, 0, Easing.bezier(0.7, 0, 0.3, 1))
  const imagen = lerp(fr, 40, 60, 0, 1)
  const implosion = lerp(fr, fin - 18, fin - 2, 1, 0, Easing.in(Easing.cubic))
  return (
    <AbsoluteFill style={{ background: PAPEL }}>
      <AbsoluteFill style={{ transform: `scale(${implosion})`, transformOrigin: `${PX}px ${PY}px`, opacity: implosion > 0.02 ? 1 : 0 }}>
        <div style={{ position: 'absolute', right: 120, top: 150, width: 680, height: 780, borderRadius: 48, overflow: 'hidden', clipPath: `inset(${(1 - imagen) * 100}% 0 0 0 round 48px)`, boxShadow: '0 40px 80px rgba(52,57,66,.18)' }}>
          <Img src={staticFile('img/cocina.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.15 - imagen * 0.1})` }} />
        </div>
        <div style={{ position: 'absolute', left: 140, top: 250 }}>
          <Palabra desde={15} size={120}>Manos en la masa.</Palabra>
          <Palabra desde={60} size={120} color={VERDE}>La receta,</Palabra>
          <Palabra desde={75} size={120} color={VERDE}>en la pantalla.</Palabra>
          <Palabra desde={105} size={64} peso={500} style={{ marginTop: 30 }}>¿Y quién la toca?</Palabra>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: PX - iris / 2, top: PY - iris / 2, width: iris, height: iris, borderRadius: '50%', background: VERDE, display: iris < 1 ? 'none' : 'block' }} />
    </AbsoluteFill>
  )
}

// El punto verde: hilo conductor (la mano que señala). Se dibuja encima de todo.
const Punto: React.FC = () => {
  const fr = useCurrentFrame()
  const { fps } = useVideoConfig()
  const i = f(CORTES.inicio)
  const pulsoBase = (s: number) => 1 + 0.25 * Math.max(0, Math.sin(((fr - s) / 15) * Math.PI)) * (fr >= s ? 1 : 0)
  // Posiciones por tramo.
  let x = PX, y = PY, r = 22, op = 1
  if (fr < 18) op = 0
  else if (fr < f(CORTES.marca)) { r = 22 * pulsoBase(18); op = 1 }
  else if (fr < i) {
    // Entra en la marca y se esconde detrás del logo.
    const s = spring({ frame: fr - f(CORTES.marca), fps, config: { damping: 12 } })
    r = 22; op = 1 - lerp(fr, f(CORTES.marca), f(CORTES.marca) + 6, 0, 1)
  } else if (fr < f(CORTES.gestos)) {
    // En Inicio: viaja hasta el botón real «Iniciar cámara» y late como un cursor que lo señala.
    const t = lerp(fr, i + 30, i + 60, 0, 1)
    x = interpolate(t, [0, 1], [1500, 950]); y = interpolate(t, [0, 1], [900, 470]); r = 16 * pulsoBase(i + 60); op = lerp(fr, i + 25, i + 35, 0, 1) * lerp(fr, f(CORTES.gestos) - 8, f(CORTES.gestos), 1, 0)
  } else op = 0
  return <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', background: VERDE, opacity: op, boxShadow: `0 0 0 ${r * 0.6}px rgba(116,141,124,.18)` }} />
}

// ---------------------------------------------------------------- 2. Marca (5–7 s)
const Marca: React.FC = () => {
  const fr = useCurrentFrame() - f(CORTES.marca)
  const { fps } = useVideoConfig()
  const logo = spring({ frame: fr, fps, config: { damping: 11, stiffness: 140 } })
  const texto = lerp(fr, 10, 26, 0, 1)
  const sube = lerp(fr, 45, 60, 0, 1, Easing.in(Easing.cubic))
  return (
    <AbsoluteFill style={{ background: TINTA, justifyContent: 'center', alignItems: 'center', clipPath: `circle(${lerp(fr, 0, 12, 0, 160)}% at ${PX}px ${PY}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36, transform: `translateY(${sube * -1200}px)` }}>
        <Img src={staticFile('img/zerotouch-dark.png')} style={{ width: 170, height: 170, transform: `scale(${logo}) rotate(${(1 - logo) * -40}deg)` }} />
        <div style={{ overflow: 'hidden', width: texto * 980 }}>
          <div style={{ fontFamily: FUENTE, fontWeight: 800, fontSize: 132, color: PAPEL, letterSpacing: 4, whiteSpace: 'nowrap', transform: `translateX(${(1 - texto) * -100}%)` }}>ZEROTOUCH</div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 700, fontFamily: FUENTE, fontSize: 46, color: '#c9ccd2', opacity: lerp(fr, 22, 32, 0, 1) * (1 - sube) }}>
        Controla tu computador con gestos.
      </div>
    </AbsoluteFill>
  )
}

// Ventana de la aplicación con la captura real.
const Ventana: React.FC<{ src: string; style?: React.CSSProperties; imgStyle?: React.CSSProperties }> = ({ src, style, imgStyle }) => (
  <div style={{ position: 'absolute', borderRadius: 28, overflow: 'hidden', background: '#fff', boxShadow: '0 50px 120px rgba(52,57,66,.28), 0 0 0 1px rgba(52,57,66,.08)', ...style }}>
    <Img src={staticFile(src)} style={{ display: 'block', width: '100%', ...imgStyle }} />
  </div>
)

const Rotulo: React.FC<{ arriba: string; abajo?: string; desde: number; x?: number; y?: number }> = ({ arriba, abajo, desde, x = 110, y = 90 }) => (
  <div style={{ position: 'absolute', left: x, top: y }}>
    <Palabra desde={desde} size={78}>{arriba}</Palabra>
    {abajo && <Palabra desde={desde + 15} size={78} color={VERDE}>{abajo}</Palabra>}
  </div>
)

// ---------------------------------------------------------------- 3a. Inicio real (7–11 s)
const Inicio: React.FC = () => {
  const fr = useCurrentFrame() - f(CORTES.inicio)
  const { fps } = useVideoConfig()
  const sube = spring({ frame: fr, fps, config: { damping: 16, stiffness: 90 } })
  const sale = lerp(fr, 110, 120, 0, 1, Easing.in(Easing.cubic))
  // Captura 2560×1680 → 1340 de ancho.
  return (
    <AbsoluteFill style={{ background: PAPEL, perspective: 2200 }}>
      <Rotulo desde={f(CORTES.inicio) + 6} arriba="Una cámara web común." abajo="Nada que tocar." />
      <Ventana src="app/inicio.png" style={{ left: 480, top: 330, width: 1340, transform: `translateY(${(1 - sube) * 700 + sale * -60}px) rotateX(${(1 - sube) * 28}deg) scale(${1 - sale * 0.05})`, opacity: 1 - sale }} />
      <Etiqueta desde={f(CORTES.inicio) + 40} x={1440} y={110} texto="Captura real de la aplicación" />
    </AbsoluteFill>
  )
}

const Etiqueta: React.FC<{ desde: number; x: number; y: number; texto: string }> = ({ desde, x, y, texto }) => {
  const fr = useCurrentFrame()
  return <div style={{ position: 'absolute', left: x, top: y, fontFamily: FUENTE, fontSize: 26, color: '#8a8f98', opacity: lerp(fr, desde, desde + 10, 0, 1) }}>{texto}</div>
}

// ---------------------------------------------------------------- 3b. Gestos reales (11–16 s)
const GESTOS = [
  { foto: 'img/mano-abierta.jpg', gesto: 'Mano abierta', accion: 'mueve el cursor', fila: 508 },
  { foto: 'img/clic.jpg', gesto: 'Pinza', accion: 'hace clic', fila: 574 },
  { foto: 'img/desplazar-arriba.jpg', gesto: 'Dos dedos', accion: 'desplaza', fila: 640 },
  { foto: 'img/pausar.jpg', gesto: 'Puño', accion: 'pausa todo', fila: 706 },
]
const Gestos: React.FC = () => {
  const frAbs = useCurrentFrame()
  const fr = frAbs - f(CORTES.gestos)
  const { fps } = useVideoConfig()
  const golpes = GOLPES_GESTOS.map(f)
  const actual = golpes.reduce((k, g, i) => (frAbs >= g ? i : k), -1)
  const entra = spring({ frame: fr, fps, config: { damping: 16 } })
  const sale = lerp(fr, 140, 150, 0, 1, Easing.in(Easing.cubic))
  // Captura de la lista completa (2560 de ancho, CSS ×2). Escala 0,58 → filas visibles a la derecha.
  const escala = 0.56
  const px = (css: number) => css * 2 * escala
  // La lista sube fila a fila, al compás: la fila del gesto actual queda siempre a la altura 540.
  const desplaza = GESTOS.slice(1).reduce((acc, gesto, i) => acc + spring({ frame: frAbs - golpes[i + 1], fps, config: { damping: 18, stiffness: 150 } }) * px(gesto.fila - GESTOS[i].fila), 0)
  const topImg = 540 - px(GESTOS[0].fila) - desplaza
  const leftImg = 40 - px(195)
  const g = actual >= 0 ? GESTOS[actual] : null
  const pop = actual >= 0 ? spring({ frame: frAbs - golpes[actual], fps, config: { damping: 10, stiffness: 180 } }) : 0
  return (
    <AbsoluteFill style={{ background: PAPEL, opacity: 1 - sale }}>
      <div style={{ position: 'absolute', left: 840, top: 0, width: 1080, height: 1080, overflow: 'hidden', transform: `translateX(${(1 - entra) * 900}px)` }}>
        <Img src={staticFile('app/gestos-completo.png')} style={{ position: 'absolute', left: leftImg, top: topImg, width: 2560 * escala }} />
        {g && (
          <div style={{ position: 'absolute', left: leftImg + px(203), top: 540 - px(30), width: px(954), height: px(60), borderRadius: 18, boxShadow: `0 0 0 5px ${VERDE}`, opacity: Math.min(1, pop) }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${PAPEL} 0%, transparent 18%, transparent 82%, ${PAPEL} 100%)` }} />
      </div>
      <div style={{ position: 'absolute', left: 110, top: 90 }}>
        <Palabra desde={f(CORTES.gestos) + 2} size={70}>Un gesto, una acción.</Palabra>
      </div>
      {g && (
        <div style={{ position: 'absolute', left: 110, top: 300, display: 'flex', alignItems: 'center', gap: 36 }}>
          <div style={{ width: 280, height: 280, borderRadius: 36, overflow: 'hidden', transform: `scale(${0.7 + pop * 0.3}) rotate(${(1 - pop) * -8}deg)`, boxShadow: '0 30px 70px rgba(52,57,66,.2)' }}>
            <Img src={staticFile(g.foto)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div key={actual}>
            <Palabra desde={golpes[actual]} size={58}>{g.gesto}</Palabra>
            <Palabra desde={golpes[actual] + 4} size={58} color={VERDE}>{g.accion}</Palabra>
          </div>
        </div>
      )}
      <Etiqueta desde={f(CORTES.gestos) + 20} x={110} y={990} texto="Fotos de manos del equipo · lista real de la app" />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 3c. Sincronización real (16–20 s)
const Sync: React.FC = () => {
  const frAbs = useCurrentFrame()
  const fr = frAbs - f(CORTES.sync)
  const { fps } = useVideoConfig()
  const entra = spring({ frame: fr, fps, config: { damping: 18 } })
  const zoom = lerp(frAbs, f(GOLPE_SYNC) - 10, f(GOLPE_SYNC) + 14, 0, 1)
  const brillo = lerp(frAbs, f(GOLPE_SYNC), f(GOLPE_SYNC) + 8, 0, 1)
  const sale = lerp(fr, 110, 120, 0, 1, Easing.in(Easing.cubic))
  // Diálogo real en CSS (400..880, 278..563); resultado en y≈437. Captura ×2.
  const ancho = interpolate(zoom, [0, 1], [1340, 2300])
  const k = ancho / 2560
  const cx = interpolate(zoom, [0, 1], [1150, 1240]), cy = interpolate(zoom, [0, 1], [640, 620])
  const left = cx - 640 * 2 * k, top = cy - 437 * 2 * k
  return (
    <AbsoluteFill style={{ background: PAPEL, opacity: 1 - sale }}>
      <div style={{ position: 'absolute', left: 520, top: 230, width: 1300, height: 760, borderRadius: 28, overflow: 'hidden', boxShadow: '0 50px 120px rgba(52,57,66,.28)', transform: `translateY(${(1 - entra) * 800}px)` }}>
        <Img src={staticFile('app/sincronizado.png')} style={{ position: 'absolute', left: left - 520, top: top - 230, width: ancho }} />
        <div style={{ position: 'absolute', left: left - 520 + 428 * 2 * k, top: top - 230 + 419 * 2 * k, width: 424 * 2 * k, height: 38 * 2 * k, borderRadius: 12 * k * 2, boxShadow: `0 0 0 ${6 * brillo}px ${VERDE}`, opacity: brillo }} />
      </div>
      <Rotulo desde={f(CORTES.sync) + 4} arriba="Tus ajustes," abajo="guardados en tu cuenta." y={60} />
      <Etiqueta desde={f(GOLPE_SYNC) + 6} x={520} y={1010} texto="Respuesta real del servidor (API + SQLite)" />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 4. Promesa (20–24 s)
const Promesa: React.FC = () => {
  const frAbs = useCurrentFrame()
  const fr = frAbs - f(CORTES.promesa)
  const { fps } = useVideoConfig()
  const tacha = lerp(fr, 22, 32, 0, 1)
  const lockup = spring({ frame: fr - 50, fps, config: { damping: 13 } })
  const textoSale = lerp(fr, 44, 52, 0, 1)
  return (
    <AbsoluteFill style={{ background: PAPEL, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ position: 'absolute', left: 260, top: 330, opacity: 1 - textoSale }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Palabra desde={frAbs - fr + 2} size={110}>Tocar la pantalla.</Palabra>
          <div style={{ position: 'absolute', left: 0, top: '50%', height: 12, width: `${tacha * 100}%`, background: VERDE, borderRadius: 6 }} />
        </div>
        <Palabra desde={frAbs - fr + 30} size={110} color={VERDE}>Ya no hace falta.</Palabra>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 30, transform: `scale(${lockup})`, opacity: lockup }}>
        <Img src={staticFile('img/zerotouch-light.png')} style={{ width: 130, height: 130 }} />
        <div style={{ fontFamily: FUENTE, fontWeight: 800, fontSize: 112, color: TINTA, letterSpacing: 3 }}>ZEROTOUCH</div>
      </div>
      <div style={{ position: 'absolute', top: 700, fontFamily: FUENTE, fontSize: 44, color: TINTA, opacity: lerp(fr, 62, 72, 0, 1) }}>
        Tus manos siguen en lo suyo. El computador te sigue a ti.
      </div>
      <div style={{ position: 'absolute', bottom: 46, fontFamily: FUENTE, fontSize: 20, color: '#8a8f98', opacity: lerp(fr, 66, 76, 0, 1), textAlign: 'center', lineHeight: 1.5 }}>
        Capturas reales de ZeroTouch para Windows · Fotos de manos del equipo · Imagen de cocina generada con IA (Hito 1) · Música sintetizada con código
        <br />
        Estilo inspirado en «claude-launchvideo» de Leonxlnx (licencia MIT) · github.com/JuliettaC/ZEROTOUCH
      </div>
    </AbsoluteFill>
  )
}

const Tramo: React.FC<{ desde: number; hasta: number; children: React.ReactNode }> = ({ desde, hasta, children }) => {
  const fr = useCurrentFrame()
  return fr >= f(desde) && fr < f(hasta) ? <>{children}</> : null
}

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: PAPEL }}>
    <Fuente />
    <Audio src={staticFile('musica.wav')} />
    <Tramo desde={CORTES.problema} hasta={CORTES.marca}><Problema /></Tramo>
    <Tramo desde={CORTES.marca} hasta={CORTES.inicio}><Marca /></Tramo>
    <Tramo desde={CORTES.inicio} hasta={CORTES.gestos}><Inicio /></Tramo>
    <Tramo desde={CORTES.gestos} hasta={CORTES.sync}><Gestos /></Tramo>
    <Tramo desde={CORTES.sync} hasta={CORTES.promesa}><Sync /></Tramo>
    <Tramo desde={CORTES.promesa} hasta={24}><Promesa /></Tramo>
    <Punto />
  </AbsoluteFill>
)
