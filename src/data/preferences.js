// Preferencias locales de ZeroTouch, versión 2.
//
// - Un espacio por cuenta (`zerotouch:prefs:v2:<id de usuario>`) y otro para invitado. Cambiar de
//   cuenta nunca muestra ni sube datos de otra; importar los modos de invitado es una acción explícita.
// - Modelo: perfiles → modos → asignaciones gesto → acción, con la misma identidad (UUID) y `version`
//   que la API, para sincronizar cambios y borrados sin pérdida silenciosa.
// - `device` guarda los ajustes propios del equipo (mano, cámara, espejo, recorrido, exigencia de
//   detección, gestos de ventana, calibraciones); no se sincronizan.
// Este módulo es puro (sin React) y acepta el `storage` para poder probarse en Node.
import { defaultAssignments, normalizeAssignments, togglesFrom, TOGGLE_TO_GESTURE, TOGGLE_KEYS, isAllowed, NO_ACTION } from './capabilities.js'

import { uniqueName } from '../sync/names.js'

export const SCHEMA = 2
export const GUEST = 'invitado'
const LEGACY_KEY = 'zerotouch-preferences-v1'
export const storageKey = accountId => `zerotouch:prefs:v2:${accountId || GUEST}`

const uuid = () => globalThis.crypto.randomUUID()
const now = () => new Date().toISOString()
const clamp = (value, fallback, min = 0, max = 100) => (Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback)
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const text = (value, fallback = '', max = 60) => (typeof value === 'string' ? value.trim().normalize('NFC').slice(0, max) : fallback)
const HANDS = ['LEFT', 'RIGHT', 'AUTO']
const normalizeHand = value => (HANDS.includes(value) ? value : 'RIGHT')
export const CATEGORIES = ['manual', 'oficina', 'accesibilidad', 'personalizado']

export const deviceDefaults = Object.freeze({
  preferredHand: 'RIGHT',
  mirrorCamera: true,
  cameraIndex: 0,
  movementArea: 65,
  confidenceThreshold: 65,
  diagnosticOverlay: true,
  windowGestures: false,
  // Mano abierta rápida hacia abajo/arriba: minimizar la ventana activa / traerla de vuelta.
  // Apagado por defecto: un movimiento rápido del cursor hacia abajo minimizaba ventanas sin querer.
  windowSwipe: false,
  // Abanico con la mano abierta y ladeada: pestaña siguiente (Ctrl+Tab). Antes, pulgar y meñique (hasta el 21-11-2026).
  tabGestures: true,
  // Pinza pulgar-medio: clic derecho.
  rightClick: true,
  // Aceleración del cursor: movimientos lentos más finos (sin temblor), rápidos completos.
  pointerAcceleration: true,
  // Minutos del temporizador que inicia un gesto (acción «temporizador_iniciar»).
  timerMinutes: 5,
  // Calibración de recorrido: [xMin, xMax, yMin, yMax] en coordenadas de cámara, o null (área automática).
  activeBox: null,
  // Asistencia por orientación de la cabeza (aproximación local; no es seguimiento ocular).
  gaze: { enabled: false, yawTolerance: 22, pitchTolerance: 18, awayMs: 800, backMs: 300, calibration: null },
})

export const modeSettingDefaults = Object.freeze({ sensitivity: 65, stability: 40, pinchTolerance: 50, deskRest: true, gazeAssist: false })

// Plantillas de los modos incorporados. Son modos reales del perfil: se editan, sincronizan y borran
// como cualquier otro; `plantilla` solo conserva el icono y la descripción.
export const presets = {
  kitchen: {
    title: 'Cocina y Taller', icon: 'kitchen', categoria: 'manual', badge: 'Optimizado',
    description: 'Control sin contacto a distancia media. Mano abierta para puntero, dos dedos para desplazar y puño cerrado para pausar.',
    settings: { sensitivity: 70, stability: 45, pinchTolerance: 55, deskRest: false, gazeAssist: false },
  },
  desk: {
    title: 'Desk-Rest Ergonómico', icon: 'desk', categoria: 'oficina', badge: 'Antebrazo apoyado',
    description: 'Rastreo con antebrazo apoyado en mesa. Área activa compacta para cubrir la pantalla con movimientos breves de muñeca.',
    settings: { sensitivity: 68, stability: 50, pinchTolerance: 50, deskRest: true, gazeAssist: false },
  },
  assistance: {
    title: 'Asistencia Motriz', icon: 'assistance', categoria: 'accesibilidad', badge: 'Alta estabilidad',
    description: 'Filtrado antitemblor reforzado y mayor tolerancia en micro-pinza para facilitar una selección estable.',
    settings: { sensitivity: 52, stability: 78, pinchTolerance: 68, deskRest: true, gazeAssist: false },
  },
}
export const CATEGORY_ICON = { manual: 'kitchen', oficina: 'desk', accesibilidad: 'assistance', personalizado: 'star' }

