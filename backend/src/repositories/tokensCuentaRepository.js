// Single-use verification/recovery tokens. Only SHA-256 hashes are stored.
export function createTokensCuentaRepository(db) {
  return {
    // One active token per account and purpose: issuing a new one revokes the previous ones.
    issue(token) {
      db.prepare('DELETE FROM tokens_cuenta WHERE julianday(expira_en)<=julianday(?)').run(token.creado_en);
      db.prepare('DELETE FROM tokens_cuenta WHERE usuario_id=? AND proposito=?').run(token.usuario_id, token.proposito);
      db.prepare('INSERT INTO tokens_cuenta(token_hash,usuario_id,proposito,correo,creado_en,expira_en) VALUES(?,?,?,?,?,?)')
        .run(token.token_hash, token.usuario_id, token.proposito, token.correo, token.creado_en, token.expira_en);
    },
    latest: (usuarioId, proposito) => db.prepare('SELECT creado_en FROM tokens_cuenta WHERE usuario_id=? AND proposito=? ORDER BY creado_en DESC LIMIT 1').get(usuarioId, proposito),
    find: (hash, proposito) => db.prepare('SELECT * FROM tokens_cuenta WHERE token_hash=? AND proposito=?').get(hash, proposito),
    remove: hash => db.prepare('DELETE FROM tokens_cuenta WHERE token_hash=?').run(hash).changes,
    revoke: (usuarioId, proposito) => db.prepare('DELETE FROM tokens_cuenta WHERE usuario_id=? AND proposito=?').run(usuarioId, proposito).changes,
  };
}
