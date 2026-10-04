'use strict';
process.env.JWT_SECRET = 'test_secret_'.padEnd(64, 'x');
process.env.DATA_ENC_KEY = 'a'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.LOGIN_MAX_ATTEMPTS = '5';
process.env.ENV_FILE = '/nonexistent';
process.env.ENFORCE_ON_XUI = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword, verifyPassword, encryptSecret, decryptSecret, signToken, verifyToken } = require('../src/security');
const { createServer } = require('../src/app');
const { syncAll } = require('../src/stats');
const { parseLink } = require('../src/links');
const { startMockXui } = require('./mock-xui');

const GB = 1024 ** 3;
const VLESS_ALI = 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@nl.example.com:443?type=ws&security=tls&sni=nl.example.com&path=%2Fws&host=nl.example.com#NL-ali';
const VLESS_REALITY = 'vless://b3482e88-686a-4a58-8126-99c9df64b7bf@1.2.3.4:443?type=tcp&security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw&sni=www.speedtest.net&fp=chrome&sid=6ba85179e30d4fc2&flow=xtls-rprx-vision#DE-sara';
const VMESS = 'vmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'FR-vmess', add: 'fr.example.com', port: '8443', id: 'c3482e88-686a-4a58-8126-99c9df64b7bf', aid: '0', net: 'grpc', path: 'svc', type: 'gun', tls: 'tls', sni: 'fr.example.com' })).toString('base64');
const TROJAN = 'trojan://s3cr3t%40pw@tr.example.com:443?security=tls&type=tcp&sni=tr.example.com#TR';
const SS = 'ss://' + Buffer.from('chacha20-ietf-poly1305:sspass').toString('base64url') + '@9.9.9.9:8388#SS-1';
const SS2022 = 'ss://2022-blake3-aes-128-gcm:' + encodeURIComponent('AAAAAAAAAAAAAAAAAAAAAA==') + '@9.9.9.9:8389#SS2022';

