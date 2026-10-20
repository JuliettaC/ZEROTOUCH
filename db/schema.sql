PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS profiles (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=300),
 gaze INTEGER NOT NULL DEFAULT 1 CHECK(gaze IN (0,1)),
 proximity INTEGER NOT NULL DEFAULT 1 CHECK(proximity IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS contexts (
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
PRAGMA user_version = 1;
COMMIT;
