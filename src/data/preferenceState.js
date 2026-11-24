// Preferencias locales de ZeroTouch, versión 2.
//
// - Un espacio por cuenta (`zerotouch:prefs:v2:<id de usuario>`) y otro para invitado. Cambiar de
//   cuenta nunca muestra ni sube datos de otra; importar los modos de invitado es una acción explícita.
// - Modelo: perfiles → modos → asignaciones gesto → acción, con la misma identidad (UUID) y `version`
//   que la API, para sincronizar cambios y borrados sin pérdida silenciosa.
// - `device` guarda los ajustes propios del equipo (mano, cámara, espejo, recorrido, exigencia de
//   detección, gestos de ventana, calibraciones); no se sincronizan.
// Este módulo es puro (sin React) y acepta el `storage` para poder probarse en Node.
import {
  defaultAssignments,
  normalizeAssignments,
  TOGGLE_TO_GESTURE,
  TOGGLE_KEYS,
} from './capabilities.js'

export const SCHEMA = 2
export const GUEST = 'invitado'
const LEGACY_KEY = 'zerotouch-preferences-v1'
export const storageKey = (accountId) => `zerotouch:prefs:v2:${accountId || GUEST}`

const uuid = () => globalThis.crypto.randomUUID()
export const now = () => new Date().toISOString()
const clamp = (value, fallback, min = 0, max = 100) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
export const text = (value, fallback = '', max = 60) =>
  typeof value === 'string' ? value.trim().normalize('NFC').slice(0, max) : fallback
const HANDS = ['LEFT', 'RIGHT', 'AUTO']
const normalizeHand = (value) => (HANDS.includes(value) ? value : 'RIGHT')
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
  // 🤙 sostenido: dictado de Windows (Win+H). Gesto local del equipo (23-11-2026).
  dictation: true,
  // ☝️ sostenido y quieto: Enter (hasta el 24-11-2026 abría el teclado). Gesto local del equipo.
  keyboardGesture: true,
  // Doblar índice, medio y anular rápido con el meñique arriba: Alt+Tab (23-11-2026).
  altTab: true,
  // ✌️ V (índice y medio separados) sostenida y quieta: pestaña nueva, Ctrl+T (23-11-2026).
  newTab: true,
  // Experimental: mano abierta quieta y luego subir/bajar = desplazar. Apagado: choca con mover el cursor.
  openHandScroll: false,
  // Aceleración del cursor: movimientos lentos más finos (sin temblor), rápidos completos.
  pointerAcceleration: true,
  // Minutos del temporizador que inicia un gesto (acción «temporizador_iniciar»).
  timerMinutes: 5,
  // Calibración de recorrido: [xMin, xMax, yMin, yMax] en coordenadas de cámara, o null (área automática).
  activeBox: null,
  // Asistencia por orientación de la cabeza (aproximación local; no es seguimiento ocular).
  gaze: {
    enabled: false,
    yawTolerance: 22,
    pitchTolerance: 18,
    awayMs: 800,
    backMs: 300,
    calibration: null,
  },
})

export const modeSettingDefaults = Object.freeze({
  sensitivity: 65,
  stability: 40,
  pinchTolerance: 50,
  deskRest: true,
  gazeAssist: false,
})

// Plantillas de los modos incorporados. Son modos reales del perfil: se editan, sincronizan y borran
// como cualquier otro; `plantilla` solo conserva el icono y la descripción.
export const presets = {
  kitchen: {
    title: 'Cocina y Taller',
    icon: 'kitchen',
    categoria: 'manual',
    badge: 'Optimizado',
    description:
      'Control sin contacto a distancia media. Mano abierta para puntero, dos dedos para desplazar y puño cerrado para pausar.',
    settings: {
      sensitivity: 70,
      stability: 45,
      pinchTolerance: 55,
      deskRest: false,
      gazeAssist: false,
    },
  },
  desk: {
    title: 'Desk-Rest Ergonómico',
    icon: 'desk',
    categoria: 'oficina',
    badge: 'Antebrazo apoyado',
    description:
      'Rastreo con antebrazo apoyado en mesa. Área activa compacta para cubrir la pantalla con movimientos breves de muñeca.',
    settings: {
      sensitivity: 68,
      stability: 50,
      pinchTolerance: 50,
      deskRest: true,
      gazeAssist: false,
    },
  },
  assistance: {
    title: 'Asistencia Motriz',
    icon: 'assistance',
    categoria: 'accesibilidad',
    badge: 'Alta estabilidad',
    description:
      'Filtrado antitemblor reforzado y mayor tolerancia en micro-pinza para facilitar una selección estable.',
    settings: {
      sensitivity: 52,
      stability: 78,
      pinchTolerance: 68,
      deskRest: true,
      gazeAssist: false,
    },
  },
}
export const CATEGORY_ICON = {
  manual: 'kitchen',
  oficina: 'desk',
  accesibilidad: 'assistance',
  personalizado: 'star',
}

