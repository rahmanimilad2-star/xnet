'use strict';
process.env.JWT_SECRET = 'man_secret_'.padEnd(64, 'm');
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
const { syncAll } = require('../src/stats');

const UUID = 'a3482e88-686a-4a58-8126-99c9df64b7bf';
const VLESS = `vless://${UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sni=www.speedtest.net&fp=chrome&sid=6ba8&flow=xtls-rprx-vision#Third%20Party%20NL`;
const VMESS = 'vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'Other DE', add: 'de.example.org', port: '8443', id: 'c3482e88-686a-4a58-8126-99c9df64b7bf', aid: '0', net: 'ws', path: '/v', host: 'de.example.org', tls: 'tls', sni: 'de.example.org' })).toString('base64');
const TROJAN = 'trojan://secretpass@tr.example.org:443?security=tls&type=grpc&serviceName=g&sni=tr.example.org#Other%20TR';
const SS = 'ss://' + Buffer.from('chacha20-ietf-poly1305:sspw').toString('base64url') + '@9.9.9.9:8388#Other%20SS';
let subUp = true;
let base, app, subSrv, cookie, token, userId;
let outboundHits = 0;

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
  subSrv = http.createServer((req, res) => {
    outboundHits++;
    if (!subUp) { res.writeHead(503); return res.end(); }
    res.writeHead(200); res.end(Buffer.from('trojan://subpw@sub.example.org:443?security=tls&type=tcp&sni=sub.example.org#From%20Sub').toString('base64'));
  });
  await new Promise((r) => subSrv.listen(0, '127.0.0.1', r));
  cookie = (await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } })).headers.get('set-cookie').split(';')[0];
  // a user with a quota but NO 3X-UI at all (no servers, no client email)
  userId = (await call('POST', '/api/admin/users', { body: { username: 'reza', password: 'rezapass1', quota_gb: 10, days: 30 } })).body.user.id;
});
test.after(() => { app.close(); subSrv.close(); });

const subUrl = () => `http://127.0.0.1:${subSrv.address().port}/sub/token123`;

test('preview: paste mixed text -> every item parsed, validated and described', async () => {
  const text = [VLESS, VMESS, '', TROJAN, 'vless://broken', SS, subUrl(), 'hello'].join('\n');
  const r = await call('POST', '/api/admin/configs/import', { body: { text } });
  assert.equal(r.status, 200);
  const it = r.body.items;
  assert.equal(it.length, 7);
  const v = it[0].details;
  assert.deepEqual([v.protocol, v.address, v.port, v.name, v.network, v.security, v.flow, v.sni, v.credential_type],
    ['vless', '1.2.3.4', 443, 'Third Party NL', 'tcp', 'reality', 'xtls-rprx-vision', 'www.speedtest.net', 'UUID']);
  assert.equal(v.credential, 'a3482e88…', 'credential masked in preview');
  assert.deepEqual([it[1].details.protocol, it[1].details.network, it[1].details.path, it[1].details.security], ['vmess', 'ws', '/v', 'tls']);
  assert.deepEqual([it[2].details.protocol, it[2].details.network, it[2].details.path, it[2].details.credential_type], ['trojan', 'grpc', 'g', 'Password']);
  assert.equal(it[3].valid, false); assert.match(it[3].error, /UUID|نامعتبر/);
  assert.deepEqual([it[4].details.protocol, it[4].details.method, it[4].details.port], ['shadowsocks', 'chacha20-ietf-poly1305', 8388]);
  assert.equal(it[5].kind, 'subscription'); assert.equal(it[5].valid, true); assert.equal(it[5].count, 1);
  assert.equal(it[6].valid, false); assert.match(it[6].error, /پروتکل پشتیبانی نمی‌شود/);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM configs').get().n, 0, 'preview stores nothing');
});

test('save: valid items stored as MANUAL configs (+1 subscription), no server / credentials attached', async () => {
  const text = [VLESS, VMESS, TROJAN, SS, subUrl(), 'garbage'].join('\n');
  const r = await call('POST', '/api/admin/configs/import', { body: { text, save: true, scope: 'users', user_ids: [userId], country: 'NL', server_id: 99 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.saved, { configs: 4, subscriptions: 1 });
  const rows = getDb().prepare('SELECT * FROM configs ORDER BY id').all();
  assert.deepEqual(rows.map((x) => x.source), ['manual', 'manual', 'manual', 'manual', 'subscription']);
  assert.ok(rows.every((x) => x.server_id === null), 'manual configs are not tied to any panel');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM servers').get().n, 0, 'no panel / credentials stored');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM user_clients').get().n, 0);
});

test('nothing valid -> clear error, nothing saved', async () => {
  const before = getDb().prepare('SELECT COUNT(*) n FROM configs').get().n;
  const r = await call('POST', '/api/admin/configs/import', { body: { text: 'vless://x\nfoo', save: true } });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_LINK'); assert.equal(r.body.error.items.length, 2);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM configs').get().n, before);
});

test('app: login + configs work without any 3X-UI; usage is «unknown» and connecting stays allowed', async () => {
  token = (await call('POST', '/api/v1/auth/login', { body: { username: 'reza', password: 'rezapass1' } })).body.token;
  let r = await call('GET', '/api/v1/account', { auth: token });
  assert.equal(r.body.account.status, 'ACTIVE');
  assert.equal(r.body.account.usage_known, false);
  r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 200);
  assert.equal(r.body.configs.length, 5);
  // The outbound handed to Xray dials exactly the server inside the pasted link.
  const nl = r.body.configs.find((c) => c.name === 'Third Party NL').outbound;
  assert.equal(nl.settings.vnext[0].address, '1.2.3.4');
  assert.equal(nl.settings.vnext[0].port, 443);
  assert.equal(nl.settings.vnext[0].users[0].id, UUID);
  assert.equal(nl.streamSettings.realitySettings.publicKey, 'Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw');
  const tr = r.body.configs.find((c) => c.name === 'Other TR').outbound;
  assert.equal(tr.settings.servers[0].address, 'tr.example.org'); assert.equal(tr.settings.servers[0].password, 'secretpass');
});

test('connect/disconnect cycle: zero requests to any panel or subscription; stats sync skips manual configs', async () => {
  outboundHits = 0;
  for (const [m, p, b] of [['GET', '/api/v1/configs'], ['POST', '/api/v1/events', { type: 'connected' }], ['GET', '/api/v1/account'], ['POST', '/api/v1/events', { type: 'disconnected' }]]) {
    assert.ok((await call(m, p, { body: b, auth: token })).status < 400);
  }
  const s = await syncAll(() => {});
  assert.deepEqual(s, { servers: 0, clients: 0, errors: [] });
  assert.equal(outboundHits, 0);
});

test('quota cannot block a user whose usage is unknown', async () => {
  await call('PUT', `/api/admin/users/${userId}`, { body: { quota_gb: 0.001 } });
  const r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 200);
  assert.equal(r.body.account.usage_known, false);
});

test('subscription offline later -> last saved configs remain usable', async () => {
  subUp = false;
  const sub = getDb().prepare('SELECT id FROM subscriptions').get();
  const rr = await call('POST', `/api/admin/subscriptions/${sub.id}/refresh`);
  assert.equal(rr.body.refresh.ok, false);
  const r = await call('GET', '/api/v1/configs', { auth: token });
  assert.ok(r.body.configs.some((c) => c.name === 'From Sub'));
});
