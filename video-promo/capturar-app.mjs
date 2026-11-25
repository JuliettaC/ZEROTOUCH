// Capturas REALES de la aplicación de escritorio (zerotouch-desktop.exe) para el video promocional.
// Mismo aislamiento que scripts/verificar-recorrido-hito3.mjs: backend real sobre una base temporal, cuenta ficticia
// verificada, perfil temporal de WebView2 y cámara en un índice inexistente (nunca se abre).
// Uso (desde la raíz): npm run desktop:build && node video-promo/capturar-app.mjs  → video-promo/public/app/*.png
import { fork, spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url))).split(path.sep).join('/')
const OUT = `${ROOT}/video-promo/public/app`
mkdirSync(OUT, { recursive: true })
const EXE = `${ROOT}/desktop/target/debug/zerotouch-desktop.exe`
const CDP_PORT = 9341
const url = file => pathToFileURL(`${ROOT}/${file}`).href
const { openDatabase } = await import(url('backend/src/config/database.js'))
const DATABASE_KEY = randomBytes(32).toString('hex')   // base temporal cifrada; nunca la clave de tu .env
const { tokenFromOutbox } = await import(url('backend/test/helpers/correo.js'))
const { createDefaultState } = await import(url('src/data/preferences.js'))
if (!existsSync(EXE)) { console.error('Falta el ejecutable: npm run desktop:build'); process.exit(2) }

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page')
const main = async () => (await targets()).find(t => t.url.includes('tauri.localhost') && !t.url.includes('#airswipe') && !t.url.includes('#hud'))
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
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = fn(); if (value) return value; await wait(100) } throw new Error('Tiempo agotado: ' + fn.toString().slice(0, 140)) }
const clickText = (selector, label, root = document) => { const el = [...root.querySelectorAll(selector)].find(e => e.textContent.trim().includes(label) && !e.disabled); if (!el) throw new Error('No hay ' + selector + ' con «' + label + '»'); el.click(); return el }
const fill = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
const go = async route => { window.history.pushState({}, '', route); window.dispatchEvent(new PopStateEvent('popstate')); await wait(600) }
const HELPERS = Object.entries({ wait, until, clickText, fill, go }).map(([name, fn]) => `const ${name} = ${fn.toString()};`).join('\n')
async function run(target, fn, args = {}) {
  const expression = `(async () => { ${HELPERS}\nreturn await (${fn.toString()})(${JSON.stringify(args)}) })()`
  const result = await cdp(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 38000 })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