// ------------------------------------------------------------------ construcción

export function newProfile({ nombre, descripcion = '' }, extra = {}) {
  return { id: uuid(), nombre: text(nombre, 'Perfil'), descripcion: text(descripcion, '', 300), version: null, dirty: true, updatedAt: now(), ...extra }
}

export function newMode(profileId, { nombre, categoria = 'personalizado', plantilla = null, settings = {}, assignments = null }, extra = {}) {
  return {
    id: uuid(), profileId, nombre: text(nombre, 'Modo'), categoria: CATEGORIES.includes(categoria) ? categoria : 'personalizado', plantilla,
    settings: normalizeModeSettings({ ...modeSettingDefaults, ...settings }),
    assignments: normalizeAssignments(assignments ?? defaultAssignments()),
    version: null, dirty: true, updatedAt: now(), ...extra,
  }
}

export function createDefaultState() {
  const profile = newProfile({ nombre: 'Perfil principal', descripcion: 'Modos de este equipo' })
  const modes = Object.entries(presets).map(([key, preset]) => newMode(profile.id, { nombre: preset.title, categoria: preset.categoria, plantilla: key, settings: preset.settings }))
  return {
    schema: SCHEMA,
    device: structuredClone(deviceDefaults),
    profiles: [profile],
    modes,
    tombstones: [],
    activeProfileId: profile.id,
    activeModeId: modes[0].id,
    lastSync: null,
  }
}

// ------------------------------------------------------------------ normalización

export function normalizeModeSettings(raw) {
  const r = raw || {}
  return {
    sensitivity: clamp(r.sensitivity, modeSettingDefaults.sensitivity),
    stability: clamp(r.stability, modeSettingDefaults.stability),
    pinchTolerance: clamp(r.pinchTolerance, modeSettingDefaults.pinchTolerance),
    deskRest: bool(r.deskRest, modeSettingDefaults.deskRest),
    gazeAssist: bool(r.gazeAssist, modeSettingDefaults.gazeAssist),
  }
}

