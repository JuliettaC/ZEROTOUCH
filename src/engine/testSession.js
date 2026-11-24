// Informe de una prueba de gestos: mide lo que hizo el motor mientras la persona repite un gesto y lo
// entrega como Markdown. Puro (sin React ni Tauri). Solo guarda conteos, tiempos y ajustes: nunca imágenes,
// puntos de la mano ni texto escrito.

export const EVENT_LABELS = {
  LEFT_CLICK: 'Clic izquierdo',
  RIGHT_CLICK: 'Clic derecho',
  SCROLL: 'Desplazar',
  START_DRAG: 'Inicio de arrastre',
  END_DRAG: 'Fin de arrastre',
  PAUSE: 'Pausar',
  RESUME: 'Reanudar',
  TRACKING_LOST: 'Mano perdida',
  NEXT_TAB: 'Pestaña siguiente',
  PREV_TAB: 'Pestaña anterior',
  MINIMIZE_WINDOW: 'Minimizar ventana',
  RESTORE_WINDOW: 'Traer ventana de vuelta',
  BACK: 'Atrás',
  FORWARD: 'Adelante',
  CONFIRM: 'Confirmar',
  CANCEL: 'Cancelar',
  MEDIA_PLAY_PAUSE: 'Reproducir / pausar',
  MEDIA_NEXT: 'Siguiente pista',
  TIMER: 'Temporizador',
  PRECISION: 'Precisión',
  NAVIGATION: 'Navegación',
  DICTATION: 'Dictado (Win + H)',
  KEYBOARD: 'Abrir teclado',
  KEYBOARD_CLOSE: 'Bajar teclado',
  ALT_TAB: 'Cambiar de ventana (Alt + Tab)',
  ALT_TAB_HOLD: 'Selector de ventanas (Alt mantenido)',
  NEW_TAB: 'Pestaña nueva (Ctrl + T)',
}

const MAX_SAMPLES = 20000
const MAX_TIMELINE = 400
const NO_HAND = 'SIN_MANO'

// Destino de cada evento (motor `delivery_counts`): permite distinguir «no reconoce el gesto» de «lo
// reconoce pero no llega a la aplicación». Los códigos que no estén aquí se muestran tal cual.
export const DELIVERY_LABELS = {
  SO: 'llegó al sistema operativo',
  MOTOR: 'estado del motor (no va al SO)',
  INTERFAZ: 'solo a la interfaz de ZeroTouch',
  AIRSWIPE: 'al teclado Air-Swipe',
  SIN_ACCION: 'sin acción asignada',
  BLOQUEADO_OBSERVAR: 'bloqueado: modo Observar',
  BLOQUEADO_PARADA: 'bloqueado: parada de emergencia',
  BLOQUEADO_PAUSA: 'bloqueado: en pausa',
  BLOQUEADO_MIRADA: 'bloqueado: asistencia por mirada',
  BLOQUEADO_MANO_PERDIDA: 'bloqueado: mano perdida',
  VENTANA_MINIMIZED: 'ventana minimizada',
  VENTANA_WIN_DOWN: 'Win + flecha abajo enviado a la ventana activa',
  VENTANA_RESTORED: 'ventana restaurada',
  VENTANA_OWN_WINDOW: 'Windows no actuó: la ventana activa era ZeroTouch',
  VENTANA_NO_FOREGROUND: 'Windows no actuó: no había ventana activa',
  VENTANA_ALREADY_MINIMIZED: 'Windows no actuó: ya estaba minimizada',
  VENTANA_NO_LAST_WINDOW: 'Windows no actuó: nada que restaurar',
  VENTANA_NOT_MINIMIZED: 'Windows no actuó: la ventana no estaba minimizada',
  VENTANA_WINDOW_GONE: 'Windows no actuó: la ventana ya no existe',
  VENTANA_MINIMIZE_FAILED: 'Windows rechazó minimizar',
  VENTANA_RESTORE_FAILED: 'Windows rechazó restaurar',
  VENTANA_UNAVAILABLE: 'control de ventanas no disponible',
}

