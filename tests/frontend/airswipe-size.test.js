import test from 'node:test'
import assert from 'node:assert/strict'
import { KEYBOARD_SIZE_KEY, otherKeyboardSize, readKeyboardSize, writeKeyboardSize } from '../../src/airswipe/link.js'
import { keyboardGeometry } from '../../src/airswipe/layout.js'

const memory = () => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }

test('el teclado es compacto por defecto y recuerda el tamaño elegido', () => {
  const storage = memory()
  assert.equal(readKeyboardSize(storage), 'compact')
  assert.equal(writeKeyboardSize(storage, 'large'), true)
  assert.equal(storage.m.get(KEYBOARD_SIZE_KEY), 'large')
  assert.equal(readKeyboardSize(storage), 'large')
  writeKeyboardSize(storage, 'compact')
  assert.equal(readKeyboardSize(storage), 'compact')
})

test('un valor desconocido o un almacenamiento bloqueado dan el compacto', () => {
  const storage = memory()
  storage.m.set(KEYBOARD_SIZE_KEY, 'gigante')
  assert.equal(readKeyboardSize(storage), 'compact')
  writeKeyboardSize(storage, 'gigante')
  assert.equal(storage.m.get(KEYBOARD_SIZE_KEY), 'compact', 'nunca se guarda un tamaño que el puente no conoce')
  const blocked = { getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') } }
  assert.equal(readKeyboardSize(blocked), 'compact')
  assert.equal(writeKeyboardSize(blocked, 'large'), false)
})

test('el botón alterna entre los dos tamaños', () => {
  assert.equal(otherKeyboardSize('compact'), 'large')
  assert.equal(otherKeyboardSize('large'), 'compact')
  assert.equal(otherKeyboardSize(undefined), 'large')
})

test('con el tamaño compacto (768×256 en 1920×1080) las 27 teclas caben y no se solapan', () => {
  const g = keyboardGeometry(768, 256)
  const rects = Object.values(g.rects)
  assert.equal(rects.length, 27)
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= g.bar && r.x + r.w <= 768 + 0.5 && r.y + r.h <= 256 + 0.5, 'dentro de la ventana y bajo la barra')
    assert.ok(r.w >= 30 && r.h >= 30, `tecla de al menos 30 px: ${r.w}×${r.h}`)
  }
  for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
    const a = rects[i], b = rects[j]
    assert.ok(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, 'sin solapes')
  }
})