export function normalizeDevice(raw) {
  const r = raw || {}
  const box = Array.isArray(r.activeBox) && r.activeBox.length === 4 && r.activeBox.every(v => Number.isFinite(v) && v >= 0 && v <= 1)
    && r.activeBox[0] < r.activeBox[1] && r.activeBox[2] < r.activeBox[3] ? r.activeBox.map(v => Math.round(v * 1000) / 1000) : null
  const g = r.gaze && typeof r.gaze === 'object' ? r.gaze : {}
  const cal = g.calibration && typeof g.calibration === 'object' && Number.isFinite(g.calibration.yaw) && Number.isFinite(g.calibration.pitch)
    ? { yaw: g.calibration.yaw, pitch: g.calibration.pitch } : null
  return {
    preferredHand: normalizeHand(r.preferredHand),
    mirrorCamera: bool(r.mirrorCamera, true),
    cameraIndex: clamp(r.cameraIndex, 0, 0, 10),
    movementArea: clamp(r.movementArea, 65, 20, 100),
    confidenceThreshold: clamp(r.confidenceThreshold, 65, 30, 95),
    diagnosticOverlay: bool(r.diagnosticOverlay, true),
    windowGestures: bool(r.windowGestures, false),
    windowSwipe: bool(r.windowSwipe, false),
    tabGestures: bool(r.tabGestures, true),
    rightClick: bool(r.rightClick, true),
    pointerAcceleration: bool(r.pointerAcceleration, true),
    timerMinutes: clamp(r.timerMinutes, 5, 1, 120),
    activeBox: box,
    gaze: {
      enabled: bool(g.enabled, false),
      yawTolerance: clamp(g.yawTolerance, 22, 8, 45),
      pitchTolerance: clamp(g.pitchTolerance, 18, 8, 45),
      awayMs: clamp(g.awayMs, 800, 200, 5000),
      backMs: clamp(g.backMs, 300, 100, 3000),
      calibration: cal,
    },
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const version = value => (Number.isInteger(value) && value >= 1 ? value : null)

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA) return null
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .filter(p => p && UUID.test(p.id))
    .map(p => ({ id: p.id.toLowerCase(), nombre: text(p.nombre, 'Perfil') || 'Perfil', descripcion: text(p.descripcion, '', 300), version: version(p.version), dirty: bool(p.dirty, false), updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now() }))
  const ids = new Set(profiles.map(p => p.id))
  const modes = (Array.isArray(raw.modes) ? raw.modes : [])
    .filter(m => m && UUID.test(m.id) && typeof m.profileId === 'string' && ids.has(m.profileId.toLowerCase()))
    .map(m => ({
      id: m.id.toLowerCase(), profileId: m.profileId.toLowerCase(), nombre: text(m.nombre, 'Modo') || 'Modo',
      categoria: CATEGORIES.includes(m.categoria) ? m.categoria : 'personalizado',
      plantilla: typeof m.plantilla === 'string' && presets[m.plantilla] ? m.plantilla : null,
      settings: normalizeModeSettings(m.settings), assignments: normalizeAssignments(m.assignments),
      version: version(m.version), dirty: bool(m.dirty, false), updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now(),
    }))
  const tombstones = (Array.isArray(raw.tombstones) ? raw.tombstones : []).filter(t => t && ['profile', 'mode'].includes(t.kind) && UUID.test(t.id)).map(t => ({ ...t, kind: t.kind, id: t.id.toLowerCase(), version: version(t.version) }))
  const activeModeId = modes.some(m => m.id === raw.activeModeId) ? raw.activeModeId : (modes[0]?.id ?? null)
  const activeProfileId = activeModeId ? modes.find(m => m.id === activeModeId).profileId : (ids.has(raw.activeProfileId) ? raw.activeProfileId : (profiles[0]?.id ?? null))
  return {
    schema: SCHEMA, device: normalizeDevice(raw.device), profiles, modes, tombstones, activeProfileId, activeModeId,
    syncOperation: raw.syncOperation == null ? null : structuredClone(raw.syncOperation),
    lastSync: raw.lastSync && typeof raw.lastSync === 'object' ? { at: String(raw.lastSync.at || ''), status: String(raw.lastSync.status || '') } : null,
  }
}

// ------------------------------------------------------------------ almacenamiento

export function loadState(accountId, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(accountId)))
    const state = normalizeState(parsed)
    if (state) return state
  } catch { /* se ignora un valor corrupto: se parte de cero o del formato antiguo */ }
  if (!accountId || accountId === GUEST) {
    try {
      const legacy = JSON.parse(storage.getItem(LEGACY_KEY))
      if (legacy && typeof legacy === 'object') return migrateLegacy(legacy)
    } catch { /* sin preferencias antiguas */ }
  }
  return null
}

export function saveState(accountId, state, storage = globalThis.localStorage) {
  try { storage.setItem(storageKey(accountId), JSON.stringify(state)); return true } catch { return false }
}

export function hasStoredState(accountId, storage = globalThis.localStorage) {
  try { return storage.getItem(storageKey(accountId)) !== null } catch { return false }
}

/** Convierte el formato v1 (contextos planos y ajustes globales) al modelo de perfiles y modos. */
export function migrateLegacy(legacy) {
  const state = createDefaultState()
  const s = legacy.settings || {}
  state.device = normalizeDevice({ preferredHand: s.preferredHand, mirrorCamera: s.mirrorCamera, cameraIndex: s.cameraIndex, movementArea: s.movementArea, confidenceThreshold: s.confidenceThreshold, diagnosticOverlay: s.diagnosticOverlay, windowGestures: s.windowGestures })
  const legacyToggles = Object.fromEntries(TOGGLE_KEYS.filter(key => typeof s[key] === 'boolean').map(key => [key, s[key]]))
  const applyToggles = (mode, toggles) => { for (const [key, value] of Object.entries(toggles)) if (typeof value === 'boolean' && TOGGLE_TO_GESTURE[key]) mode.assignments[TOGGLE_TO_GESTURE[key]].habilitado = value }
  for (const mode of state.modes) {
    const override = legacy.contextSettings?.[mode.plantilla]
    if (override && typeof override === 'object') {
      mode.settings = normalizeModeSettings({ ...mode.settings, ...override })
      applyToggles(mode, override)
    } else applyToggles(mode, legacyToggles)
  }
  for (const ctx of Array.isArray(legacy.contexts) ? legacy.contexts : []) {
    if (!ctx || typeof ctx.name !== 'string') continue
    const mode = newMode(state.activeProfileId, { nombre: ctx.name, categoria: 'personalizado', settings: ctx })
    applyToggles(mode, { ...legacyToggles, ...ctx })
    if (UUID.test(ctx.id)) mode.id = ctx.id.toLowerCase()
    state.modes.push(mode)
  }
  const presetKey = { kitchen: 'kitchen', desk: 'desk', assistance: 'assistance', handsfree: 'kitchen' }[legacy.desktopContext]
  const active = state.modes.find(m => (presetKey ? m.plantilla === presetKey : m.id === String(legacy.desktopContext).toLowerCase()))
  state.activeModeId = (active || state.modes[0]).id
  state.activeProfileId = (active || state.modes[0]).profileId
  return normalizeState(state)
}

