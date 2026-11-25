import { createAssignmentWriter } from './asignacionesWriter.js';
import { GESTOS } from '../domain/capacidades.js';
// Solo los gestos del contrato: una base v2/v3 aún sin migrar conserva filas de gestos retirados (v4) que no se muestran.
const vigentes = `g.codigo IN (${GESTOS.map(() => '?').join(',')})`;
// All dynamic SQL identifiers below are internal constants, never request keys.
export function createCatalogosRepository(db) {
  const writer = createAssignmentWriter(db);
  const owner = 'id=? AND perfil_id IN (SELECT id FROM perfiles WHERE usuario_id=?)';
  const effective = db.prepare(`
      SELECT g.codigo AS gesto_codigo,g.nombre,COALESCE(a.accion_codigo,g.accion_predeterminada) AS accion_codigo,
        COALESCE(a.habilitado,1) AS habilitado,a.version AS asignacion_version
      FROM modos_uso m JOIN perfiles p ON p.id=m.perfil_id CROSS JOIN gestos g
      LEFT JOIN asignaciones_gestos a ON a.modo_id=m.id AND a.gesto_codigo=g.codigo
      WHERE m.id=? AND p.usuario_id=? AND ${vigentes} ORDER BY g.codigo`);
  const bump = db.prepare(`UPDATE modos_uso SET version=version+1,actualizado_en=? WHERE ${owner} AND version=? RETURNING version`);
  const exists = db.prepare(`SELECT version FROM modos_uso WHERE ${owner}`);
  return {
    gestures: () => db.prepare(`SELECT codigo,nombre,accion_predeterminada FROM gestos g WHERE ${vigentes} ORDER BY codigo`).all(...GESTOS),
    actions: () => db.prepare('SELECT codigo,nombre FROM acciones ORDER BY codigo').all(),
    effective: (modoId, usuarioId) => effective.all(modoId, usuarioId, ...GESTOS).map(row => ({ ...row, habilitado: Boolean(row.habilitado) })),
    snapshot: operation => db.transaction(operation).deferred(),
    /**
     * Replaces (or, with `replaceAll=false`, upserts) the assignments of one mode in a single
     * transaction guarded by the mode's optimistic version, which is incremented so one `version`
     * covers the mode and its assignments. Returns 'missing', 'conflict' or the new version.
     */
    writeAssignments(modoId, usuarioId, version, rows, { replaceAll = true } = {}) {
      return db.transaction(() => {
        const current = exists.get(modoId, usuarioId);
        if (!current) return 'missing';
        const now = new Date().toISOString();
        const bumped = bump.get(now, modoId, usuarioId, version);
        if (!bumped) return 'conflict';
        if (replaceAll) writer.replaceAll(modoId, rows, now);
        else writer.upsertAll(modoId, rows, now);
        return bumped.version;
      }).immediate();
    },
  };
}
