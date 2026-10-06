'use strict';
// Subscription URL = a remote list of share links (3X-UI "sub" server, etc.).
// The backend fetches it, validates every link and stores them as normal configs.
// The app never sees the subscription URL and never contacts it: it only receives
// ready configs from our own API.
const http = require('node:http');
const https = require('node:https');
const { getDb, tx } = require('./db');
const { config } = require('./config');
const { parseLink } = require('./links');
const { audit } = require('./services');
const settings = require('./settings');

const MAX_BYTES = 2 * 1024 * 1024;

function fetchText(urlStr, redirects = 3, withHeaders = false) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('آدرس Subscription نامعتبر است')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('فقط http/https مجاز است'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { timeout: 15000, headers: { 'User-Agent': 'v2rayNG/1.8.0', Accept: '*/*' }, rejectUnauthorized: !settings.get('xui_allow_insecure_tls') }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, u).toString(), redirects - 1, withHeaders));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('پاسخ بیش از حد بزرگ است')); return; } chunks.push(c); });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('پاسخ Subscription ناقص است')));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(withHeaders ? { body, userinfo: res.headers['subscription-userinfo'] } : body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Subscription body is either plain links (one per line) or base64 of that. */
function decodeBody(body) {
  const t = String(body || '').trim();
  if (/^[a-z0-9]+:\/\//im.test(t)) return t;
  const compact = t.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  try {
    const dec = Buffer.from(compact, 'base64').toString('utf8');
    if (/:\/\//.test(dec)) return dec;
  } catch { /* fallthrough */ }
  return t;
}

function parseBody(body) {
  const links = []; const errors = [];
  decodeBody(body).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    try { links.push({ link: line, parsed: parseLink(line) }); } catch (e) { errors.push({ line: i + 1, link: line.slice(0, 60), error: e.message }); }
  });
  return { links, errors };
}

const arr = (j) => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

/**
 * Fetch and apply one subscription. Existing configs whose link is unchanged keep their id
 * (so connected apps are not forced to reconnect); removed links are deleted; new ones inserted.
 */
async function refreshSubscription(sub, fetcher = fetchText) {
  const db = getDb();
  try {
    const { links, errors } = parseBody(await fetcher(sub.url));
    if (!links.length) throw new Error(errors.length ? `هیچ لینک معتبری نبود (${errors[0].error})` : 'Subscription خالی است');
    const now = Date.now();
    const result = tx(() => {
      const existing = db.prepare('SELECT id, link FROM configs WHERE subscription_id=?').all(sub.id);
      const keep = new Set();
      let added = 0;
      links.forEach(({ link, parsed }, i) => {
        const hit = existing.find((c) => c.link === link && !keep.has(c.id));
        const userIds = arr(sub.user_ids); const groupIds = arr(sub.group_ids);
        let id;
        if (hit) {
          id = hit.id; keep.add(id);
          db.prepare('UPDATE configs SET priority=?, scope=?, country=? WHERE id=?').run(sub.priority + i, sub.scope, sub.country || '', id);
        } else {
          const r = db.prepare(`INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,subscription_id,source,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,'subscription',?,?)`).run(parsed.name || `${sub.name} ${i + 1}`, sub.country || '', link, parsed.protocol, sub.enabled ? 1 : 0, sub.priority + i, sub.scope, sub.id, now, now);
          id = Number(r.lastInsertRowid); keep.add(id); added++;
        }
        db.prepare('DELETE FROM config_users WHERE config_id=?').run(id);
        db.prepare('DELETE FROM config_groups WHERE config_id=?').run(id);
        for (const u of userIds) db.prepare('INSERT OR IGNORE INTO config_users(config_id,user_id) SELECT ?, id FROM users WHERE id=?').run(id, u);
        for (const g of groupIds) db.prepare('INSERT OR IGNORE INTO config_groups(config_id,group_id) SELECT ?, id FROM groups WHERE id=?').run(id, g);
      });
      const removed = existing.filter((c) => !keep.has(c.id));
      for (const c of removed) db.prepare('DELETE FROM configs WHERE id=?').run(c.id);
      db.prepare('UPDATE subscriptions SET last_fetch_at=?, last_error=?, last_count=? WHERE id=?')
        .run(now, errors.length ? `${errors.length} لینک نامعتبر رد شد` : null, links.length, sub.id);
      return { total: links.length, added, removed: removed.length, invalid: errors.length };
    });
    return { ok: true, ...result, errors };
  } catch (e) {
    db.prepare('UPDATE subscriptions SET last_fetch_at=?, last_error=? WHERE id=?').run(Date.now(), e.message, sub.id);
    return { ok: false, error: e.message };
  }
}

async function refreshAll(log = console.log) {
  const subs = getDb().prepare('SELECT * FROM subscriptions WHERE enabled=1').all();
  for (const s of subs) {
    const r = await refreshSubscription(s);
    if (!r.ok) log(`[subscription] ${s.name}: ${r.error}`);
    else if (r.added || r.removed) audit('system', 'subscription.refresh', `subscription:${s.id}`, { added: r.added, removed: r.removed });
  }
}

function startSubscriptionRefresher(log = console.log) {
  let stopped = false;
  let timer = null;

  const schedule = (delayMs) => {
    if (stopped) return;
    timer = setTimeout(run, delayMs);
    timer.unref();
  };

  const run = async () => {
    if (stopped) return;

    try {
      if (settings.get('sync_enabled')) {
        await refreshAll(log);
      }
    } catch (e) {
      log(`[subscription] ${e.message}`);
    }

    const interval = settings.get('subscription_refresh_minutes');
    schedule(Math.max(1000, interval * 60000));
  };

  schedule(3000);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = { refreshSubscription, refreshAll, startSubscriptionRefresher, parseBody, decodeBody, fetchText };
