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
const isMain = t => t.url.includes('tauri.localhost') && !t.url.includes('#airswipe') && !t.url.includes('#hud')
const isOverlay = t => t.url.includes('#airswipe')
const isHud = t => t.url.includes('#hud')
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

  // 3b. Primera vez en este equipo (perfil de WebView2 nuevo): aparece la bienvenida; «Saltar» la cierra para siempre
  //     y deja el inicio de un solo botón. Perfiles y modos viven ahora en Ajustes.
  const welcome = await run(page, async () => { await until(() => document.querySelector('#welcome-title')); return document.querySelector('#welcome-title').textContent })
  const skipped = await run(page, async () => {
    clickText('button', 'Ya lo configuré: saltar')
    await until(() => document.querySelector('.start-button'))
    return { boton: document.querySelector('.start-button').textContent.trim(), botones: document.querySelectorAll('main button').length, guardado: JSON.parse(localStorage.getItem('zerotouch:bienvenida') ?? 'null') }
  })
  check('primera vez: aparece la bienvenida y «Saltar» deja un inicio con un solo botón, «Empezar»', /bienvenida/.test(welcome) && skipped.boton === 'Empezar' && skipped.botones === 1 && skipped.guardado?.done === true, { titulo: welcome, ...skipped })
  await run(page, async () => { window.history.pushState({}, '', '/ajustes'); window.dispatchEvent(new PopStateEvent('popstate')); await until(() => document.querySelector('.mode-option')) })

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
    // Por la etiqueta accesible: desde el 16-11 la fila tiene antes el botón ✎ «Editar …».
    row.querySelector('.icon-button[aria-label^="Eliminar"]').click(); await wait(200)
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

  // 7c. «Empezar» por la interfaz real con la cámara 9: como el motor ya corre, solo pide el control (no vuelve a
  //     arrancarlo). Debe esperar la cámara, avisar que no se abrió y quedarse en Observar, sin minimizar nada.
  const quick = await run(page, async () => {
    window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'))
    await until(() => document.querySelector('.start-button'))
    const label = document.querySelector('.start-button').textContent.trim()
    document.querySelector('.start-button').click()
    await until(() => document.querySelector('.toast-error'), 15000)
    return { boton: label, aviso: document.querySelector('.toast-error').innerText, estado: (await invoke('engine_status')).mode, titulo: document.querySelector('#start-title')?.textContent }
  })
  const afterQuick = winState(app.pid).windows.find(w => w.title === 'ZEROTOUCH')
  check('«Empezar» real sin cámara: avisa que la cámara no se abrió, sigue en Observar y no minimiza la ventana', quick.boton === 'Empezar a controlar' && /cámara no se abrió/.test(quick.aviso) && quick.estado === 'OBSERVATION' && afterQuick?.visible && afterQuick.width > 400, { ...quick, ventana: afterQuick && [afterQuick.width, afterQuick.height] })
  await run(page, async () => { document.querySelector('.toast-error button')?.click() })

  // 7b. Indicador flotante (HUD): la ventana principal lo abre sola al estar el motor en marcha.
  let hud
  for (let i = 0; i < 30 && !hud; i += 1) { await delay(500); hud = await findTarget(isHud) }
  check('el HUD real se abre en #hud al arrancar el motor', hud, hud?.url)
  const hudView = await run(hud, async () => { await until(() => document.querySelector('.hud-state')?.textContent, 10000); return { state: document.querySelector('.hud-state')?.textContent, action: document.querySelector('.hud-action')?.textContent ?? '', origin: location.origin, w: innerWidth, h: innerHeight } })
  const realStatus = await run(page, async () => invoke('engine_status'))
  // Con la cámara 9 (inexistente) el estado real es «Cámara no disponible»: el HUD debe decir eso, no inventar otro.
  check('el HUD muestra el estado REAL del motor (cámara inexistente → «Cámara no disponible») y la última acción', /Cámara no disponible/.test(hudView.state) && realStatus.running && !realStatus.cameraOpen && /^Última acción: /.test(hudView.action), { hud: hudView, motor: { running: realStatus.running, cameraOpen: realStatus.cameraOpen, lastEvent: realStatus.lastEvent } })
  check('el HUD usa el origen de la aplicación', hudView.origin === 'https://tauri.localhost', hudView.origin)
  const hudPerms = await run(hud, async () => ({ status: await settle(() => invoke('engine_status')), stop: await settle(() => invoke('engine_stop')), open: await settle(() => invoke('airswipe_window_open')), api: await settle(() => invoke('profiles', { offset: 0 })) }))
  const afterHudStop = await run(page, async () => invoke('engine_status'))
  check('el HUD solo puede LEER el estado: engine_stop, abrir el teclado y la API se rechazan desde él', hudPerms.status.ok && !hudPerms.stop.ok && !hudPerms.open.ok && !hudPerms.api.ok && afterHudStop.running, { status: hudPerms.status.ok, stop: hudPerms.stop.message, open: hudPerms.open.message, api: hudPerms.api.message, motorSigue: afterHudStop.running })
  const hudWin = winState(app.pid).windows.find(w => w.title.includes('HUD'))
  // Tauri conserva el bit WS_CAPTION en ventanas sin decoración: como en la overlay, se mide el desfase real del contenido.
  const hudTitleBar = hudWin ? hudWin.clientY - hudWin.y : null
  check('HUD nativo: sin barra de título, siempre encima, NO activable, transparente a los clics y sin foco', hudWin && hudWin.noActivate && hudWin.topmost && hudWin.clickThrough && hudTitleBar < 20 && !hudWin.foreground && hudWin.visible, { desfaseVerticalDelContenido: hudTitleBar, estiloEx: hudWin?.exStyleHex, foco: hudWin?.foreground })
  await screenshot(hud, 'hud-real')

  // 8. Ventana overlay real del teclado Air-Swipe.
  // La aplicación abre el teclado con `openKeyboard`, que da 8 s de margen hasta el primer latido de la overlay; llamar
  // directamente a los comandos se saltaría ese margen y el guardia de huérfanos cerraría la ventana mientras carga.
  // Aquí se emula sembrando un latido; la comprobación 9 exige que luego lo REESCRIBA la propia overlay.
  // Un único latido sembrado caduca a los 3,5 s (STALE_AFTER_MS): si la overlay tarda más en escribir el suyo, el guardia
  // de huérfanos la cierra. La app real da 8 s (OPEN_GRACE_MS); aquí se emula igual: se renueva la semilla hasta que la
  // overlay escriba su propio latido o pasen 8 s, y se MIDE cuánto tardó (dato para saber si el margen real alcanza).
  const opened = await run(page, async () => { const seed = Date.now(); localStorage.setItem('zerotouch:airswipe:heartbeat', String(seed)); const g = await invoke('airswipe_window_open'); await invoke('engine_airswipe', { active: true }); return { g, seed } })
  const seeds = new Set([String(opened.seed)])
  let seedStamp = opened.seed, firstBeatMs = null
  while (Date.now() - opened.seed < 8000) {
    await delay(300)
    const value = await run(page, async () => localStorage.getItem('zerotouch:airswipe:heartbeat'))
    if (value && !seeds.has(value)) { firstBeatMs = Date.now() - opened.seed; break }
    seedStamp = await run(page, async () => { const now = Date.now(); localStorage.setItem('zerotouch:airswipe:heartbeat', String(now)); return now })
    seeds.add(String(seedStamp))
  }
  let overlay
  for (let i = 0; i < 40 && !overlay; i += 1) { await delay(500); overlay = await findTarget(isOverlay) }
  // Diagnóstico si falla: sin latido + aviso de «modo teclado apagado» = el guardia la cerró; con latido y sin destino CDP = otra causa.
  const overlayToast = overlay ? null : await run(page, async () => document.querySelector('.toast')?.innerText ?? null)
  check('la ventana overlay real se crea en #airswipe y escribe su latido dentro del margen de 8 s de la app', overlay && firstBeatMs !== null, { url: overlay?.url, msHastaPrimerLatido: firstBeatMs, ...(overlay ? {} : { aviso: overlayToast }) })
  await run(overlay, async () => { await until(() => document.querySelectorAll('.as-key').length === 27, 30000) })
  const keys = await run(overlay, async () => ({ keys: document.querySelectorAll('.as-key').length, message: document.querySelector('.as-message')?.textContent, buttons: [...document.querySelectorAll('.as-action')].map(b => b.textContent.trim()) }))
  check('la overlay carga el léxico y dibuja las 27 teclas en WebView2 real', keys.keys === 27, keys)
  const alpha = await run(overlay, async () => { const a = c => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m ? m[1].split(',').map(Number) : []; return p.length === 4 ? p[3] : 1 }; return { body: a(getComputedStyle(document.body).backgroundColor), fondo: a(getComputedStyle(document.querySelector('.as-overlay')).backgroundColor), tecla: a(getComputedStyle(document.querySelector('.as-key')).backgroundColor) } })
  check('fondo del teclado semitransparente (página transparente, fondo < 1 y teclas más opacas que el fondo)', alpha.body === 0 && alpha.fondo > 0 && alpha.fondo < 1 && alpha.tecla > alpha.fondo, alpha)

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
  check('el teclado abre COMPACTO: ≤ 40 % del ancho y ≤ 26 % del alto del área de trabajo', rect.size === 'compact' && rect.width <= rect.work.width * 0.40 + 1 && rect.height <= rect.work.height * 0.26 + 1, { rect: [rect.width, rect.height], area: [rect.work.width, rect.work.height] })

  // 10b. Agrandar y achicar desde la propia overlay (botón ⤢/⤡): ventana nativa, rectángulo del puente y teclas en sincronía.
  const sized = async () => { await delay(900); const r = await run(await main(), async () => invoke('airswipe_window_rect')); const w = winState(app.pid).windows.find(x => x.title.includes('Air-Swipe')); const keys = await run(overlay, async () => document.querySelectorAll('.as-key').length); return { r, w, keys } }
  await run(overlay, async () => document.querySelector('.as-action[aria-label="Agrandar el teclado"]').click())
  const big = await sized()
  check('⤢ agranda el teclado real y el área cliente nativa coincide con el puente', big.w && big.r.width > rect.width && big.r.height > rect.height && big.w.clientWidth === big.r.width && big.w.clientHeight === big.r.height && big.keys === 27, { antes: [rect.width, rect.height], despues: [big.r.width, big.r.height], nativo: big.w && [big.w.clientWidth, big.w.clientHeight] })
  await run(overlay, async () => document.querySelector('.as-action[aria-label="Achicar el teclado"]').click())
  const small = await sized()
  const remembered = await run(await main(), async () => localStorage.getItem('zerotouch:airswipe:size'))
  check('⤡ lo devuelve al compacto, sigue sin foco y la preferencia queda guardada', small.w && small.r.width === rect.width && small.r.height === rect.height && !small.w.foreground && remembered === 'compact', { tamaño: [small.r.width, small.r.height], foco: small.w?.foreground, guardado: remembered })

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
  let hudGone = false
  for (let i = 0; i < 20 && !hudGone; i += 1) { await delay(500); hudGone = !(await findTarget(isHud)) && !winState(app.pid).windows.some(w => w.title.includes('HUD')) }
  check('con el motor detenido el HUD se cierra (CDP y Windows)', hudGone)

  // 14. Cerrar la ventana principal con la overlay abierta y el motor en marcha debe cerrarlo TODO (si no, la cámara
  //     quedaba encendida sin ventana principal desde la que controlarla). Motor otra vez con la cámara inexistente.
  let exited = app.exitCode !== null
  app.once('exit', () => { exited = true })
  await run(await main(), async ({ config }) => { localStorage.setItem('zerotouch:airswipe:heartbeat', String(Date.now())); await invoke('engine_start', { config }); await invoke('airswipe_window_open') }, { config: { format_version: 2, cameraIndex: 9 } })
  let overlayAgain
  // Mismo margen de 8 s que la app: se renueva la semilla mientras la overlay no aparezca.
  for (let i = 0; i < 20 && !overlayAgain; i += 1) {
    await delay(500); overlayAgain = await findTarget(isOverlay)
    if (!overlayAgain && i < 16) await run(await main(), async () => localStorage.setItem('zerotouch:airswipe:heartbeat', String(Date.now())))
  }
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
