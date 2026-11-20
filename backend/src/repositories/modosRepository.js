import { modeEtag } from '../domain/etag.js';
import { createAssignmentWriter } from './asignacionesWriter.js';
import { prepared } from './statements.js';
// All dynamic SQL identifiers below are internal constants, never request keys.
const fields = ['nombre', 'categoria', 'plataforma', 'sensibilidad_puntero', 'estabilizacion_puntero', 'tolerancia_micro_pinza', 'desk_rest_habilitado', 'asistencia_mirada_habilitada', 'activacion_contextual_movil'];
const booleans = ['desk_rest_habilitado', 'asistencia_mirada_habilitada', 'activacion_contextual_movil'];
export const modeDto = row => row && { ...row, ...Object.fromEntries(booleans.map(key => [key, Boolean(row[key])])) };
const value = (key, data) => booleans.includes(key) ? Number(data[key]) : data[key];
export function createModosRepository(db, usuarioId) {
  if (!usuarioId) throw new Error('Se requiere propietario.');
  const owner = 'perfil_id IN (SELECT id FROM perfiles WHERE usuario_id=?)';
  const assignments = createAssignmentWriter(db);
  return {
    get: id => modeDto(db.prepare(`SELECT * FROM modos_uso WHERE id=? AND ${owner}`).get(id, usuarioId)),
    list: (perfilId, { limite, offset }) => db.prepare(`SELECT * FROM modos_uso WHERE perfil_id=? AND ${owner} ORDER BY creado_en,id LIMIT ? OFFSET ?`).all(perfilId, usuarioId, limite, offset).map(modeDto),
    /**
     * Crea el modo. Con `rows` (lista `gestos` ya validada) escribe también sus asignaciones en la MISMA transacción:
     * o existen el modo y todas sus asignaciones, o no existe nada. Sin `rows` no toca las asignaciones.
     */
    create(perfilId, data, rows) {
      const keys = fields.filter(key => Object.hasOwn(data, key));
      const apply = () => {
        const row = prepared(db, `INSERT INTO modos_uso(id,perfil_id,${keys.join(',')}) SELECT ?,id,${keys.map(() => '?').join(',')} FROM perfiles WHERE id=? AND usuario_id=? RETURNING *`)
          .get(data.id, ...keys.map(key => value(key, data)), perfilId, usuarioId);
        if (row && rows) assignments.replaceAll(row.id, rows, new Date().toISOString());
        return modeDto(row);
      };
      return rows ? db.transaction(apply).immediate() : apply();
    },
    /**
     * Actualiza el modo con control de versión. Con `rows` reemplaza además todas sus asignaciones en la MISMA
     * transacción y con UNA sola subida de versión (la versión del modo ya cubre sus asignaciones); si la versión no
     * coincide no se toca nada. Devuelve `undefined` ante un conflicto de versión.
     */
    update(id, data, rows) {
      const keys = fields.filter(key => Object.hasOwn(data, key));
      const now = new Date().toISOString();
      const sets = [...keys.map(key => `${key}=?`), 'version=version+1', 'actualizado_en=?'];
      const apply = () => {
        const row = prepared(db, `UPDATE modos_uso SET ${sets.join(',')} WHERE id=? AND ${owner} AND version=? RETURNING *`)
          .get(...keys.map(key => value(key, data)), now, id, usuarioId, data.version);
        if (row && rows) assignments.replaceAll(row.id, rows, now);
        return modeDto(row);
      };
      return rows ? db.transaction(apply).immediate() : apply();
    },
    /** ETag del modo: su versión cubre también sus asignaciones. */
    etag: row => modeEtag(row.id, row.version),
    /**
     * Borra el modo y sus asignaciones SOLO si su versión coincide con `etag`; comprobación y borrado en una
     * misma transacción con bloqueo de escritura. @returns {'missing'|'stale'|'deleted'}
     */
    deleteIfMatch(id, etag) {
      return db.transaction(() => {
        const row = db.prepare(`SELECT id,version FROM modos_uso WHERE id=? AND ${owner}`).get(id, usuarioId);
        if (!row) return 'missing';
        if (modeEtag(row.id, row.version) !== etag) return 'stale';
        // Defensa en profundidad: si la fila ya no tiene esa versión, no se declara borrada.
        const { changes } = db.prepare('DELETE FROM modos_uso WHERE id=? AND version=?').run(row.id, row.version);
        return changes === 1 ? 'deleted' : 'stale';
      }).immediate();
    },
  };
}
