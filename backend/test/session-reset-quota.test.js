'use strict';
// Release checks: Reset Session (admin) only frees the login lock; quota exhaustion is a clear, distinct state.
process.env.JWT_SECRET = 'test_secret_'.padEnd(64, 'x');
process.env.DATA_ENC_KEY = 'a'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');

const GB = 1024 ** 3;
const VLESS = 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@nl.example.com:443?type=ws&security=tls&sni=nl.example.com&path=%2Fws&host=nl.example.com#NL';
let base, server, adminCookie, userId, serverId;

async function call(method, p, { body, token, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) { headers.Cookie = cookie; headers['X-Requested-With'] = 'panel'; }
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
const login = () => call('POST', '/api/v1/auth/login', { body: { username: 'reza', password: 'reza-pass-1' } });
const setUsage = (bytes) => getDb().prepare('UPDATE user_server_usage SET down_bytes=? WHERE user_id=?').run(bytes, userId);
const snapshot = () => ({
  user: getDb().prepare('SELECT id, username, password_hash, status, quota_bytes, expires_at, group_id FROM users WHERE id=?').get(userId),
  usage: getDb().prepare('SELECT up_bytes, down_bytes, base_up, base_down FROM user_server_usage WHERE user_id=?').all(userId),
  configs: getDb().prepare('SELECT config_id FROM config_users WHERE user_id=? ORDER BY config_id').all(userId),
});

test.before(async () => {
  const now = Date.now();
  const db = getDb();
  db.prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), now);
  userId = Number(db.prepare('INSERT INTO users(username,password_hash,quota_bytes,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('reza', hashPassword('reza-pass-1'), GB, now + 30 * 86400000, now, now).lastInsertRowid);
  serverId = Number(db.prepare('INSERT INTO servers(name,created_at,updated_at) VALUES (?,?,?)').run('S1', now, now).lastInsertRowid);
  db.prepare('INSERT INTO user_server_usage(user_id,server_id,up_bytes,down_bytes,updated_at) VALUES (?,?,0,?,?)').run(userId, serverId, 100 * 1024 ** 2, now);
  const cfg = Number(db.prepare("INSERT INTO configs(name,link,protocol,scope,created_at,updated_at) VALUES ('NL',?,'vless','users',?,?)").run(VLESS, now, now).lastInsertRowid);
  db.prepare('INSERT INTO config_users(config_id,user_id) VALUES (?,?)').run(cfg, userId);
  server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } });
  adminCookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

test('login, concurrent login blocked, logout, re-login', async () => {
  const a = await login();
  assert.equal(a.status, 200);
  const b = await login();
  assert.equal(b.status, 409);
  assert.equal(b.body.error.code, 'ALREADY_ACTIVE');
  assert.match(b.body.error.message, /این حساب در حال حاضر روی دستگاه دیگری فعال است/);
  assert.equal((await call('GET', '/api/v1/configs', { token: a.body.token })).status, 200, 'first device keeps working');
  assert.equal((await call('POST', '/api/v1/auth/logout', { token: a.body.token })).body.released, true);
  const c = await login();
  assert.equal(c.status, 200, 'after logout the same account can log in again');
  await call('POST', '/api/v1/auth/logout', { token: c.body.token });
});

test('Reset Session frees only the login lock: account, quota, expiry, usage and configs are untouched', async () => {
  const a = await login();
  assert.equal((await login()).status, 409);
  const before = snapshot();
  const list = await call('GET', '/api/admin/users', { cookie: adminCookie });
  assert.equal(list.body.users.find((u) => u.id === userId).device_session_active, true);

  const r = await call('POST', `/api/admin/users/${userId}/release-device`, { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.released, true);
  assert.deepEqual(snapshot(), before);
  assert.equal((await call('GET', '/api/v1/account', { token: a.body.token })).status, 401, 'old session is invalid');
  const after = await call('GET', '/api/admin/users', { cookie: adminCookie });
  assert.equal(after.body.users.find((u) => u.id === userId).device_session_active, false);

  const c = await login();
  assert.equal(c.status, 200, 'user can log in again after reset');
  const cfgs = await call('GET', '/api/v1/configs', { token: c.body.token });
  assert.equal(cfgs.status, 200);
  assert.equal(cfgs.body.configs.length, 1);
  assert.equal(cfgs.body.account.quota_bytes, GB);
  await call('POST', '/api/v1/auth/logout', { token: c.body.token });
});

test('quota exhausted: explicit QUOTA_EXCEEDED state with the user-facing message (not a generic error)', async () => {
  const t = (await login()).body.token;
  setUsage(GB + 1);
  const cfgs = await call('GET', '/api/v1/configs', { token: t });
  assert.equal(cfgs.status, 403);
  assert.equal(cfgs.body.error.code, 'QUOTA_EXCEEDED');
  assert.equal(cfgs.body.error.message, 'حجم اشتراک شما تمام شده است.');
  assert.equal(cfgs.body.error.account.status, 'QUOTA_EXCEEDED');
  assert.equal(cfgs.body.error.account.remaining_bytes, 0);
  const acc = await call('GET', '/api/v1/account', { token: t });
  assert.equal(acc.status, 200, 'account endpoint still answers so the app can show the state');
  assert.equal(acc.body.account.status, 'QUOTA_EXCEEDED');
  assert.equal(acc.body.account.status_message, 'حجم اشتراک شما تمام شده است.');
  await call('POST', '/api/v1/auth/logout', { token: t });
  const again = await login();
  assert.equal(again.status, 200, 'login itself is not refused for an exhausted quota');
  assert.equal(again.body.account.status, 'QUOTA_EXCEEDED');
  await call('POST', '/api/v1/auth/logout', { token: again.body.token });
  setUsage(100 * 1024 ** 2);
});

test('expired subscription is a different state than exhausted quota', async () => {
  getDb().prepare('UPDATE users SET expires_at=? WHERE id=?').run(Date.now() - 1000, userId);
  const t = (await login()).body.token;
  const r = await call('GET', '/api/v1/configs', { token: t });
  assert.equal(r.body.error.code, 'EXPIRED');
  assert.notEqual(r.body.error.message, 'حجم اشتراک شما تمام شده است.');
  await call('POST', '/api/v1/auth/logout', { token: t });
});
