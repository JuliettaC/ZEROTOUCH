// Clips de ejemplo de cada gesto (mano real vista desde la webcam). Cómo grabarlos: docs/grabar-gestos.md.
// El archivo va en public/gestos/<nombre> y la clave es el id del gesto en src/data/gestures.js.
// Formato: MP4 de la app Cámara de Windows (o WebM), 2–3 s, en bucle; se reproduce sin sonido.
// Sin clip, la interfaz muestra el emoji del gesto: nunca una imagen de otra persona ni un video inventado.
export const GESTURE_CLIPS = {
  // pointer: 'mover.mp4',
  // click: 'clic.mp4',
  // scroll: 'desplazar.mp4',
  // pause: 'pausar.mp4',
  // drag: 'arrastrar.mp4',
  // rightClick: 'clic-derecho.mp4',
  // tabs: 'pestanas.mp4',
}

export const clipFor = id => GESTURE_CLIPS[id] ?? null
