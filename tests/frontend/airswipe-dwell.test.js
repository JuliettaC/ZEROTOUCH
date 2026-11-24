import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CLICK_AFTER_DWELL_MS,
  DWELL_MS,
  GRACE_MS,
  clickKey,
  createDwell,
  cursorInWindow,
  dwellLayout,
  hitTest,
  needFor,
  stepDwell,
} from '../../src/airswipe/dwell.js'
import { buildSuggester, currentWord, planKey, planSuggestion, suggest } from '../../src/airswipe/typing.js'
import { KEYBOARD_MODE_KEY, readKeyboardMode, windowSizeFor, writeKeyboardMode, writeKeyboardSize } from '../../src/airswipe/link.js'

const terms = JSON.parse(readFileSync(new URL('../../src/airswipe/terminos-recetas.json', import.meta.url), 'utf8'))
const memory = () => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
// Ventana grande en 1920×1080 al 100 % (airswipe_size de desktop/src/main.rs).
const layout = dwellLayout(1180, 470)
const keyOf = id => layout.keys.find(k => k.id === id)
const center = k => ({ x: k.x + k.w / 2, y: k.y + k.h / 2 })
const need = needFor(layout.keys)

test('distribución: 27 letras, 4 sugerencias y 5 acciones grandes, dentro de la ventana y sin solapes', () => {
  const kinds = layout.keys.reduce((acc, k) => ({ ...acc, [k.kind]: (acc[k.kind] || 0) + 1 }), {})
  assert.deepEqual(kinds, { suggestion: 4, letter: 27, action: 5 })
  for (const k of layout.keys) {
    assert.ok(k.x >= 0 && k.y >= layout.textH && k.x + k.w <= 1180 + 0.5 && k.y + k.h <= 470 + 0.5, `${k.id} dentro`)
    if (k.kind === 'letter') assert.ok(k.w >= 110 && k.h >= 68, `letra de al menos 110×68 px: ${k.w}×${k.h}`)
  }
  for (let i = 0; i < layout.keys.length; i += 1) for (let j = i + 1; j < layout.keys.length; j += 1) {
    const a = layout.keys[i], b = layout.keys[j]
    assert.ok(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, `${a.id} y ${b.id} no se solapan`)
  }
})

test('prueba de impacto: el borde no empieza una tecla, el centro sí, y el temblor en el borde la conserva', () => {
  const g = keyOf('k:g')
  assert.equal(hitTest(layout.keys, center(g)), 'k:g')
  assert.equal(hitTest(layout.keys, { x: g.x + 2, y: g.y + g.h / 2 }), null, 'rozando el borde izquierdo no cuenta')
  // Ya sobre «g», salir 5 px por la derecha (dentro del margen) la mantiene; pasar al centro de «h» cambia.
  assert.equal(hitTest(layout.keys, { x: g.x + g.w + 5, y: g.y + g.h / 2 }, 'k:g'), 'k:g')
  assert.equal(hitTest(layout.keys, center(keyOf('k:h')), 'k:g'), 'k:h')
  assert.equal(hitTest(layout.keys, null, 'k:g'), null)
  // Una sugerencia vacía no cuenta.
  assert.equal(hitTest(layout.keys, center(keyOf('s0')), null, k => k.kind !== 'suggestion'), null)
})

test('permanencia: escribe UNA vez tras la espera y no repite mientras la mano siga quieta', () => {
  let s = createDwell(), fires = []
  for (let t = 0; t <= 4000; t += 100) {
    const r = stepDwell(s, 'k:a', t, need)
    s = r.state
    if (r.fire) fires.push([r.fire, t])
  }
  assert.deepEqual(fires, [['k:a', DWELL_MS.letter]])
})

test('permanencia: pasar de largo por teclas no escribe; salir y volver permite la letra doble', () => {
  let s = createDwell(), fires = []
  const feed = (key, from, to) => { for (let t = from; t < to; t += 100) { const r = stepDwell(s, key, t, need); s = r.state; if (r.fire) fires.push(r.fire) } }
  feed('k:q', 0, 300); feed('k:w', 300, 600); feed('k:e', 600, 900)
  assert.deepEqual(fires, [], 'camino de paso: nada')
  feed('k:l', 900, 1800); feed(null, 1800, 2200); feed('k:l', 2200, 3100)
  assert.deepEqual(fires, ['k:l', 'k:l'], '«ll» saliendo y volviendo')
})