// Por qué no hubo clic con el pulgar tocando el índice (motor `pinch_diag`, fotogramas por motivo).
export const PINCH_LABELS = {
  PINZA: 'pinza aceptada (clic o arrastre)',
  INDICE_JUNTO_AL_MEDIO: 'descartada: índice pegado al medio (así se distingue del desplazar)',
  INDICE_RECTO: 'descartada: índice recto (doblarlo hacia el pulgar)',
  MANO_EN_MOVIMIENTO: 'descartada: mano en movimiento rápido (detenla antes de la pinza)',
  PUNO_RECIENTE: 'descartada: puño hace un instante',
  PINZA_DESACTIVADA: 'descartada: pinza desactivada',
  TRAZO_AIRSWIPE: 'descartada: trazo de Air-Swipe',
}
const pinchLabel = (code) =>
  PINCH_LABELS[code] ||
  (code.startsWith('OTRO_GESTO_') ? `ganó otro gesto: ${code.slice(11)}` : code)
const flatOf = (status, key) =>
  status?.[key] && typeof status[key] === 'object' ? status[key] : {}

/** Diferencia entre dos conteos planos {clave: n} (solo positivos). */
export function flatDelta(baseline, latest) {
  const result = {}
  for (const [key, value] of Object.entries(latest ?? {})) {
    const delta = (Number.isFinite(value) ? value : 0) - (baseline?.[key] ?? 0)
    if (delta > 0) result[key] = delta
  }
  return result
}

function addFlat(a, b) {
  const result = { ...a }
  for (const [key, value] of Object.entries(b)) result[key] = (result[key] ?? 0) + value
  return result
}

const countsOf = (status) =>
  status?.eventCounts && typeof status.eventCounts === 'object' ? status.eventCounts : {}
const deliveryOf = (status) =>
  status?.deliveryCounts && typeof status.deliveryCounts === 'object' ? status.deliveryCounts : {}
const cloneDelivery = (delivery) =>
  Object.fromEntries(
    Object.entries(delivery).map(([event, outcomes]) => [event, { ...(outcomes ?? {}) }]),
  )
const deliveryDropped = (previous, next) =>
  Object.entries(previous).some(([event, outcomes]) =>
    Object.entries(outcomes).some(([outcome, value]) => (next[event]?.[outcome] ?? 0) < value),
  )

/** Diferencia de destinos entre el inicio y el final (`{evento: {destino: veces}}`, solo positivos). */
export function deliveryDelta(baseline, latest) {
  const result = {}
  for (const [event, outcomes] of Object.entries(latest ?? {})) {
    for (const [outcome, value] of Object.entries(outcomes ?? {})) {
      const delta = (Number.isFinite(value) ? value : 0) - (baseline?.[event]?.[outcome] ?? 0)
      if (delta > 0) (result[event] = result[event] ?? {})[outcome] = delta
    }
  }
  return result
}
const poseOf = (status) =>
  !status?.handDetected
    ? NO_HAND
    : status.gesture && status.gesture !== 'NONE'
      ? status.gesture
      : 'NONE'

/** Empieza una prueba con la telemetría actual como punto de partida. `t` en segundos. */
export function startSession(status, t, meta = {}) {
  return {
    meta,
    t0: t,
    baseline: { ...countsOf(status) },
    last: { ...countsOf(status) },
    deliveryBaseline: cloneDelivery(deliveryOf(status)),
    deliveryLast: cloneDelivery(deliveryOf(status)),
    deliveryCarry: {}, // lo acumulado antes de un reinicio del motor
    pinchBaseline: { ...flatOf(status, 'pinchDiag') },
    pinchLast: { ...flatOf(status, 'pinchDiag') },
    pinchCarry: {},
    controlSamples: 0,
    mode: status?.mode ?? '',
    config: status?.appliedConfig ?? null,
    fps: [],
    handSamples: 0,
    armedSamples: 0,
    samples: 0,
    lastT: t,
    episode: null, // { pose, start }
    episodes: [],
    events: [], // { t, event, n }
    paused: Boolean(status?.paused),
    modeChanges: [],
  }
}

