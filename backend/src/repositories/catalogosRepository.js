export function createCatalogosRepository(db) {
  return {
    gestures: () => db.prepare('SELECT codigo,nombre,accion_predeterminada FROM gestos ORDER BY codigo').all(),
    actions: () => db.prepare('SELECT codigo,nombre FROM acciones ORDER BY codigo').all(),
    effective: (modoId, usuarioId) => db.prepare(`
      SELECT g.codigo AS gesto_codigo,g.nombre,COALESCE(a.accion_codigo,g.accion_predeterminada) AS accion_codigo,
        COALESCE(a.habilitado,1) AS habilitado,a.version AS asignacion_version
      FROM modos_uso m JOIN perfiles p ON p.id=m.perfil_id CROSS JOIN gestos g
      LEFT JOIN asignaciones_gestos a ON a.modo_id=m.id AND a.gesto_codigo=g.codigo
      WHERE m.id=? AND p.usuario_id=? ORDER BY g.codigo`).all(modoId, usuarioId)
      .map(row => ({ ...row, habilitado: Boolean(row.habilitado) })),
    snapshot: operation => db.transaction(operation).deferred(),
  };
}
