// Verificación de la aplicación Tauri REAL (zerotouch-desktop.exe) contra un backend temporal aislado.
// Uso: npm run desktop:build && npm run verify:tauri   (Windows; abre ventanas reales durante ~1 minuto)
//
// Qué hace y qué NO hace:
// - Backend: proceso real de backend/src/server.js con base SQLite temporal (loopback, NODE_ENV=test). Nada de bases reales.
// - App: el .exe real con un perfil de WebView2 TEMPORAL (no toca tus datos; si no queda aislado, aborta antes de escribir)
//   y un puerto de depuración de WebView2 solo en 127.0.0.1 para leer y accionar las ventanas.
// - Motor: solo en OBSERVACIÓN y con un índice de cámara inexistente (9): no abre ninguna cámara, no puede pasar a
//   CONTROL y por tanto no puede inyectar ratón ni teclado. No se mueve el puntero ni se envían teclas del sistema.
// - Solo se cierran los procesos que este script lanzó. Las capturas y resultados van a tmp/verificacion-tauri-real/.
// No sustituye la prueba manual con cámara y manos (ver PROGRESO.md): gestos, clic por pinza sobre la overlay y escritura real.
import { fork, spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url))).split(path.sep).join('/')
const OUT = `${ROOT}/tmp/verificacion-tauri-real`
mkdirSync(OUT, { recursive: true })
const PS1 = `${ROOT}/scripts/verificar-tauri-real.ps1`
const EXE = `${ROOT}/desktop/target/debug/zerotouch-desktop.exe`
const CDP_PORT = Number(process.env.ZEROTOUCH_CDP_PORT ?? 9333)
const url = file => pathToFileURL(`${ROOT}/${file}`).href
const { openDatabase } = await import(url('backend/src/config/database.js'))
const { tokenFromOutbox } = await import(url('backend/test/helpers/correo.js'))
const { createDefaultState } = await import(url('src/data/preferences.js'))
const Database = createRequire(`${ROOT}/backend/package.json`)('better-sqlite3')

if (!existsSync(EXE)) { console.error('Falta el ejecutable. Compila primero: npm run desktop:build'); process.exit(2) }
const running = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-Process -Name 'zerotouch-desktop' -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: 'utf8' }).trim()
if (running !== '0') { console.error('Hay una instancia de ZeroTouch abierta: ciérrala antes (esta prueba no toca la tuya).'); process.exit(2) }
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then(() => true, () => false)) { console.error(`El puerto ${CDP_PORT} ya está en uso; define ZEROTOUCH_CDP_PORT con otro.`); process.exit(2) }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(ok ? '✔' : '✖', name, detail === '' ? '' : `· ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------- CDP (WebView2 de la app real)
const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page')
const findTarget = async predicate => (await targets()).find(predicate)
const isMain = t => t.url.includes('tauri.localhost') && !t.url.includes('#airswipe')
const isOverlay = t => t.url.includes('#airswipe')
function cdp(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP ${method}: tiempo agotado`)) }, 40000)
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })))
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      clearTimeout(timer); ws.close()
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`)); else resolve(message.result)
    })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP ${method}: error de conexión`)) })
  })
}

// Ayudas que se inyectan en la página (se serializan con toString: no se ejecutan en Node).
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = fn(); if (value) return value; await wait(100) } throw new Error('Tiempo agotado: ' + fn.toString().slice(0, 140)) }
const clickText = (selector, label, root = document) => { const el = [...root.querySelectorAll(selector)].find(e => e.textContent.trim().includes(label) && !e.disabled); if (!el) throw new Error('No hay ' + selector + ' con «' + label + '»'); el.click(); return el }
const fill = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args)
const settle = async (fn) => { try { return { ok: true, value: await fn() } } catch (error) { return { ok: false, code: error?.code ?? null, message: String(error?.message ?? error) } } }
const HELPERS = Object.entries({ wait, until, clickText, fill, invoke, settle }).map(([name, fn]) => `const ${name} = ${fn.toString()};`).join('\n')