function closeEpisode(session, t) {
  if (!session.episode) return
  session.episodes.push({
    pose: session.episode.pose,
    start: session.episode.start - session.t0,
    duration: t - session.episode.start,
  })
  session.episode = null
}

function mergeDelivery(a, b) {
  const result = cloneDelivery(a)
  for (const [event, outcomes] of Object.entries(b)) {
    for (const [outcome, value] of Object.entries(outcomes))
      (result[event] = result[event] ?? {})[outcome] = (result[event][outcome] ?? 0) + value
  }
  return result
}

/** Incorpora una muestra de telemetría. Las muestras con un motor reiniciado (conteos que bajan) reinician la base. */
export function feedSession(session, status, t) {
  if (!status?.running) return session
  const counts = countsOf(status)
  for (const [event, value] of Object.entries(counts)) {
    const previous = session.last[event] ?? 0
    if (!Number.isFinite(value)) continue
    if (value < previous) {
      session.baseline[event] = 0
      session.last[event] = 0
    }
    const delta = value - (session.last[event] ?? 0)
    for (let i = 0; i < delta; i += 1) session.events.push({ t: t - session.t0, event, n: 1 })
    session.last[event] = value
  }
  const delivery = deliveryOf(status)
  if (deliveryDropped(session.deliveryLast, delivery)) {
    // Motor reiniciado: se guarda lo medido hasta ahora y la nueva base es cero.
    session.deliveryCarry = mergeDelivery(
      session.deliveryCarry,
      deliveryDelta(session.deliveryBaseline, session.deliveryLast),
    )
    session.deliveryBaseline = {}
  }
  session.deliveryLast = cloneDelivery(delivery)
  const pinch = flatOf(status, 'pinchDiag')
  if (Object.entries(session.pinchLast).some(([key, value]) => (pinch[key] ?? 0) < value)) {
    // Motor reiniciado: se guarda lo medido y la nueva base es cero.
    session.pinchCarry = addFlat(
      session.pinchCarry,
      flatDelta(session.pinchBaseline, session.pinchLast),
    )
    session.pinchBaseline = {}
  }
  session.pinchLast = { ...pinch }
  session.samples += 1
  if (status.mode === 'CONTROL') session.controlSamples += 1
  if (
    status.cameraOpen &&
    Number.isFinite(status.fps) &&
    status.fps > 0 &&
    session.fps.length < MAX_SAMPLES
  )
    session.fps.push(status.fps)
  if (status.handDetected) session.handSamples += 1
  if (status.pointerArmed) session.armedSamples += 1
  const pose = poseOf(status)
  if (!session.episode) session.episode = { pose, start: t }
  else if (session.episode.pose !== pose) {
    closeEpisode(session, t)
    session.episode = { pose, start: t }
  }
  if ((status.mode ?? '') !== session.mode) {
    session.modeChanges.push({ t: t - session.t0, mode: status.mode })
    session.mode = status.mode
  }
  session.paused = Boolean(status.paused)
  session.lastT = t
  return session
}