let base, server, xui;
async function call(method, path, { body, token, cookie, csrf = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (cookie && csrf) headers['X-Requested-With'] = 'panel';
  const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
let adminCookie;

test.before(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  xui = await startMockXui();
});
test.after(() => { server.close(); xui.server.close(); });

test('security primitives', () => {
  const h = hashPassword('hello123');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(!h.includes('hello123'));
  assert.equal(verifyPassword('hello123', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(decryptSecret(encryptSecret('xui-pass')), 'xui-pass');
  const { token } = signToken({ sub: 1, role: 'user', tv: 0 }, 1);
  assert.equal(verifyToken(token).sub, 1);
  const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifyToken(tampered), null);
  const forged = token.split('.'); forged[1] = Buffer.from(JSON.stringify({ sub: 1, role: 'admin', tv: 0, exp: 9e9 })).toString('base64url');
  assert.equal(verifyToken(forged.join('.')), null);
});

test('link parser: valid links of every protocol', () => {
  for (const [l, proto] of [[VLESS_ALI, 'vless'], [VLESS_REALITY, 'vless'], [VMESS, 'vmess'], [TROJAN, 'trojan'], [SS, 'shadowsocks'], [SS2022, 'shadowsocks']]) {
    const p = parseLink(l);
    assert.equal(p.protocol, proto);
    assert.equal(p.outbound.tag, 'proxy');
  }
  const r = parseLink(VLESS_REALITY).outbound;
  assert.equal(r.streamSettings.security, 'reality');
  assert.equal(r.settings.vnext[0].users[0].flow, 'xtls-rprx-vision');
  assert.equal(parseLink(TROJAN).outbound.settings.servers[0].password, 's3cr3t@pw');
  assert.equal(parseLink(VMESS).outbound.streamSettings.grpcSettings.serviceName, 'svc');
  assert.equal(parseLink(SS2022).outbound.settings.servers[0].password, 'AAAAAAAAAAAAAAAAAAAAAA==');
});

test('link parser: rejects invalid links', () => {
  for (const bad of ['', 'http://x', 'vless://not-a-uuid@a.com:443', 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@a.com:99999', 'vmess://!!!', 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@a.com:443?security=reality', 'ss://' + Buffer.from('rc4:pw').toString('base64') + '@1.1.1.1:1', 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@a.com:443?type=kcp']) {
    assert.throws(() => parseLink(bad));
  }
});

test('admin login: wrong password, CSRF guard, success', async () => {
  let r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  adminCookie = sc.split(';')[0];
  r = await call('GET', '/api/admin/me', { cookie: adminCookie });
  assert.equal(r.body.username, 'admin');
  r = await call('POST', '/api/admin/groups', { cookie: adminCookie, csrf: false, body: { name: 'x' } });
  assert.equal(r.status, 403);
  r = await call('GET', '/api/admin/users');
  assert.equal(r.status, 401);
});

let ali, sara, vip, cfgAli, cfgSara, cfgAll, cfgGroup;
test('admin: groups, users, servers, configs CRUD', async () => {
  let r = await call('POST', '/api/admin/groups', { cookie: adminCookie, body: { name: 'VIP' } });
  assert.equal(r.status, 201); vip = r.body.group.id;

  r = await call('POST', '/api/admin/users', { cookie: adminCookie, body: { username: 'ali', password: 'alipass1', quota_gb: 1, days: 30, xui_email: 'ali' } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); ali = r.body.user;
  assert.equal(ali.quota_bytes, GB); assert.equal(ali.status, 'ACTIVE'); assert.equal(ali.days_left, 30);
  r = await call('POST', '/api/admin/users', { cookie: adminCookie, body: { username: 'ali', password: 'whatever1' } });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/admin/users', { cookie: adminCookie, body: { username: 'a b', password: 'x' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/admin/users', { cookie: adminCookie, body: { username: 'sara', password: 'sarapass1', quota_gb: 0, group_id: vip, xui_email: 'sara' } });
  assert.equal(r.status, 201); sara = r.body.user;
  assert.equal(sara.unlimited, true);

  r = await call('POST', '/api/admin/servers', { cookie: adminCookie, body: { name: 'NL-1', country: 'NL', xui_url: xui.url, xui_username: 'xadmin', xui_password: 'xpass' } });
  assert.equal(r.status, 201); assert.equal(r.body.server.has_password, true); assert.equal(r.body.server.xui_password, undefined);
  const enc = getDb().prepare('SELECT xui_password_enc FROM servers').get().xui_password_enc;
  assert.ok(enc.startsWith('v1:') && !enc.includes('xpass'));

  r = await call('POST', '/api/admin/configs/validate', { cookie: adminCookie, body: { link: 'vless://broken' } });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_LINK');
  r = await call('POST', '/api/admin/configs/validate', { cookie: adminCookie, body: { link: VLESS_REALITY } });
  assert.equal(r.body.security, 'reality');

  r = await call('POST', '/api/admin/configs', { cookie: adminCookie, body: { link: VLESS_ALI, country: 'NL', priority: 10, scope: 'users', user_ids: [ali.id] } });
  assert.equal(r.status, 201); cfgAli = r.body.config; assert.equal(cfgAli.name, 'NL-ali');
  r = await call('POST', '/api/admin/configs', { cookie: adminCookie, body: { link: VLESS_REALITY, name: 'آلمان', country: 'DE', priority: 5, scope: 'users', user_ids: [sara.id] } });
  cfgSara = r.body.config;
  r = await call('POST', '/api/admin/configs', { cookie: adminCookie, body: { link: TROJAN, country: 'TR', priority: 50, scope: 'all', enabled: false } });
  cfgAll = r.body.config; assert.equal(cfgAll.enabled, false);

  // bulk: 3 valid + 1 invalid, group scope
  r = await call('POST', '/api/admin/configs/bulk', { cookie: adminCookie, body: { links: [VMESS, SS, 'vless://bad', SS2022].join('\n'), scope: 'groups', group_ids: [vip], country: 'FR', priority: 20 } });
  assert.equal(r.status, 201); assert.equal(r.body.created.length, 3); assert.equal(r.body.errors.length, 1); assert.equal(r.body.errors[0].line, 3);
  cfgGroup = r.body.created[0];
  r = await call('POST', '/api/admin/configs/bulk', { cookie: adminCookie, body: { links: [VMESS, 'nope'], atomic: true } });
  assert.equal(r.status, 400);
  assert.equal((await call('GET', '/api/admin/configs', { cookie: adminCookie })).body.configs.length, 6);
});

let aliToken, saraToken;
test('app: login, account and allowed configs only', async () => {
  let r = await call('POST', '/api/v1/auth/login', { body: { username: 'ali', password: 'wrong' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/v1/auth/login', { body: { username: 'ali', password: 'alipass1' } });
  assert.equal(r.status, 200); aliToken = r.body.token;
  assert.equal(r.body.account.username, 'ali');
  r = await call('POST', '/api/v1/auth/login', { body: { username: 'SARA', password: 'sarapass1' } });
  saraToken = r.body.token;

  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.configs.map((c) => c.id), [cfgAli.id]); // trojan(all) disabled -> hidden
  assert.equal(r.body.configs[0].outbound.protocol, 'vless');
  assert.equal(r.body.configs[0].link, undefined);

  r = await call('GET', '/api/v1/configs', { token: saraToken });
  // sara: own (prio 5) + 3 group configs (prio 20,21,22)
  assert.deepEqual(r.body.configs.map((c) => c.priority), [5, 20, 21, 22]);

  // enable the 'all' config -> both see it; ordering by priority
  await call('PUT', `/api/admin/configs/${cfgAll.id}`, { cookie: adminCookie, body: { enabled: true } });
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.deepEqual(r.body.configs.map((c) => c.id), [cfgAli.id, cfgAll.id]);
  const v1 = r.body.version;
  // replace link of a config from the panel -> app receives new one on next sync
  await call('PUT', `/api/admin/configs/${cfgAli.id}`, { cookie: adminCookie, body: { link: VLESS_ALI.replace('nl.example.com:443', 'nl2.example.com:2083') } });
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.body.configs[0].outbound.settings.vnext[0].address, 'nl2.example.com');
  assert.notEqual(r.body.version, v1);
  r = await call('PUT', `/api/admin/configs/${cfgAli.id}`, { cookie: adminCookie, body: { link: 'trojan://' } });
  assert.equal(r.status, 400);

  // users cannot hit admin API with their token
  r = await call('GET', '/api/admin/users', { token: aliToken });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/v1/configs');
  assert.equal(r.status, 401);
  r = await call('POST', '/api/v1/events', { token: aliToken, body: { type: 'connected', config_id: cfgAli.id } });
  assert.equal(r.status, 200);
  assert.ok(getDb().prepare('SELECT last_connect_at FROM users WHERE id=?').get(ali.id).last_connect_at);
});

test('real usage from 3X-UI, quota enforcement, renew and re-enable', async () => {
  xui.state.traffic.ali = { up: 100 * 1024 ** 2, down: 400 * 1024 ** 2 }; // 500 MB
  let s = await syncAll(() => {});
  assert.equal(s.servers, 1); assert.deepEqual(s.errors, []);
  let r = await call('GET', '/api/v1/account', { token: aliToken });
  assert.equal(r.body.account.used_bytes, 500 * 1024 ** 2);
  assert.equal(r.body.account.remaining_bytes, GB - 500 * 1024 ** 2);
  assert.equal(r.body.account.status, 'ACTIVE');

  xui.state.traffic.ali = { up: 200 * 1024 ** 2, down: 900 * 1024 ** 2 }; // 1.07 GB > 1 GB
  await syncAll(() => {});
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'QUOTA_EXCEEDED');
  assert.equal(xui.state.inbound.settings.clients.find((c) => c.email === 'ali').enable, false, 'client disabled on 3X-UI');
  assert.equal(xui.state.inbound.settings.clients.find((c) => c.email === 'sara').enable, true);

  r = await call('POST', `/api/admin/users/${ali.id}/renew`, { cookie: adminCookie, body: { add_gb: 1, add_days: 10 } });
  assert.equal(r.body.user.quota_bytes, 2 * GB); assert.equal(r.body.user.days_left, 40);
  await syncAll(() => {});
  assert.equal(xui.state.inbound.settings.clients.find((c) => c.email === 'ali').enable, true, 're-enabled');
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.status, 200);

  r = await call('POST', `/api/admin/users/${ali.id}/renew`, { cookie: adminCookie, body: { reset_usage: true } });
  assert.equal(r.body.user.used_bytes, 0);
  xui.state.traffic.ali.down += 1000;
  await syncAll(() => {});
  assert.equal((await call('GET', '/api/v1/usage', { token: aliToken })).body.used_bytes, 1000);
});

test('expiry, block, no-config, password change revokes session', async () => {
  let r = await call('PUT', `/api/admin/users/${ali.id}`, { cookie: adminCookie, body: { expires_at: Date.now() - 1000 } });
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.body.error.code, 'EXPIRED');
  await call('PUT', `/api/admin/users/${ali.id}`, { cookie: adminCookie, body: { days: 30 } });
  assert.equal((await call('GET', '/api/v1/configs', { token: aliToken })).status, 200);

  await call('PUT', `/api/admin/users/${ali.id}`, { cookie: adminCookie, body: { status: 'blocked' } });
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.body.error.code, 'BLOCKED');
  r = await call('POST', '/api/v1/auth/login', { body: { username: 'ali', password: 'alipass1' } });
  assert.equal(r.status, 403);
  await call('PUT', `/api/admin/users/${ali.id}`, { cookie: adminCookie, body: { status: 'active' } });

  await call('PUT', `/api/admin/configs/${cfgAli.id}`, { cookie: adminCookie, body: { enabled: false } });
  await call('PUT', `/api/admin/configs/${cfgAll.id}`, { cookie: adminCookie, body: { enabled: false } });
  r = await call('GET', '/api/v1/configs', { token: aliToken });
  assert.equal(r.status, 404); assert.equal(r.body.error.code, 'NO_CONFIG');

  await call('PUT', `/api/admin/users/${ali.id}`, { cookie: adminCookie, body: { password: 'newpass99' } });
  assert.equal((await call('GET', '/api/v1/account', { token: aliToken })).status, 401);
});

