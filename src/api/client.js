import { allPages } from './paging.js'

export { allPages }

/** True dentro de la aplicación Tauri; false en navegador (web o móvil, solo frontend). */
export const isDesktop = () => Boolean(globalThis.window?.__TAURI__?.core?.invoke)

const invoke = (command, args) => {
  if (!isDesktop()) {
    return Promise.reject({
      code: 'DESKTOP_REQUIRED',
      message: 'Ejecuta la aplicación de escritorio ZEROTOUCH para usar esta función nativa.',
    })
  }
  return window.__TAURI__.core.invoke(command, args)
}

const toAuthPayload = c => ({
  nombre_usuario: String(c?.nombre_usuario ?? c?.username ?? '').trim(),
  contrasena: String(c?.contrasena ?? c?.password ?? ''),
})

const toEmail = c => String(c?.correo ?? c?.email ?? '').trim()

export const api = {
  // Registro y vinculación envían nombre_usuario, correo y contrasena; el puente rechaza campos extra.
  register: c => invoke('register', { c: { ...toAuthPayload(c), correo: toEmail(c) } }),
  resendVerification: c => invoke('resend_verification', { e: { correo: toEmail(c) } }),
  forgotPassword: c => invoke('forgot_password', { e: { correo: toEmail(c) } }),
  linkEmail: c => invoke('link_email', { c: { ...toAuthPayload(c), correo: toEmail(c) } }),
  login: c => invoke('login', { c: toAuthPayload(c) }),
  account: () => invoke('account'),
  logout: () => invoke('logout'),
  backendInfo: () => invoke('backend_info'),
  profiles: offset => invoke('profiles', { offset }),
  // Creación idempotente: `idempotencyKey` (UUID v7, opcional) viaja como cabecera `Idempotency-Key`; repetirla con
  // el mismo cuerpo devuelve la respuesta original (con `repetida: true`) en lugar de crear otro recurso.
  createProfile: (p, idempotencyKey) => invoke('create_profile', { p, idempotencyKey: idempotencyKey ?? null }),
  updateProfile: (id, p) => invoke('update_profile', { id, p }),
  // Borrado condicional: `ifMatch` es el ETag que la interfaz conocía (src/sync/etag.js). Sin él el puente no envía nada.
  deleteProfile: (id, ifMatch) => invoke('delete_profile', { id, ifMatch }),
  contexts: (profileId, offset) => invoke('contexts', { profileId, offset }),
  createContext: (profileId, c, idempotencyKey) => invoke('create_context', { profileId, c, idempotencyKey: idempotencyKey ?? null }),
  updateContext: (id, c) => invoke('update_context', { id, c }),
  deleteContext: (id, ifMatch) => invoke('delete_context', { id, ifMatch }),
  // Asignaciones gesto → acción (exportación formato 1) y contrato de capacidades del backend.
  modeGestures: id => invoke('mode_gestures', { id }),
  setModeGestures: (id, g) => invoke('set_mode_gestures', { id, g }),
  capabilities: () => invoke('capabilities'),

  // Motor gestual local (IPC con confirmación por comando)
  engineStart: config => invoke('engine_start', { config }),
  engineStop: () => invoke('engine_stop'),
  engineStatus: () => invoke('engine_status'),
  engineUpdateConfig: config => invoke('engine_update_config', { config }),
  engineSetMode: mode => invoke('engine_set_mode', { mode }),
  engineSetPaused: paused => invoke('engine_set_paused', { paused }),
  // Exportación de GET /api/v1/modos/:id/gestos (formato 1). Sin credenciales; el motor valida y puede rechazarla.
  engineLoadExport: (document, runtime) => invoke('engine_load_export', { document, runtime }),
  // Air-Swipe: modo teclado en el motor, escritura en la aplicación activa y ventana del teclado.
  engineAirswipe: active => invoke('engine_airswipe', { active }),
  engineTypeText: text => invoke('engine_type_text', { text }),
  enginePressKey: key => invoke('engine_press_key', { key }),
  engineGazeCalibrate: () => invoke('engine_gaze_calibrate'),
  airswipeWindowOpen: edge => invoke('airswipe_window_open', edge ? { edge } : {}),
  airswipeWindowClose: () => invoke('airswipe_window_close'),
  airswipeWindowRect: () => invoke('airswipe_window_rect'),
}