const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Resumen de la prueba (datos puros, sin formato). */
export function summarizeSession(session, t) {
  closeEpisode(session, t)
  const duration = Math.max(0, t - session.t0)
  const eventTotals = {}
  for (const { event } of session.events) eventTotals[event] = (eventTotals[event] ?? 0) + 1
  const poses = {}
  for (const { pose, duration: d } of session.episodes) {
    if (pose === NO_HAND) continue
    poses[pose] = poses[pose] ?? { entries: 0, total: 0, durations: [] }
    poses[pose].entries += 1
    poses[pose].total += d
    poses[pose].durations.push(d)
  }
  const fps = session.fps
  return {
    duration,
    samples: session.samples,
    handShare: session.samples ? session.handSamples / session.samples : 0,
    armedShare: session.samples ? session.armedSamples / session.samples : 0,
    controlShare: session.samples ? session.controlSamples / session.samples : 0,
    pinch: addFlat(session.pinchCarry, flatDelta(session.pinchBaseline, session.pinchLast)),
    delivery: mergeDelivery(
      session.deliveryCarry,
      deliveryDelta(session.deliveryBaseline, session.deliveryLast),
    ),
    fps: fps.length
      ? {
          min: Math.min(...fps),
          median: median(fps),
          mean: fps.reduce((a, b) => a + b, 0) / fps.length,
          max: Math.max(...fps),
        }
      : null,
    eventTotals,
    poses,
    events: session.events,
    episodes: session.episodes,
    modeChanges: session.modeChanges,
    mode: session.modeChanges.length ? session.modeChanges[0].mode : session.mode,
  }
}

const num = (value, digits = 1) => Number(value).toFixed(digits)
const poseName = (pose, labels) => labels[pose] || pose
const eventName = (event) => EVENT_LABELS[event] || event