test('dashboard, audit log, delete', async () => {
  let r = await call('GET', '/api/admin/dashboard', { cookie: adminCookie });
  assert.equal(r.body.users.total, 2);
  assert.ok(r.body.total_traffic_bytes > 0);
  assert.equal(r.body.servers[0].last_sync_error, null);
  r = await call('GET', '/api/admin/audit', { cookie: adminCookie });
  const actions = r.body.logs.map((l) => l.action);
  for (const a of ['admin.login', 'user.create', 'config.bulk_create', 'xui.disable_client', 'xui.enable_client', 'user.renew']) assert.ok(actions.includes(a), a);
  r = await call('DELETE', `/api/admin/users/${sara.id}`, { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/v1/account', { token: saraToken })).status, 401);
  r = await call('DELETE', `/api/admin/configs/${cfgGroup.id}`, { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal((await call('DELETE', `/api/admin/configs/${cfgGroup.id}`, { cookie: adminCookie })).status, 404);
});

test('3X-UI wrong credentials are reported, not crashing', async () => {
  const srv = getDb().prepare('SELECT id FROM servers').get();
  await call('PUT', `/api/admin/servers/${srv.id}`, { cookie: adminCookie, body: { xui_password: 'bad' } });
  const s = await syncAll(() => {});
  assert.equal(s.errors.length, 1);
  const r = await call('GET', '/api/admin/servers', { cookie: adminCookie });
  assert.match(r.body.servers[0].last_sync_error, /login failed/);
});

test('input hardening: bad JSON, huge body, path traversal, unknown route', async () => {
  let r = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  r = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(r.status, 413);
  r = await fetch(base + '/..%2f..%2fpackage.json');
  assert.equal(r.status, 404);
  r = await fetch(base + '/api/nothing');
  assert.equal(r.status, 404);
  r = await call('POST', '/api/v1/auth/login', { body: { username: ['x'], password: 'y' } });
  assert.equal(r.status, 400);
});

test('login rate limiting (5 attempts then 429)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/v1/auth/login', { body: { username: 'brute', password: 'x' + i } });
    assert.equal(r.status, 401);
  }
  const r = await call('POST', '/api/v1/auth/login', { body: { username: 'brute', password: 'x' } });
  assert.equal(r.status, 429); assert.ok(r.body.error.retry_after > 0);
});

test('admin logout revokes the session', async () => {
  let r = await call('POST', '/api/admin/logout', { cookie: adminCookie });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/admin/me', { cookie: adminCookie });
  assert.equal(r.status, 401);
});