// ------------------------------------------------------------------ construcción

export function newProfile({ nombre, descripcion = '' }, extra = {}) {
  return {
    id: uuid(),
    nombre: text(nombre, 'Perfil'),
    descripcion: text(descripcion, '', 300),
    version: null,
    dirty: true,
    updatedAt: now(),
    ...extra,
  }
}

export function newMode(
  profileId,
  { nombre, categoria = 'personalizado', plantilla = null, settings = {}, assignments = null },
  extra = {},
) {
  return {
    id: uuid(),
    profileId,
    nombre: text(nombre, 'Modo'),
    categoria: CATEGORIES.includes(categoria) ? categoria : 'personalizado',
    plantilla,
    settings: normalizeModeSettings({ ...modeSettingDefaults, ...settings }),
    assignments: normalizeAssignments(assignments ?? defaultAssignments()),
    version: null,
    dirty: true,
    updatedAt: now(),
    ...extra,
  }
}

export function createDefaultState() {
  const profile = newProfile({ nombre: 'Perfil principal', descripcion: 'Modos de este equipo' })
  const modes = Object.entries(presets).map(([key, preset]) =>
    newMode(profile.id, {
      nombre: preset.title,
      categoria: preset.categoria,
      plantilla: key,
      settings: preset.settings,
    }),
  )
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
  const box =
    Array.isArray(r.activeBox) &&
    r.activeBox.length === 4 &&
    r.activeBox.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    r.activeBox[0] < r.activeBox[1] &&
    r.activeBox[2] < r.activeBox[3]
      ? r.activeBox.map((v) => Math.round(v * 1000) / 1000)
      : null
  const g = r.gaze && typeof r.gaze === 'object' ? r.gaze : {}
  const cal =
    g.calibration &&
    typeof g.calibration === 'object' &&
    Number.isFinite(g.calibration.yaw) &&
    Number.isFinite(g.calibration.pitch)
      ? { yaw: g.calibration.yaw, pitch: g.calibration.pitch }
      : null
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
    dictation: bool(r.dictation, true),
    keyboardGesture: bool(r.keyboardGesture, true),
    altTab: bool(r.altTab, true),
    newTab: bool(r.newTab, true),
    openHandScroll: bool(r.openHandScroll, false),
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
const version = (value) => (Number.isInteger(value) && value >= 1 ? value : null)

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA) return null
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .filter((p) => p && UUID.test(p.id))
    .map((p) => ({
      id: p.id.toLowerCase(),
      nombre: text(p.nombre, 'Perfil') || 'Perfil',
      descripcion: text(p.descripcion, '', 300),
      version: version(p.version),
      dirty: bool(p.dirty, false),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now(),
    }))
  const ids = new Set(profiles.map((p) => p.id))
  const modes = (Array.isArray(raw.modes) ? raw.modes : [])
    .filter(
      (m) =>
        m &&
        UUID.test(m.id) &&
        typeof m.profileId === 'string' &&
        ids.has(m.profileId.toLowerCase()),
    )
    .map((m) => ({
      id: m.id.toLowerCase(),
      profileId: m.profileId.toLowerCase(),
      nombre: text(m.nombre, 'Modo') || 'Modo',
      categoria: CATEGORIES.includes(m.categoria) ? m.categoria : 'personalizado',
      plantilla: typeof m.plantilla === 'string' && presets[m.plantilla] ? m.plantilla : null,
      settings: normalizeModeSettings(m.settings),
      assignments: normalizeAssignments(m.assignments),
      version: version(m.version),
      dirty: bool(m.dirty, false),
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now(),
    }))
  const tombstones = (Array.isArray(raw.tombstones) ? raw.tombstones : [])
    .filter((t) => t && ['profile', 'mode'].includes(t.kind) && UUID.test(t.id))
    .map((t) => ({ ...t, kind: t.kind, id: t.id.toLowerCase(), version: version(t.version) }))
  const activeModeId = modes.some((m) => m.id === raw.activeModeId)
    ? raw.activeModeId
    : (modes[0]?.id ?? null)
  const activeProfileId = activeModeId
    ? modes.find((m) => m.id === activeModeId).profileId
    : ids.has(raw.activeProfileId)
      ? raw.activeProfileId
      : (profiles[0]?.id ?? null)
  return {
    schema: SCHEMA,
    device: normalizeDevice(raw.device),
    profiles,
    modes,
    tombstones,
    activeProfileId,
    activeModeId,
    syncOperation: raw.syncOperation == null ? null : structuredClone(raw.syncOperation),
    lastSync:
      raw.lastSync && typeof raw.lastSync === 'object'
        ? { at: String(raw.lastSync.at || ''), status: String(raw.lastSync.status || '') }
        : null,
  }
}

// ------------------------------------------------------------------ almacenamiento

export function loadState(accountId, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(accountId)))
    const state = normalizeState(parsed)
    if (state) return state
  } catch {
    /* se ignora un valor corrupto: se parte de cero o del formato antiguo */
  }
  if (!accountId || accountId === GUEST) {
    try {
      const legacy = JSON.parse(storage.getItem(LEGACY_KEY))
      if (legacy && typeof legacy === 'object') return migrateLegacy(legacy)
    } catch {
      /* sin preferencias antiguas */
    }
  }
  return null
}

export function saveState(accountId, state, storage = globalThis.localStorage) {
  try {
    storage.setItem(storageKey(accountId), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function hasStoredState(accountId, storage = globalThis.localStorage) {
  try {
    return storage.getItem(storageKey(accountId)) !== null
  } catch {
    return false
  }
}

/** Convierte el formato v1 (contextos planos y ajustes globales) al modelo de perfiles y modos. */
export function migrateLegacy(legacy) {
  const state = createDefaultState()
  const s = legacy.settings || {}
  state.device = normalizeDevice({
    preferredHand: s.preferredHand,
    mirrorCamera: s.mirrorCamera,
    cameraIndex: s.cameraIndex,
    movementArea: s.movementArea,
    confidenceThreshold: s.confidenceThreshold,
    diagnosticOverlay: s.diagnosticOverlay,
    windowGestures: s.windowGestures,
  })
  const legacyToggles = Object.fromEntries(
    TOGGLE_KEYS.filter((key) => typeof s[key] === 'boolean').map((key) => [key, s[key]]),
  )
  const applyToggles = (mode, toggles) => {
    for (const [key, value] of Object.entries(toggles))
      if (typeof value === 'boolean' && TOGGLE_TO_GESTURE[key])
        mode.assignments[TOGGLE_TO_GESTURE[key]].habilitado = value
  }
  for (const mode of state.modes) {
    const override = legacy.contextSettings?.[mode.plantilla]
    if (override && typeof override === 'object') {
      mode.settings = normalizeModeSettings({ ...mode.settings, ...override })
      applyToggles(mode, override)
    } else applyToggles(mode, legacyToggles)
  }
  for (const ctx of Array.isArray(legacy.contexts) ? legacy.contexts : []) {
    if (!ctx || typeof ctx.name !== 'string') continue
    const mode = newMode(state.activeProfileId, {
      nombre: ctx.name,
      categoria: 'personalizado',
      settings: ctx,
    })
    applyToggles(mode, { ...legacyToggles, ...ctx })
    if (UUID.test(ctx.id)) mode.id = ctx.id.toLowerCase()
    state.modes.push(mode)
  }
  const presetKey = {
    kitchen: 'kitchen',
    desk: 'desk',
    assistance: 'assistance',
    handsfree: 'kitchen',
  }[legacy.desktopContext]
  const active = state.modes.find((m) =>
    presetKey ? m.plantilla === presetKey : m.id === String(legacy.desktopContext).toLowerCase(),
  )
  state.activeModeId = (active || state.modes[0]).id
  state.activeProfileId = (active || state.modes[0]).profileId
  return normalizeState(state)
}