/** Markdown del informe. `labels` traduce los códigos de postura (GESTURE_LABELS). */
export function renderReport(
  summary,
  { meta = {}, labels = {}, config = null, startedAt = '' } = {},
) {
  const lines = []
  lines.push('# Informe de prueba de gestos — ZeroTouch', '')
  lines.push(`- **Gesto probado:** ${meta.gesture || '(sin indicar)'}`)
  lines.push(
    `- **Intentos que hizo la persona:** ${Number.isFinite(meta.attempts) ? meta.attempts : '(sin indicar)'}`,
  )
  if (meta.notes) lines.push(`- **Notas:** ${meta.notes}`)
  if (startedAt) lines.push(`- **Inicio:** ${startedAt}`)
  lines.push(`- **Duración:** ${num(summary.duration)} s`)
  lines.push(
    `- **Modo:** ${summary.mode || '—'}${summary.modeChanges.length > 1 ? ` (cambió ${summary.modeChanges.length - 1} vez/veces)` : ''}`,
  )
  lines.push(`- **Tiempo en Controlar:** ${num((summary.controlShare ?? 0) * 100, 0)} %`)
  lines.push(`- **Mano detectada:** ${num(summary.handShare * 100, 0)} % del tiempo`)
  lines.push(
    `- **Puntero activado:** ${num(summary.armedShare * 100, 0)} % del tiempo${summary.armedShare < 0.5 ? ' (**poco: sin el puntero activado casi ningún gesto actúa; hay que abrir la mano ~0,4 s antes**)' : ''}`,
  )
  if (summary.fps)
    lines.push(
      `- **FPS de la cámara:** mín ${num(summary.fps.min)} · mediana ${num(summary.fps.median)} · media ${num(summary.fps.mean)} · máx ${num(summary.fps.max)}`,
    )
  else lines.push('- **FPS de la cámara:** sin datos (cámara cerrada)')
  lines.push('')

  lines.push('## Eventos que disparó el motor', '')
  const events = Object.entries(summary.eventTotals).sort((a, b) => b[1] - a[1])
  if (events.length) {
    lines.push('| Evento | Veces |', '|---|---|')
    for (const [event, n] of events) lines.push(`| ${eventName(event)} (\`${event}\`) | ${n} |`)
    if (Number.isFinite(meta.attempts) && meta.attempts > 0) {
      lines.push(
        '',
        `Con ${meta.attempts} intentos, el evento más frecuente se disparó ${events[0][1]} vez/veces.`,
      )
    }
  } else lines.push('Ningún evento (el motor no reconoció ningún gesto con acción).')
  lines.push('')

  lines.push('## Adónde llegó cada evento', '')
  const delivery = Object.entries(summary.delivery ?? {})
  if (delivery.length) {
    lines.push('| Evento | Destino | Veces |', '|---|---|---|')
    for (const [event, outcomes] of delivery.sort((a, b) =>
      eventName(a[0]).localeCompare(eventName(b[0])),
    )) {
      for (const [outcome, n] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) {
        lines.push(
          `| ${eventName(event)} (\`${event}\`) | ${DELIVERY_LABELS[outcome] || outcome} (\`${outcome}\`) | ${n} |`,
        )
      }
    }
    lines.push(
      '',
      '«Llegó al sistema operativo» quiere decir que el motor envió el clic, la tecla o el desplazamiento a Windows; si aun así no pasó nada, el problema está en la ventana que lo recibió (por ejemplo, Ctrl+Tab sobre una aplicación sin pestañas).',
    )
  } else lines.push('Sin datos de destino (motor sin este contador o ningún evento).')
  lines.push('')

  lines.push('## Pinza: por qué hubo o no clic', '')
  const pinchRows = Object.entries(summary.pinch ?? {}).sort((a, b) => b[1] - a[1])
  if (pinchRows.length) {
    const frames = pinchRows.reduce((sum, [, n]) => sum + n, 0)
    lines.push(
      `Fotogramas con el pulgar tocando el índice: ${frames}.`,
      '',
      '| Motivo | Fotogramas |',
      '|---|---|',
    )
    for (const [code, n] of pinchRows) lines.push(`| ${pinchLabel(code)} (\`${code}\`) | ${n} |`)
    lines.push(
      '',
      'Si casi todo es «pinza aceptada» y aun así no hubo clic, mira «Adónde llegó cada evento»; si domina un motivo de descarte, ese es el que hay que corregir.',
    )
  } else lines.push('El pulgar no llegó a tocar el índice (o el motor no tiene este contador).')
  lines.push('')

  lines.push('## Posturas vistas por el motor', '')
  const poses = Object.entries(summary.poses).sort((a, b) => b[1].entries - a[1].entries)
  if (poses.length) {
    lines.push(
      '| Postura | Entradas | Tiempo total (s) | Duración mediana (s) | Duración máxima (s) |',
      '|---|---|---|---|---|',
    )
    for (const [pose, p] of poses)
      lines.push(
        `| ${poseName(pose, labels)} (\`${pose}\`) | ${p.entries} | ${num(p.total)} | ${num(median(p.durations), 2)} | ${num(Math.max(...p.durations), 2)} |`,
      )
  } else lines.push('Ninguna postura distinta de «sin gesto».')
  lines.push(
    '',
    'Una «entrada» es una vez que la postura apareció y se mantuvo hasta cambiar. Si las entradas superan a los eventos, la postura se reconoce pero no llega a confirmarse como acción.',
    '',
  )

  lines.push('## Cronología', '')
  const timeline = []
  for (const ep of summary.episodes) {
    if (ep.pose === NO_HAND || ep.pose === 'NONE' || ep.duration < 0.1) continue
    timeline.push({
      t: ep.start,
      text: `postura ${poseName(ep.pose, labels)} (${num(ep.duration, 2)} s)`,
    })
  }
  for (const ev of summary.events) timeline.push({ t: ev.t, text: `EVENTO ${eventName(ev.event)}` })
  for (const ch of summary.modeChanges.slice(1))
    timeline.push({ t: ch.t, text: `modo → ${ch.mode}` })
  timeline.sort((a, b) => a.t - b.t)
  if (timeline.length) {
    lines.push('```')
    for (const row of timeline.slice(0, MAX_TIMELINE))
      lines.push(`${num(row.t).padStart(6)} s  ${row.text}`)
    if (timeline.length > MAX_TIMELINE)
      lines.push(`… ${timeline.length - MAX_TIMELINE} filas más omitidas`)
    lines.push('```')
  } else lines.push('Sin filas.')
  lines.push('')

  if (config) {
    lines.push(
      '## Configuración aplicada en el motor',
      '',
      '```json',
      JSON.stringify(config, null, 2),
      '```',
      '',
    )
  }
  lines.push(
    '_Solo contiene conteos, tiempos y ajustes: no incluye imágenes ni puntos de la mano._',
    '',
  )
  return lines.join('\n')
}
