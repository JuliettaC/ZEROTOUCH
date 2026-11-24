import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventCursor, describeEvent, takeNewEvents } from '../../src/engine/appEvents.js'
import { MAX_TIMERS, addMinute, cancelTimer, formatRemaining, pauseTimer, remainingMs, resumeTimer, startTimer, tickTimers } from '../../src/data/timers.js'
import { defaultAssignments, gesturesWithAction } from '../../src/data/capabilities.js'
import { createDefaultState, getEffectiveSettings, updateActiveSettings } from '../../src/data/preferences.js'

const running = (eventSeq, recentEvents) => ({ running: true, eventSeq, recentEvents })
const ev = (seq, event, extra = {}) => ({ type: 'EVENT', seq, event, ...extra })

test('eventos: lo que ya estaba al conectar no se aplica; lo nuevo se entrega una vez y en orden', () => {
  let cursor = createEventCursor({ running: false, eventSeq: 0, recentEvents: [] })
  // Primer estado en marcha (p. ej. interfaz recargada con un TIMER antiguo en la lista): solo línea base.
  let step = takeNewEvents(cursor, running(3, [ev(3, 'TIMER')]))
  assert.deepEqual(step.events, [])
  cursor = step.cursor
  step = takeNewEvents(cursor, running(5, [ev(3, 'TIMER'), ev(5, 'MEDIA_NEXT', { injected: true }), ev(4, 'PRECISION', { active: true })]))
  assert.deepEqual(step.events.map(e => e.seq), [4, 5])
  cursor = step.cursor
  assert.deepEqual(takeNewEvents(cursor, running(5, [ev(5, 'MEDIA_NEXT')])).events, [], 'no se repite')
})

test('eventos: motor detenido y vuelto a arrancar, o reiniciado con secuencia menor', () => {
  let { cursor } = takeNewEvents(createEventCursor(running(0, [])), running(7, []))
  assert.equal(cursor.baseline, 0, 'el cursor creado con el motor en marcha ya tiene línea base')
  cursor = takeNewEvents(cursor, running(7, [ev(7, 'TIMER')])).cursor
  cursor = takeNewEvents(cursor, { running: false, eventSeq: 0, recentEvents: [] }).cursor
  const restarted = takeNewEvents(cursor, running(1, [ev(1, 'TIMER')]))
  assert.deepEqual(restarted.events, [], 'el primer estado tras arrancar solo fija la base')
  const reset = takeNewEvents({ baseline: 9, primed: true }, running(2, [ev(1, 'TIMER'), ev(2, 'MEDIA_NEXT')]))
  assert.deepEqual(reset.events.map(e => e.seq), [1, 2], 'secuencia menor sin parada: reinicio del motor')
})

test('avisos de multimedia y ventanas dicen si llegaron al sistema', () => {
  assert.match(describeEvent(ev(1, 'MEDIA_PLAY_PAUSE', { injected: true })).text, /Reproducir/)
  assert.equal(describeEvent(ev(1, 'MEDIA_NEXT', { injected: false })).tone, 'warn')
  assert.match(describeEvent(ev(1, 'MINIMIZE_WINDOW', { injected: true, result: 'MINIMIZED' })).text, /minimizada/)
  assert.match(describeEvent(ev(1, 'MINIMIZE_WINDOW', { injected: true, result: 'WIN_DOWN' })).text, /minimizada/)
  assert.match(describeEvent(ev(1, 'MINIMIZE_WINDOW', { injected: true, result: 'ALREADY_MINIMIZED' })).text, /ya estaba/)
  assert.match(describeEvent(ev(1, 'RESTORE_WINDOW', { injected: false })).text, /Controlar/)
  assert.equal(describeEvent(ev(1, 'AIRSWIPE_TRACE')), null, 'el trazo es del teclado, no de la ventana principal')
})