// ------------------------------------------------------------------ selectores

export const getActiveMode = state => state.modes.find(m => m.id === state.activeModeId) || null
export const getActiveProfile = state => state.profiles.find(p => p.id === state.activeProfileId) || null
export const modesOf = (state, profileId) => state.modes.filter(m => m.profileId === profileId)
export const presetOf = mode => (mode?.plantilla && presets[mode.plantilla]) || null

/** Ajustes planos que consume la interfaz y el motor: equipo + modo activo + interruptores. */
export function getEffectiveSettings(state) {
  const mode = getActiveMode(state)
  const settings = mode ? mode.settings : { ...modeSettingDefaults }
  const assignments = mode ? mode.assignments : defaultAssignments()
  return { ...state.device, ...settings, ...togglesFrom(assignments) }
}

export const getActiveAssignments = state => getActiveMode(state)?.assignments ?? defaultAssignments()

// ------------------------------------------------------------------ mutaciones (puras)

const touch = item => ({ ...item, dirty: true, updatedAt: now() })

export function updateDevice(state, patch) {
  return { ...state, device: normalizeDevice({ ...state.device, ...patch, gaze: { ...state.device.gaze, ...(patch.gaze || {}) } }) }
}

export function updateModeSettings(state, modeId, patch) {
  return { ...state, modes: state.modes.map(m => (m.id === modeId ? touch({ ...m, settings: normalizeModeSettings({ ...m.settings, ...patch }) }) : m)) }
}

export function setAssignment(state, modeId, gesto, { accion, habilitado }) {
  return {
    ...state,
    modes: state.modes.map(m => {
      if (m.id !== modeId || !m.assignments[gesto]) return m
      const next = { accion: accion ?? m.assignments[gesto].accion, habilitado: habilitado ?? m.assignments[gesto].habilitado }
      if (!isAllowed(gesto, next.accion, next.habilitado)) return m
      return touch({ ...m, assignments: { ...m.assignments, [gesto]: next } })
    }),
  }
}

export function setToggle(state, modeId, toggle, value) {
  const gesto = TOGGLE_TO_GESTURE[toggle]
  if (!gesto) return state
  const mode = state.modes.find(m => m.id === modeId)
  if (!mode) return state
  const current = mode.assignments[gesto]
  // Encender un gesto que estaba en sin_accion devuelve su acción predeterminada.
  const accion = value && current.accion === NO_ACTION ? defaultAssignments()[gesto].accion : current.accion
  return setAssignment(state, modeId, gesto, { accion, habilitado: Boolean(value) })
}

/** Reparte un parche plano (como lo produce la interfaz) entre el equipo, el modo activo y sus interruptores. */
export function updateActiveSettings(state, patch) {
  let next = state
  const device = {}, mode = {}
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in deviceDefaults) device[key] = value
    else if (key in modeSettingDefaults) mode[key] = value
    else if (TOGGLE_TO_GESTURE[key] && state.activeModeId) next = setToggle(next, state.activeModeId, key, value)
  }
  if (Object.keys(device).length) next = updateDevice(next, device)
  if (Object.keys(mode).length && state.activeModeId) next = updateModeSettings(next, state.activeModeId, mode)
  return next
}

export function selectMode(state, modeId) {
  const mode = state.modes.find(m => m.id === modeId)
  return mode ? { ...state, activeModeId: mode.id, activeProfileId: mode.profileId } : state
}

