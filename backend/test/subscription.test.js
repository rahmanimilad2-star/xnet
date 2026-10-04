'use strict';
process.env.JWT_SECRET = 'sub_secret_'.padEnd(64, 's');
process.env.DATA_ENC_KEY = 'e'.repeat(64);
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

const L1 = 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@nl.example.com:443?type=ws&security=tls&sni=nl.example.com&path=%2Fws#NL-sub';
const L2 = 'trojan://pw123@tr.example.com:443?security=tls&type=tcp&sni=tr.example.com#TR-sub';
const L3 = 'ss://' + Buffer.from('aes-256-gcm:sspw').toString('base64') + '@9.9.9.9:8388#SS-sub';
let subBody = Buffer.from([L1, L2, 'garbage://x'].join('\n')).toString('base64');
let subHits = 0; let xuiHits = 0;

let base, app, subSrv, xuiSrv, cookie, token, userId, subId;
async function call(method, path, { body, auth } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${auth}`; else if (cookie) { headers.Cookie = cookie; headers['X-Requested-With'] = 'panel'; }
  const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json(), headers: r.headers };
}

test.before(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  app = createServer({ log: () => {} });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
  subSrv = http.createServer((req, res) => { subHits++; res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(subBody); });
  await new Promise((r) => subSrv.listen(0, '127.0.0.1', r));
  // a "3X-UI" that counts every request it receives
  xuiSrv = http.createServer((req, res) => { xuiHits++; res.writeHead(500); res.end(); });
  await new Promise((r) => xuiSrv.listen(0, '127.0.0.1', r));
  const r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
  userId = (await call('POST', '/api/admin/users', { body: { username: 'ali', password: 'alipass1', quota_gb: 10, days: 30 } })).body.user.id;
});
test.after(() => { app.close(); subSrv.close(); xuiSrv.close(); });

test('subscription URL (base64) is fetched by the backend and stored as configs', async () => {
  const r = await call('POST', '/api/admin/subscriptions', { body: { name: 'My 3X-UI sub', url: `http://127.0.0.1:${subSrv.address().port}/sub/abc`, scope: 'users', user_ids: [userId], country: 'NL', priority: 10 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  subId = r.body.subscription.id;
  assert.equal(r.body.refresh.ok, true);
  assert.equal(r.body.refresh.total, 2); assert.equal(r.body.refresh.invalid, 1);
  assert.equal(r.body.subscription.config_count, 2);
});

test('app gets those configs from OUR API; the subscription URL is never exposed to the app', async () => {
  token = (await call('POST', '/api/v1/auth/login', { body: { username: 'ali', password: 'alipass1' } })).body.token;
  const r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.configs.map((c) => c.name), ['NL-sub', 'TR-sub']);
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('/sub/abc'), 'subscription URL not leaked');
  assert.ok(!raw.includes('trojan://') && !raw.includes('vless://'), 'only ready outbounds, no admin data');
});

test('refresh keeps unchanged config ids (no forced reconnect), adds new, removes deleted', async () => {
  const before = (await call('GET', '/api/v1/configs', { auth: token })).body.configs;
  const nlId = before.find((c) => c.name === 'NL-sub').id;
  subBody = [L1, L3].join('\n'); // plain-text format, TR removed, SS added
  const r = await call('POST', `/api/admin/subscriptions/${subId}/refresh`);
  assert.equal(r.body.refresh.added, 1); assert.equal(r.body.refresh.removed, 1);
  const after = (await call('GET', '/api/v1/configs', { auth: token })).body.configs;
  assert.deepEqual(after.map((c) => c.name), ['NL-sub', 'SS-sub']);
  assert.equal(after.find((c) => c.name === 'NL-sub').id, nlId);
});

test('broken subscription keeps the last good configs', async () => {
  subBody = 'not a subscription';
  const r = await call('POST', `/api/admin/subscriptions/${subId}/refresh`);
  assert.equal(r.body.refresh.ok, false);
  assert.ok(r.body.subscription.last_error);
  assert.equal((await call('GET', '/api/v1/configs', { auth: token })).body.configs.length, 2);
});

test('app endpoints never contact 3X-UI, even when a 3X-UI server is configured and down', async () => {
  await call('POST', '/api/admin/servers', { body: { name: 'down', xui_url: `http://127.0.0.1:${xuiSrv.address().port}/p`, xui_username: 'a', xui_password: 'b' } });
  xuiHits = 0; const subBefore = subHits;
  const t0 = Date.now();
  // single-device rule: release the current session before logging in again
  for (const [m, p, b] of [['POST', '/api/v1/auth/logout'], ['POST', '/api/v1/auth/login', { username: 'ali', password: 'alipass1' }], ['GET', '/api/v1/account'], ['GET', '/api/v1/configs'], ['GET', '/api/v1/usage'], ['POST', '/api/v1/events', { type: 'connected' }], ['POST', '/api/v1/events', { type: 'disconnected' }]]) {
    const r = await call(m, p, { body: b, auth: p.includes('login') ? undefined : token });
    assert.ok(r.status < 400, `${p} -> ${r.status}`);
    if (p.endsWith('/login')) token = r.body.token;
  }
  assert.equal(xuiHits, 0, 'no request reached 3X-UI');
  assert.equal(subHits, subBefore, 'no request reached the subscription URL');
  assert.ok(Date.now() - t0 < 2000, 'app API answers from local DB');
});

test('deleting a subscription removes its configs', async () => {
  const r = await call('DELETE', `/api/admin/subscriptions/${subId}`);
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/v1/configs', { auth: token })).body.error.code, 'NO_CONFIG');
});
