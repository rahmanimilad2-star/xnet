'use strict';
// Browser E2E test of the admin panel (requires playwright + chromium). Run: node test/e2e-panel.js
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
const { startMockXui } = require('./mock-xui');
const SHOTS = process.env.SHOTS || '/tmp';

(async () => {
  getDb().prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), Date.now());
  const xui = await startMockXui();
  xui.state.traffic.ali = { up: 300 * 1024 ** 2, down: 1200 * 1024 ** 2 };
  const server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fa-IR' });
  const cspErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') cspErrors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✓', s);

  await page.goto(base);
  await page.fill('#login-form [name=username]', 'admin');
  await page.fill('#login-form [name=password]', 'wrong-password');
  await page.click('#login-form button');
  await page.waitForSelector('#login-error:has-text("اشتباه")'); step('wrong admin password rejected');
  await page.fill('#login-form [name=password]', 'AdminPass123!');
  await page.click('#login-form button');
  await page.waitForSelector('#app-view:not(.hidden) .stats'); step('admin login + dashboard');

  // group
  await page.click('[data-page=groups]'); await page.click('#add-group');
  await page.fill('#modal-body [name=name]', 'VIP'); await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#g-body td:has-text("VIP")'); step('group created');

  // server (3X-UI)
  await page.click('[data-page=servers]'); await page.click('#add-srv');
  await page.fill('#modal-body [name=name]', 'NL-1'); await page.fill('#modal-body [name=xui_url]', xui.url);
  await page.fill('#modal-body [name=xui_username]', 'xadmin'); await page.fill('#modal-body [name=xui_password]', 'xpass');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#s-body .server-card:has-text("NL-1")'); step('3X-UI server added');

  // user
  await page.click('[data-page=users]'); await page.click('#add-user');
  await page.fill('#modal-body [name=username]', 'ali'); await page.fill('#modal-body [name=password]', 'alipass1');
  await page.fill('#modal-body [name=quota_gb]', '2'); await page.fill('#modal-body [name=days]', '30');
  await page.fill('#modal-body [name=xui_email]', 'ali');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#users-body td:has-text("ali")'); step('user created');

  // config: invalid then valid
  await page.click('[data-page=configs]'); await page.click('#add-cfg');
  await page.fill('#modal-body [name=link]', 'vless://garbage');
  await page.click('#validate-btn'); await page.waitForSelector('#validate-out:has-text("نامعتبر")'); step('invalid link flagged');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#modal-body .error:has-text("لینک نامعتبر")'); step('invalid link blocked on save');
  await page.fill('#modal-body [name=link]', 'vless://a3482e88-686a-4a58-8126-99c9df64b7bf@nl.example.com:443?type=ws&security=tls&sni=nl.example.com&path=%2Fws#Netherlands');
  await page.click('#validate-btn'); await page.waitForSelector('#validate-out:has-text("معتبر")');
  await page.fill('#modal-body [name=country]', 'هلند'); await page.fill('#modal-body [name=priority]', '10');
  await page.check('#modal-body [name=user_ids]');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#cfg-body td:has-text("Netherlands")'); step('config created & assigned to ali');

  // subscription URL (served by a tiny local server)
  const subSrv = require('node:http').createServer((q, r) => { r.writeHead(200); r.end(Buffer.from('vless://a3482e88-686a-4a58-8126-99c9df64b7bf@sub.example.com:443?type=tcp&security=tls&sni=sub.example.com#FromSub').toString('base64')); });
  await new Promise((r) => subSrv.listen(0, '127.0.0.1', r));
  await page.click('#add-sub');
  await page.fill('#modal-body [name=name]', 'Sub-1'); await page.fill('#modal-body [name=url]', `http://127.0.0.1:${subSrv.address().port}/sub/x`);
  await page.selectOption('#modal-body [name=scope]', 'users'); await page.check('#modal-body [name=user_ids]');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#sub-body .group-row:has-text("Sub-1"):has-text("FromSub")'); step('subscription URL imported as configs (grouped)');
  // subscription detail: view -> configs listed, full URL copyable, refresh now; then edit
  await page.click('#sub-body [data-act=view]'); await page.waitForSelector('#modal-body .ud-section:has-text("FromSub")');
  const mb = await page.evaluate(() => { const r = document.querySelector('#modal .modal-box').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight }; });
  assert.ok(mb.top > 0 && mb.bottom < mb.h && Math.abs((mb.left + mb.right) / 2 - mb.w / 2) < 2, `modal not centered ${JSON.stringify(mb)}`); step('modal centered in viewport');
  await page.click('#modal-body .copy-field [data-copy]'); await page.waitForSelector('#toast:has-text("کپی شد")'); step('subscription URL copy');
  await page.click('#sub-refresh'); await page.waitForSelector('#toast:has-text("کانفیگ")'); await page.waitForSelector('#modal-body .cfg-row:has-text("FromSub")');
  await page.keyboard.press('Escape'); await page.waitForSelector('#modal.hidden', { state: 'attached' }); step('subscription refreshed from detail view');
  await page.click('#sub-body [data-act=edit]'); await page.fill('#modal-body [name=name]', 'Sub-1b'); await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#sub-body .group-row:has-text("Sub-1b")'); step('subscription edited');
  await page.click('#sub-body summary'); await page.click('#sub-body [data-act=refresh]'); await page.waitForSelector('#toast:has-text("کانفیگ")'); step('subscription refresh from list (⋯ menu)');
  await page.click('#sub-body summary'); await page.click('#sub-body [data-act=del]'); await page.waitForSelector('#toast:has-text("حذف شد")'); subSrv.close();
  await page.waitForFunction(() => !document.querySelector('#sub-body')?.textContent.includes('FromSub')); step('subscription removed with its configs');

  // bulk
  await page.click('#bulk-cfg');
  const ss = 'ss://' + Buffer.from('aes-256-gcm:pw').toString('base64') + '@9.9.9.9:8388#SS-DE';
  await page.fill('#modal-body [name=links]', [ss, 'trojan://p@tr.example.com:443#TR', 'nonsense://x'].join('\n'));
  await page.selectOption('#modal-body [name=scope]', 'all');
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#bulk-errors:has-text("خط ۳")'); step('bulk: 2 added, bad line 3 reported');
  assert.equal(await page.inputValue('#modal-body [name=links]'), 'nonsense://x');
  await page.click('#modal-close'); await page.click('[data-page=configs]');
  await page.waitForSelector('#cfg-body td:has-text("SS-DE")');
  await page.screenshot({ path: `${SHOTS}/panel-configs.png`, fullPage: true });

  // app API sees configs
  let r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ali', password: 'alipass1' }) });
  const { token } = await r.json();
  r = await fetch(`${base}/api/v1/configs`, { headers: { Authorization: `Bearer ${token}` } });
  const cfg = await r.json();
  assert.deepEqual(cfg.configs.map((c) => c.name), ['Netherlands', 'SS-DE', 'TR']); step('app API returns assigned + all-scope configs in priority order');

  // sync stats & see usage
  await page.click('[data-page=dashboard]'); await page.waitForSelector('#sync-btn'); await page.click('#sync-btn');
  await page.waitForSelector('#toast:has-text("همگام شد")');
  await page.click('[data-page=users]'); await page.waitForSelector('#users-body td:has-text("GB")');
  const usage = await page.textContent('#users-body tr td:nth-child(3)');
  assert.match(usage, /۱٫۴۶\u00A0GB/); step(`real usage shown from 3X-UI: ${usage.trim()}`);

  // renew + block
  await page.click('#users-body [data-act=renew]'); await page.fill('#modal-body [name=add_gb]', '3');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#users-body td:has-text("۵\u00A0GB")'); step('renew +3GB');
  await page.click('#users-body [data-act=toggle]'); await page.waitForSelector('#users-body .badge:has-text("مسدود")'); step('user blocked');
  r = await fetch(`${base}/api/v1/configs`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await r.json()).error.code, 'BLOCKED'); step('blocked user gets BLOCKED from app API');
  await page.click('#users-body [data-act=toggle]');
  await page.waitForSelector('#users-body .badge:has-text("فعال")');
  await page.screenshot({ path: `${SHOTS}/panel-users.png`, fullPage: true });

  // edit config through the modal; cancel + Escape close it
  await page.click('[data-page=configs]'); await page.click('#cfg-body tr:first-child [data-act=edit]');
  await page.waitForSelector('#modal:not(.hidden) #modal-body [name=link]');
  await page.click('#modal-body [data-cancel]'); await page.waitForSelector('#modal.hidden', { state: 'attached' });
  await page.click('#cfg-body tr:first-child [data-act=edit]'); await page.keyboard.press('Escape'); await page.waitForSelector('#modal.hidden', { state: 'attached' }); step('modal closes via Cancel and Escape');
  await page.click('#cfg-body tr:first-child [data-act=edit]'); await page.fill('#modal-body [name=country]', 'هلند ۲');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#cfg-body td:has-text("هلند ۲")'); step('config edited');
  // user detail view
  await page.click('[data-page=users]'); await page.click('#users-body [data-act=detail]');
  await page.waitForSelector('#modal-body .ud-stats'); await page.waitForSelector('#modal-body .ud-section:has-text("کانفیگ‌ها")');
  await page.screenshot({ path: `${SHOTS}/panel-user-detail.png` });
  await page.click('#modal-body .ud-section [data-copy]'); await page.waitForSelector('#toast:has-text("کپی شد")'); step('user detail: stats, sections, copy config');
  await page.click('#modal-close');
  // edit config: disable
  await page.click('[data-page=configs]'); await page.click('#cfg-body tr:first-child [data-act=toggle]');
  await page.waitForSelector('#cfg-body tr:first-child .badge:has-text("غیرفعال")'); step('config disabled without delete');

  await page.click('[data-page=audit]'); await page.waitForSelector('td:has-text("config.bulk_create")'); step('audit log visible');
  await page.click('[data-page=dashboard]'); await page.waitForSelector('.stats');
  await page.screenshot({ path: `${SHOTS}/panel-dashboard.png`, fullPage: true });

  // mobile layout
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'fa-IR' });
  await m.context().addCookies(await page.context().cookies());
  await m.goto(base + '/#users'); await m.waitForSelector('#users-body td');
  await m.screenshot({ path: `${SHOTS}/panel-mobile.png` });
  await m.click('#menu-toggle'); await m.click('#sidebar a[data-page=configs]'); await m.waitForSelector('#cfg-body td');
  await m.screenshot({ path: `${SHOTS}/panel-mobile-configs.png` });
  await m.click('#menu-toggle'); await m.click('#sidebar a[data-page=dashboard]'); await m.waitForSelector('.stats');
  await m.screenshot({ path: `${SHOTS}/panel-mobile-dashboard.png` });
  await m.click('#menu-toggle'); await m.click('#sidebar a[data-page=users]'); await m.waitForSelector('#users-body [data-act=renew]');
  await m.click('#users-body [data-act=renew]'); await m.waitForSelector('#modal:not(.hidden)');
  await m.screenshot({ path: `${SHOTS}/panel-mobile-sheet.png` });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  const box = await m.evaluate(() => { const r = document.querySelector('#modal .modal-box').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
  assert.ok(box.top >= 0 && box.bottom <= box.h, `modal outside viewport ${JSON.stringify(box)}`);
  step('mobile: off-canvas sidebar, scrollable tables, centered modal inside viewport, no page-level horizontal scroll');

  await page.click('#logout-btn'); await page.waitForSelector('#login-view:not(.hidden)'); step('logout');
  assert.deepEqual(cspErrors.filter((e) => /Content Security Policy|Refused/.test(e)), [], 'no CSP violations');
  step('no CSP violations in console');
  await browser.close(); server.close(); xui.server.close();
  console.log('E2E PANEL: ALL PASSED');
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