export function selectProfile(state, profileId) {
  if (!state.profiles.some(p => p.id === profileId)) return state
  const first = state.modes.find(m => m.profileId === profileId)
  return { ...state, activeProfileId: profileId, activeModeId: first ? first.id : null }
}

export function addProfile(state, data) {
  const profile = newProfile(data)
  return { ...state, profiles: [...state.profiles, profile], activeProfileId: profile.id, activeModeId: null }
}

export function updateProfile(state, profileId, patch) {
  return { ...state, profiles: state.profiles.map(p => (p.id === profileId ? touch({ ...p, nombre: text(patch.nombre ?? p.nombre, p.nombre) || p.nombre, descripcion: text(patch.descripcion ?? p.descripcion, '', 300) }) : p)) }
}

export function removeProfile(state, profileId) {
  const op = state.syncOperation
  if (op && (op.id === profileId || state.modes.some(m => m.profileId === profileId && m.id === op.id))) throw new Error('Recupera la sincronización pendiente antes de eliminar este perfil.')
  const profile = state.profiles.find(p => p.id === profileId)
  if (!profile) return state
  const tombstones = [...state.tombstones]
  if (profile.version !== null) tombstones.push({ kind: 'profile', id: profile.id, version: profile.version, nombre: profile.nombre, modes: modesOf(state, profile.id).filter(m => m.version !== null).map(m => ({ id: m.id, version: m.version })) })
  const modes = state.modes.filter(m => m.profileId !== profileId)
  const profiles = state.profiles.filter(p => p.id !== profileId)
  let next = { ...state, profiles, modes, tombstones }
  if (next.activeProfileId === profileId) next = profiles.length ? selectProfile(next, profiles[0].id) : { ...next, activeProfileId: null, activeModeId: null }
  return next
}

export function addMode(state, profileId, data) {
  if (!state.profiles.some(p => p.id === profileId)) return state
  const mode = newMode(profileId, data)
  return { ...state, modes: [...state.modes, mode], activeModeId: mode.id, activeProfileId: profileId }
}

export function updateMode(state, modeId, patch) {
  return {
    ...state,
    modes: state.modes.map(m => {
      if (m.id !== modeId) return m
      const next = { ...m }
      if (patch.nombre !== undefined) next.nombre = text(patch.nombre, m.nombre) || m.nombre
      if (patch.categoria !== undefined && CATEGORIES.includes(patch.categoria)) next.categoria = patch.categoria
      if (patch.settings) next.settings = normalizeModeSettings({ ...m.settings, ...patch.settings })
      if (patch.assignments) next.assignments = normalizeAssignments({ ...m.assignments, ...patch.assignments })
      return touch(next)
    }),
  }
}

export function removeMode(state, modeId) {
  if (state.syncOperation?.id === modeId) throw new Error('Recupera la sincronización pendiente antes de eliminar este modo.')
  const mode = state.modes.find(m => m.id === modeId)
  if (!mode) return state
  const tombstones = [...state.tombstones]
  if (mode.version !== null) tombstones.push({ kind: 'mode', id: mode.id, version: mode.version, nombre: mode.nombre, profileId: mode.profileId })
  const modes = state.modes.filter(m => m.id !== modeId)
  let next = { ...state, modes, tombstones }
  if (next.activeModeId === modeId) {
    const sibling = modes.find(m => m.profileId === mode.profileId) || modes[0]
    next = { ...next, activeModeId: sibling ? sibling.id : null, activeProfileId: sibling ? sibling.profileId : mode.profileId }
  }
  return next
}

/** Copia explícita de los perfiles y modos de invitado a la cuenta actual, con identidades nuevas. */
export function importGuestInto(state, guest) {
  if (!guest) return state
  const names = new Set(state.profiles.map(p => p.nombre.toLowerCase()))
  const profiles = [...state.profiles], modes = [...state.modes]
  for (const profile of guest.profiles) {
    const nombre = uniqueName(profile.nombre, [...names])
    names.add(nombre.toLowerCase())
    const copy = newProfile({ nombre, descripcion: profile.descripcion })
    profiles.push(copy)
    for (const mode of modesOf(guest, profile.id)) modes.push(newMode(copy.id, { nombre: mode.nombre, categoria: mode.categoria, plantilla: mode.plantilla, settings: mode.settings, assignments: mode.assignments }))
  }
  const next = { ...state, profiles, modes }
  return next.activeModeId ? next : selectProfile(next, profiles[0]?.id)
}

// ------------------------------------------------------------------ ayudas de sincronización

