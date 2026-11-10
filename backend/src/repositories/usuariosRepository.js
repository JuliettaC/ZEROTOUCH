const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export function createUsuariosRepository(db) {
  return {
    get: id => db.prepare('SELECT * FROM usuarios WHERE id=?').get(id),
    byName: name => db.prepare('SELECT * FROM usuarios WHERE nombre_usuario=?').get(name),
    byEmail: correo => db.prepare('SELECT * FROM usuarios WHERE correo=?').get(correo),
    insert(user) {
      db.prepare('INSERT INTO usuarios(id,nombre_usuario,contrasena_hash,rol,correo) VALUES(?,?,?,?,?)')
        .run(user.id, user.nombre_usuario, user.contrasena_hash, user.rol ?? 'user', user.correo ?? null);
    },
    list: ({ limite, offset }) => db.prepare('SELECT id,nombre_usuario,rol,estado,correo_verificado_en FROM usuarios ORDER BY creado_en,id LIMIT ? OFFSET ?').all(limite, offset),
    activeAdmins: () => db.prepare("SELECT count(*) n FROM usuarios WHERE rol='admin' AND estado='activo'").get().n,
    updateRole: (id, value) => db.prepare(`UPDATE usuarios SET rol=?,actualizado_en=${now} WHERE id=?`).run(value, id),
    updateStatus: (id, value) => db.prepare(`UPDATE usuarios SET estado=?,actualizado_en=${now} WHERE id=?`).run(value, id),
    // Only an unverified account may (re)assign its address; a verified address is never replaced here.
    setUnverifiedEmail: (id, correo) => db.prepare(`UPDATE usuarios SET correo=?,correo_verificado_en=NULL,actualizado_en=${now} WHERE id=? AND correo_verificado_en IS NULL`).run(correo, id).changes,
    markEmailVerified: (id, correo) => db.prepare(`UPDATE usuarios SET correo_verificado_en=${now},actualizado_en=${now} WHERE id=? AND correo=? AND correo_verificado_en IS NULL`).run(id, correo).changes,
    updatePassword: (id, hash) => db.prepare(`UPDATE usuarios SET contrasena_hash=?,actualizado_en=${now} WHERE id=?`).run(hash, id).changes,
    transaction: operation => db.transaction(operation).immediate(),
  };
}
