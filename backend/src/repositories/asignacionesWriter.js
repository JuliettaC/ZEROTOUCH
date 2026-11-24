// SQL único de escritura de asignaciones, compartido por el repositorio de catálogos (PUT/PATCH de /gestos) y el
// de modos (mutación conjunta). No abre transacciones: quien lo llama decide el alcance de la transacción.
import { prepared } from './statements.js';
export function createAssignmentWriter(db) {
  const clear = prepared(db, 'DELETE FROM asignaciones_gestos WHERE modo_id=?');
  const upsert = prepared(db, `INSERT INTO asignaciones_gestos(modo_id,gesto_codigo,accion_codigo,habilitado,version,actualizado_en) VALUES(?,?,?,?,1,?)
      ON CONFLICT(modo_id,gesto_codigo) DO UPDATE SET accion_codigo=excluded.accion_codigo,habilitado=excluded.habilitado,version=version+1,actualizado_en=excluded.actualizado_en`);
  return {
    /** Añade o actualiza filas sin tocar las demás. */
    upsertAll(modoId, rows, now) {
      for (const row of rows) upsert.run(modoId, row.gesto_codigo, row.accion_codigo, row.habilitado ? 1 : 0, now);
    },
    /** Sustituye todas las asignaciones del modo: los gestos sin fila vuelven a la acción predeterminada del catálogo. */
    replaceAll(modoId, rows, now) {
      clear.run(modoId);
      for (const row of rows) upsert.run(modoId, row.gesto_codigo, row.accion_codigo, row.habilitado ? 1 : 0, now);
    },
  };
}
