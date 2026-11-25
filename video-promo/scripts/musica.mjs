// Banda sonora del video, sintetizada con código (sin muestras ni música de terceros).
// 120 BPM, 24 s, progresión F – C/E – Am – G. Los golpes caen en los mismos instantes que los cortes de src/tiempos.ts.
// Uso: node scripts/musica.mjs  → public/musica.wav
import { writeFileSync } from 'node:fs'
import { CORTES, DURACION_S, GOLPES_GESTOS, GOLPE_SYNC } from '../src/tiempos.js'

const SR = 44100
const N = Math.round(DURACION_S * SR)
const L = new Float32Array(N), R = new Float32Array(N)
const BEAT = 0.5
const hz = m => 440 * 2 ** ((m - 69) / 12)
const add = (t0, buf, gainL = 1, gainR = gainL) => {
  const i0 = Math.round(t0 * SR)
  for (let i = 0; i < buf.length && i0 + i < N; i++) { if (i0 + i < 0) continue; L[i0 + i] += buf[i] * gainL; R[i0 + i] += buf[i] * gainR }
}
let seed = 7
const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }

// Instrumentos -----------------------------------------------------------------------------------------------
const tick = (f, dur = 0.06) => Float32Array.from({ length: dur * SR }, (_, i) => { const t = i / SR; return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 90) * 0.5 })
const kick = () => Float32Array.from({ length: 0.35 * SR }, (_, i) => { const t = i / SR; const f = 45 + 95 * Math.exp(-t * 28); return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.9 })
const bell = (m, dur = 1.6) => Float32Array.from({ length: dur * SR }, (_, i) => {
  const t = i / SR, f = hz(m)
  return Math.sin(2 * Math.PI * f * t + 2.2 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * f * 3.5 * t)) * Math.exp(-t * 3.2) * 0.32
})
const impacto = () => {
  let lp = 0
  return Float32Array.from({ length: 1.4 * SR }, (_, i) => {
    const t = i / SR; lp += (noise() - lp) * 0.08
    return (Math.sin(2 * Math.PI * (38 + 40 * Math.exp(-t * 10)) * t) * 0.9 + lp * 1.4) * Math.exp(-t * 3.5) * 0.8
  })
}
const pad = (notas, dur) => {
  let lp = 0
  return Float32Array.from({ length: dur * SR }, (_, i) => {
    const t = i / SR
    let s = 0
    for (const m of notas) for (const d of [-0.08, 0.08]) { const f = hz(m + d); for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f * h * t + h) / h }
    lp += (s - lp) * 0.045
    const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.35)
    return lp * env * 0.055
  })
}

// Partitura ---------------------------------------------------------------------------------------------------
const ACORDES = [[53, 57, 60, 65], [52, 55, 60, 64], [57, 60, 64, 69], [55, 59, 62, 67]] // F, C/E, Am, G
const ARPEGIO = [[77, 81, 84], [76, 79, 84], [76, 81, 84], [74, 79, 83]]
// Apertura: tic-tac de reloj (la espera de quien tiene las manos ocupadas).
for (let t = 0; t < CORTES.marca - 0.01; t += BEAT) add(t, tick(Math.round(t / BEAT) % 2 ? 1568 : 2093), 0.7)
// Pad desde el comienzo, más presente desde la marca.
for (let bar = 0; bar * 2 < DURACION_S; bar++) {
  const t = bar * 2, g = t < CORTES.marca ? 0.45 : 1
  add(t, pad(ACORDES[bar % 4], 2.1), g)
}
add(CORTES.marca - 0.02, impacto(), 1)
add(CORTES.promesa - 0.02, impacto(), 0.8)
// Pulso y arpegio mientras se ve el producto.
const duck = new Float32Array(N).fill(1)
for (let t = CORTES.marca; t < CORTES.promesa; t += BEAT) {
  add(t, kick(), 0.8)
  const i0 = Math.round(t * SR)
  for (let i = 0; i < 0.25 * SR && i0 + i < N; i++) duck[i0 + i] = Math.min(duck[i0 + i], 0.55 + 0.45 * (i / (0.25 * SR)))
  const bar = Math.floor(t / 2), paso = Math.round((t % 2) / BEAT)
  add(t + 0.25, bell(ARPEGIO[bar % 4][paso % 3], 0.6), paso % 2 ? 0.25 : 0.4, paso % 2 ? 0.4 : 0.25)
}
GOLPES_GESTOS.forEach((t, k) => add(t, bell([84, 86, 88, 91][k], 1.4), 0.7))
add(GOLPE_SYNC, bell(96, 2), 0.6); add(GOLPE_SYNC + 0.12, bell(91, 2), 0.5)
// Cierre: acorde final y el tic-tac vuelve dos veces.
add(CORTES.promesa + 2, bell(77, 2.5), 0.6); add(CORTES.promesa + 2, bell(84, 2.5), 0.5)
add(DURACION_S - 1.0, tick(2093), 0.8); add(DURACION_S - 0.5, tick(1568), 0.8)

// Mezcla: compresión del pad por el bombo, eco suave, limitador y fundido -----------------------------------
for (let i = 0; i < N; i++) { L[i] *= duck[i] ** 0.5; R[i] *= duck[i] ** 0.5 }
const D = Math.round(0.375 * SR)
for (let i = D; i < N; i++) { L[i] += R[i - D] * 0.22; R[i] += L[i - D] * 0.22 }
let pico = 0
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i])) }
const escala = 0.89 / pico
const fin = Math.round(0.6 * SR)
const wav = Buffer.alloc(44 + N * 4)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24)
wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  const f = Math.min(1, (N - i) / fin)
  wav.writeInt16LE(Math.round(L[i] * escala * f * 32767), 44 + i * 4)
  wav.writeInt16LE(Math.round(R[i] * escala * f * 32767), 46 + i * 4)
}
writeFileSync(new URL('../public/musica.wav', import.meta.url), wav)
console.log(`public/musica.wav · ${DURACION_S} s · pico normalizado a -1 dBFS`)
