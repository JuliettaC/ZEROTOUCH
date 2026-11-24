import assert from 'node:assert/strict'
import test from 'node:test'
import { readFavorites, saveFavorites, toggleFavorite } from '../../src/data/favorites.js'
import { BASIC_GESTURES } from '../../src/onboarding/onboarding.js'
import { gestures } from '../../src/data/gestures.js'

function localStorageFixture() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('los favoritos son locales, admiten gestos adicionales y conservan una lista vacía', () => {
  const storage = localStorageFixture()
  const initial = readFavorites(storage)
  assert.deepEqual(initial, BASIC_GESTURES)
  const extra = Object.keys(gestures).find(id => !initial.includes(id))
  const changed = toggleFavorite(initial, extra)
  saveFavorites(storage, changed)
  assert.deepEqual(readFavorites(storage), [...BASIC_GESTURES, extra])
  saveFavorites(storage, changed.reduce(toggleFavorite, changed))
  assert.deepEqual(readFavorites(storage), [])
})

test('descarta favoritos obsoletos o duplicados y recupera datos dañados', () => {
  const storage = localStorageFixture()
  saveFavorites(storage, ['click', 'obsoleto', 'click'])
  assert.deepEqual(readFavorites(storage), ['click'])
  assert.deepEqual(toggleFavorite(['click'], 'obsoleto'), ['click'])
  assert.deepEqual(readFavorites({getItem: () => '{'}), BASIC_GESTURES)
})

test('la ruta de la receta abre Gestos y reemplaza la entrada antigua del historial', async () => {
  const { currentPath, restoreRoute, pageUrl } = await import('../../src/app/routes.js')
  const replaced = []
  const browser = {
    location: { pathname: '/prueba' }, sessionStorage: localStorageFixture(),
    history: { replaceState: (_state, _title, url) => replaced.push(url) },
  }
  restoreRoute(browser)
  assert.deepEqual(replaced, [pageUrl('/calibracion')])
  assert.equal(currentPath('/prueba'), '/calibracion')
  assert.equal(currentPath('/index.html'), '/')
  assert.equal(currentPath('/diagnosticos'), '/diagnosticos')
})
