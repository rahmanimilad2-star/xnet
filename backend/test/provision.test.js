'use strict';
process.env.JWT_SECRET = 'prov_secret_'.padEnd(64, 'z');
process.env.DATA_ENC_KEY = 'c'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';
process.env.ENFORCE_ON_XUI = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');
const { syncAll } = require('../src/stats');
const { parseLink } = require('../src/links');
const { startMockXui2 } = require('./mock-xui2');
const GB = 1024 ** 3; const MB = 1024 ** 2;

let base, srv, xui, cookie, serverId, userId, token;
async function call(method, path, { body, auth } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${auth}`; else if (cookie) { headers.Cookie = cookie; headers['X-Requested-With'] = 'panel'; }
  const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
const clientsOf = (email) => xui.state.inbounds.flatMap((ib) => ib.settings.clients.filter((c) => c.email.startsWith(email)).map((c) => ({ ib: ib.id, ...c })));

test.before(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  srv = createServer({ log: () => {} });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  xui = await startMockXui2();
  const r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(() => { srv.close(); xui.server.close(); });

test('server: list inbounds from 3X-UI and choose provisioning targets', async () => {
  let r = await call('POST', '/api/admin/servers', { body: { name: 'NL-1', country: 'NL', xui_url: xui.url, xui_username: 'xadmin', xui_password: 'xpass', public_host: 'vpn.example.com' } });
  assert.equal(r.status, 201); serverId = r.body.server.id;
  r = await call('GET', `/api/admin/servers/${serverId}/inbounds`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.inbounds.map((i) => i.protocol), ['vless', 'trojan', 'shadowsocks', 'vmess']);
  r = await call('PUT', `/api/admin/servers/${serverId}`, { body: { provision_inbounds: [1, 2, 3, 4] } });
  assert.deepEqual(r.body.server.provision_inbounds, [1, 2, 3, 4]);
  // wrong password -> clear error
  const bad = await call('POST', '/api/admin/servers', { body: { name: 'bad', xui_url: xui.url, xui_username: 'xadmin', xui_password: 'nope' } });
  r = await call('GET', `/api/admin/servers/${bad.body.server.id}/inbounds`);
  assert.equal(r.status, 502); assert.match(r.body.error.message, /login failed/);
  await call('DELETE', `/api/admin/servers/${bad.body.server.id}`);
});

test('creating a user auto-creates one 3X-UI client per inbound with quota + expiry', async () => {
  const r = await call('POST', '/api/admin/users', { body: { username: 'ali', password: 'alipass1', quota_gb: 1, days: 30 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  userId = r.body.user.id;
  assert.equal(r.body.provision.errors.length, 0, JSON.stringify(r.body.provision.errors));
  assert.equal(r.body.provision.created.length, 4);
  const cs = clientsOf('ali-');
  assert.equal(cs.length, 4);
  for (const c of cs) { assert.equal(c.totalGB, GB); assert.ok(c.expiryTime > Date.now()); assert.equal(c.enable, true); }
  assert.equal(cs.find((c) => c.ib === 1).flow, 'xtls-rprx-vision');
  assert.equal(r.body.user.xui_clients.length, 4);
  assert.equal(r.body.user.allowed_config_count, 4);
});

test('generated links are valid and point to the public host', async () => {
  const links = getDb().prepare('SELECT link FROM configs').all().map((x) => x.link);
  assert.equal(links.length, 4);
  for (const l of links) {
    const p = parseLink(l);
    assert.equal(p.address, 'vpn.example.com');
  }
  const reality = parseLink(links.find((l) => l.startsWith('vless://'))).outbound;
  assert.equal(reality.streamSettings.security, 'reality');
  assert.equal(reality.streamSettings.realitySettings.shortId, '6ba85179e30d4fc2');
  const tr = parseLink(links.find((l) => l.startsWith('trojan://'))).outbound;
  assert.equal(tr.streamSettings.wsSettings.host, 'de.example.com');
  const ss = parseLink(links.find((l) => l.startsWith('ss://'))).outbound;
  assert.match(ss.settings.servers[0].password, /^AAAAAAAAAAAAAAAAAAAAAA==:/);
  const vm = parseLink(links.find((l) => l.startsWith('vmess://'))).outbound;
  assert.equal(vm.streamSettings.grpcSettings.serviceName, 'svc');
});

test('unified provisioning creates one usable per-user subscription without duplicates', async () => {
  const rows = getDb().prepare("SELECT * FROM subscriptions WHERE scope='users' AND user_ids LIKE '%1%'").all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].url, /\/api\/v1\/subscriptions\/[a-f0-9]{48}$/);
  assert.equal(rows[0].last_count, 4);
  const feed = await fetch(base + rows[0].url);
  assert.equal(feed.status, 200);
  const decoded = Buffer.from(await feed.text(), 'base64').toString('utf8').trim().split(/\n/);
  assert.equal(decoded.length, 4);
  const again = await fetch(base + '/api/v1/subscriptions/not-a-real-token');
  assert.equal(again.status, 404);
  const reprovision = await call('POST', `/api/admin/users/${userId}/provision`);
  assert.equal(reprovision.status, 200);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM subscriptions WHERE scope='users' AND user_ids LIKE '%1%'").get().n, 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM user_clients WHERE user_id=?').get(userId).n, 4);
});

test('app login sees own configs; usage and live speed come from 3X-UI', async () => {
  let r = await call('POST', '/api/v1/auth/login', { body: { username: 'ali', password: 'alipass1' } });
  token = r.body.token;
  r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 200); assert.equal(r.body.configs.length, 4);

  await syncAll(() => {});                       // first sync: baseline
  const [e1, e2] = clientsOf('ali-').map((c) => c.email);
  xui.state.traffic[e1] = { up: 20 * MB, down: 180 * MB };
  xui.state.traffic[e2] = { up: 10 * MB, down: 90 * MB };
  await new Promise((res) => setTimeout(res, 1100));
  await syncAll(() => {});
  r = await call('GET', '/api/v1/account', { auth: token });
  assert.equal(r.body.account.used_bytes, 300 * MB);
  assert.equal(r.body.account.download_bytes, 270 * MB);
  assert.ok(r.body.account.rate_down_bps > 0, 'download speed computed');
  r = await call('GET', `/api/admin/users/${userId}`);
  assert.equal(r.body.user.online, true);
  assert.equal(r.body.user.used_bytes, 300 * MB);
});

test('quota exhausted -> API blocks and all 3X-UI clients get disabled; renew re-enables', async () => {
  const [e1] = clientsOf('ali-').map((c) => c.email);
  xui.state.traffic[e1] = { up: 100 * MB, down: 900 * MB }; // total > 1GB
  await syncAll(() => {});
  let r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'QUOTA_EXCEEDED');
  assert.ok(clientsOf('ali-').every((c) => c.enable === false), 'all clients disabled on 3X-UI');

  r = await call('POST', `/api/admin/users/${userId}/renew`, { body: { add_gb: 2, reset_usage: true } });
  assert.deepEqual(r.body.xui_errors, []);
  assert.equal(r.body.user.used_bytes, 0);
  assert.ok(clientsOf('ali-').every((c) => c.enable === true && c.totalGB === 3 * GB), 'limits pushed + re-enabled');
  assert.ok(Object.entries(xui.state.traffic).filter(([k]) => k.startsWith('ali-')).every(([, t]) => t.up === 0 && t.down === 0), 'traffic reset on 3X-UI');
  r = await call('GET', '/api/v1/configs', { auth: token });
  assert.equal(r.status, 200);
});

test('block / expiry changes are pushed to 3X-UI immediately', async () => {
  await call('PUT', `/api/admin/users/${userId}`, { body: { status: 'blocked' } });
  assert.ok(clientsOf('ali-').every((c) => c.enable === false));
  await call('PUT', `/api/admin/users/${userId}`, { body: { status: 'active', days: 10 } });
  assert.ok(clientsOf('ali-').every((c) => c.enable === true && Math.abs(c.expiryTime - (Date.now() + 10 * 86400000)) < 60000));
});

test('3X-UI unreachable during create -> user still created, error reported, retry works', async () => {
  const s = getDb().prepare('SELECT xui_url FROM servers WHERE id=?').get(serverId);
  getDb().prepare('UPDATE servers SET xui_url=? WHERE id=?').run('http://127.0.0.1:1/x', serverId);
  let r = await call('POST', '/api/admin/users', { body: { username: 'sara', password: 'sarapass1', quota_gb: 5, days: 30 } });
  assert.equal(r.status, 201); assert.equal(r.body.provision.created.length, 0); assert.ok(r.body.provision.errors.length > 0);
  assert.ok(r.body.user.provision_error);
  getDb().prepare('UPDATE servers SET xui_url=? WHERE id=?').run(s.xui_url, serverId);
  r = await call('POST', `/api/admin/users/${r.body.user.id}/provision`);
  assert.equal(r.body.provision.created.length, 4); assert.equal(r.body.user.provision_error, null);
  // no duplicates on second retry
  r = await call('POST', `/api/admin/users/${r.body.user.id}/provision`);
  assert.equal(r.body.provision.created.length, 0);
});

test('deleting a user removes its 3X-UI clients and its generated configs', async () => {
  const before = getDb().prepare('SELECT COUNT(*) n FROM configs').get().n;
  const r = await call('DELETE', `/api/admin/users/${userId}`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.xui_errors, []);
  assert.equal(clientsOf('ali-').length, 0);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM configs').get().n, before - 4);
  assert.equal(clientsOf('sara-').length, 4, 'other users untouched');
});