async function run(target, fn, args = {}) {
  const expression = `(async () => { ${HELPERS}\nreturn await (${fn.toString()})(${JSON.stringify(args)}) })()`
  const result = await cdp(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 38000 })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const main = () => findTarget(isMain)
const screenshot = async (target, name) => { const { data } = await cdp(target, 'Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64')); return `${OUT}/${name}.png` }
const winState = pid => { const raw = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${PS1}`, '-ProcessId', String(pid)], { encoding: 'utf8' }); const data = JSON.parse(raw); data.windows = [].concat(data.windows ?? []); return data }

// ---------------------------------------------------------------- escenario
const temp = mkdtempSync(path.join(tmpdir(), 'zt-real-'))
const database = path.join(temp, 'real.sqlite')
let backend, app
const cleanup = async () => {
  try { if (app?.pid) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ya cerrada */ }
  try { backend?.kill() } catch { /* ya cerrado */ }
  await delay(800)
  try { rmSync(temp, { recursive: true, force: true }) } catch { /* se borra al reiniciar */ }
}

try {
  // 1. Backend temporal aislado y cuenta de prueba verificada.
  openDatabase(database, { initialize: true }).close()
  backend = fork(`${ROOT}/backend/src/server.js`, [], { cwd: temp, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, DATABASE_PATH: database, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3000', SESSION_TTL_SECONDS: '28800' } })
  backend.stderr.resume()
  const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('backend no inició')), 15000); backend.once('message', m => { clearTimeout(timer); resolve(m.port) }) })
  const base = `http://127.0.0.1:${port}/api/v1`
  const username = `ui_real_${randomBytes(3).toString('hex')}`, correo = `${username}@ejemplo.test`, password = `Zt-${randomBytes(9).toString('base64url')}-2026`
  const http = async (method, route, body, session) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
  }
  const registro = await http('POST', '/auth/registro', { nombre_usuario: username, correo, contrasena: password })
  const token = await tokenFromOutbox(path.join(temp, 'correo-saliente'), correo)
  const verificada = await http('POST', '/auth/verificacion', { token })
  const login = await http('POST', '/auth/login', { nombre_usuario: username, contrasena: password })
  const other = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.body.data.csrf_token }   // «otro equipo»: misma cuenta, otra sesión
  const userId = login.body.data.usuario.id
  check('backend temporal con cuenta de prueba verificada', registro.status === 202 && verificada.status === 200 && login.status === 200, `loopback:${port}`)

  // 2. La app real, con perfil de WebView2 temporal y depuración solo en loopback.
  app = spawn(EXE, [], { env: { ...process.env, ZEROTOUCH_BACKEND_URL: `http://127.0.0.1:${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(temp, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` }, stdio: 'ignore' })
  let page
  for (let i = 0; i < 80 && !page; i += 1) { await delay(500); try { page = await findTarget(isMain) } catch { /* aún arrancando */ } }
  check('la app real arranca y expone su ventana principal', page, page?.url)
  // El destino aparece antes de que el documento termine de cargar: se espera a que esté realmente listo.
  let ready = false
  for (let i = 0; i < 80 && !ready; i += 1) {
    try { ready = await run(page, async () => document.readyState === 'complete' && location.origin === 'https://tauri.localhost' && Boolean(window.__TAURI__?.core?.invoke) && Boolean(document.querySelector('.app-header'))) } catch { ready = false }
    if (!ready) { await delay(500); page = (await main()) ?? page }
  }
  if (!ready) throw new Error('La ventana principal no terminó de cargar')
  const env = await run(page, async () => ({ tauri: Boolean(window.__TAURI__?.core?.invoke), origin: location.origin, secure: isSecureContext, subtle: Boolean(crypto.subtle), storageEmpty: localStorage.length === 0, info: await invoke('backend_info') }))
  check('puente Tauri presente, contexto seguro y crypto.subtle disponible (necesario para el ETag)', env.tauri && env.secure && env.subtle, { origin: env.origin })
  const isolated = existsSync(path.join(temp, 'webview')) && readdirSync(path.join(temp, 'webview')).length > 0
  check('el perfil de WebView2 es el temporal (sin datos tuyos) y el backend es el temporal', isolated && env.storageEmpty && env.info.base === `http://127.0.0.1:${port}` && env.info.local === true, { carpetaTemporalEnUso: isolated, ...env.info })
  if (!isolated || !env.storageEmpty) throw new Error('El perfil de WebView2 no está aislado: se aborta ANTES de escribir nada')

  // 3. Preferencias de la cuenta con la cámara en un índice inexistente (el motor nunca abrirá un dispositivo real).
  const seeded = createDefaultState(); seeded.device = { ...seeded.device, cameraIndex: 9 }
  await run(page, async ({ key, value }) => { localStorage.setItem(key, value) }, { key: `zerotouch:prefs:v2:${userId}`, value: JSON.stringify(seeded) })
  await cdp(page, 'Page.reload'); await delay(2500)
  page = await main()
  await run(page, async () => { await until(() => document.querySelector('.app-header')) })

  // 4. Inicio de sesión y sincronización por la interfaz real (bridge Rust → HTTP → backend).
  const logged = await run(page, async ({ user, pass }) => {
    document.querySelector('.account-button').click()
    await until(() => document.querySelector('dialog[open] input[name=username]'))
    fill(document.querySelector('dialog[open] input[name=username]'), user); fill(document.querySelector('dialog[open] input[name=password]'), pass)
    document.querySelector('dialog[open] form').requestSubmit()
    await until(() => !document.querySelector('dialog[open]'))
    await until(() => document.querySelector('.account-button').innerText.includes(user))
    return { modes: [...document.querySelectorAll('.mode-option strong')].map(e => e.textContent) }
  }, { user: username, pass: password })
  check('inicio de sesión por la interfaz real y espacio de la cuenta cargado', logged.modes.length === 3, logged.modes)

  const syncUi = () => run(page, async () => {
    document.querySelector('.account-button').click()
    await until(() => document.querySelector('dialog[open]'))
    clickText('dialog[open] button', 'Sincronizar')
    await wait(500)
    await until(() => !document.querySelector('dialog[open] .dialog-actions .button.primary')?.innerText.includes('Sincronizando'), 30000)
    await until(() => document.querySelector('dialog[open] .sync-result'), 10000)
    await wait(300)
    return { report: text('.sync-result'), conflicts: [...document.querySelectorAll('dialog[open] .sync-conflicts li p')].map(p => p.innerText), options: [...document.querySelectorAll('dialog[open] .sync-conflicts label')].map(l => l.innerText.trim()) }
    function text(selector) { return document.querySelector('dialog[open] ' + selector)?.innerText }
  })
  const decideUi = (label) => run(page, async ({ label }) => {
    const radio = [...document.querySelectorAll('dialog[open] .sync-conflicts input[type=radio]')].find(i => i.parentElement.innerText.includes(label))
    if (!radio) throw new Error('No hay opción «' + label + '»')
    radio.click(); await wait(200)
    const before = document.querySelector('dialog[open] .sync-result')?.innerText
    document.querySelector('dialog[open] .sync-conflicts .button.primary').click()
    for (let i = 0; i < 150 && document.querySelector('dialog[open] .sync-result')?.innerText === before; i += 1) await wait(100)
    await wait(800)
    return { report: document.querySelector('dialog[open] .sync-result')?.innerText, conflicts: document.querySelectorAll('dialog[open] .sync-conflicts li').length }
  }, { label })
  const closeDialog = () => run(page, async () => { document.querySelector('dialog[open] .close-dialog')?.click(); await wait(300) })
  const deleteModeUi = name => run(page, async ({ name }) => {
    const row = [...document.querySelectorAll('.mode-option')].find(o => o.textContent.includes(name))
    row.querySelector('.icon-button').click(); await wait(200)
    row.querySelector('.tiny-button.danger').click(); await wait(300)
  }, { name })
  const listProfiles = async () => (await http('GET', '/perfiles', undefined, other)).body.data
  const listModes = async profileId => (await http('GET', `/perfiles/${profileId}/modos`, undefined, other)).body.data

  const first = await syncUi()
  const profile = (await listProfiles())[0]
  const modes = await listModes(profile.id)
  check('primera sincronización real: perfil y 3 modos creados en el backend', /4 creados/.test(first.report) && modes.length === 3, first.report)
  await closeDialog()

  // 4b. Creaciones idempotentes por el puente real (UI → Tauri → HTTP → SQLite v3).
  const registry = new Database(database, { readonly: true })
  const keyRows = registry.prepare('SELECT clave, recurso_tipo, recurso_id, usuario_id FROM idempotencia ORDER BY creado_en').all()
  registry.close()
  const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  check('cada creación de la primera sincronización llevó su Idempotency-Key (UUID v7), distinta y registrada en SQLite', keyRows.length === 4 && keyRows.every(r => uuidV7.test(r.clave) && r.usuario_id === userId) && new Set(keyRows.map(r => r.clave)).size === 4 && keyRows.filter(r => r.recurso_tipo === 'perfil').length === 1 && keyRows.filter(r => r.recurso_tipo === 'modo').length === 3, keyRows.map(r => `${r.recurso_tipo}:${r.clave.slice(0, 8)}…`))
  const profileKey = keyRows.find(r => r.recurso_tipo === 'perfil').clave
  const replayed = await run(page, async ({ key, name, description }) => ({
    capacidad: (await invoke('capabilities')).data.servidor.idempotencia,
    repeticion: await settle(() => invoke('create_profile', { p: { name, description }, idempotencyKey: key })),
    conflicto: await settle(() => invoke('create_profile', { p: { name: name + ' bis', description }, idempotencyKey: key })),
    mala: await settle(() => invoke('create_profile', { p: { name: 'No debe crearse', description }, idempotencyKey: key.toUpperCase() })),
  }), { key: profileKey, name: profile.nombre, description: profile.descripcion })
  check('puente real: repetir la clave devuelve el perfil original (repetida: true) sin crear otro', replayed.repeticion.ok && replayed.repeticion.value.repetida === true && replayed.repeticion.value.data.id === profile.id && (await listProfiles()).length === 1, { repetida: replayed.repeticion.value?.repetida, mismoId: replayed.repeticion.value?.data?.id === profile.id })
  check('puente real: la misma clave con otro cuerpo da IDEMPOTENCIA_CONFLICTO y una clave mal formada ni se envía (DATOS_INVALIDOS)', !replayed.conflicto.ok && replayed.conflicto.code === 'IDEMPOTENCIA_CONFLICTO' && !replayed.mala.ok && replayed.mala.code === 'DATOS_INVALIDOS' && (await listProfiles()).length === 1, { conflicto: replayed.conflicto.code, mala: replayed.mala.code })
  check('GET /capacidades anuncia servidor.idempotencia (uuid-v7, 30 días) por el puente real', replayed.capacidad?.clave === 'uuid-v7' && replayed.capacidad?.retencion_dias === 30, replayed.capacidad)

  // 4c. Mutación conjunta: la interfaz real crea cada modo CON sus asignaciones en una sola solicitud.
  const jointDb = new Database(database, { readonly: true })
  const jointCounts = {
    versiones: jointDb.prepare('SELECT DISTINCT version FROM modos_uso').all().map(r => r.version),
    asignaciones: jointDb.prepare('SELECT count(*) n FROM asignaciones_gestos').get().n,
    modosCompletos: jointDb.prepare('SELECT count(*) n FROM (SELECT modo_id FROM asignaciones_gestos GROUP BY modo_id HAVING count(*) = 13)').get().n,
  }
  jointDb.close()
  check('mutación conjunta por la interfaz real: 3 modos con sus 13 asignaciones cada uno y todos en la versión 1 (ningún PUT aparte)', jointCounts.versiones.length === 1 && jointCounts.versiones[0] === 1 && jointCounts.asignaciones === 39 && jointCounts.modosCompletos === 3, jointCounts)
  const target = modes[0]
  const jointBridge = await run(page, async ({ id, version }) => ({
    anuncio: (await invoke('capabilities')).data.servidor.modo_con_asignaciones,
    invalida: await settle(() => invoke('update_context', { id, c: { name: 'No debe aplicarse', version, gestos: [{ gesto_codigo: 'no_existe', accion_codigo: 'sin_accion', habilitado: true }] } })),
  }), { id: target.id, version: target.version })
  const afterRejected = (await http('GET', `/modos/${target.id}`, undefined, other)).body.data
  check('puente real: una asignación inválida dentro de la edición del modo se rechaza y no cambia NADA (ni nombre ni versión)', jointBridge.anuncio === true && !jointBridge.invalida.ok && jointBridge.invalida.code === 'DATOS_INVALIDOS' && afterRejected.nombre === target.nombre && afterRejected.version === target.version, { anuncio: jointBridge.anuncio, codigo: jointBridge.invalida.code, nombre: afterRejected.nombre, version: afterRejected.version })

  // 5. Borrado condicional por el puente real.
  const victim = modes.find(m => m.nombre === 'Asistencia Motriz')
  await deleteModeUi('Asistencia Motriz')
  const deleted = await syncUi()
  const afterDelete = (await http('GET', `/modos/${victim.id}`, undefined, other)).status
  check('borrado real con If-Match (UI → Tauri → HTTP → SQLite): el modo desaparece del backend', /1 borrado/.test(deleted.report) && afterDelete === 404, deleted.report)
  await closeDialog()

  const desk = modes.find(m => m.nombre.startsWith('Desk-Rest'))
  await deleteModeUi('Desk-Rest')
  const current = (await http('GET', `/modos/${desk.id}`, undefined, other)).body.data
  await http('PATCH', `/modos/${desk.id}`, { sensibilidad_puntero: 91, version: current.version }, other)   // otro equipo lo edita
  const clash = await syncUi()
  const stillThere = (await http('GET', `/modos/${desk.id}`, undefined, other)).body.data
  check('cambio en otro equipo: el backend real responde 412, no borra y la interfaz pide decisión', clash.conflicts.some(c => /cambió en otro equipo/.test(c)) && clash.options.length === 2 && stillThere.sensibilidad_puntero === 91, clash)
  await screenshot(await main(), 'conflicto-real')
  const recovered = await decideUi('Recuperarlo')
  check('«Recuperarlo» vuelve a descargar el modo con el cambio del otro equipo', /descargado/.test(recovered.report), recovered.report)
  await closeDialog()

  // 6. Cascada de perfil: un modo nuevo en otro equipo invalida el ETag de agregado.
  await run(page, async () => { const row = document.querySelector('.profile-bar .icon-button'); row.click(); await wait(200); document.querySelector('.profile-bar .tiny-button.danger').click(); await wait(300) })
  await http('POST', `/perfiles/${profile.id}/modos`, { nombre: 'Llegó desde otro equipo' }, other)
  const cascadeClash = await syncUi()
  const profileStill = (await http('GET', `/perfiles/${profile.id}`, undefined, other)).status
  check('perfil: un modo nuevo en otro equipo invalida el ETag de agregado (412) y no se borra nada', cascadeClash.conflicts.some(c => /perfil/i.test(c) && /cambió en otro equipo/.test(c)) && profileStill === 200, cascadeClash.conflicts)
  const forced = await decideUi('de todos modos')
  const db = new Database(database, { readonly: true })
  const counts = { perfiles: db.prepare('SELECT count(*) n FROM perfiles').get().n, modos: db.prepare('SELECT count(*) n FROM modos_uso').get().n, asignaciones: db.prepare('SELECT count(*) n FROM asignaciones_gestos').get().n }
  db.close()
  check('«Borrarlo de todos modos»: cascada atómica en SQLite real (perfil, modos y asignaciones)', /borrado/.test(forced.report) && counts.perfiles === 0 && counts.modos === 0 && counts.asignaciones === 0, { informe: forced.report, ...counts })
  await closeDialog()

  // 7. Motor real en OBSERVACIÓN, sin cámara (índice 9).
  // Salvaguarda: la interfaz reenvía su configuración al motor tras READY; si no usara la cámara 9 abriría la real.
  const seededCamera = await run(page, async ({ key }) => JSON.parse(localStorage.getItem(key))?.device?.cameraIndex, { key: `zerotouch:prefs:v2:${userId}` })
  if (seededCamera !== 9) throw new Error(`La interfaz usaría la cámara ${seededCamera}: se aborta sin arrancar el motor`)
  // Único arranque del motor: con la cámara 9, que no existe. Jamás se llama a engine_start sin configuración.
  const safeStart = await run(page, async ({ config }) => settle(() => invoke('engine_start', { config })), { config: { format_version: 2, cameraIndex: 9 } })
  let engineStatus
  for (let i = 0; i < 60; i += 1) {
    await delay(500)
    engineStatus = await run(page, async () => invoke('engine_status'))
    if (engineStatus.cameraOpen) { await run(page, async () => settle(() => invoke('engine_stop'))); throw new Error('Se abrió una cámara: motor detenido y prueba abortada') }
    if (engineStatus.appliedConfig) break
  }
  check('motor real arranca en OBSERVACIÓN sin abrir ninguna cámara', safeStart.ok && engineStatus.running && engineStatus.cameraOpen === false && engineStatus.mode === 'OBSERVATION' && engineStatus.appliedConfig?.cameraIndex === 9, { running: engineStatus.running, cameraOpen: engineStatus.cameraOpen, mode: engineStatus.mode, cameraIndex: engineStatus.appliedConfig?.cameraIndex })
  const control = await run(page, async () => settle(() => invoke('engine_set_mode', { mode: 'CONTROL' })))
  check('sin cámara el motor se niega a pasar a CONTROL (no puede inyectar entradas)', !control.ok && /CAMERA_NOT_OPEN|EMERGENCY_HOTKEY_UNAVAILABLE/.test(control.code ?? ''), control)
  await run(page, async () => settle(() => invoke('engine_set_mode', { mode: 'OBSERVATION' })))

  // 8. Ventana overlay real del teclado Air-Swipe.
  // La aplicación abre el teclado con `openKeyboard`, que da 8 s de margen hasta el primer latido de la overlay; llamar
  // directamente a los comandos se saltaría ese margen y el guardia de huérfanos cerraría la ventana mientras carga.
  // Aquí se emula sembrando un latido; la comprobación 9 exige que luego lo REESCRIBA la propia overlay.
  const opened = await run(page, async () => { const seed = Date.now(); localStorage.setItem('zerotouch:airswipe:heartbeat', String(seed)); const g = await invoke('airswipe_window_open'); await invoke('engine_airswipe', { active: true }); return { g, seed } })
  const seedStamp = opened.seed
  let overlay
  for (let i = 0; i < 40 && !overlay; i += 1) { await delay(500); overlay = await findTarget(isOverlay) }
  check('la ventana overlay real se crea en #airswipe', overlay, overlay?.url)
  await run(overlay, async () => { await until(() => document.querySelectorAll('.as-key').length === 27, 30000) })
  const keys = await run(overlay, async () => ({ keys: document.querySelectorAll('.as-key').length, message: document.querySelector('.as-message')?.textContent, buttons: [...document.querySelectorAll('.as-action')].map(b => b.textContent.trim()) }))
  check('la overlay carga el léxico y dibuja las 27 teclas en WebView2 real', keys.keys === 27, keys)

  // 9. LA SUPOSICIÓN CLAVE: ¿comparten localStorage la ventana principal y la overlay?
  await delay(2200)
  const beat = await run(await main(), async () => ({ heartbeat: localStorage.getItem('zerotouch:airswipe:heartbeat'), now: Date.now() }))
  const age = beat.heartbeat ? beat.now - Number(beat.heartbeat) : null
  check('localStorage compartido entre ventanas: la principal lee el latido que REESCRIBE la overlay', age !== null && age >= 0 && age < 3500 && Number(beat.heartbeat) > seedStamp + 300, { edadMs: age, posteriorAlSembrado: beat.heartbeat ? Number(beat.heartbeat) - seedStamp : null })
  const pageState = await run(await main(), async () => { window.history.pushState({}, '', '/teclado'); window.dispatchEvent(new PopStateEvent('popstate')); await until(() => document.querySelector('.airswipe-state-line')?.textContent.includes('abierto'), 8000); return { line: document.querySelector('.airswipe-state-line')?.textContent, button: [...document.querySelectorAll('main button.button.primary')].map(b => b.textContent.trim()) } })
  check('la página /teclado detecta el teclado abierto y ofrece cerrarlo', /abierto/.test(pageState.line) && pageState.button.includes('Cerrar teclado'), pageState)

  // 10. Ventana nativa: estilos, foco, geometría y escala frente a lo que informa el puente.
  const rect = await run(await main(), async () => invoke('airswipe_window_rect'))
  const win = winState(app.pid)
  const overlayWin = win.windows.find(w => w.title.includes('Air-Swipe'))
  const mainWin = win.windows.find(w => w.title === 'ZEROTOUCH')
  const titleBar = overlayWin ? overlayWin.clientY - overlayWin.y : null
  check('overlay nativa: sin barra de título, siempre encima y NO activable (WS_EX_NOACTIVATE)', overlayWin && overlayWin.noActivate && overlayWin.topmost && titleBar < 20 && overlayWin.visible, { desfaseVerticalDelContenido: titleBar, estiloEx: overlayWin?.exStyleHex })
  check('la overlay NO se queda con el foco del sistema al crearse', overlayWin && !overlayWin.foreground, { primerPlano: win.foregroundTitle })
  check('el rectángulo del puente es el ÁREA CLIENTE nativa (donde se dibujan las teclas), en píxeles físicos', overlayWin && overlayWin.clientX === rect.x && overlayWin.clientY === rect.y && overlayWin.clientWidth === rect.width && overlayWin.clientHeight === rect.height, { puente: [rect.x, rect.y, rect.width, rect.height], cliente: overlayWin && [overlayWin.clientX, overlayWin.clientY, overlayWin.clientWidth, overlayWin.clientHeight], ventanaExterior: overlayWin && [overlayWin.x, overlayWin.y, overlayWin.width, overlayWin.height], escala: rect.scale, dpiVentana: overlayWin?.dpi })
  const css = await run(overlay, async () => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, origin: location.origin }))
  check('la vista web de la overlay ocupa exactamente ese rectángulo (CSS × escala = píxeles del puente)', Math.abs(css.w * css.dpr - rect.width) <= 1.5 && Math.abs(css.h * css.dpr - rect.height) <= 1.5, css)
  check('la overlay usa el mismo origen que la principal (https://tauri.localhost)', css.origin === 'https://tauri.localhost', css.origin)
  check('escritorio virtual del puente = métricas de Windows', rect.screen.left === win.virtualScreen.left && rect.screen.top === win.virtualScreen.top && rect.screen.width === win.virtualScreen.width && rect.screen.height === win.virtualScreen.height, { puente: rect.screen, windows: win.virtualScreen })
  check('la ventana principal sigue abierta junto a la overlay', Boolean(mainWin), { ventanas: win.windows.filter(w => w.title).map(w => w.title) })
  check('la geometría cabe en el escritorio visible', overlayWin && rect.x >= win.virtualScreen.left && rect.y >= win.virtualScreen.top && rect.x + rect.width <= win.virtualScreen.left + win.virtualScreen.width && rect.y + rect.height <= win.virtualScreen.top + win.virtualScreen.height, { rect: [rect.x, rect.y, rect.width, rect.height] })
  await screenshot(overlay, 'overlay-real')

  // 11. Overlay → puente → motor real: tocar una tecla sin CONTROL debe rechazarse con la compuerta del motor.
  const keyCenter = await run(overlay, async () => { const r = document.querySelector('.as-key[aria-label="Tecla h"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp(overlay, 'Input.dispatchMouseEvent', { type, x: keyCenter.x, y: keyCenter.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
  await delay(900)
  const rejected = await run(overlay, async () => ({ message: document.querySelector('.as-message')?.textContent }))
  check('tocar una tecla en la overlay llega al motor real y este lo rechaza (CONTROL_REQUIRED): nada se escribe', /Controlar/.test(rejected.message ?? ''), rejected)
  const gates = await run(await main(), async () => ({ texto: await settle(() => invoke('engine_type_text', { text: 'hola' })), tecla: await settle(() => invoke('engine_press_key', { key: 'enter' })) }))
  check('el motor real rechaza TYPE_TEXT y PRESS_KEY fuera de CONTROL', !gates.texto.ok && gates.texto.code === 'CONTROL_REQUIRED' && !gates.tecla.ok && gates.tecla.code === 'CONTROL_REQUIRED', gates)

  // 12. Guardia de huérfanos real: la overlay deja de latir (colgada) → la principal apaga el modo teclado y cierra la ventana.
  await run(overlay, async () => { Storage.prototype.setItem = () => {}; localStorage.removeItem('zerotouch:airswipe:heartbeat') })
  let off = false, toast = null
  for (let i = 0; i < 40 && !off; i += 1) {
    await delay(500)
    const status = await run(await main(), async () => ({ airswipe: (await invoke('engine_status')).airswipe, toast: document.querySelector('.toast')?.innerText ?? null }))
    off = status.airswipe === false; toast = status.toast ?? toast
  }
  await delay(1500)
  const gone = !(await findTarget(isOverlay))
  const winAfter = winState(app.pid)
  check('guardia de huérfanos real: el motor apaga el modo teclado sin latido de la overlay', off, { aviso: toast })
  check('…y la ventana overlay se cierra (CDP y Windows)', gone && !winAfter.windows.some(w => w.title.includes('Air-Swipe')), { ventanas: winAfter.windows.map(w => w.title) })
  const aviso = await run(await main(), async () => document.querySelector('.toast')?.innerText ?? null)
  check('la persona recibe el aviso «se apagó el modo teclado»', /modo teclado Air-Swipe/.test(toast ?? aviso ?? ''), toast ?? aviso)

  // 13. Parada del motor: sin procesos huérfanos.
  await run(await main(), async () => settle(() => invoke('engine_stop')))
  await delay(1500)
  const python = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'motor_local' } | Measure-Object).Count"], { encoding: 'utf8' }).trim()
  check('tras engine_stop no queda ningún proceso del motor', python === '0', { procesos: python })

  // 14. Cerrar la ventana principal con la overlay abierta y el motor en marcha debe cerrarlo TODO (si no, la cámara
  //     quedaba encendida sin ventana principal desde la que controlarla). Motor otra vez con la cámara inexistente.
  let exited = app.exitCode !== null
  app.once('exit', () => { exited = true })
  await run(await main(), async ({ config }) => { localStorage.setItem('zerotouch:airswipe:heartbeat', String(Date.now())); await invoke('engine_start', { config }); await invoke('airswipe_window_open') }, { config: { format_version: 2, cameraIndex: 9 } })
  let overlayAgain
  for (let i = 0; i < 20 && !overlayAgain; i += 1) { await delay(500); overlayAgain = await findTarget(isOverlay) }
  const before = winState(app.pid).windows.filter(w => w.title).map(w => w.title)
  const sent = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${ROOT}/scripts/verificar-tauri-real-cerrar.ps1`, '-ProcessId', String(app.pid)], { encoding: 'utf8' }).trim()
  for (let i = 0; i < 40 && !exited; i += 1) await delay(500)
  await delay(1000)
  const pythonAfter = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'motor_local' } | Measure-Object).Count"], { encoding: 'utf8' }).trim()
  check('cerrar la ventana principal con la overlay abierta y el motor en marcha termina la aplicación', Boolean(overlayAgain) && exited, { antes: before, cierre: sent })
  check('…y no deja el motor (ni la cámara) vivo', pythonAfter === '0', { procesos: pythonAfter })
} catch (error) {
  check('la prueba terminó sin excepciones', false, String(error?.stack ?? error).slice(0, 600))
} finally {
  await cleanup()
  const failed = results.filter(r => !r.ok)
  console.log(`\nRESUMEN: ${results.length - failed.length}/${results.length} comprobaciones correctas${failed.length ? '; FALLAN: ' + failed.map(f => f.name).join(' | ') : ''}`)
  writeFileSync(`${OUT}/resultados.json`, JSON.stringify(results, null, 2))
  process.exitCode = failed.length ? 1 : 0
}