test('permanencia: un hueco breve sin cursor no reinicia; uno largo sí', () => {
  let s = createDwell()
  s = stepDwell(s, 'k:a', 0, need).state
  s = stepDwell(s, 'k:a', 500, need).state
  s = stepDwell(s, null, 600, need).state
  const back = stepDwell(s, 'k:a', 600 + GRACE_MS - 50, need)
  assert.equal(back.state.key, 'k:a')
  assert.ok(back.progress > 0.5 && back.progress < 1, 'conserva el avance sin contar el hueco')
  let lost = stepDwell(stepDwell(s, null, 700, need).state, null, 700 + GRACE_MS + 200, need)
  assert.equal(lost.state.key, null)
})

test('las acciones (borrar, buscar) piden más espera que las letras', () => {
  assert.ok(need('a:enter') > need('k:a') && need('a:backspace') > need('k:a') && need('s0') > need('k:a'))
})

test('la pinza que llega tarde sobre la tecla recién escrita no la duplica', () => {
  const dup = clickKey(createDwell(), 'k:a', 1000, { id: 'k:a', at: 700 })
  assert.equal(dup.write, false)
  assert.equal(dup.state.fired, true, 'y la permanencia no la vuelve a escribir')
  assert.equal(clickKey(createDwell(), 'k:a', 700 + CLICK_AFTER_DWELL_MS + 1, { id: 'k:a', at: 700 }).write, true)
  assert.equal(clickKey(createDwell(), 'k:b', 1000, { id: 'k:a', at: 900 }).write, true)
})

test('posición del cursor de la telemetría en píxeles de la ventana', () => {
  const ctx = { screen: { left: 0, top: 0, width: 1920, height: 1080 }, rect: { x: 370, y: 560, width: 1180, height: 470 } }
  assert.deepEqual(cursorInWindow({ cursorX: 0.5, cursorY: 0.75 }, ctx), { x: 590, y: 250 })
  assert.equal(cursorInWindow({ cursorX: 'x' }, ctx), null)
})

test('escritura: espacio sin dobles, borrar, borrar palabra, limpiar y buscar', () => {
  assert.deepEqual(planKey('', { kind: 'letter', value: 'p' }), { effects: [{ type: 'text', text: 'p' }], text: 'p' })
  assert.equal(planKey('', { kind: 'action', value: 'space' }).effects.length, 0, 'sin espacio inicial')
  assert.equal(planKey('pollo ', { kind: 'action', value: 'space' }).effects.length, 0, 'sin doble espacio')
  assert.equal(planKey('pollo', { kind: 'action', value: 'space' }).text, 'pollo ')
  assert.equal(planKey('pollo', { kind: 'action', value: 'backspace' }).text, 'poll')
  const word = planKey('receta de poll', { kind: 'action', value: 'word' })
  assert.equal(word.text, 'receta de ')
  assert.equal(word.effects.length, 4)
  assert.equal(planKey('receta de ', { kind: 'action', value: 'word' }).text, 'receta ')
  const clear = planKey('receta de', { kind: 'action', value: 'clear' })
  assert.equal(clear.text, '')
  assert.equal(clear.effects.length, 9)
  assert.ok(clear.effects.every(e => e.key === 'backspace'))
  assert.equal(planKey('', { kind: 'action', value: 'clear' }).effects.length, 0, 'limpiar no borra texto que no escribió este teclado')
  const search = planKey('lasaña ', { kind: 'action', value: 'enter' })
  assert.deepEqual(search.effects, [{ type: 'key', key: 'enter' }])
  assert.equal(search.text, '')
  assert.equal(search.searched, 'lasaña')
})

