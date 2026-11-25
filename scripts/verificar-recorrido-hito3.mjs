// Recorrido principal del Hito 3 con la aplicación REAL (zerotouch-desktop.exe) y un backend REAL sobre una base nueva.
// Uso: npm run desktop:build && npm run verify:hito3   (Windows; abre la ventana de la app ~1 minuto; sin cámara)
//
// Qué demuestra, paso a paso (cada paso imprime ✔ o ✖):
//   interfaz → API → SQLite:  cambiar «Velocidad del cursor» del modo «Cocina y Taller» de 70 a 55, sincronizar,
//                             y leer el valor por la API y directamente en el archivo SQLite.
//   persistencia del servidor: cerrar el backend con orden de apagado, abrirlo de nuevo sobre la MISMA base y leer 55.
//   recarga de la interfaz:    recargar la ventana y ver 55.
//   origen en el servidor:     un cambio hecho por la API desde «otro equipo» (58) aparece en pantalla solo después de
//                             sincronizar y se mantiene tras recargar. Una preferencia que viviera solo en el cliente
//                             no podría hacerlo.
//
// Aislamiento: base SQLite y bandeja de correo en una carpeta temporal fuera del repositorio y de OneDrive; perfil
// temporal de WebView2; motor sin arrancar (la cámara nunca se abre). No toca tu .env, tu base ni tu cuenta.
// Capturas y resultados: tmp/verificacion-hito3/ (carpeta ignorada por Git).
import { fork, spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url))).split(path.sep).join('/')
const OUT = `${ROOT}/tmp/verificacion-hito3`
mkdirSync(OUT, { recursive: true })
const PS1 = `${ROOT}/scripts/verificar-tauri-real.ps1`
const CERRAR = `${ROOT}/scripts/verificar-tauri-real-cerrar.ps1`
const EXE = `${ROOT}/desktop/target/debug/zerotouch-desktop.exe`
const CDP_PORT = Number(process.env.ZEROTOUCH_CDP_PORT ?? 9334)
const url = file => pathToFileURL(`${ROOT}/${file}`).href
const { openDatabase } = await import(url('backend/src/config/database.js'))
const { tokenFromOutbox } = await import(url('backend/test/helpers/correo.js'))
const { createDefaultState } = await import(url('src/data/preferences.js'))
// Clave de cifrado de la base temporal (DATABASE_KEY): nueva en cada ejecución, nunca la de tu .env.
const DATABASE_KEY = randomBytes(32).toString('hex')

if (!existsSync(EXE)) { console.error('Falta el ejecutable. Compila primero: npm run desktop:build'); process.exit(2) }
const ps = command => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
if (ps("(Get-Process -Name 'zerotouch-desktop' -ErrorAction SilentlyContinue | Measure-Object).Count") !== '0') { console.error('Hay una instancia de ZeroTouch abierta: ciérrala antes (esta prueba no toca la tuya).'); process.exit(2) }
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then(() => true, () => false)) { console.error(`El puerto ${CDP_PORT} ya está en uso; define ZEROTOUCH_CDP_PORT con otro.`); process.exit(2) }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(ok ? '✔' : '✖', name, detail === '' ? '' : `· ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })

// ---------------------------------------------------------------- CDP (WebView2 de la app real)
const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page')
const isMain = t => t.url.includes('tauri.localhost') && !t.url.includes('#airswipe') && !t.url.includes('#hud')
const main = async () => (await targets()).find(isMain)
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
const go = async path => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); await wait(300) }
const HELPERS = Object.entries({ wait, until, clickText, fill, go }).map(([name, fn]) => `const ${name} = ${fn.toString()};`).join('\n')
async function run(target, fn, args = {}) {
  const expression = `(async () => { ${HELPERS}\nreturn await (${fn.toString()})(${JSON.stringify(args)}) })()`
  const result = await cdp(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 38000 })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const screenshot = async (name) => { const { data } = await cdp(await main(), 'Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64')); return `tmp/verificacion-hito3/${name}.png` }

// ---------------------------------------------------------------- escenario
const temp = mkdtempSync(path.join(tmpdir(), 'zt-hito3-'))
const database = path.join(temp, 'hito3.sqlite')
const outbox = path.join(temp, 'correo-saliente')
const port = await freePort()
const base = `http://127.0.0.1:${port}/api/v1`
let backend, app
const startBackend = () => new Promise((resolve, reject) => {
  const child = fork(`${ROOT}/backend/src/server.js`, [], { cwd: temp, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, DATABASE_PATH: database, DATABASE_KEY, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'development', APP_ORIGIN: `http://127.0.0.1:${port}`, SESSION_TTL_SECONDS: '28800', MAIL_TRANSPORT: 'archivo', MAIL_OUTBOX_DIR: outbox } })
  child.stderr.resume()
  const timer = setTimeout(() => reject(new Error('backend no inició')), 15000)
  child.once('message', m => { clearTimeout(timer); resolve(child) })
  child.once('exit', () => { clearTimeout(timer) })
})
const stopBackend = child => new Promise(resolve => { let done = false; const finish = () => { if (!done) { done = true; resolve() } }; child.once('exit', finish); child.send('shutdown'); setTimeout(() => { try { child.kill() } catch { /* ya cerrado */ } finish() }, 8000) })
const cleanup = async () => {
  try { if (app?.pid) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ya cerrada */ }
  try { backend?.kill() } catch { /* ya cerrado */ }
  await delay(800)
  try { rmSync(temp, { recursive: true, force: true }) } catch { /* se borra al reiniciar */ }
}
const http = async (method, route, body, session) => {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
}
const sqliteValue = (modeId) => { const db = openDatabase(database, { key: DATABASE_KEY, readonly: true }); try { return db.prepare('SELECT sensibilidad_puntero AS s, version AS v FROM modos_uso WHERE id=?').get(modeId) } finally { db.close() } }
const MODE = 'Cocina y Taller'

