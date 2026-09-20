'use strict';

const { openDb } = require('./db');

const USER_COLUMNS = `
  id, login, password, name, is_male AS isMale, city, country, language,
  birth_year AS birthYear, birth_month AS birthMonth, birth_day AS birthDay,
  first_name AS firstName, surname, about, interests, last_seen AS lastSeen,
  created_at AS createdAt
`;

/**
 * SQLite-backed account, friend-graph, message, and wall-post store.
 *
 * `authenticate` is strict: it only succeeds for an account that already
 * exists (via `register`, the real phone-based RegistrationCommand flow -
 * see commands/registration.js) with a matching password. `autoRegister` is
 * a separate, opt-in convenience for local testing, off by default - see
 * config.allowLoginAutoRegister / commands/login.js.
 *
 * Passwords are stored in plaintext - matches what the real client itself
 * does, caching the plaintext password in memory for ReloginCommand (see
 * commands/relogin.js). Fine for a private hobby server, not something to
 * copy for anything internet-facing.
 *
 * Profile field names (first_name/surname/about/interests, plus `name`
 * doing double duty as "nick") match
 * drug.vokrug.activity.profile.MyProfileDataFragment.java's DataType enum
 * exactly - see commands/profile.js for the full field-by-field derivation.
 */
class Store {
  constructor(dbPath) {
    this.db = openDb(dbPath);

    this._stmtGetByLogin = this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE login = ?`);
    this._stmtGetById = this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
    this._stmtInsertUser = this.db.prepare(
      'INSERT INTO users (login, password, name, is_male, created_at) VALUES (?, ?, ?, 1, ?)'
    );
    this._stmtInsertUserFull = this.db.prepare(
      `INSERT INTO users
         (login, password, name, is_male, city, country, language, birth_year, birth_month, birth_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this._stmtSetPassword = this.db.prepare('UPDATE users SET password = ? WHERE id = ?');
    this._stmtUpdateProfile = this.db.prepare(
      `UPDATE users SET name = ?, first_name = ?, surname = ?, city = ?, about = ?, interests = ?, is_male = ?
       WHERE id = ?`
    );
    this._stmtTouchLastSeen = this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?');

    this._stmtAddFriend = this.db.prepare(
      'INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)'
    );
    this._stmtGetFriends = this.db.prepare(
      `SELECT u.id, u.login, u.password, u.name, u.is_male AS isMale, u.created_at AS createdAt
       FROM friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? ORDER BY f.created_at`
    );

    this._stmtInsertMessage = this.db.prepare(
      'INSERT INTO messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)'
    );
    this._stmtMessagesTo = this.db.prepare(
      `SELECT id, from_id AS fromId, to_id AS toId, body, created_at AS createdAt, is_read AS isRead
       FROM messages WHERE to_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    );
    this._stmtMessagesFrom = this.db.prepare(
      `SELECT id, from_id AS fromId, to_id AS toId, body, created_at AS createdAt, is_read AS isRead
       FROM messages WHERE from_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    );
    this._stmtConversation = this.db.prepare(
      `SELECT id, from_id AS fromId, to_id AS toId, body, created_at AS createdAt, is_read AS isRead
       FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
       ORDER BY id DESC LIMIT ? OFFSET ?`
    );
    this._stmtMarkRead = this.db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?');

    this._stmtInsertWallPost = this.db.prepare(
      'INSERT INTO wall_posts (author_id, region_code, body, created_at) VALUES (?, ?, ?, ?)'
    );
    this._stmtWallPosts = this.db.prepare(
      `SELECT id, author_id AS authorId, region_code AS regionCode, body, created_at AS createdAt
       FROM wall_posts WHERE region_code = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    );
  }

  // Strict credential check: only succeeds for an account that already
  // exists with a matching password. No auto-creation here - see
  // `autoRegister` below for the opt-in dev-convenience path, and
  // `register` for the real RegistrationCommand flow.
  authenticate(login, password) {
    const user = this._stmtGetByLogin.get(login);
    if (!user) return null;
    if (user.password !== password) return null;
    return user;
  }

  // Opt-in convenience for local testing only - gated behind
  // config.allowLoginAutoRegister (off by default) in commands/login.js.
  // Real accounts should go through `register` (RegistrationCommand).
  autoRegister(login, password) {
    const info = this._stmtInsertUser.run(login, password, login, Date.now());
    return this._stmtGetById.get(Number(info.lastInsertRowid));
  }

  getById(id) {
    return this._stmtGetById.get(id) || null;
  }

  getByLogin(login) {
    return this._stmtGetByLogin.get(login) || null;
  }

  // Used by RegistrationCommand: creates a brand-new account with a
  // server-generated password and the profile fields collected at
  // registration. Caller is responsible for checking the login doesn't
  // already exist first (see commands/registration.js).
  register({ login, password, name, isMale, city, country, language, birthYear, birthMonth, birthDay }) {
    const info = this._stmtInsertUserFull.run(
      login,
      password,
      name,
      isMale ? 1 : 0,
      city ?? null,
      country ?? null,
      language ?? null,
      birthYear ?? null,
      birthMonth ?? null,
      birthDay ?? null,
      Date.now()
    );
    return this._stmtGetById.get(Number(info.lastInsertRowid));
  }

  setPassword(userId, newPassword) {
    this._stmtSetPassword.run(newPassword, userId);
  }

  // Used by SendUserInfoCommand (CID 32) - a full overwrite of the
  // editable profile fields, matching what the client always sends (not
  // an incremental patch).
  updateProfile(userId, { nick, firstName, surname, city, about, interests, isMale }) {
    this._stmtUpdateProfile.run(nick, firstName, surname, city, about, interests, isMale ? 1 : 0, userId);
  }

  touchLastSeen(userId) {
    this._stmtTouchLastSeen.run(Date.now(), userId);
  }

  addFriend(userId, friendId) {
    this._stmtAddFriend.run(userId, friendId, Date.now());
  }

  getFriends(userId) {
    return this._stmtGetFriends.all(userId);
  }

  // Persists a message and returns { id, createdAt }.
  saveMessage(fromId, toId, body) {
    const createdAt = Date.now();
    const info = this._stmtInsertMessage.run(fromId, toId, body, createdAt);
    return { id: Number(info.lastInsertRowid), createdAt };
  }

  getIncoming(userId, limit, offset) {
    return this._stmtMessagesTo.all(userId, limit, offset);
  }

  getOutgoing(userId, limit, offset) {
    return this._stmtMessagesFrom.all(userId, limit, offset);
  }

  getConversation(userId, otherUserId, limit, offset) {
    return this._stmtConversation.all(userId, otherUserId, otherUserId, userId, limit, offset);
  }

  markRead(messageId) {
    this._stmtMarkRead.run(messageId);
  }

  // Persists a live-feed ("эфир"/wall) post and returns { id, createdAt }.
  saveWallPost(authorId, regionCode, body) {
    const createdAt = Date.now();
    const info = this._stmtInsertWallPost.run(authorId, regionCode, body, createdAt);
    return { id: Number(info.lastInsertRowid), createdAt };
  }

  getWallPosts(regionCode, limit, offset) {
    return this._stmtWallPosts.all(regionCode, limit, offset);
  }

  close() {
    this.db.close();
  }
}

module.exports = { Store };
