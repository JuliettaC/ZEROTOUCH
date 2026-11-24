import {
  defaultAssignments,
  normalizeAssignments,
  togglesFrom,
  TOGGLE_TO_GESTURE,
  isAllowed,
  NO_ACTION,
} from './capabilities.js'
import { uniqueName } from '../sync/names.js'
import {
  now,
  text,
  CATEGORIES,
  deviceDefaults,
  modeSettingDefaults,
  presets,
  newProfile,
  newMode,
  normalizeModeSettings,
  normalizeDevice,
} from './preferenceState.js'

export {
  SCHEMA,
  GUEST,
  storageKey,
  CATEGORIES,
  deviceDefaults,
  modeSettingDefaults,
  presets,
  CATEGORY_ICON,
  newProfile,
  newMode,
  createDefaultState,
  normalizeModeSettings,
  normalizeDevice,
  normalizeState,
  loadState,
  saveState,
  hasStoredState,
  migrateLegacy,
} from './preferenceState.js'

// ------------------------------------------------------------------ selectores

export const getActiveMode = (state) => state.modes.find((m) => m.id === state.activeModeId) || null
export const getActiveProfile = (state) =>
  state.profiles.find((p) => p.id === state.activeProfileId) || null
export const modesOf = (state, profileId) => state.modes.filter((m) => m.profileId === profileId)
export const presetOf = (mode) => (mode?.plantilla && presets[mode.plantilla]) || null

/** Ajustes planos que consume la interfaz y el motor: equipo + modo activo + interruptores. */
export function getEffectiveSettings(state) {
  const mode = getActiveMode(state)
  const settings = mode ? mode.settings : { ...modeSettingDefaults }
  const assignments = mode ? mode.assignments : defaultAssignments()
  return { ...state.device, ...settings, ...togglesFrom(assignments) }
}

export const getActiveAssignments = (state) =>
  getActiveMode(state)?.assignments ?? defaultAssignments()

// ------------------------------------------------------------------ mutaciones (puras)

const touch = (item) => ({ ...item, dirty: true, updatedAt: now() })

export function updateDevice(state, patch) {
  return {
    ...state,
    device: normalizeDevice({
      ...state.device,
      ...patch,
      gaze: { ...state.device.gaze, ...(patch.gaze || {}) },
    }),
  }
}

export function updateModeSettings(state, modeId, patch) {
  return {
    ...state,
    modes: state.modes.map((m) =>
      m.id === modeId
        ? touch({ ...m, settings: normalizeModeSettings({ ...m.settings, ...patch }) })
        : m,
    ),
  }
}

export function setAssignment(state, modeId, gesto, { accion, habilitado }) {
  return {
    ...state,
    modes: state.modes.map((m) => {
      if (m.id !== modeId || !m.assignments[gesto]) return m
      const next = {
        accion: accion ?? m.assignments[gesto].accion,
        habilitado: habilitado ?? m.assignments[gesto].habilitado,
      }
      if (!isAllowed(gesto, next.accion, next.habilitado)) return m
      return touch({ ...m, assignments: { ...m.assignments, [gesto]: next } })
    }),
  }
}

export function setToggle(state, modeId, toggle, value) {
  const gesto = TOGGLE_TO_GESTURE[toggle]
  if (!gesto) return state
  const mode = state.modes.find((m) => m.id === modeId)
  if (!mode) return state
  const current = mode.assignments[gesto]
  // Encender un gesto que estaba en sin_accion devuelve su acción predeterminada.
  const accion =
    value && current.accion === NO_ACTION ? defaultAssignments()[gesto].accion : current.accion
  return setAssignment(state, modeId, gesto, { accion, habilitado: Boolean(value) })
}

/** Reparte un parche plano (como lo produce la interfaz) entre el equipo, el modo activo y sus interruptores. */
export function updateActiveSettings(state, patch) {
  let next = state
  const device = {},
    mode = {}
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in deviceDefaults) device[key] = value
    else if (key in modeSettingDefaults) mode[key] = value
    else if (TOGGLE_TO_GESTURE[key] && state.activeModeId)
      next = setToggle(next, state.activeModeId, key, value)
  }
  if (Object.keys(device).length) next = updateDevice(next, device)
  if (Object.keys(mode).length && state.activeModeId)
    next = updateModeSettings(next, state.activeModeId, mode)
  return next
}

export function selectMode(state, modeId) {
  const mode = state.modes.find((m) => m.id === modeId)
  return mode ? { ...state, activeModeId: mode.id, activeProfileId: mode.profileId } : state
}

