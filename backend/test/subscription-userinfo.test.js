'use strict';
// Subscription-Userinfo -> account.subscription_userinfo (display only; never changes status/access).
process.env.JWT_SECRET = 'sui_secret_'.padEnd(64, 's');
process.env.DATA_ENC_KEY = 'f'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.SUBSCRIPTION_REFRESH_MINUTES = '0';
process.env.ENV_FILE = '/nonexistent';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');
const { parseUserinfo } = require('../src/user-subscription-refresh');

const GB = 1024 ** 3; const DAY = 86400000;
const L1 = 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@nl.example.com:443?type=ws&security=tls&sni=nl.example.com&path=%2Fws#NL-ui';
let header = null; // Subscription-Userinfo sent by the fake upstream
let base, app, up, cookie;

async function call(method, path, { body, auth } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${auth}`; else if (cookie) { headers.Cookie = cookie; headers['X-Requested-With'] = 'panel'; }
  const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
const userinfo = (o) => `upload=${o.up}; download=${o.down}; total=${o.total}; expire=${o.expire}`;

async function makeUser(name, quotaGb, days) {
  const r = await call('POST', '/api/admin/users', { body: { username: name, password: 'passw0rd1', quota_gb: quotaGb, days } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.user.id;
}
async function addSub(name, userIds) {
  const r = await call('POST', '/api/admin/subscriptions', { body: { name, url: `http://127.0.0.1:${up.address().port}/s/${name}`, scope: 'users', user_ids: userIds, country: 'NL', priority: 10 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.subscription.id;
}
async function login(name) {
  const r = await call('POST', '/api/v1/auth/login', { body: { username: name, password: 'passw0rd1' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

test.before(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  app = createServer({ log: () => {} });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
  up = http.createServer((req, res) => {
    const h = { 'Content-Type': 'text/plain' };
    if (header) h['Subscription-Userinfo'] = header;
    res.writeHead(200, h); res.end(L1);
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const r = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'AdminPass123!' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(() => { app.close(); up.close(); });

test('parseUserinfo is strict', () => {
  assert.deepEqual(parseUserinfo('upload=1; download=2; total=3; expire=4'), { upload: 1, download: 2, total: 3, expire: 4 });
  assert.throws(() => parseUserinfo('upload=1; download=2; total=3'));
  assert.throws(() => parseUserinfo('upload=-1; download=2; total=3; expire=0'));
  assert.throws(() => parseUserinfo('upload=1; upload=2; download=2; total=3; expire=0'));
  assert.throws(() => parseUserinfo(undefined));
});

test('no stored userinfo: field is null, old fields unchanged (usage_known=false)', async () => {
  await makeUser('user_sa', 10, 30); const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  await addSub('user_sa', [uid]);
  const t = await login('user_sa');
  const a = (await call('GET', '/api/v1/account', { auth: t })).body.account;
  assert.equal(a.usage_known, false);
  assert.equal(a.subscription_userinfo, null);
});

test('refresh stores userinfo; account exposes backend-computed values; status/quota/days untouched', async () => {
  const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  getDb().prepare('DELETE FROM user_sessions WHERE user_id=?').run(uid);
  const token = await login('user_sa');
  const before = (await call('GET', '/api/v1/account', { auth: token })).body.account;
  const expireSec = Math.floor((Date.now() + 12 * DAY) / 1000);
  header = userinfo({ up: 1 * GB, down: 3 * GB, total: 20 * GB, expire: expireSec });
  const r = await call('POST', '/api/v1/subscriptions/refresh', { auth: token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = (await call('GET', '/api/v1/account', { auth: token })).body.account;
  const u = a.subscription_userinfo;
  assert.equal(u.used_bytes, 4 * GB); assert.equal(u.total_bytes, 20 * GB);
  assert.equal(u.remaining_bytes, 16 * GB); assert.equal(u.unlimited, false);
  assert.equal(u.expire_at, expireSec * 1000); assert.equal(u.days_left, 12);
  // panel-governed fields are identical
  for (const k of ['status', 'usage_known', 'quota_bytes', 'used_bytes', 'remaining_bytes', 'expires_at', 'days_left', 'unlimited']) {
    assert.deepEqual(a[k], before[k], k);
  }
  // also delivered in /configs account
  const c = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(c.status, 200); assert.equal(c.body.account.subscription_userinfo.used_bytes, 4 * GB);
});

test('upstream says exhausted and expired: user is NOT made QUOTA_EXCEEDED/EXPIRED, configs still allowed', async () => {
  const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  getDb().prepare('DELETE FROM user_sessions WHERE user_id=?').run(uid);
  const token = await login('user_sa');
  header = userinfo({ up: 30 * GB, down: 30 * GB, total: 20 * GB, expire: Math.floor((Date.now() - 2 * DAY) / 1000) });
  assert.equal((await call('POST', '/api/v1/subscriptions/refresh', { auth: token })).status, 200);
  const c = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.account.status, 'ACTIVE');
  assert.equal(c.body.account.subscription_userinfo.remaining_bytes, 0);
  assert.equal(c.body.account.subscription_userinfo.days_left, 0);
});

test('upstream total=0 / expire=0 means unlimited / no expiry', async () => {
  const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  getDb().prepare('DELETE FROM user_sessions WHERE user_id=?').run(uid);
  const token = await login('user_sa');
  header = userinfo({ up: 5, down: 7, total: 0, expire: 0 });
  assert.equal((await call('POST', '/api/v1/subscriptions/refresh', { auth: token })).status, 200);
  const u = (await call('GET', '/api/v1/account', { auth: token })).body.account.subscription_userinfo;
  assert.equal(u.unlimited, true); assert.equal(u.remaining_bytes, null);
  assert.equal(u.expire_at, null); assert.equal(u.days_left, null); assert.equal(u.used_bytes, 12);
});

test('invalid header on refresh keeps previous data', async () => {
  const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  getDb().prepare('DELETE FROM user_sessions WHERE user_id=?').run(uid);
  const token = await login('user_sa');
  header = 'upload=1; download=2';
  const r = await call('POST', '/api/v1/subscriptions/refresh', { auth: token });
  assert.equal(r.status, 502); assert.equal(r.body.error?.code || r.body.code, 'SUBSCRIPTION_USERINFO_INVALID');
  const u = (await call('GET', '/api/v1/account', { auth: token })).body.account.subscription_userinfo;
  assert.equal(u.used_bytes, 12);
});

test('panel still governs: panel expiry -> EXPIRED even though upstream says unlimited/no expiry', async () => {
  const uid = getDb().prepare("SELECT id FROM users WHERE username='user_sa'").get().id;
  getDb().prepare('DELETE FROM user_sessions WHERE user_id=?').run(uid);
  const token = await login('user_sa');
  getDb().prepare('UPDATE users SET expires_at=? WHERE id=?').run(Date.now() - 1000, uid);
  const a = (await call('GET', '/api/v1/account', { auth: token })).body.account;
  assert.equal(a.status, 'EXPIRED'); assert.equal(a.days_left, 0);
  assert.equal(a.subscription_userinfo.unlimited, true); // display data does not override the panel
  assert.equal((await call('GET', '/api/v1/configs', { auth: token })).status, 403);
  getDb().prepare('UPDATE users SET expires_at=? WHERE id=?').run(Date.now() + 30 * 86400000, uid);
  assert.equal((await call('GET', '/api/v1/configs', { auth: token })).status, 200);
});

test('a subscription shared by several users, or several subscriptions: nothing is exposed', async () => {
  const a = await makeUser('user_sb', 10, 30); const b = await makeUser('user_sc', 10, 30);
  await addSub('shared', [a, b]);
  header = userinfo({ up: 1, down: 1, total: 10, expire: 0 });
  const ta = await login('user_sb');
  assert.equal((await call('GET', '/api/v1/account', { auth: ta })).body.account.subscription_userinfo, null);
  // user with two owned subscriptions: values can't be summed safely -> null
  const d = await makeUser('user_sd', 10, 30); await addSub('d1', [d]); await addSub('d2', [d]);
  const td = await login('user_sd');
  assert.equal((await call('POST', '/api/v1/subscriptions/refresh', { auth: td })).status, 200);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM subscription_userinfo WHERE user_id=?').get(d).n, 2);
  assert.equal((await call('GET', '/api/v1/account', { auth: td })).body.account.subscription_userinfo, null);
});

test('measured users (usage_known=true) never get upstream values', async () => {
  const uid = await makeUser('user_se', 10, 30);
  getDb().prepare("UPDATE users SET xui_email='se@x' WHERE id=?").run(uid);
  await addSub('user_se', [uid]);
  const t = await login('user_se');
  assert.equal((await call('POST', '/api/v1/subscriptions/refresh', { auth: t })).status, 200);
  const a = (await call('GET', '/api/v1/account', { auth: t })).body.account;
  assert.equal(a.usage_known, true); assert.equal(a.subscription_userinfo, null);
});
