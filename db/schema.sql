-- Fresh v2 database only. Never execute over v1: ownership needs explicit mapping.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE accounts (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 40),
 password_hash TEXT NOT NULL CHECK(password_hash LIKE '$argon2id$%'),
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE profiles (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 description TEXT NOT NULL,
 gaze INTEGER NOT NULL DEFAULT 1 CHECK(gaze IN (0,1)),
 proximity INTEGER NOT NULL DEFAULT 1 CHECK(proximity IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX profiles_owner ON profiles(account_id,created_at,id);
CREATE TABLE contexts (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 name_key TEXT NOT NULL CHECK(length(name_key)>0),
 sensitivity INTEGER NOT NULL DEFAULT 65 CHECK(sensitivity BETWEEN 0 AND 100),
 stability INTEGER NOT NULL DEFAULT 40 CHECK(stability BETWEEN 0 AND 100),
 desk_rest INTEGER NOT NULL DEFAULT 1 CHECK(desk_rest IN (0,1)),
 pinch INTEGER NOT NULL DEFAULT 1 CHECK(pinch IN (0,1)),
 scroll INTEGER NOT NULL DEFAULT 1 CHECK(scroll IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(profile_id,name_key)
) STRICT;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 auth_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 CHECK(expires_at>created_at)
) STRICT;
CREATE INDEX sessions_owner ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE security_events (
 id INTEGER PRIMARY KEY,
 actor_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 target_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('register','login_ok','login_failed','logout','revoke_all','account_updated','account_deleted','admin_updated','admin_bootstrap','access_denied')),
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX events_age ON security_events(created_at);
CREATE TABLE rate_limits (
 key_hash TEXT PRIMARY KEY NOT NULL,
 count INTEGER NOT NULL CHECK(count>=1),
 expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX rate_expiry ON rate_limits(expires_at);
PRAGMA user_version = 2;
COMMIT;
