'use strict';
// Single active app session per user ("one device at a time"), enforced server-side.
//
// The JWT stays the credential (existing architecture). Each user token now also carries a random
// session id (`sid`); the server keeps exactly ONE row per user in `user_sessions` (user_id is the
// PRIMARY KEY, so the database itself refuses a second active binding). Only a SHA-256 of the sid
// is stored. Rows live in SQLite, so a backend restart changes nothing.
//
// A row counts as "live" while it has not expired and its token_version still matches the user's
// (an admin password change / logout bumps token_version, which releases the device).
const crypto = require('node:crypto');
const { getDb } = require('./db');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const legacyHash = (rawToken) => sha256(`legacy:${rawToken}`);

/** BEGIN IMMEDIATE takes SQLite's write lock up front: check + bind can't interleave, even across processes. */
function immediate(fn, d = getDb()) {
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

function isLive(row, tokenVersion, now = Date.now()) {
  return !!row && row.expires_at > now && row.token_version === tokenVersion;
}

/** Admin-facing status only; never returns the session id or token. */
function status(userId, tokenVersion, now = Date.now()) {
  const row = getDb().prepare('SELECT expires_at, token_version FROM user_sessions WHERE user_id=?').get(userId);
  return { active: isLive(row, tokenVersion, now), expires_at: row?.expires_at ?? null };
}

/**
 * Atomically bind a new session to the user.
 * `sign(sid)` must return { token, exp } (exp = epoch ms); it runs inside the transaction so the
 * stored expiry equals the token's expiry.
 * Returns { token, exp } or null when another device holds a live session (nothing is changed then).
 */
function claim(userId, sign, { ip = null, userAgent = null } = {}, d = getDb()) {
  return immediate((db) => {
    const now = Date.now();
    const u = db.prepare('SELECT token_version FROM users WHERE id=?').get(userId);
    if (!u) return null;
    const row = db.prepare('SELECT * FROM user_sessions WHERE user_id=?').get(userId);
    if (isLive(row, u.token_version, now)) return null;           // already active elsewhere
    if (row) db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(userId); // expired / revoked
    const sid = crypto.randomBytes(32).toString('base64url');
    const out = sign(sid, u.token_version);
    db.prepare(`INSERT INTO user_sessions(user_id, sid_hash, token_version, created_at, expires_at, last_seen_at, ip, user_agent)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, sha256(sid), u.token_version, now, out.exp, now, ip, userAgent ? String(userAgent).slice(0, 200) : null);
    return out;
  }, d);
}

/**
 * Is this (already signature/expiry/token_version-verified) token the user's active session?
 * Tokens issued before this feature have no `sid`: the first one seen is adopted as the active
 * device (so deploying this doesn't log everybody out); any other device is then rejected.
 */
function check(user, payload, rawToken) {
  const d = getDb();
  const now = Date.now();
  const row = d.prepare('SELECT sid_hash, token_version, expires_at FROM user_sessions WHERE user_id=?').get(user.id);
  if (payload.sid) return isLive(row, user.token_version, now) && row.sid_hash === sha256(payload.sid);
  const lh = legacyHash(rawToken);
  if (isLive(row, user.token_version, now)) return row.sid_hash === lh;
  return immediate((db) => {
    const r2 = db.prepare('SELECT * FROM user_sessions WHERE user_id=?').get(user.id);
    if (isLive(r2, user.token_version, Date.now())) return r2.sid_hash === lh;
    if (r2) db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(user.id);
    db.prepare(`INSERT INTO user_sessions(user_id, sid_hash, token_version, created_at, expires_at, last_seen_at)
                VALUES (?,?,?,?,?,?)`).run(user.id, lh, user.token_version, Date.now(), payload.exp * 1000, Date.now());
    return true;
  }, d);
}

/** Explicit logout from the device that owns the session. Returns true when a session was released. */
function release(user, payload, rawToken) {
  return immediate((db) => {
    const row = db.prepare('SELECT sid_hash FROM user_sessions WHERE user_id=?').get(user.id);
    const mine = payload.sid ? sha256(payload.sid) : legacyHash(rawToken);
    if (row && row.sid_hash === mine) {
      db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(user.id);
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(user.id); // token can't be reused
      return true;
    }
    if (!row && !payload.sid) { // un-adopted legacy token: just kill it
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(user.id);
      return true;
    }
    return false; // not the active device: never touch someone else's session
  });
}

/** Admin: free the account (e.g. lost phone). Also invalidates any outstanding token. */
function adminRelease(userId) {
  return immediate((db) => {
    const r = db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(userId);
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(userId);
    return r.changes > 0;
  });
}

module.exports = { claim, check, release, adminRelease, isLive, status, sha256 };
