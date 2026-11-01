export function createUsuariosRepository(db) {
  return {
    get: id => db.prepare('SELECT * FROM usuarios WHERE id=?').get(id),
    byName: name => db.prepare('SELECT * FROM usuarios WHERE nombre_usuario=?').get(name),
    insert(user) {
      db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,rol) VALUES(?,?,?,?)')
        .run(user.id, user.nombre_usuario, user.contrasena_hash, user.rol ?? 'user');
    },
    list: ({ limite, offset }) => db.prepare('SELECT id,nombre_usuario,rol,estado FROM usuarios ORDER BY creado_en,id LIMIT ? OFFSET ?').all(limite, offset),
    activeAdmins: () => db.prepare("SELECT count(*) n FROM usuarios WHERE rol='admin' AND estado='activo'").get().n,
    updateRole: (id, value) => db.prepare("UPDATE usuarios SET rol=?,actualizado_en=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(value, id),
    updateStatus: (id, value) => db.prepare("UPDATE usuarios SET estado=?,actualizado_en=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(value, id),
    transaction: operation => db.transaction(operation).immediate(),
  };
}
