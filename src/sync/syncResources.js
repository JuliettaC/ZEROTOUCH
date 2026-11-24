import { allPages } from '../api/paging.js'
import { uniqueName } from './names.js'
import {
  adoptRemote,
  dropLocal,
  markSynced,
  modesOf,
  upsertRemoteProfile,
} from '../data/preferences.js'
import {
  conflictKey,
  lower,
  sameName,
  profilePayload,
  modePayload,
  pushMode,
  pullMode,
} from './syncProtocol.js'

export async function syncProfiles({
  session,
  resolutions,
  remoteProfiles,
  remoteProfileById,
  changes,
  conflicts,
  skipRemote,
  write,
  create,
  checkpoint,
}) {
  // 2. Perfiles locales → servidor.
  for (const profile of [...session.state.profiles]) {
    const res = resolutions[conflictKey('profile', profile.id)]
    const remote = remoteProfileById.get(profile.id)
    if (profile.version === null) {
      const duplicate = remoteProfiles.find(
        (r) =>
          !session.state.profiles.some((p) => p.id === r.id) && sameName(r.nombre, profile.nombre),
      )
      if (duplicate && res === 'adoptar') {
        session.state = adoptRemote(session.state, 'profile', profile.id, {
          id: duplicate.id,
          version: duplicate.version,
        })
        if ((duplicate.descripcion ?? '') !== profile.descripcion) {
          const updated = (
            await write(
              'updateProfile',
              [duplicate.id, { ...profilePayload(profile), version: duplicate.version }],
              'profile',
              duplicate.id,
            )
          ).data
          session.state = markSynced(session.state, 'profile', duplicate.id, updated.version)
          remoteProfileById.set(duplicate.id, { ...duplicate, version: updated.version })
          changes.updated += 1
        }
        session.state = markSynced(
          session.state,
          'profile',
          duplicate.id,
          session.state.profiles.find((p) => p.id === duplicate.id).version,
        )
        await checkpoint()
        continue
      }
      const payload = profilePayload(profile)
      if (duplicate && res === 'renombrar')
        payload.name = uniqueName(
          profile.nombre,
          remoteProfiles.map((r) => r.nombre),
        )
      try {
        const created = (await create('createProfile', [payload], 'profile', profile.id)).data
        session.state = adoptRemote(session.state, 'profile', profile.id, {
          id: lower(created.id),
          version: created.version,
        })
        if (payload.name !== profile.nombre)
          session.state = {
            ...session.state,
            profiles: session.state.profiles.map((p) =>
              p.id === lower(created.id) ? { ...p, nombre: created.nombre } : p,
            ),
          }
        remoteProfileById.set(lower(created.id), { ...created, id: lower(created.id) })
        changes.created += 1
      } catch (error) {
        if (error?.code !== 'NOMBRE_DUPLICADO') throw error
        if (duplicate) skipRemote.add(duplicate.id)
        conflicts.push({
          kind: 'profile',
          id: profile.id,
          type: 'nombre_duplicado',
          nombre: profile.nombre,
          local: profile,
          remote: duplicate ?? null,
          options: ['adoptar', 'renombrar'],
        })
      }
      continue
    }
    if (!remote) {
      const pending =
        profile.dirty ||
        modesOf(session.state, profile.id).some((m) => m.dirty || m.version === null)
      if (!pending || res === 'eliminar') {
        session.state = dropLocal(session.state, 'profile', profile.id)
        changes.removed += 1
        continue
      }
      if (res === 'recrear') {
        const created = (
          await create('createProfile', [profilePayload(profile)], 'profile', profile.id, true)
        ).data
        session.state = adoptRemote(session.state, 'profile', profile.id, {
          id: lower(created.id),
          version: created.version,
        })
        session.state = {
          ...session.state,
          modes: session.state.modes.map((m) =>
            m.profileId === lower(created.id) ? { ...m, version: null, dirty: true } : m,
          ),
        }
        remoteProfileById.set(lower(created.id), { ...created, id: lower(created.id) })
        changes.created += 1
        continue
      }
      conflicts.push({
        kind: 'profile',
        id: profile.id,
        type: 'eliminado_remoto',
        nombre: profile.nombre,
        local: profile,
        remote: null,
        options: ['recrear', 'eliminar'],
      })
      continue
    }
    if (profile.dirty) {
      if (remote.version === profile.version || res === 'local') {
        try {
          const updated = (
            await write(
              'updateProfile',
              [profile.id, { ...profilePayload(profile), version: remote.version }],
              'profile',
              profile.id,
            )
          ).data
          session.state = markSynced(session.state, 'profile', profile.id, updated.version)
          remoteProfileById.set(profile.id, { ...remote, ...updated, id: profile.id })
          changes.updated += 1
        } catch (error) {
          if (error?.code !== 'VERSION_CONFLICTO') throw error
          conflicts.push({
            kind: 'profile',
            id: profile.id,
            type: 'version',
            nombre: profile.nombre,
            local: profile,
            remote,
            options: ['local', 'remoto'],
          })
        }
      } else if (res === 'remoto') {
        session.state = upsertRemoteProfile(session.state, remote)
        changes.pulled += 1
      } else {
        conflicts.push({
          kind: 'profile',
          id: profile.id,
          type: 'version',
          nombre: profile.nombre,
          local: profile,
          remote,
          options: ['local', 'remoto'],
        })
      }
      continue
    }
    if (remote.version !== profile.version) {
      session.state = upsertRemoteProfile(session.state, remote)
      changes.pulled += 1
    }
  }

  // 3. Perfiles remotos desconocidos localmente.
  for (const remote of remoteProfiles) {
    if (
      !remoteProfileById.has(remote.id) ||
      skipRemote.has(remote.id) ||
      session.state.profiles.some((p) => p.id === remote.id)
    )
      continue
    session.state = upsertRemoteProfile(session.state, remote)
    changes.pulled += 1
  }
}