try {
  // 1. Base NUEVA fuera del repositorio y de OneDrive, y backend real.
  openDatabase(database, { key: DATABASE_KEY, initialize: true }).close()
  backend = await startBackend()
  const health = await fetch(`${base}/health`).then(r => r.status, () => 0)
  check('base SQLite nueva en una carpeta temporal y backend real escuchando solo en 127.0.0.1', health === 200, { puerto: port, carpeta: 'temporal (fuera del repositorio y de OneDrive)' })

  // 2. Cuenta de prueba verificada (registro, correo en la bandeja de archivos y verificación con su token).
  const username = `profe_${randomBytes(3).toString('hex')}`, correo = `${username}@ejemplo.test`, password = `Zt-${randomBytes(9).toString('base64url')}-2026`
  const registro = await http('POST', '/auth/registro', { nombre_usuario: username, correo, contrasena: password })
  const token = await tokenFromOutbox(outbox, correo)
  const verificada = await http('POST', '/auth/verificacion', { token })
  const login = await http('POST', '/auth/login', { nombre_usuario: username, contrasena: password })
  const other = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.body.data.csrf_token }   // «otro equipo»: misma cuenta, otra sesión
  const userId = login.body.data.usuario.id
  check('cuenta de prueba creada y verificada (el token llegó por el correo guardado como archivo)', registro.status === 202 && Boolean(token) && verificada.status === 200 && login.status === 200, { usuario: username })

  // 3. La app real, con perfil de WebView2 temporal.
  app = spawn(EXE, [], { env: { ...process.env, ZEROTOUCH_BACKEND_URL: `http://127.0.0.1:${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(temp, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` }, stdio: 'ignore' })
  let page
  for (let i = 0; i < 80 && !page; i += 1) { await delay(500); try { page = await main() } catch { /* aún arrancando */ } }
  let ready = false
  for (let i = 0; i < 80 && !ready; i += 1) {
    try { ready = await run(page, async () => document.readyState === 'complete' && location.origin === 'https://tauri.localhost' && Boolean(window.__TAURI__?.core?.invoke) && Boolean(document.querySelector('.app-header'))) } catch { ready = false }
    if (!ready) { await delay(500); page = (await main()) ?? page }
  }
  check('la aplicación de escritorio real arranca y muestra su interfaz', ready, page?.url)
  if (!ready) throw new Error('La ventana principal no terminó de cargar')
  const isolated = existsSync(path.join(temp, 'webview')) && readdirSync(path.join(temp, 'webview')).length > 0 && await run(page, async () => localStorage.length === 0)
  if (!isolated) throw new Error('El perfil de WebView2 no está aislado: se aborta ANTES de escribir nada')
  // Cámara en un índice inexistente: aunque alguien pulsara «Iniciar cámara», el motor no abriría ningún dispositivo real.
  const seeded = createDefaultState(); seeded.device = { ...seeded.device, cameraIndex: 9 }
  await run(page, async ({ key, value }) => { localStorage.setItem(key, value) }, { key: `zerotouch:prefs:v2:${userId}`, value: JSON.stringify(seeded) })
  await cdp(page, 'Page.reload'); await delay(2500)
  page = await main()
  await run(page, async () => { await until(() => document.querySelector('.app-header')); await until(() => document.querySelector('#welcome-title')); clickText('button', 'Saltar configuración'); await until(() => document.querySelector('.start-button')) })

  // 4. Inicio de sesión por la interfaz.
  const logged = await run(page, async ({ user, pass }) => {
    document.querySelector('.main-nav [aria-label="Ajustes"]').click()
    await until(() => document.querySelector('.profile-trigger'))
    document.querySelector('.profile-trigger').click()
    await until(() => document.querySelector('dialog[open] input[name=username]'))
    fill(document.querySelector('dialog[open] input[name=username]'), user); fill(document.querySelector('dialog[open] input[name=password]'), pass)
    document.querySelector('dialog[open] form').requestSubmit()
    await until(() => !document.querySelector('dialog[open]'))
    await until(() => (document.querySelector('.profile-trigger').getAttribute('aria-label') || '').includes(user))
    document.querySelector('.manage-modes').open = true
    await until(() => document.querySelector('.mode-option'))
    return { modos: [...document.querySelectorAll('.mode-option strong')].map(e => e.textContent), activo: document.querySelector('.mode-option.checked strong')?.textContent }
  }, { user: username, pass: password })
  check('inicio de sesión por la interfaz: aparecen el perfil y sus modos', logged.modos.includes(MODE) && logged.activo === MODE, logged)

  const syncUi = () => run(page, async () => {
    document.querySelector('.profile-trigger').click()
    await until(() => document.querySelector('dialog[open]'))
    clickText('dialog[open] button', 'Sincronizar')
    await wait(500)
    await until(() => !document.querySelector('dialog[open] .dialog-actions .button.primary')?.innerText.includes('Sincronizando'), 30000)
    await until(() => document.querySelector('dialog[open] .sync-result'), 10000)
    await wait(300)
    const report = document.querySelector('dialog[open] .sync-result')?.innerText
    document.querySelector('dialog[open] .close-dialog')?.click(); await wait(300)
    return { report }
  })
  const sliderValue = () => run(page, async () => {
    await go('/calibracion')
    await until(() => document.querySelector('.calibration-page'))
    const details = [...document.querySelectorAll('details')].find(d => d.textContent.includes('Ajustes finos'))
    details.open = true
    const control = await until(() => [...document.querySelectorAll('.range-control')].find(c => c.textContent.includes('Velocidad del cursor')))
    return { valor: Number(control.querySelector('input[type=range]').value), texto: control.querySelector('output').textContent, modo: document.querySelector('.calibration-page')?.innerText.match(/modo «([^»]+)»/)?.[1] }
  })

  // 5. Primera sincronización: el servidor recibe el perfil y los modos con su valor inicial.
  const first = await syncUi()
  const profile = (await http('GET', '/perfiles', undefined, other)).body.data[0]
  const modes = (await http('GET', `/perfiles/${profile.id}/modos`, undefined, other)).body.data
  const kitchen = modes.find(m => m.nombre === MODE)
  const inicial = await sliderValue()
  check('primera sincronización: el servidor recibe el perfil y 3 modos; «Cocina y Taller» empieza en 70', /4 creados/.test(first.report) && modes.length === 3 && kitchen?.sensibilidad_puntero === 70 && inicial.valor === 70, { informe: first.report, api: kitchen?.sensibilidad_puntero, pantalla: inicial.valor })
  await screenshot('1-antes-70')

  // 6. Cambio en la interfaz: 70 → 55 (se guarda al instante en este equipo) y sincronización con la API.
  const edited = await run(page, async () => {
    const control = [...document.querySelectorAll('.range-control')].find(c => c.textContent.includes('Velocidad del cursor'))
    fill(control.querySelector('input[type=range]'), '55')
    await wait(500)
    return { valor: Number(control.querySelector('input[type=range]').value), texto: control.querySelector('output').textContent }
  })
  await screenshot('2-cambiado-55')
  const pushed = await syncUi()
  const viaApi = (await http('GET', `/modos/${kitchen.id}`, undefined, other)).body.data
  const viaSql = sqliteValue(kitchen.id)
  check('cambio de 70 a 55 en la interfaz: llega a la API y queda guardado en SQLite (lectura directa del archivo)', edited.valor === 55 && /1 actualizado/.test(pushed.report) && viaApi.sensibilidad_puntero === 55 && viaSql.s === 55 && viaSql.v === 2, { pantalla: edited.texto, informe: pushed.report, api: viaApi.sensibilidad_puntero, sqlite: viaSql })

  // 7. El backend se cierra con la orden de apagado y se abre de nuevo sobre la MISMA base.
  await stopBackend(backend)
  const caido = await fetch(`${base}/health`).then(() => false, () => true)
  backend = await startBackend()
  const afterRestart = (await http('GET', `/modos/${kitchen.id}`, undefined, other)).body
  check('cerrar y volver a abrir el backend sobre la misma base: el valor 55 se recupera (la sesión también sobrevive)', caido && afterRestart.data?.sensibilidad_puntero === 55 && sqliteValue(kitchen.id).s === 55, { cerroDeVerdad: caido, api: afterRestart.data?.sensibilidad_puntero })

  // 8. Recarga de la interfaz.
  await cdp(page, 'Page.reload'); await delay(2500)
  page = await main()
  await run(page, async () => { await until(() => document.querySelector('.app-header')) })
  const reloaded = await sliderValue()
  await screenshot('3-recargado-55')
  const again = await syncUi()
  check('tras recargar la aplicación sigue mostrando 55 y sincronizar con el backend reiniciado no encuentra diferencias', reloaded.valor === 55 && !/actualizado|creado|conflicto/i.test(again.report ?? ''), { pantalla: reloaded.texto, informe: again.report })

  // 9. Prueba de origen: un cambio hecho SOLO en el servidor aparece en pantalla al sincronizar.
  const current = (await http('GET', `/modos/${kitchen.id}`, undefined, other)).body.data
  const patched = await http('PATCH', `/modos/${kitchen.id}`, { sensibilidad_puntero: 58, version: current.version }, other)
  const stale = await sliderValue()
  const pulled = await syncUi()
  const shown = await sliderValue()
  await screenshot('4-descargado-58')
  await cdp(page, 'Page.reload'); await delay(2500)
  page = await main()
  await run(page, async () => { await until(() => document.querySelector('.app-header')) })
  const shownAfterReload = await sliderValue()
  check('origen en el servidor: un cambio hecho por la API (58) NO aparece hasta sincronizar, y luego se ve en pantalla y tras recargar', patched.status === 200 && stale.valor === 55 && shown.valor === 58 && shownAfterReload.valor === 58 && sqliteValue(kitchen.id).s === 58, { antes: stale.valor, informe: pulled.report, despues: shown.valor, trasRecargar: shownAfterReload.valor, sqlite: sqliteValue(kitchen.id).s })

  // 10. Cierre ordenado de la aplicación (sin procesos del motor) y del backend.
  let exited = app.exitCode !== null
  app.once('exit', () => { exited = true })
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CERRAR, '-ProcessId', String(app.pid)], { encoding: 'utf8' })
  for (let i = 0; i < 40 && !exited; i += 1) await delay(500)
  const leftovers = ps("(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'motor_local' } | Measure-Object).Count")
  await stopBackend(backend)
  check('cierre ordenado: la ventana se cierra, no queda ningún proceso del motor y el backend se apaga con su orden de parada', exited && leftovers === '0' && await fetch(`${base}/health`).then(() => false, () => true), { motor: leftovers })
} catch (error) {
  check('la prueba terminó sin excepciones', false, String(error?.stack ?? error).slice(0, 700))
} finally {
  await cleanup()
  const failed = results.filter(r => !r.ok)
  console.log(`\nRESUMEN: ${results.length - failed.length}/${results.length} comprobaciones correctas${failed.length ? '; FALLAN: ' + failed.map(f => f.name).join(' | ') : ''}`)
  writeFileSync(`${OUT}/resultados.json`, JSON.stringify(results, null, 2))
  process.exitCode = failed.length ? 1 : 0
}
