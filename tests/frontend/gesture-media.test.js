import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { GESTURE_IMAGES, imagesFor } from '../../src/data/gestureMedia.js'
import { gestures } from '../../src/data/gestures.js'

test('cada imagen de gesto existe en public/gestos y pertenece a un gesto visible', () => {
  for (const [id, files] of Object.entries(GESTURE_IMAGES)) {
    assert.ok(gestures[id] && !gestures[id].hidden, `${id} es un gesto de la lista`)
    assert.ok(files.length > 0, id)
    for (const file of files) {
      assert.match(file, /^[a-z0-9-]+\.(jpg|png|webp)$/, 'nombre seguro, sin rutas')
      assert.ok(existsSync(new URL(`../../public/gestos/${file}`, import.meta.url)), `falta public/gestos/${file}`)
    }
  }
})

test('desplazar alterna arriba y abajo; un gesto sin imagen devuelve una lista vacía (se ve su emoji)', () => {
  assert.deepEqual(imagesFor('scroll'), ['desplazar-arriba.jpg', 'desplazar-abajo.jpg'])
  assert.deepEqual(imagesFor('gesto_inexistente'), [])
})
