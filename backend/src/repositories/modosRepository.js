// All dynamic SQL identifiers below are internal constants, never request keys.
const fields = ['nombre', 'categoria', 'plataforma', 'sensibilidad_puntero', 'estabilizacion_puntero', 'tolerancia_micro_pinza', 'desk_rest_habilitado', 'asistencia_mirada_habilitada', 'activacion_contextual_movil'];
const booleans = ['desk_rest_habilitado', 'asistencia_mirada_habilitada', 'activacion_contextual_movil'];
export const modeDto = row => row && { ...row, ...Object.fromEntries(booleans.map(key => [key, Boolean(row[key])])) };
const value = (key, data) => booleans.includes(key) ? Number(data[key]) : data[key];
export function createModosRepository(db, usuarioId) {
  if (!usuarioId) throw new Error('Se requiere propietario.');
  const owner = 'perfil_id IN (SELECT id FROM perfiles WHERE usuario_id=?)';
  return {
    get: id => modeDto(db.prepare(`SELECT * FROM modos_uso WHERE id=? AND ${owner}`).get(id, usuarioId)),
    list: (perfilId, { limite, offset }) => db.prepare(`SELECT * FROM modos_uso WHERE perfil_id=? AND ${owner} ORDER BY creado_en,id LIMIT ? OFFSET ?`).all(perfilId, usuarioId, limite, offset).map(modeDto),
    create(perfilId, data) {
      const keys = fields.filter(key => Object.hasOwn(data, key));
      return modeDto(db.prepare(`INSERT INTO modos_uso(id,perfil_id,${keys.join(',')}) SELECT ?,id,${keys.map(() => '?').join(',')} FROM perfiles WHERE id=? AND usuario_id=? RETURNING *`)
        .get(data.id, ...keys.map(key => value(key, data)), perfilId, usuarioId));
    },
    update(id, data) {
      const keys = fields.filter(key => Object.hasOwn(data, key));
      return modeDto(db.prepare(`UPDATE modos_uso SET ${keys.map(key => `${key}=?`).join(',')},version=version+1,actualizado_en=? WHERE id=? AND ${owner} AND version=? RETURNING *`)
        .get(...keys.map(key => value(key, data)), new Date().toISOString(), id, usuarioId, data.version));
    },
    delete: id => db.prepare(`DELETE FROM modos_uso WHERE id=? AND ${owner}`).run(id, usuarioId).changes,
  };
}
