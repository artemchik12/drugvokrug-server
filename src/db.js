'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  login      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_male    INTEGER NOT NULL DEFAULT 1,
  city       TEXT,
  country    TEXT,
  language   TEXT,
  birth_year  INTEGER,
  birth_month INTEGER,
  birth_day   INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS friends (
  user_id    INTEGER NOT NULL,
  friend_id  INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER NOT NULL,
  to_id      INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (from_id) REFERENCES users(id),
  FOREIGN KEY (to_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id, id);

CREATE TABLE IF NOT EXISTS wall_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL,
  region_code TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_wall_region ON wall_posts(region_code, id);
`;

// Columns added after the table's initial release. CREATE TABLE IF NOT
// EXISTS won't retrofit these onto a users.db file created by an earlier
// version of this server, so add whatever's missing by hand.
const USER_COLUMNS_V2 = [
  ['city', 'TEXT'],
  ['country', 'TEXT'],
  ['language', 'TEXT'],
  ['birth_year', 'INTEGER'],
  ['birth_month', 'INTEGER'],
  ['birth_day', 'INTEGER'],
];

// Added for full profile support (SendUserInfoCommand/UserProfileCommand) -
// field meanings confirmed via drug.vokrug.activity.profile.
// MyProfileDataFragment.java's DataType enum (each tied to an L10n key:
// profile_name/profile_surname/profile_about/profile_interests).
// `name` (from USER_COLUMNS_V2 era) is what the client calls "nick" -
// UserInfoFactory feeds it into UserInfo.j()/H(), matching
// MyProfileDataFragment's NICK DataType exactly, so it's reused as-is
// rather than renamed.
const USER_COLUMNS_V3 = [
  ['first_name', 'TEXT'],
  ['surname', 'TEXT'],
  ['about', 'TEXT'],
  ['interests', 'TEXT'],
  ['last_seen', 'INTEGER'],
];

function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(users)').all().map((r) => r.name));
  for (const [name, type] of [...USER_COLUMNS_V2, ...USER_COLUMNS_V3]) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }
}

/**
 * Opens (creating if needed) the SQLite database at `dbPath` using Node's
 * built-in `node:sqlite` module (available without any native build step
 * since Node 22.5 - no better-sqlite3/node-gyp dependency). `:memory:` is
 * accepted for tests.
 */
function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb };
