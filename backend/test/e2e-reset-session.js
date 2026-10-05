'use strict';
// Browser E2E: the panel's "Reset Session" button frees a user's login lock. Run: node test/e2e-reset-session.js
process.env.JWT_SECRET = 'e2e_secret_'.padEnd(64, 'y');
process.env.DATA_ENC_KEY = 'b'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');

(async () => {
  const now = Date.now();
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), now);
  const uid = Number(getDb().prepare('INSERT INTO users(username,password_hash,quota_bytes,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('mina', hashPassword('mina-pass-1'), 1024 ** 3, now + 86400000 * 30, now, now).lastInsertRowid);
  const server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = () => fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mina', password: 'mina-pass-1' }) });
  const step = (s) => console.log('✓', s);

  assert.equal((await login()).status, 200); assert.equal((await login()).status, 409); step('session active, second login blocked');
  const before = getDb().prepare('SELECT quota_bytes, expires_at, status, password_hash FROM users WHERE id=?').get(uid);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.fill('#login-form [name=username]', 'admin');
  await page.fill('#login-form [name=password]', 'AdminPass123!');
  await page.click('#login-form button');
  await page.waitForSelector('#app-view:not(.hidden) .stats');
  await page.click('[data-page=users]');
  const btn = page.locator(`#users-body button[data-act=release][data-id="${uid}"]`);
  await btn.waitFor();
  assert.equal((await btn.textContent()).trim(), 'Reset Session'); step('panel shows "Reset Session"');
  await btn.click();
  await page.waitForSelector('text=Session ریست شد'); step('reset confirmed + toast');
  await page.waitForSelector(`#users-body button[data-act=release][data-id="${uid}"]:has-text("بدون Session فعال")`); step('button now disabled state');
  await page.screenshot({ path: '/tmp/reset-session.png' });
  await browser.close();

  assert.equal((await login()).status, 200); step('user can log in again after reset');
  assert.deepEqual(getDb().prepare('SELECT quota_bytes, expires_at, status, password_hash FROM users WHERE id=?').get(uid), before); step('account/subscription untouched');
  server.close();
  console.log('E2E reset-session OK');
})().catch((e) => { console.error(e); process.exit(1); });
