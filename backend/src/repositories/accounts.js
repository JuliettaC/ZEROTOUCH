// Persistence boundary: all account/session SQL stays in this module.
export function accountRepository(db) {
  const get = id => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const event = (kind, actor = null, target = null) => db.prepare('INSERT INTO security_events(kind,actor_id,target_id,created_at) VALUES(?,?,?,?)').run(kind, actor, target, Date.now());
  return {
    get, event,
    transaction: operation => db.transaction(operation).immediate(),
    byName: name => db.prepare('SELECT * FROM accounts WHERE username = ?').get(name),
    insert(a) { db.prepare('INSERT INTO accounts(id,username,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)').run(a.id,a.username,a.hash,a.now,a.now); },
    update(id, changes) {
      const a = { ...get(id), ...changes };
      db.prepare('UPDATE accounts SET username=?,password_hash=?,role=?,status=?,auth_version=auth_version+1,updated_at=? WHERE id=?').run(a.username,a.password_hash,a.role,a.status,new Date().toISOString(),id);
      this.revoke(id);
    },
    adminCount: () => db.prepare("SELECT count(*) n FROM accounts WHERE role='admin' AND status='active'").get().n,
    list: (limit, offset) => db.prepare('SELECT id,role,status FROM accounts ORDER BY created_at,id LIMIT ? OFFSET ?').all(limit,offset),
    events: (limit,offset) => db.prepare('SELECT id,actor_id AS actorId,target_id AS targetId,kind,created_at AS createdAt FROM security_events ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(limit,offset),
    remove(id) {
      db.prepare('DELETE FROM contexts WHERE profile_id IN (SELECT id FROM profiles WHERE account_id=?)').run(id);
      db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    },
    session(hash) { return db.prepare('SELECT s.*, a.status, a.auth_version AS current_version FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE token_hash=?').get(hash); },
    addSession(hash, account) {
      // Bound the number of live sessions per account; oldest sessions are revoked.
      db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 4)').run(account.id);
      const now = Date.now();
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(hash,account.id,account.auth_version,now,now,now+8*3600000);
    },
    touch: hash => db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(Date.now(),hash),
    logout: hash => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash),
    revoke: id => db.prepare('DELETE FROM sessions WHERE account_id=?').run(id),
    rate(key, maximum) {
      return db.transaction(() => {
        const now = Date.now();
        db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(now);
        db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET count=count+1').run(key, now+900000);
        return db.prepare('SELECT count FROM rate_limits WHERE key_hash=?').get(key).count <= maximum;
      }).immediate();
    },
    prune() {
      const now = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?').run(now,now-1800000);
      db.prepare('DELETE FROM security_events WHERE created_at<?').run(now-30*86400000);
      db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now);
    },
  };
}