test('sugerencia: completa solo lo que falta y corrige la tilde', () => {
  assert.deepEqual(planSuggestion('lasa', 'lasaña').effects, [{ type: 'text', text: 'ña ' }])
  assert.equal(planSuggestion('lasa', 'lasaña').text, 'lasaña ')
  const accent = planSuggestion('pan de cancion', 'canción')
  assert.equal(accent.effects.filter(e => e.key === 'backspace').length, 2)
  assert.deepEqual(accent.effects.at(-1), { type: 'text', text: 'ón ' })
  assert.equal(accent.text, 'pan de canción ')
  assert.equal(planSuggestion('rece', 'receta de').text, 'receta de ')
  assert.equal(currentWord('receta de pol'), 'pol')
})

test('sugerencias de recetas primero, luego el léxico; sin tildes al comparar', () => {
  const lexicon = { palabras: ['lasaña', 'lasitud', 'pollera', 'polla', 'pollo', 'canción'], pesos: [10, 200, 150, 5, 100, 50] }
  const s = buildSuggester(terms, lexicon)
  assert.deepEqual(suggest(s, ''), [], 'con el teclado recién abierto no se sugiere nada')
  assert.deepEqual(suggest(s, 'pollo '), [], 'tras un espacio tampoco: hasta escribir la primera letra')
  assert.ok(suggest(s, 'r').includes('receta de'), 'con una letra ya aparecen los términos de recetas')
  assert.equal(suggest(s, 'las')[0], 'lasaña', 'el término de recetas va antes que una palabra más frecuente')
  assert.ok(suggest(s, 'cancio').includes('canción'))
  assert.ok(!suggest(s, 'pollo').includes('pollo'), 'no propone la palabra ya completa')
  assert.ok(suggest(s, 'pol').length <= 4)
})

test('modo del teclado: permanencia por defecto y siempre con la ventana grande', () => {
  const storage = memory()
  assert.equal(readKeyboardMode(storage), 'dwell')
  assert.equal(windowSizeFor(storage), 'large')
  writeKeyboardMode(storage, 'trace')
  assert.equal(storage.m.get(KEYBOARD_MODE_KEY), 'trace')
  assert.equal(windowSizeFor(storage), 'compact', 'el trazo usa el tamaño guardado')
  writeKeyboardSize(storage, 'large')
  assert.equal(windowSizeFor(storage), 'large')
  const blocked = { getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') } }
  assert.equal(readKeyboardMode(blocked), 'dwell')
})

test('recorrido completo: escribir «pollo» con el cursor, corregir y buscar', () => {
  // Simula la telemetría a 10 Hz: el cursor va al centro de cada tecla y se queda quieto.
  let s = createDwell(), text = '', sent = []
  const press = id => {
    const key = keyOf(id)
    const plan = planKey(text, key)
    sent.push(...plan.effects)
    text = plan.text
  }
  let t = 0
  const visit = (id, ms) => {
    for (const end = t + ms; t < end; t += 100) {
      const hit = hitTest(layout.keys, center(keyOf(id)), s.key)
      const r = stepDwell(s, hit, t, need)
      s = r.state
      if (r.fire) press(r.fire)
    }
  }
  for (const id of ['k:p', 'k:o', 'k:l', 'k:k', 'k:l', 'k:l', 'k:o', 'k:o']) visit(id, 1000)
  assert.equal(text, 'polklo', 'la «o» repetida sin salir de la tecla no se duplica; la «k» es un error')
  visit('k:j', 300) // salir de la «o»
  visit('a:backspace', 1200)
  assert.equal(text, 'polkl')
  visit('a:word', 1200)
  assert.equal(text, '')
  for (const id of ['k:p', 'k:o', 'k:l', 'k:j', 'k:l', 'k:o']) visit(id, 1000)
  assert.equal(text, 'poljlo')
  visit('a:clear', 1200)
  for (const id of ['k:p', 'k:o', 'k:l', 'k:k', 'k:l', 'k:o', 'a:space', 'a:enter']) visit(id, id.startsWith('a:') ? 1200 : 1000)
  assert.equal(text, '', 'buscar deja el campo listo para otra búsqueda')
  assert.deepEqual(sent.slice(-2), [{ type: 'key', key: 'space' }, { type: 'key', key: 'enter' }])
})
