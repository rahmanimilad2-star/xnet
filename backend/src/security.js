'use strict';
const crypto = require('node:crypto');
const { config } = require('./config');

// ---------- Password hashing (scrypt, per-password salt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(dk, expected);
  } catch { return false; }
}
// Used to equalize timing when the username does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

// ---------- Tokens (JWT HS256) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(payload, ttlHours) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + Math.round(ttlHours * 3600) };
  const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return { token: `${data}.${sig}`, exp: body.exp * 1000 };
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expect = crypto.createHmac('sha256', config.jwtSecret).update(`${h}.${p}`).digest();
  let got;
  try { got = Buffer.from(s, 'base64url'); } catch { return null; }
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    return body;
  } catch { return null; }
}

// ---------- Symmetric encryption for stored secrets ----------
function encryptSecret(plain) {
  if (!plain) return '';
  const key = Buffer.from(config.dataEncKey, 'hex');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decryptSecret(blob) {
  if (!blob) return '';
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1') throw new Error('bad secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.dataEncKey, 'hex'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// ---------- Login rate limiter (in-memory, per IP and per username) ----------
class LoginLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  _key(k) {
    const now = Date.now();
    let e = this.map.get(k);
    if (!e || now - e.first > this.windowMs) { e = { count: 0, first: now }; this.map.set(k, e); }
    return e;
  }
  check(keys) {
    for (const k of keys) {
      const e = this._key(k);
      if (e.count >= this.max) return Math.ceil((e.first + this.windowMs - Date.now()) / 1000);
    }
    return 0;
  }
  fail(keys) { for (const k of keys) this._key(k).count++; }
  reset(keys) { for (const k of keys) this.map.delete(k); }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if (now - e.first > this.windowMs) this.map.delete(k); }
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, signToken, verifyToken, encryptSecret, decryptSecret, LoginLimiter };