export function selectProfile(state, profileId) {
  if (!state.profiles.some((p) => p.id === profileId)) return state
  const first = state.modes.find((m) => m.profileId === profileId)
  return { ...state, activeProfileId: profileId, activeModeId: first ? first.id : null }
}

export function addProfile(state, data) {
  const profile = newProfile(data)
  return {
    ...state,
    profiles: [...state.profiles, profile],
    activeProfileId: profile.id,
    activeModeId: null,
  }
}

export function updateProfile(state, profileId, patch) {
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === profileId
        ? touch({
            ...p,
            nombre: text(patch.nombre ?? p.nombre, p.nombre) || p.nombre,
            descripcion: text(patch.descripcion ?? p.descripcion, '', 300),
          })
        : p,
    ),
  }
}

export function removeProfile(state, profileId) {
  const op = state.syncOperation
  if (
    op &&
    (op.id === profileId || state.modes.some((m) => m.profileId === profileId && m.id === op.id))
  )
    throw new Error('Recupera la sincronización pendiente antes de eliminar este perfil.')
  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) return state
  const tombstones = [...state.tombstones]
  if (profile.version !== null)
    tombstones.push({
      kind: 'profile',
      id: profile.id,
      version: profile.version,
      nombre: profile.nombre,
      modes: modesOf(state, profile.id)
        .filter((m) => m.version !== null)
        .map((m) => ({ id: m.id, version: m.version })),
    })
  const modes = state.modes.filter((m) => m.profileId !== profileId)
  const profiles = state.profiles.filter((p) => p.id !== profileId)
  let next = { ...state, profiles, modes, tombstones }
  if (next.activeProfileId === profileId)
    next = profiles.length
      ? selectProfile(next, profiles[0].id)
      : { ...next, activeProfileId: null, activeModeId: null }
  return next
}

export function addMode(state, profileId, data) {
  if (!state.profiles.some((p) => p.id === profileId)) return state
  const mode = newMode(profileId, data)
  return {
    ...state,
    modes: [...state.modes, mode],
    activeModeId: mode.id,
    activeProfileId: profileId,
  }
}

export function updateMode(state, modeId, patch) {
  return {
    ...state,
    modes: state.modes.map((m) => {
      if (m.id !== modeId) return m
      const next = { ...m }
      if (patch.nombre !== undefined) next.nombre = text(patch.nombre, m.nombre) || m.nombre
      if (patch.categoria !== undefined && CATEGORIES.includes(patch.categoria))
        next.categoria = patch.categoria
      if (patch.settings)
        next.settings = normalizeModeSettings({ ...m.settings, ...patch.settings })
      if (patch.assignments)
        next.assignments = normalizeAssignments({ ...m.assignments, ...patch.assignments })
      return touch(next)
    }),
  }
}

export function removeMode(state, modeId) {
  if (state.syncOperation?.id === modeId)
    throw new Error('Recupera la sincronización pendiente antes de eliminar este modo.')
  const mode = state.modes.find((m) => m.id === modeId)
  if (!mode) return state
  const tombstones = [...state.tombstones]
  if (mode.version !== null)
    tombstones.push({
      kind: 'mode',
      id: mode.id,
      version: mode.version,
      nombre: mode.nombre,
      profileId: mode.profileId,
    })
  const modes = state.modes.filter((m) => m.id !== modeId)
  let next = { ...state, modes, tombstones }
  if (next.activeModeId === modeId) {
    const sibling = modes.find((m) => m.profileId === mode.profileId) || modes[0]
    next = {
      ...next,
      activeModeId: sibling ? sibling.id : null,
      activeProfileId: sibling ? sibling.profileId : mode.profileId,
    }
  }
  return next
}

/** Copia explícita de los perfiles y modos de invitado a la cuenta actual, con identidades nuevas. */
export function importGuestInto(state, guest) {
  if (!guest) return state
  const names = new Set(state.profiles.map((p) => p.nombre.toLowerCase()))
  const profiles = [...state.profiles],
    modes = [...state.modes]
  for (const profile of guest.profiles) {
    const nombre = uniqueName(profile.nombre, [...names])
    names.add(nombre.toLowerCase())
    const copy = newProfile({ nombre, descripcion: profile.descripcion })
    profiles.push(copy)
    for (const mode of modesOf(guest, profile.id))
      modes.push(
        newMode(copy.id, {
          nombre: mode.nombre,
          categoria: mode.categoria,
          plantilla: mode.plantilla,
          settings: mode.settings,
          assignments: mode.assignments,
        }),
      )
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
      profiles: state.profiles.map((p) =>
        p.id === localId
          ? { ...p, id: remoteId, version: remote.version, dirty: true, updatedAt: now() }
          : p,
      ),
      modes: state.modes.map((m) => (m.profileId === localId ? { ...m, profileId: remoteId } : m)),
      activeProfileId: state.activeProfileId === localId ? remoteId : state.activeProfileId,
    }
  }
  return {
    ...state,
    modes: state.modes.map((m) =>
      m.id === localId
        ? { ...m, id: remoteId, version: remote.version, dirty: true, updatedAt: now() }
        : m,
    ),
    activeModeId: state.activeModeId === localId ? remoteId : state.activeModeId,
  }
}

