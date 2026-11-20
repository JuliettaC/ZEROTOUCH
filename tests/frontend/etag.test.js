import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { modeEtag, profileEtag } from '../../src/sync/etag.js'
import { modeEtag as serverModeEtag, profileEtag as serverProfileEtag } from '../../backend/src/domain/etag.js'

// Vectores compartidos con backend/test/resources/borrado.test.js: el algoritmo del cliente y el del servidor
// deben producir exactamente estos valores, o el servidor rechazaría (412) todo borrado legítimo.
const { vectores } = JSON.parse(readFileSync(new URL('../../contracts/etag-vectores.json', import.meta.url), 'utf8'))

test('el ETag del cliente coincide con los vectores del servidor', async () => {
  assert.ok(vectores.length >= 8)
  for (const v of vectores) {
    const got = v.kind === 'modo' ? await modeEtag(v.id, v.version) : await profileEtag(v.id, v.version, v.modes)
    assert.equal(got, v.etag, v.nombre)
  }
})

test('cliente y servidor coinciden también con datos que no están en los vectores', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `${(i + 1).toString(16).padStart(8, '0')}-aaaa-4bbb-8ccc-${(i * 977).toString(16).padStart(12, '0')}`)
  const modes = ids.map((id, i) => ({ id, version: (i % 5) + 1 }))
  assert.equal(await profileEtag(ids[0], 9, modes), serverProfileEtag(ids[0], 9, modes))
  assert.equal(await profileEtag(ids[0], 9, [...modes].reverse()), serverProfileEtag(ids[0], 9, modes), 'el orden no importa')
  assert.equal(await modeEtag(ids[3], 41), serverModeEtag(ids[3], 41))
  assert.notEqual(await profileEtag(ids[0], 9, modes), await profileEtag(ids[0], 10, modes), 'la versión del perfil cuenta')
  assert.notEqual(await profileEtag(ids[0], 9, modes), await profileEtag(ids[0], 9, modes.slice(1)), 'un modo de menos cuenta')
  assert.notEqual(await modeEtag(ids[3], 41), await profileEtag(ids[3], 41, []), 'un modo y un perfil nunca comparten ETag')
})
