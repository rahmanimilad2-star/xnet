'use strict';
// Acceptance test: ONE subscription (or one 3X-UI user) = ONE main row; its configs only in the detail view.
// Run: node test/e2e-groups.js   (requires playwright + chromium)
process.env.JWT_SECRET = 'e2e_secret_'.padEnd(64, 'g');
process.env.DATA_ENC_KEY = 'd'.repeat(64);
process.env.STATS_INTERVAL_SECONDS = '0';
process.env.ENV_FILE = '/nonexistent';
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { openDb, getDb } = require('../src/db');
openDb(':memory:');
const { hashPassword } = require('../src/security');
const { createServer } = require('../src/app');
const SHOTS = process.env.SHOTS || '/tmp';
const U = (n) => `${n}2e88-686a-4a58-8126-99c9df64b7bf`;
const SUB_LINKS = [
  `vless://${U('a348')}@www.duravexv.ir:16314?type=tcp&security=tls&sni=www.duravexv.ir#Xnet service 🇩🇪`,
  `vless://${U('b348')}@www.duravexv.ir:36524?type=tcp&security=tls&sni=www.duravexv.ir#Xnet service 🇳🇱`,
  `vless://${U('c348')}@www.duravexv.ir:40137?type=tcp&security=tls&sni=www.duravexv.ir#Xnet service 🇹🇷`,
  `vless://${U('d348')}@snapp.ir:8880?type=tcp&security=tls&sni=snapp.ir#Xnet service 🇫🇷`,
];