/** Sustituye la identidad local por la remota (al crear) y registra la versión sincronizada. */
export function adoptRemote(state, kind, localId, remote) {
  const remoteId = String(remote.id).toLowerCase()
  if (kind === 'profile') {
    return {
      ...state,
      profiles: state.profiles.map(p => (p.id === localId ? { ...p, id: remoteId, version: remote.version, dirty: true, updatedAt: now() } : p)),
      modes: state.modes.map(m => (m.profileId === localId ? { ...m, profileId: remoteId } : m)),
      activeProfileId: state.activeProfileId === localId ? remoteId : state.activeProfileId,
    }
  }
  return {
    ...state,
    modes: state.modes.map(m => (m.id === localId ? { ...m, id: remoteId, version: remote.version, dirty: true, updatedAt: now() } : m)),
    activeModeId: state.activeModeId === localId ? remoteId : state.activeModeId,
  }
}

export function markSynced(state, kind, id, version) {
  const key = kind === 'profile' ? 'profiles' : 'modes'
  return { ...state, [key]: state[key].map(item => (item.id === id ? { ...item, version, dirty: false, updatedAt: now() } : item)) }
}

export function upsertRemoteProfile(state, remote) {
  const id = String(remote.id).toLowerCase()
  const data = { id, nombre: text(remote.nombre, 'Perfil') || 'Perfil', descripcion: text(remote.descripcion, '', 300), version: remote.version, dirty: false, updatedAt: now() }
  const exists = state.profiles.some(p => p.id === id)
  return { ...state, profiles: exists ? state.profiles.map(p => (p.id === id ? { ...p, ...data } : p)) : [...state.profiles, data] }
}

export function upsertRemoteMode(state, remote, assignments) {
  const id = String(remote.id).toLowerCase(), profileId = String(remote.perfil_id).toLowerCase()
  const existing = state.modes.find(m => m.id === id)
  const data = {
    id, profileId, nombre: text(remote.nombre, 'Modo') || 'Modo', categoria: CATEGORIES.includes(remote.categoria) ? remote.categoria : 'personalizado',
    plantilla: existing?.plantilla ?? null,
    settings: normalizeModeSettings({ sensitivity: remote.sensibilidad_puntero, stability: remote.estabilizacion_puntero, pinchTolerance: remote.tolerancia_micro_pinza, deskRest: remote.desk_rest_habilitado, gazeAssist: remote.asistencia_mirada_habilitada }),
    assignments: assignments ? normalizeAssignments(assignments) : (existing?.assignments ?? defaultAssignments()),
    version: remote.version, dirty: false, updatedAt: now(),
  }
  const modes = existing ? state.modes.map(m => (m.id === id ? data : m)) : [...state.modes, data]
  const next = { ...state, modes }
  return next.activeModeId ? next : { ...next, activeModeId: id, activeProfileId: profileId }
}

export function dropLocal(state, kind, id) {
  if (kind === 'profile') {
    const profiles = state.profiles.filter(p => p.id !== id), modes = state.modes.filter(m => m.profileId !== id)
    let next = { ...state, profiles, modes }
    if (next.activeProfileId === id) next = profiles.length ? selectProfile(next, profiles[0].id) : { ...next, activeProfileId: null, activeModeId: null }
    return next
  }
  const mode = state.modes.find(m => m.id === id)
  if (!mode) return state
  const modes = state.modes.filter(m => m.id !== id)
  let next = { ...state, modes }
  if (next.activeModeId === id) { const sibling = modes.find(m => m.profileId === mode.profileId) || modes[0]; next = { ...next, activeModeId: sibling?.id ?? null, activeProfileId: sibling?.profileId ?? mode.profileId } }
  return next
}

export const clearTombstone = (state, kind, id) => ({ ...state, tombstones: state.tombstones.filter(t => !(t.kind === kind && t.id === id)) })
export const hasPendingChanges = state => Boolean(state.syncOperation) || state.tombstones.length > 0 || state.profiles.some(p => p.dirty || p.version === null) || state.modes.some(m => m.dirty || m.version === null)

/** Diferencias entre los ajustes planos actuales de la interfaz y los nuevos: el parche que entiende `updateActiveSettings`. */
export function settingsPatch(current, next) {
  const patch = {}
  for (const [key, value] of Object.entries(next || {})) {
    if (JSON.stringify(current?.[key]) !== JSON.stringify(value)) patch[key] = value
  }
  return patch
}