export async function syncModes({
  session,
  api,
  call,
  resolutions,
  changes,
  conflicts,
  skipRemote,
  write,
  createMode,
  features,
}) {
  // 4. Modos de cada perfil sincronizado.
  for (const profile of session.state.profiles.filter(
    (p) => p.version !== null && !skipRemote.has(p.id),
  )) {
    let remoteModes
    try {
      remoteModes = (await call(() => allPages((offset) => api.contexts(profile.id, offset)))).map(
        (m) => ({ ...m, id: lower(m.id), perfil_id: lower(m.perfil_id) }),
      )
    } catch (error) {
      if (error?.code === 'NO_ENCONTRADO') continue
      throw error
    }
    const remoteById = new Map(remoteModes.map((m) => [m.id, m]))
    for (const mode of modesOf(session.state, profile.id)) {
      const res = resolutions[conflictKey('mode', mode.id)]
      const remote = remoteById.get(mode.id)
      if (mode.version === null) {
        const duplicate = remoteModes.find(
          (r) => !session.state.modes.some((m) => m.id === r.id) && sameName(r.nombre, mode.nombre),
        )
        if (duplicate && res === 'adoptar') {
          session.state = adoptRemote(session.state, 'mode', mode.id, {
            id: duplicate.id,
            version: duplicate.version,
          })
          const localMode = session.state.modes.find((m) => m.id === duplicate.id)
          const pushed = await pushMode(
            write,
            { ...localMode, dirty: true },
            duplicate.version,
            (await features()).jointMode,
          )
          session.state = markSynced(session.state, 'mode', duplicate.id, pushed.version)
          changes.updated += 1
          continue
        }
        const payload = modePayload(mode)
        if (duplicate && res === 'renombrar')
          payload.name = uniqueName(
            mode.nombre,
            remoteModes.map((r) => r.nombre),
          )
        try {
          const created = await createMode(profile.id, mode, payload)
          if (payload.name !== mode.nombre)
            session.state = {
              ...session.state,
              modes: session.state.modes.map((m) =>
                m.id === lower(created.id) ? { ...m, nombre: created.nombre } : m,
              ),
            }
          changes.created += 1
        } catch (error) {
          if (error?.code !== 'NOMBRE_DUPLICADO') throw error
          if (duplicate) skipRemote.add(duplicate.id)
          conflicts.push({
            kind: 'mode',
            id: mode.id,
            type: 'nombre_duplicado',
            nombre: mode.nombre,
            local: mode,
            remote: duplicate ?? null,
            options: ['adoptar', 'renombrar'],
          })
        }
        continue
      }
      if (!remote) {
        if (!mode.dirty || res === 'eliminar') {
          session.state = dropLocal(session.state, 'mode', mode.id)
          changes.removed += 1
          continue
        }
        if (res === 'recrear') {
          await createMode(profile.id, mode, modePayload(mode), true)
          changes.created += 1
          continue
        }
        conflicts.push({
          kind: 'mode',
          id: mode.id,
          type: 'eliminado_remoto',
          nombre: mode.nombre,
          local: mode,
          remote: null,
          options: ['recrear', 'eliminar'],
        })
        continue
      }
      if (mode.dirty) {
        if (remote.version === mode.version || res === 'local') {
          try {
            const pushed = await pushMode(write, mode, remote.version, (await features()).jointMode)
            session.state = markSynced(session.state, 'mode', mode.id, pushed.version)
            changes.updated += 1
          } catch (error) {
            if (error?.code !== 'VERSION_CONFLICTO') throw error
            conflicts.push({
              kind: 'mode',
              id: mode.id,
              type: 'version',
              nombre: mode.nombre,
              local: mode,
              remote,
              options: ['local', 'remoto'],
            })
          }
        } else if (res === 'remoto') {
          session.state = await pullMode(api, call, session.state, mode.id)
          changes.pulled += 1
        } else {
          conflicts.push({
            kind: 'mode',
            id: mode.id,
            type: 'version',
            nombre: mode.nombre,
            local: mode,
            remote,
            options: ['local', 'remoto'],
          })
        }
        continue
      }
      if (remote.version !== mode.version) {
        session.state = await pullMode(api, call, session.state, mode.id)
        changes.pulled += 1
      }
    }
    for (const remote of remoteModes) {
      if (skipRemote.has(remote.id) || session.state.modes.some((m) => m.id === remote.id)) continue
      session.state = await pullMode(api, call, session.state, remote.id)
      changes.pulled += 1
    }
  }
}
