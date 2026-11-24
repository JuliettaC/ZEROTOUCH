import { useId, useState } from 'react'
import { RESOLUTION_LABELS, conflictKey, describeConflict } from '../sync/syncEngine'

// Decisiones pendientes tras una sincronización. Nada se resuelve solo: cada conflicto conserva sus
// datos hasta que la persona elige. Montar con `key` distinto por informe para reiniciar las elecciones.
export default function SyncConflicts({ conflicts, busy, onApply, onCancelDelete }) {
  const headingId = useId()
  const [choices, setChoices] = useState({})
  const choose = (key, value) => setChoices((current) => ({ ...current, [key]: value }))
  const decided = Object.keys(choices).length
  // Hay algo que decidir solo si algún conflicto ofrece una opción real; un borrado bloqueado se informa.
  const actionable = conflicts.some((c) =>
    c.type === 'resultado_incierto' ? (c.candidates?.length ?? 0) > 0 : c.options.length > 0,
  )
  return (
    <section className="sync-conflicts" aria-labelledby={headingId}>
      <h3 id={headingId}>Requiere tu decisión</h3>
      <ul>
        {conflicts.map((conflict) => {
          const key = conflictKey(conflict.kind, conflict.id)
          const group = `${key}-${conflict.type}`
          return (
            <li key={group}>
              <p>{describeConflict(conflict)}</p>
              {conflict.type === 'borrado_no_seguro' && conflict.reason === 'servidor' && (
                <>
                  <small>
                    El elemento ya no aparece aquí, pero sigue en tu cuenta. Este servidor no
                    permite borrar comprobando la versión, así que no se envía y no se toca.
                  </small>
                  {onCancelDelete && (
                    <button
                      type="button"
                      className="tiny-button ghost"
                      disabled={busy}
                      onClick={() => onCancelDelete(conflict)}
                    >
                      Cancelar el borrado y recuperarlo
                    </button>
                  )}
                </>
              )}
              {conflict.type === 'borrado_modificado' && (
                <small>
                  «Borrarlo de todos modos» elimina lo que hay ahora en el servidor, con los cambios
                  del otro equipo.
                </small>
              )}
              {conflict.type === 'resultado_incierto' && (
                <UncertainCreation
                  conflict={conflict}
                  group={group}
                  value={choices[key]}
                  onChoose={(value) => choose(key, value)}
                />
              )}
              {/* Una creación incierta solo admite la elección explícita de un candidato (objeto), nunca la cadena «adoptar». */}
              {conflict.type !== 'resultado_incierto' && conflict.options.length > 0 && (
                <fieldset>
                  <legend className="sr-only">Decisión para «{conflict.nombre}»</legend>
                  {conflict.options.map((option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={group}
                        checked={choices[key] === option}
                        onChange={() => choose(key, option)}
                      />
                      {RESOLUTION_LABELS[option]}
                    </label>
                  ))}
                </fieldset>
              )}
            </li>
          )
        })}
      </ul>
      {actionable && (
        <>
          <button
            type="button"
            className="button primary"
            disabled={busy || decided === 0}
            onClick={() => onApply(choices)}
          >
            {busy ? 'Sincronizando…' : 'Aplicar decisiones y sincronizar'}
          </button>
          {decided === 0 && <small>Elige una opción para continuar.</small>}
        </>
      )}
    </section>
  )
}

function UncertainCreation({ conflict, group, value, onChoose }) {
  const candidates = conflict.candidates ?? []
  if (candidates.length === 0) {
    return (
      <small>
        No hay ningún elemento candidato en el servidor. Mientras no se resuelva allí, esta creación
        sigue bloqueada y no se repetirá sola.
      </small>
    )
  }
  return (
    <fieldset>
      <legend>Elige el elemento que se creó antes de perder la conexión</legend>
      {candidates.map((candidate) => (
        <label key={candidate.id}>
          <input
            type="radio"
            name={group}
            checked={value?.remoteId === candidate.id}
            onChange={() => onChoose({ action: 'adoptar', remoteId: candidate.id })}
          />
          {candidate.nombre} · versión {candidate.version}
        </label>
      ))}
      <small>
        Al elegir uno se conserva el contenido de este equipo y se reemplaza el del servidor.
      </small>
    </fieldset>
  )
}
