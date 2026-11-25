// Única fuente de los tiempos del video (en segundos). La imagen (Promo.tsx) y la música (scripts/musica.mjs) leen
// estos mismos valores, así cada golpe de sonido cae en su corte.
export const FPS = 30
export const DURACION_S = 24
export const CORTES = {
  problema: 0, // manos ocupadas
  marca: 5, // el punto se convierte en la marca
  inicio: 7, // la app real: Inicio
  gestos: 11, // la app real: lista de gestos con fotos de manos reales
  sync: 16, // la app real: «Sincronizado» con el servidor
  promesa: 20, // cierre
}
export const GOLPES_GESTOS = [11.5, 12.5, 13.5, 14.5]
export const GOLPE_SYNC = 17
export const f = s => Math.round(s * FPS)
