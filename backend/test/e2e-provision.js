'use strict';
// Browser E2E: add 3X-UI server, pick inbounds, create user -> clients auto-created, usage + speed visible.
process.env.JWT_SECRET = 'e2e2_secret_'.padEnd(64, 'q');
process.env.DATA_ENC_KEY = 'd'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');
const { syncAll } = require('../src/stats');
const { startMockXui2 } = require('./mock-xui2');
const nav = async (p, name) => { if (await p.isVisible('#menu-toggle')) await p.click('#menu-toggle'); await p.click(`#sidebar a[data-page=${name}]`); };
const SHOTS = process.env.SHOTS || '/tmp';
const MB = 1024 ** 2;

(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  const xui = await startMockXui2();
  const server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'fa-IR' });
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✓', s);

  await page.goto(base);
  await page.fill('#login-form [name=username]', 'admin'); await page.fill('#login-form [name=password]', 'AdminPass123!');
  await page.click('#login-form button'); await page.waitForSelector('.stats');
  await nav(page, 'servers'); await page.click('#add-srv');
  await page.fill('#modal-body [name=name]', 'NL-1'); await page.fill('#modal-body [name=xui_url]', xui.url);
  await page.fill('#modal-body [name=xui_username]', 'xadmin'); await page.fill('#modal-body [name=xui_password]', 'xpass');
  await page.fill('#modal-body [name=public_host]', 'vpn.example.com');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#s-body .server-card:has-text("inbound انتخاب نشده")'); step('server added (no inbounds yet)');
  await page.click('#s-body [data-act=inbounds]'); await page.waitForSelector('#modal-body input[name=ib]');
  assert.equal(await page.locator('#modal-body input[name=ib]').count(), 4);
  await page.screenshot({ path: `${SHOTS}/prov-inbounds.png` });
  await page.check('#modal-body input[name=ib][value="1"]'); await page.check('#modal-body input[name=ib][value="2"]');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#s-body .server-card:has-text("۲ inbound")'); step('picked 2 inbounds from live 3X-UI list');

  await nav(page, 'users'); await page.click('#add-user');
  await page.fill('#modal-body [name=username]', 'ali'); await page.fill('#modal-body [name=password]', 'alipass1');
  await page.fill('#modal-body [name=quota_gb]', '1'); await page.fill('#modal-body [name=days]', '30');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#toast:has-text("۲ کلاینت در 3X-UI ساخته شد")'); step('user created -> 2 clients auto-created in 3X-UI');
  const cs = xui.state.inbounds.flatMap((ib) => ib.settings.clients.filter((c) => c.email.startsWith('ali-')));
  assert.equal(cs.length, 2); assert.ok(cs.every((c) => c.totalGB === 1024 ** 3));

  await syncAll(() => {});
  cs.forEach((c, i) => { xui.state.traffic[c.email] = { up: 10 * MB, down: (i + 1) * 100 * MB }; });
  await new Promise((r) => setTimeout(r, 1100));
  await syncAll(() => {});
  await nav(page, 'dashboard'); await nav(page, 'users');
  await page.waitForSelector('#users-body .badge:has-text("آنلاین")');
  const txt = await page.textContent('#users-body');
  assert.match(txt, /۳۲۰\u00A0MB/); step('real usage (320 MB) + online badge + live speed shown');
  await page.screenshot({ path: `${SHOTS}/prov-users.png` });
  // user detail: 3X-UI section, Re-provision does not duplicate clients
  await page.click('#users-body [data-act=detail]'); await page.waitForSelector('#modal-body .ud-section:has-text("3X-UI")');
  await page.screenshot({ path: `${SHOTS}/prov-user-detail.png` });
  await page.click('#modal-body [data-uact=provision]'); await page.waitForSelector('#toast:has-text("Provisioning انجام شد")');
  assert.equal(xui.state.inbounds.flatMap((ib) => ib.settings.clients.filter((c) => c.email.startsWith('ali-'))).length, 2); step('detail Re-provision: no duplicate clients');
  // one-step create with explicit Server -> Inbound (only that server's selected inbounds are offered)
  await page.click('#add-user'); await page.fill('#modal-body [name=username]', 'sara'); await page.fill('#modal-body [name=password]', 'sarapass1');
  await page.selectOption('#provision-server', { index: 1 }); await page.waitForSelector('#provision-inbound:not([disabled])');
  assert.equal(await page.locator('#provision-inbound option[value]:not([value=""])').count(), 2);
  await page.selectOption('#provision-inbound', '2'); await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#toast:has-text("۱ کلاینت در 3X-UI ساخته شد")');
  assert.equal(xui.state.inbounds.find((ib) => ib.id === 2).settings.clients.filter((c) => c.email.startsWith('sara-')).length, 1); step('wizard: server -> inbound -> exactly one client');
  await page.click('#users-body tr:has-text("sara") [data-act=del]'); await page.waitForSelector('#toast:has-text("کاربر حذف شد")');
  await page.click('#users-body [data-act=edit]'); await page.waitForSelector('#modal-body .checklist .badge');
  await page.screenshot({ path: `${SHOTS}/prov-user-edit.png` }); step('user edit shows its 3X-UI clients');
  await page.click('#modal-close');
  await page.click('#users-body [data-act=del]'); await page.waitForSelector('#toast:has-text("کاربر حذف شد")');
  assert.equal(xui.state.inbounds.flatMap((ib) => ib.settings.clients.filter((c) => c.email.startsWith('ali-'))).length, 0); step('delete removes clients from 3X-UI');
  assert.deepEqual(errs.filter((e) => /Content Security Policy|Refused/.test(e)), []); step('no CSP errors');
  await browser.close(); server.close(); xui.server.close();
  console.log('E2E PROVISION: ALL PASSED');
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