// Captura a escala 2: la ventana real (≈1280×840) queda en ≈2560×1680 píxeles, nítida al acercar la cámara en el video.
const ESCALA = 2
const shot = async (page, name, full = false) => {
  const { w, h } = await run(page, async () => ({ w: window.innerWidth, h: Math.ceil(Math.max(window.innerHeight, document.documentElement.scrollHeight)) }))
  const clip = { x: 0, y: 0, width: w, height: full ? h : await run(page, async () => window.innerHeight), scale: ESCALA }
  const { data } = await cdp(page, 'Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: full })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('✔', name)
}

const temp = mkdtempSync(path.join(tmpdir(), 'zt-video-'))
const database = path.join(temp, 'video.sqlite')
const outbox = path.join(temp, 'correo-saliente')
const port = await freePort()
const base = `http://127.0.0.1:${port}/api/v1`
let backend, app
try {
  openDatabase(database, { key: DATABASE_KEY, initialize: true }).close()
  backend = await new Promise((resolve, reject) => {
    const child = fork(`${ROOT}/backend/src/server.js`, [], { cwd: temp, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, DATABASE_PATH: database, DATABASE_KEY, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'development', APP_ORIGIN: `http://127.0.0.1:${port}`, SESSION_TTL_SECONDS: '28800', MAIL_TRANSPORT: 'archivo', MAIL_OUTBOX_DIR: outbox } })
    child.stderr.resume()
    const timer = setTimeout(() => reject(new Error('backend no inició')), 15000)
    child.once('message', () => { clearTimeout(timer); resolve(child) })
  })
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }))
  const username = 'cocina_demo', correo = 'cocina.demo@ejemplo.test', password = `Zt-${randomBytes(9).toString('base64url')}-2026`
  await post('/auth/registro', { nombre_usuario: username, correo, contrasena: password })
  await post('/auth/verificacion', { token: await tokenFromOutbox(outbox, correo) })
  const login = await post('/auth/login', { nombre_usuario: username, contrasena: password })
  const userId = login.body.data.usuario.id

  app = spawn(EXE, [], { env: { ...process.env, ZEROTOUCH_BACKEND_URL: `http://127.0.0.1:${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(temp, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` }, stdio: 'ignore' })
  let page
  for (let i = 0; i < 80 && !page; i += 1) { await delay(500); try { page = await main() } catch { /* arrancando */ } }
  for (let i = 0; i < 80; i += 1) {
    try { if (await run(page, async () => document.readyState === 'complete' && Boolean(document.querySelector('.app-header')))) break } catch { /* cargando */ }
    await delay(500); page = (await main()) ?? page
  }
  const seeded = createDefaultState(); seeded.device = { ...seeded.device, cameraIndex: 9 }
  await run(page, async ({ key, value }) => { localStorage.setItem(key, value) }, { key: `zerotouch:prefs:v2:${userId}`, value: JSON.stringify(seeded) })
  await cdp(page, 'Page.reload'); await delay(2500)
  page = await main()
  await run(page, async () => { await until(() => document.querySelector('#welcome-title')); clickText('button', 'Saltar configuración'); await until(() => document.querySelector('.start-button')) })

  // Inicio de sesión por la interfaz.
  await run(page, async ({ user, pass }) => {
    document.querySelector('.main-nav [aria-label="Ajustes"]').click()
    await until(() => document.querySelector('.profile-trigger'))
    document.querySelector('.profile-trigger').click()
    await until(() => document.querySelector('dialog[open] input[name=username]'))
    fill(document.querySelector('dialog[open] input[name=username]'), user); fill(document.querySelector('dialog[open] input[name=password]'), pass)
    document.querySelector('dialog[open] form').requestSubmit()
    await until(() => !document.querySelector('dialog[open]'))
    await until(() => (document.querySelector('.profile-trigger').getAttribute('aria-label') || '').includes(user))
  }, { user: username, pass: password })
  await delay(500)
  await shot(page, 'ajustes')

  // Sincronizar: el diálogo con el resultado real del servidor.
  await run(page, async () => {
    document.querySelector('.profile-trigger').click()
    await until(() => document.querySelector('dialog[open]'))
    clickText('dialog[open] button', 'Sincronizar')
    await until(() => document.querySelector('dialog[open] .sync-result'), 30000)
    await wait(400)
  })
  await shot(page, 'sincronizado')
  await run(page, async () => { document.querySelector('dialog[open] .close-dialog')?.click(); await wait(300) })

  await run(page, async () => { await go('/'); await until(() => document.querySelector('.start-button')) })
  await delay(800)
  await shot(page, 'inicio')

  await run(page, async () => { await go('/calibracion'); await until(() => document.querySelector('.calibration-page')); await wait(1500) })
  await shot(page, 'gestos')
  await shot(page, 'gestos-completo', true)

  await run(page, async () => { await go('/teclado'); await wait(1500) })
  await shot(page, 'teclado')
} catch (error) {
  console.error('✖', error?.stack ?? error); process.exitCode = 1
} finally {
  try { if (app?.pid) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* cerrada */ }
  try { backend?.kill() } catch { /* cerrado */ }
  await delay(800)
  try { rmSync(temp, { recursive: true, force: true }) } catch { /* se borra al reiniciar */ }
}