(async () => {
  const db = getDb(); const now = Date.now();
  db.prepare('INSERT INTO admins(username,password_hash,created_at) VALUES (?,?,?)').run('admin', hashPassword('AdminPass123!'), now);
  const sheyda = Number(db.prepare("INSERT INTO users(username,password_hash,status,created_at,updated_at) VALUES ('sheyda',?,'active',?,?)").run(hashPassword('pw123456'), now, now).lastInsertRowid);
  const milad = Number(db.prepare("INSERT INTO users(username,password_hash,status,created_at,updated_at) VALUES ('miladtest',?,'active',?,?)").run(hashPassword('pw123456'), now, now).lastInsertRowid);
  // 3X-UI-style per-user configs for miladtest (no subscription_id) - must group under the user
  for (const [i, f] of ['🇫🇷', '🇩🇪', '🇳🇱', '🇹🇷'].entries()) {
    const id = Number(db.prepare("INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,source,created_at,updated_at) VALUES (?,?,?,?,1,?,'users','xui',?,?)")
      .run(`NL-1 · Xnet ${f}`, '', `vless://${U(`e${i}48`)}@vpn.example.com:${4430 + i}?type=tcp&security=tls&sni=vpn.example.com#m${i}`, 'vless', 50 + i, now, now).lastInsertRowid);
    db.prepare('INSERT INTO config_users(config_id,user_id) VALUES (?,?)').run(id, milad);
  }
  // two unrelated manual configs that must stay individual rows
  db.prepare("INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,source,created_at,updated_at) VALUES ('Manual-A','DE',?,'vless',1,10,'all','manual',?,?)").run(`vless://${U('f148')}@m1.example.com:443?type=tcp&security=tls&sni=m1.example.com#Manual-A`, now, now);
  db.prepare("INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,source,created_at,updated_at) VALUES ('Manual-B','NL',?,'vless',1,11,'all','manual',?,?)").run(`vless://${U('f248')}@m2.example.com:443?type=tcp&security=tls&sni=m2.example.com#Manual-B`, now, now);

  const subSrv = http.createServer((q, r) => { r.writeHead(200); r.end(Buffer.from(SUB_LINKS.join('\n')).toString('base64')); });
  await new Promise((r) => subSrv.listen(0, '127.0.0.1', r));
  const server = createServer({ log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'fa-IR' });
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('dialog', (d) => d.accept());
  const step = (s) => console.log('✓', s);
  await page.goto(base);
  await page.fill('#login-form [name=username]', 'admin'); await page.fill('#login-form [name=password]', 'AdminPass123!');
  await page.click('#login-form button'); await page.waitForSelector('.stats');

  // create ONE subscription for sheyda through the real UI
  await page.click('[data-page=configs]'); await page.click('#add-sub');
  const subUrl = `http://127.0.0.1:${subSrv.address().port}/sub/a82f0c1d9e7b6a5f4e3d2c1b0a9f8e7d`;
  await page.fill('#modal-body [name=name]', 'sheyda | France, Turkey, Germany'); await page.fill('#modal-body [name=url]', subUrl);
  await page.selectOption('#modal-body [name=scope]', 'users'); await page.check(`#modal-body [name=user_ids][value="${sheyda}"]`);
  await page.click('#modal-body [type=submit]');
  await page.waitForSelector('#sub-body .group-row:has-text("sheyda")');
  const api = async (p) => (await page.evaluate(async (u) => (await fetch(u, { headers: { 'X-Requested-With': 'panel' } })).json(), p));
  const before = (await api('/api/admin/configs')).configs;
  assert.equal(before.filter((c) => c.subscription_id).length, 4, 'backend keeps 4 independent subscription configs');

  // 1-7: one main row per subscription / per user, count, locations, status, copy link
  const rows = await page.$$eval('#sub-body .group-row', (els) => els.map((e) => e.innerText));
  assert.equal(rows.length, 2, `expected 2 main rows (sheyda sub + miladtest), got ${rows.length}`);
  const sRow = rows.find((t) => t.includes('sheyda')); const mRow = rows.find((t) => t.includes('miladtest'));
  assert.ok(sRow.includes('Subscription') && sRow.includes('۴ کانفیگ') && sRow.includes('کاربر خاص'), sRow);
  for (const loc of ['آلمان', 'هلند', 'ترکیه', 'فرانسه']) assert.ok(sRow.includes(loc), `location ${loc} missing in: ${sRow}`);
  assert.ok(sRow.includes('فعال'), 'status shown');
  assert.equal(await page.locator('#sub-body .group-row:has-text("sheyda") [data-copy]').getAttribute('data-copy'), subUrl, 'copy uses the real stored URL');
  assert.ok(mRow.includes('۴ کانفیگ') && mRow.includes('3X-UI'), mRow);
  assert.equal((await page.$$eval('#sub-body .group-row', (els) => els.filter((e) => e.innerText.includes('sheyda')).length)), 1, 'sheyda rendered once');
  const urlBox = await page.locator('#sub-body .group-row:has-text("sheyda") .g-url').boundingBox();
  assert.ok(urlBox.width <= 262, `URL expands the row: ${urlBox.width}px`);
  step('main page: 1 row for sheyda subscription, 1 row for miladtest; counts, locations, scope, status, truncated URL');
  // manual configs stay individual; grouped configs are NOT repeated as main rows
  const cfgRows = await page.$$eval('#cfg-body tr', (els) => els.map((e) => e.innerText));
  assert.equal(cfgRows.length, 2); assert.ok(cfgRows[0].includes('Manual-A') && cfgRows[1].includes('Manual-B'));
  assert.ok(!cfgRows.some((t) => t.includes('Xnet service')), 'subscription configs not listed as top-level rows');
  step('manual configs remain individual, subscription configs not duplicated at top level');
  await page.click('#sub-body .group-row:has-text("sheyda") [data-copy]'); await page.waitForSelector('#toast:has-text("کپی شد")'); step('copy link');
  await page.screenshot({ path: `${SHOTS}/groups-main.png`, fullPage: true });

  // 8-9: View -> individual configs; disable / edit / delete per config
  await page.click('#sub-body .group-row:has-text("sheyda") [data-act=view]');
  await page.waitForSelector('#modal-body .cfg-row');
  assert.equal(await page.locator('#modal-body .cfg-row').count(), 4); step('View lists the 4 individual configs');
  await page.screenshot({ path: `${SHOTS}/groups-detail.png` });
  await page.click('#modal-body .cfg-row:has-text("هلند") [data-cact=toggle]');
  await page.waitForSelector('#modal-body .cfg-row:has-text("هلند") .badge:has-text("غیرفعال")');
  await page.waitForSelector('#sub-body .group-row:has-text("sheyda") .badge:has-text("۱ غیرفعال")');
  assert.equal((await api('/api/admin/configs')).configs.find((c) => c.name.includes('🇳🇱') && c.subscription_id).enabled, false); step('disable one config from detail (persisted, row badge updated)');
  await page.click('#modal-body .cfg-row:has-text("ترکیه") [data-cact=del]');
  await page.waitForFunction(() => document.querySelectorAll('#modal-body .cfg-row').length === 3);
  assert.equal((await api('/api/admin/configs')).configs.filter((c) => c.subscription_id).length, 3); step('delete one config from detail (only that config removed)');
  await page.click('#modal-body .cfg-row:has-text("فرانسه") [data-cact=edit]');
  await page.waitForSelector('#modal-body [name=link]'); await page.fill('#modal-body [name=priority]', '7');
  await page.click('#modal-body [type=submit]'); await page.waitForSelector('#toast:has-text("ذخیره شد")');
  assert.equal((await api('/api/admin/configs')).configs.find((c) => c.name.includes('🇫🇷')).priority, 7); step('edit one config from detail');
  // the user group detail works too
  await page.click('#sub-body .group-row:has-text("miladtest") [data-act=view]');
  await page.waitForSelector('#modal-body .cfg-row'); assert.equal(await page.locator('#modal-body .cfg-row').count(), 4); step('miladtest: View lists its 4 configs');
  await page.keyboard.press('Escape');
  // every other page still renders
  for (const p of ['dashboard', 'users', 'servers', 'groups', 'audit', 'settings']) { await page.click(`[data-page=${p}]`); await page.waitForSelector('#page .page-head'); }
  step('all other pages render');
  assert.deepEqual(errs.filter((e) => /Content Security Policy|Refused|TypeError|ReferenceError/.test(e)), []); step('no console errors');
  await browser.close(); server.close(); subSrv.close();
  console.log('E2E GROUPS: ALL PASSED');
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
