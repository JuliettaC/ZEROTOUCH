import test from 'node:test'
import assert from 'node:assert/strict'
import { previewCaption, drawPreview } from '../../src/engine/previewOverlay.js'

test('la leyenda muestra FPS, gesto y pinza', () => {
  assert.equal(previewCaption({ fps: 15, gesture: 'PINCH', pinchRatio: 0.2134, gestureLabels: { PINCH: 'Pinza' } }), '15 FPS · Pinza · pinza 0.21')
})

test('sin gesto ni pinza la leyenda sigue mostrando los FPS', () => {
  assert.equal(previewCaption({ fps: 9, gesture: 'NONE', pinchRatio: null }), '9 FPS · Sin gesto')
  assert.equal(previewCaption({ fps: undefined }), '0 FPS · Sin gesto')
})

function fakeContext() {
  const calls = []
  return new Proxy({ calls }, {
    get: (target, name) => name === 'calls' ? calls : name === 'measureText' ? () => ({ width: 100 }) : (...args) => calls.push([name, ...args]),
    set: () => true,
  })
}

test('dibuja 21 puntos y las conexiones solo con una mano completa', () => {
  const full = fakeContext()
  drawPreview(full, 400, 225, null, Array.from({ length: 21 }, (_, i) => [i / 21, 0.5]), '15 FPS')
  assert.equal(full.calls.filter(c => c[0] === 'arc').length, 21)
  const none = fakeContext()
  drawPreview(none, 400, 225, null, [], '15 FPS')
  assert.equal(none.calls.filter(c => c[0] === 'arc').length, 0)
  assert.ok(none.calls.some(c => c[0] === 'fillText'))
})
