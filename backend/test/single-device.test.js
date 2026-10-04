'use strict';
// Single active device per user, enforced server-side.
process.env.JWT_SECRET = 'test_secret_'.padEnd(64, 'x');
process.env.DATA_ENC_KEY = 'a'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'single-device-'));
const DB_FILE = path.join(DIR, 'data.db');
const { openDb, getDb } = require('../src/db');
openDb(DB_FILE); // real file DB so the restart test is meaningful
const { hashPassword, signToken } = require('../src/security');
const { createServer } = require('../src/app');
const sessions = require('../src/sessions');

let base, server, adminCookie;
async function start() {
  server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
async function stop() { await new Promise((r) => server.close(r)); }
async function call(method, p, { body, token, cookie, ua } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) { headers.Cookie = cookie; headers['X-Requested-With'] = 'panel'; }
  if (ua) headers['User-Agent'] = ua;
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
const login = (username, password, ua) => call('POST', '/api/v1/auth/login', { body: { username, password }, ua });
const account = (token) => call('GET', '/api/v1/account', { token });
const logout = (token) => call('POST', '/api/v1/auth/logout', { token });

function addUser(username, password) {
  const now = Date.now();
  const r = getDb().prepare('INSERT INTO users(username,password_hash,created_at,updated_at) VALUES (?,?,?,?)')
    .run(username, hashPassword(password), now, now);
  return Number(r.lastInsertRowid);
}

test.before(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  await start();
  const r = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'AdminPass123!' } });
  adminCookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await stop(); fs.rmSync(DIR, { recursive: true, force: true }); });

let phoneA;
test('first device login succeeds', async () => {
  addUser('milad1', 'pass-milad1');
  const r = await login('milad1', 'pass-milad1', 'PhoneA');
  assert.equal(r.status, 200);
  assert.ok(r.body.token); assert.ok(r.body.expires_at > Date.now());
  assert.equal(r.body.account.username, 'milad1'); // response contract unchanged
  phoneA = r.body.token;
  assert.equal((await account(phoneA)).status, 200);
  const row = getDb().prepare('SELECT * FROM user_sessions WHERE user_id=(SELECT id FROM users WHERE username=?)').get('milad1');
  assert.ok(row); assert.equal(row.user_agent, 'PhoneA');
  assert.equal(row.expires_at, r.body.expires_at, 'server session expiry = token expiry');
  assert.ok(!JSON.stringify(row).includes(phoneA), 'raw token/sid is not stored');
});

test('second device login is rejected with a clear error', async () => {
  const r = await login('milad1', 'pass-milad1', 'PhoneB');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ALREADY_ACTIVE');
  assert.match(r.body.error.message, /دستگاه دیگری فعال است/);
  assert.equal(r.body.token, undefined);
});

test('existing device stays logged in after the rejected attempt', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await login('milad1', 'pass-milad1', 'PhoneB')).status, 409);
  assert.equal((await account(phoneA)).status, 200);
  assert.equal((await call('GET', '/api/v1/usage', { token: phoneA })).status, 200);
  // wrong password from another device: normal 401, does not reveal or touch the active session
  const bad = await login('milad1', 'nope');
  assert.equal(bad.status, 401); assert.equal(bad.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await account(phoneA)).status, 200);
  // a rejected login never counts as a failed attempt for the brute-force limiter
  for (let i = 0; i < 6; i++) await login('milad1', 'pass-milad1');
  assert.equal((await account(phoneA)).status, 200);
});

test('logout releases the account; the logged-out token is dead', async () => {
  const out = await logout(phoneA);
  assert.equal(out.status, 200); assert.equal(out.body.released, true);
  assert.equal((await account(phoneA)).status, 401);
  assert.equal((await logout(phoneA)).body.released, false, 'logout is idempotent');
  const b = await login('milad1', 'pass-milad1', 'PhoneB');
  assert.equal(b.status, 200);
  assert.equal((await account(b.body.token)).status, 200);
  phoneA = b.body.token; // PhoneB is now the active device
});

test('logout from a non-active / garbage token never releases the active device', async () => {
  assert.equal((await logout('garbage.token.value')).body.released, false);
  assert.equal((await logout(undefined)).body.released, false);
  assert.equal((await account(phoneA)).status, 200);
});

test('login after session expiration succeeds', async () => {
  addUser('exp1', 'pass-exp1');
  const a = await login('exp1', 'pass-exp1');
  assert.equal(a.status, 200);
  assert.equal((await login('exp1', 'pass-exp1')).status, 409);
  // let the active session reach its expiry (same moment the token expires)
  getDb().prepare('UPDATE user_sessions SET expires_at=? WHERE user_id=(SELECT id FROM users WHERE username=?)').run(Date.now() - 1, 'exp1');
  assert.equal((await account(a.body.token)).status, 401, 'expired session is not accepted');
  const b = await login('exp1', 'pass-exp1');
  assert.equal(b.status, 200, 'another device can log in after expiry');
  assert.equal((await account(b.body.token)).status, 200);
  // and a token whose own JWT expiry passed is rejected as before
  const uid = getDb().prepare('SELECT id, token_version FROM users WHERE username=?').get('exp1');
  const dead = signToken({ sub: uid.id, role: 'user', tv: uid.token_version, sid: 'x' }, -1).token;
  assert.equal((await account(dead)).status, 401);
});