test('temporizadores: iniciar, pausar, reanudar, sumar un minuto y terminar una sola vez', () => {
  let { timers, added } = startTimer([], { minutes: 2, now: 0, id: 'a' })
  assert.equal(added, true)
  assert.equal(remainingMs(timers[0], 30_000), 90_000)
  timers = pauseTimer(timers, 'a', 30_000)
  assert.equal(remainingMs(timers[0], 100_000), 90_000, 'en pausa no corre')
  timers = resumeTimer(timers, 'a', 100_000)
  assert.equal(remainingMs(timers[0], 110_000), 80_000)
  timers = addMinute(timers, 'a', 110_000)
  assert.equal(remainingMs(timers[0], 110_000), 140_000)
  let tick = tickTimers(timers, 250_000)
  assert.deepEqual(tick.finished, ['a'])
  tick = tickTimers(tick.timers, 260_000)
  assert.deepEqual(tick.finished, [], 'avisa una sola vez')
  timers = addMinute(tick.timers, 'a', 300_000)
  assert.equal(timers[0].done, false, '+1 min a uno terminado lo vuelve a poner en marcha')
  assert.deepEqual(cancelTimer(timers, 'a'), [])
})

test('temporizadores: límite de simultáneos, minutos acotados y formato', () => {
  let timers = []
  for (let i = 0; i < MAX_TIMERS; i++) timers = startTimer(timers, { minutes: 1, now: 0, id: `t${i}` }).timers
  assert.equal(startTimer(timers, { minutes: 1, now: 0 }).added, false)
  assert.equal(startTimer([], { minutes: 999, now: 0 }).timers[0].duration, 120 * 60_000)
  assert.equal(startTimer([], { minutes: 0, now: 0 }).timers[0].duration, 60_000)
  assert.equal(formatRemaining(65_000), '1:05')
  assert.equal(formatRemaining(3_726_000), '1:02:06')
  assert.equal(formatRemaining(400), '0:01')
})

test('duración del temporizador por gesto: ajuste del equipo con valor por defecto y límites', () => {
  let state = createDefaultState()
  assert.equal(getEffectiveSettings(state).timerMinutes, 5)
  state = updateActiveSettings(state, { timerMinutes: 12 })
  assert.equal(state.device.timerMinutes, 12)
  assert.equal(getEffectiveSettings(state).timerMinutes, 12)
})

test('qué gesto realiza cada acción del modo', () => {
  const assignments = defaultAssignments()
  assert.deepEqual(gesturesWithAction('temporizador_iniciar', assignments), [])
  const custom = { ...assignments, pulgar_abajo: { accion: 'temporizador_iniciar', habilitado: true } }
  assert.deepEqual(gesturesWithAction('temporizador_iniciar', custom), ['pulgar_abajo'])
  assert.deepEqual(gesturesWithAction('temporizador_iniciar', { ...custom, pulgar_abajo: { accion: 'temporizador_iniciar', habilitado: false } }), [])
})

test('el gesto del temporizador inicia, pausa y reanuda (contrato: «inicia, pausa o reanuda»)', async () => {
  const { timerFromGesture } = await import('../../src/data/timers.js')
  let step = timerFromGesture([], { minutes: 3, now: 0, id: 'g1' })
  assert.equal(step.action, 'started')
  step = timerFromGesture(step.timers, { minutes: 3, now: 10_000, id: 'g2' })
  assert.equal(step.action, 'paused')
  assert.equal(step.timers.length, 1)
  step = timerFromGesture(step.timers, { minutes: 3, now: 50_000, id: 'g3' })
  assert.equal(step.action, 'resumed')
  assert.equal(remainingMs(step.timers[0], 50_000), 170_000)
  const done = tickTimers(step.timers, 1_000_000).timers
  assert.equal(timerFromGesture(done, { minutes: 3, now: 1_000_000, id: 'g4' }).action, 'started', 'uno terminado no se reanuda: se inicia otro')
})

test('editar un modo cambia nombre y categoría y lo deja pendiente de subir', async () => {
  const { updateMode, getActiveMode } = await import('../../src/data/preferences.js')
  let state = createDefaultState()
  const mode = getActiveMode(state)
  state = updateMode(state, mode.id, { nombre: '  Presentaciones ', categoria: 'oficina' })
  const edited = getActiveMode(state)
  assert.equal(edited.nombre, 'Presentaciones')
  assert.equal(edited.categoria, 'oficina')
  state = updateMode(state, mode.id, { categoria: 'inventada' })
  assert.equal(getActiveMode(state).categoria, 'oficina', 'una categoría fuera del catálogo se ignora')
})
