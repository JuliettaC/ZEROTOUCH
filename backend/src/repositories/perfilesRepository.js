export function createPerfilesRepository(db, usuarioId) {
  if (!usuarioId) throw new Error('Se requiere propietario.');
  return {
    get: id => db.prepare('SELECT * FROM perfiles WHERE id=? AND usuario_id=?').get(id, usuarioId),
    list: ({ limite, offset }) => db.prepare('SELECT * FROM perfiles WHERE usuario_id=? ORDER BY creado_en,id LIMIT ? OFFSET ?').all(usuarioId, limite, offset),
    create(data) {
      return db.prepare('INSERT INTO perfiles(id,usuario_id,nombre,descripcion) VALUES(?,?,?,?) RETURNING *').get(data.id, usuarioId, data.nombre, data.descripcion);
    },
    update(id, data) {
      const keys = ['nombre', 'descripcion'].filter(key => Object.hasOwn(data, key));
      return db.prepare(`UPDATE perfiles SET ${keys.map(key => `${key}=?`).join(',')},version=version+1,actualizado_en=? WHERE id=? AND usuario_id=? AND version=? RETURNING *`)
        .get(...keys.map(key => data[key]), new Date().toISOString(), id, usuarioId, data.version);
    },
    delete: id => db.prepare('DELETE FROM perfiles WHERE id=? AND usuario_id=?').run(id, usuarioId).changes,
  };
}