test('revoked sessions: admin password change / admin release free the device', async () => {
  const id = addUser('rev1', 'pass-rev1');
  const a = (await login('rev1', 'pass-rev1')).body.token;
  assert.equal((await login('rev1', 'pass-rev1')).status, 409);
  let r = await call('PUT', `/api/admin/users/${id}`, { cookie: adminCookie, body: { password: 'pass-rev2' } });
  assert.equal(r.status, 200);
  assert.equal((await account(a)).status, 401, 'password change revokes the old device');
  const b = (await login('rev1', 'pass-rev2'));
  assert.equal(b.status, 200, 'revoked session no longer blocks login');

  r = await call('POST', `/api/admin/users/${id}/release-device`, { cookie: adminCookie });
  assert.equal(r.status, 200); assert.equal(r.body.released, true);
  assert.equal((await account(b.body.token)).status, 401);
  assert.equal((await login('rev1', 'pass-rev2')).status, 200);
  assert.equal((await call('POST', `/api/admin/users/${id}/release-device`)).status, 401, 'admin only');
});

test('two simultaneous logins cannot both succeed (HTTP)', async () => {
  addUser('race1', 'pass-race1');
  const rs = await Promise.all(Array.from({ length: 12 }, () => login('race1', 'pass-race1')));
  const ok = rs.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, `exactly one winner, got ${rs.map((r) => r.status)}`);
  assert.ok(rs.every((r) => r.status === 200 || (r.status === 409 && r.body.error.code === 'ALREADY_ACTIVE')));
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM user_sessions WHERE user_id=(SELECT id FROM users WHERE username=?)').get('race1').n, 1);
  assert.equal((await account(ok[0].body.token)).status, 200);
});

test('two simultaneous logins cannot both succeed (separate DB connections / processes)', async () => {
  const id = addUser('race2', 'pass-race2');
  const N = 6;
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const code = `
    const { workerData, parentPort } = require('node:worker_threads');
    const { openDb } = require(${JSON.stringify(path.resolve(__dirname, '../src/db'))});
    const sessions = require(${JSON.stringify(path.resolve(__dirname, '../src/sessions'))});
    openDb(workerData.file);
    const gate = new Int32Array(workerData.sab);
    parentPort.postMessage('ready');
    Atomics.wait(gate, 0, 0);               // all workers start at the same instant
    const r = sessions.claim(workerData.id, (sid) => ({ token: sid, exp: Date.now() + 3600e3 }));
    parentPort.postMessage(r ? 'won' : 'rejected');`;
  const results = [];
  const workers = Array.from({ length: N }, () => new Worker(code, { eval: true, workerData: { file: DB_FILE, id, sab: gate.buffer } }));
  let ready = 0;
  const done = Promise.all(workers.map((w) => new Promise((res, rej) => {
    w.on('message', (m) => { if (m === 'ready') { if (++ready === N) { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); } } else { results.push(m); res(); } });
    w.on('error', rej);
  })));
  await done; await Promise.all(workers.map((w) => w.terminate()));
  assert.equal(results.filter((x) => x === 'won').length, 1, `results: ${results}`);
  assert.equal(results.length, N);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM user_sessions WHERE user_id=?').get(id).n, 1);
});

test('backend restart does not invalidate valid sessions (and keeps the lock)', async () => {
  addUser('restart1', 'pass-restart1');
  const a = (await login('restart1', 'pass-restart1')).body.token;
  await stop();
  getDb().close();
  openDb(DB_FILE);        // fresh process state: new connection, new server, same data
  await start();
  assert.equal((await account(a)).status, 200, 'token from before restart still valid');
  assert.equal((await login('restart1', 'pass-restart1')).status, 409, 'single-device lock survives restart');
  assert.equal((await logout(a)).body.released, true);
  assert.equal((await login('restart1', 'pass-restart1')).status, 200);
});

test('tokens issued before this update: first device is adopted, others rejected (no mass logout)', async () => {
  const id = addUser('legacy1', 'pass-legacy1');
  const tv = getDb().prepare('SELECT token_version FROM users WHERE id=?').get(id).token_version;
  const oldA = signToken({ sub: id, role: 'user', tv }, 720).token; // old format: no sid
  const oldB = signToken({ sub: id, role: 'user', tv, x: 1 }, 720).token;
  assert.equal((await account(oldA)).status, 200, 'already-logged-in phone keeps working');
  assert.equal((await account(oldB)).status, 401, 'a second already-logged-in phone is cut off');
  assert.equal((await account(oldA)).status, 200);
  assert.equal((await login('legacy1', 'pass-legacy1')).status, 409);
  assert.equal((await logout(oldA)).body.released, true);
  assert.equal((await account(oldA)).status, 401);
  assert.equal((await login('legacy1', 'pass-legacy1')).status, 200);
});

test('deleting a user removes the session row', async () => {
  const id = addUser('del1', 'pass-del1');
  await login('del1', 'pass-del1');
  getDb().prepare('DELETE FROM users WHERE id=?').run(id);
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM user_sessions WHERE user_id=?').get(id).n, 0);
});

test('unit: claim refuses while live, isLive honours expiry and token_version', () => {
  const id = addUser('unit1', 'pass-unit1');
  const sign = (sid) => ({ token: sid, exp: Date.now() + 1000 });
  assert.ok(sessions.claim(id, sign));
  assert.equal(sessions.claim(id, sign), null);
  getDb().prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(id);
  assert.ok(sessions.claim(id, sign), 'token_version bump = revoked');
  assert.equal(sessions.isLive({ expires_at: Date.now() - 1, token_version: 0 }, 0), false);
});
