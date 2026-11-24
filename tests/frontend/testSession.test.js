import test from 'node:test'
import assert from 'node:assert/strict'
import { feedSession, renderReport, startSession, summarizeSession } from '../../src/engine/testSession.js'

const status = (over = {}) => ({ running: true, cameraOpen: true, handDetected: true, gesture: 'NONE', fps: 15, mode: 'OBSERVATION', eventCounts: {}, ...over })

test('cuenta solo los eventos nuevos desde el inicio y no pierde dos seguidos del mismo tipo', () => {
  const s = startSession(status({ eventCounts: { RIGHT_CLICK: 3 } }), 10, { gesture: 'clic derecho', attempts: 10 })
  feedSession(s, status({ eventCounts: { RIGHT_CLICK: 5, PAUSE: 1 } }), 11)
  feedSession(s, status({ eventCounts: { RIGHT_CLICK: 6, PAUSE: 1 } }), 12)
  const sum = summarizeSession(s, 13)
  assert.deepEqual(sum.eventTotals, { RIGHT_CLICK: 3, PAUSE: 1 })
  assert.equal(sum.duration, 3)
})

test('episodios de postura: entradas, duración y mano perdida aparte', () => {
  const s = startSession(status(), 0)
  feedSession(s, status({ gesture: 'PINZA_MEDIO' }), 1)
  feedSession(s, status({ gesture: 'PINZA_MEDIO' }), 1.5)
  feedSession(s, status({ gesture: 'NONE' }), 2)
  feedSession(s, status({ gesture: 'PINZA_MEDIO' }), 3)
  feedSession(s, status({ handDetected: false }), 3.4)
  const sum = summarizeSession(s, 4)
  assert.equal(sum.poses.PINZA_MEDIO.entries, 2)
  assert.ok(Math.abs(sum.poses.PINZA_MEDIO.total - 1.4) < 1e-9)
  assert.equal(sum.poses.SIN_MANO, undefined)
  assert.ok(sum.handShare > 0 && sum.handShare < 1)
})

test('FPS: mínimo, mediana y máximo; con un motor reiniciado los conteos no dan negativos', () => {
  const s = startSession(status({ eventCounts: { SCROLL: 8 } }), 0)
  for (const [i, fps] of [14, 15, 13].entries()) feedSession(s, status({ fps }), i + 1)
  feedSession(s, status({ fps: 14, eventCounts: { SCROLL: 1 } }), 5)
  const sum = summarizeSession(s, 6)
  assert.equal(sum.fps.min, 13)
  assert.equal(sum.fps.max, 15)
  assert.equal(sum.fps.median, 14)
  assert.equal(sum.eventTotals.SCROLL, 1)
})

test('el informe dice cuánto tiempo estuvo activado el puntero y avisa cuando fue poco', () => {
  const s = startSession(status({ pointerArmed: false }), 0)
  for (const [i, armed] of [false, false, false, true].entries()) feedSession(s, status({ pointerArmed: armed }), i + 1)
  const sum = summarizeSession(s, 5)
  assert.equal(sum.armedShare, 0.25)
  assert.match(renderReport(sum, {}), /Puntero activado:\*\* 25 %.*poco/)
})

test('sin motor en marcha no se incorpora nada', () => {
  const s = startSession(status(), 0)
  feedSession(s, { running: false, eventCounts: { PAUSE: 9 } }, 1)
  assert.equal(summarizeSession(s, 2).samples, 0)
})

test('el informe en Markdown incluye datos de la prueba y no contiene puntos de la mano', () => {
  const s = startSession(status(), 0, { gesture: 'clic derecho', attempts: 10 })
  feedSession(s, status({ gesture: 'PINZA_MEDIO', landmarks: [[0.1, 0.2]] }), 1)
  feedSession(s, status({ gesture: 'PINZA_MEDIO', eventCounts: { RIGHT_CLICK: 1 } }), 1.3)
  feedSession(s, status({ gesture: 'NONE', eventCounts: { RIGHT_CLICK: 1 } }), 2)
  const md = renderReport(summarizeSession(s, 3), { meta: s.meta, labels: { PINZA_MEDIO: 'Pinza con el medio' }, config: { windowSwipe: true }, startedAt: '22-11-2026' })
  assert.match(md, /\*\*Gesto probado:\*\* clic derecho/)
  assert.match(md, /\| Clic derecho \(`RIGHT_CLICK`\) \| 1 \|/)
  assert.match(md, /Pinza con el medio/)
  assert.match(md, /"windowSwipe": true/)
  assert.doesNotMatch(md, /0\.1, ?0\.2|landmarks/)
})

test('destino de cada evento: solo lo nuevo desde el inicio, tiempo en Controlar y motor reiniciado', () => {
  const s = startSession(status({ deliveryCounts: { LEFT_CLICK: { BLOQUEADO_OBSERVAR: 4 } } }), 0)
  feedSession(s, status({ mode: 'CONTROL', deliveryCounts: { LEFT_CLICK: { BLOQUEADO_OBSERVAR: 4, SO: 2 }, MINIMIZE_WINDOW: { VENTANA_OWN_WINDOW: 1 } } }), 1)
  // El motor se reinicia: los conteos vuelven a cero y lo medido no se pierde.
  feedSession(s, status({ mode: 'CONTROL', deliveryCounts: { LEFT_CLICK: { BLOQUEADO_PAUSA: 1 } } }), 2)
  feedSession(s, status({ deliveryCounts: { LEFT_CLICK: { BLOQUEADO_PAUSA: 1, SO: 1 } } }), 3)
  const sum = summarizeSession(s, 4)
  assert.deepEqual(sum.delivery, {
    LEFT_CLICK: { SO: 3, BLOQUEADO_PAUSA: 1 },
    MINIMIZE_WINDOW: { VENTANA_OWN_WINDOW: 1 },
  })
  assert.ok(Math.abs(sum.controlShare - 2 / 3) < 1e-9)
  const md = renderReport(sum)
  assert.match(md, /## Adónde llegó cada evento/)
  assert.match(md, /Clic izquierdo \(`LEFT_CLICK`\) \| llegó al sistema operativo \(`SO`\) \| 3 \|/)
  assert.match(md, /la ventana activa era ZeroTouch \(`VENTANA_OWN_WINDOW`\) \| 1 \|/)
  assert.match(md, /Tiempo en Controlar:\*\* 67 %/)
})

test('pinza: motivos nuevos desde el inicio, con motor reiniciado, y su sección en el informe', () => {
  const s = startSession(status({ pinchDiag: { PINZA: 4 } }), 0)
  feedSession(s, status({ pinchDiag: { PINZA: 6, INDICE_JUNTO_AL_MEDIO: 3 } }), 1)
  feedSession(s, status({ pinchDiag: { OTRO_GESTO_PESTANAS: 2 } }), 2)
  const sum = summarizeSession(s, 3)
  assert.deepEqual(sum.pinch, { PINZA: 2, INDICE_JUNTO_AL_MEDIO: 3, OTRO_GESTO_PESTANAS: 2 })
  const md = renderReport(sum)
  assert.match(md, /Fotogramas con el pulgar tocando el índice: 7\./)
  assert.match(md, /índice pegado al medio .*\(`INDICE_JUNTO_AL_MEDIO`\) \| 3 \|/)
  assert.match(md, /ganó otro gesto: PESTANAS \(`OTRO_GESTO_PESTANAS`\) \| 2 \|/)
})
