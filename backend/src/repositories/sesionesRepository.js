export function createSesionesRepository(db) {
  return {
    get: hash => db.prepare('SELECT s.*,u.rol,u.estado FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token_hash=?').get(hash),
    insert(session) {
      db.prepare('DELETE FROM sesiones WHERE julianday(expira_en)<=julianday(?)').run(session.creado_en);
      // At most five sessions per account. Oldest ones are revoked at login.
      db.prepare('DELETE FROM sesiones WHERE token_hash IN (SELECT token_hash FROM sesiones WHERE usuario_id=? ORDER BY creado_en DESC,token_hash LIMIT -1 OFFSET 4)').run(session.usuario_id);
      db.prepare('INSERT INTO sesiones(token_hash,usuario_id,creado_en,expira_en) VALUES(?,?,?,?)')
        .run(session.token_hash, session.usuario_id, session.creado_en, session.expira_en);
    },
    remove: hash => db.prepare('DELETE FROM sesiones WHERE token_hash=?').run(hash),
    revoke: id => db.prepare('DELETE FROM sesiones WHERE usuario_id=?').run(id),
  };
}