export function markSynced(state, kind, id, version) {
  const key = kind === 'profile' ? 'profiles' : 'modes'
  return {
    ...state,
    [key]: state[key].map((item) =>
      item.id === id ? { ...item, version, dirty: false, updatedAt: now() } : item,
    ),
  }
}

export function upsertRemoteProfile(state, remote) {
  const id = String(remote.id).toLowerCase()
  const data = {
    id,
    nombre: text(remote.nombre, 'Perfil') || 'Perfil',
    descripcion: text(remote.descripcion, '', 300),
    version: remote.version,
    dirty: false,
    updatedAt: now(),
  }
  const exists = state.profiles.some((p) => p.id === id)
  return {
    ...state,
    profiles: exists
      ? state.profiles.map((p) => (p.id === id ? { ...p, ...data } : p))
      : [...state.profiles, data],
  }
}

export function upsertRemoteMode(state, remote, assignments) {
  const id = String(remote.id).toLowerCase(),
    profileId = String(remote.perfil_id).toLowerCase()
  const existing = state.modes.find((m) => m.id === id)
  const data = {
    id,
    profileId,
    nombre: text(remote.nombre, 'Modo') || 'Modo',
    categoria: CATEGORIES.includes(remote.categoria) ? remote.categoria : 'personalizado',
    plantilla: existing?.plantilla ?? null,
    settings: normalizeModeSettings({
      sensitivity: remote.sensibilidad_puntero,
      stability: remote.estabilizacion_puntero,
      pinchTolerance: remote.tolerancia_micro_pinza,
      deskRest: remote.desk_rest_habilitado,
      gazeAssist: remote.asistencia_mirada_habilitada,
    }),
    assignments: assignments
      ? normalizeAssignments(assignments)
      : (existing?.assignments ?? defaultAssignments()),
    version: remote.version,
    dirty: false,
    updatedAt: now(),
  }
  const modes = existing ? state.modes.map((m) => (m.id === id ? data : m)) : [...state.modes, data]
  const next = { ...state, modes }
  return next.activeModeId ? next : { ...next, activeModeId: id, activeProfileId: profileId }
}

export function dropLocal(state, kind, id) {
  if (kind === 'profile') {
    const profiles = state.profiles.filter((p) => p.id !== id),
      modes = state.modes.filter((m) => m.profileId !== id)
    let next = { ...state, profiles, modes }
    if (next.activeProfileId === id)
      next = profiles.length
        ? selectProfile(next, profiles[0].id)
        : { ...next, activeProfileId: null, activeModeId: null }
    return next
  }
  const mode = state.modes.find((m) => m.id === id)
  if (!mode) return state
  const modes = state.modes.filter((m) => m.id !== id)
  let next = { ...state, modes }
  if (next.activeModeId === id) {
    const sibling = modes.find((m) => m.profileId === mode.profileId) || modes[0]
    next = {
      ...next,
      activeModeId: sibling?.id ?? null,
      activeProfileId: sibling?.profileId ?? mode.profileId,
    }
  }
  return next
}

export const clearTombstone = (state, kind, id) => ({
  ...state,
  tombstones: state.tombstones.filter((t) => !(t.kind === kind && t.id === id)),
})
export const hasPendingChanges = (state) =>
  Boolean(state.syncOperation) ||
  state.tombstones.length > 0 ||
  state.profiles.some((p) => p.dirty || p.version === null) ||
  state.modes.some((m) => m.dirty || m.version === null)

/** Diferencias entre los ajustes planos actuales de la interfaz y los nuevos: el parche que entiende `updateActiveSettings`. */
export function settingsPatch(current, next) {
  const patch = {}
  for (const [key, value] of Object.entries(next || {})) {
    if (JSON.stringify(current?.[key]) !== JSON.stringify(value)) patch[key] = value
  }
  return patch
}
