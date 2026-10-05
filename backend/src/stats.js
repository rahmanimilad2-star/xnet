'use strict';
// Collects REAL per-user traffic from each 3X-UI panel and enforces limits.
//  - user_clients: clients this panel provisioned automatically (preferred)
//  - users.xui_email: legacy manual mapping
const { getDb } = require('./db');
const { config } = require('./config');
const settings = require('./settings');
const { XuiClient } = require('./xui');
const { decryptSecret } = require('./security');
const { getUsage, subscriptionStatus, audit } = require('./services');

let running = false;

async function syncProvisioned(x, server, log) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM user_clients WHERE server_id=?').all(server.id);
  const seen = [];
  for (const c of rows) {
    let t;
    try { t = await x.getClientTraffic(c.email); } catch (e) { log(`[stats] ${c.email}: ${e.message}`); continue; }
    if (!t) { db.prepare('UPDATE user_clients SET last_error=? WHERE id=?').run('کلاینت در 3X-UI پیدا نشد', c.id); continue; }
    const now = Date.now();
    const dt = c.synced_at ? Math.max(1, (now - c.synced_at) / 1000) : 0;
    const reset = t.up < c.up_bytes || t.down < c.down_bytes; // counters reset on 3X-UI side
    const rateUp = dt && !reset ? Math.round((t.up - c.up_bytes) / dt) : 0;
    const rateDown = dt && !reset ? Math.round((t.down - c.down_bytes) / dt) : 0;
    const baseUp = t.up < c.base_up ? 0 : c.base_up;
    const baseDown = t.down < c.base_down ? 0 : c.base_down;
    db.prepare(`UPDATE user_clients SET up_bytes=?, down_bytes=?, base_up=?, base_down=?, rate_up=?, rate_down=?,
      enabled_on_xui=?, last_error=NULL, synced_at=? WHERE id=?`).run(t.up, t.down, baseUp, baseDown, rateUp, rateDown, t.enable ? 1 : 0, now, c.id);
    seen.push({ row: c, traffic: t });
  }
  return seen;
}

async function enforceProvisioned(x, seen, log) {
  const db = getDb();
  for (const { row, traffic } of seen) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    if (!user) continue;
    const shouldEnable = subscriptionStatus(user, getUsage(user.id)) === 'ACTIVE';
    if (shouldEnable === traffic.enable) continue;
    try {
      await x.updateClientByEmail(row.inbound_id, row.email, { enable: shouldEnable, totalGB: user.quota_bytes || 0, expiryTime: user.expires_at || 0 });
      db.prepare('UPDATE user_clients SET enabled_on_xui=? WHERE id=?').run(shouldEnable ? 1 : 0, row.id);
      audit('system', shouldEnable ? 'xui.enable_client' : 'xui.disable_client', `user:${user.id}`, { email: row.email });
    } catch (e) { log(`[stats] enforce ${row.email}: ${e.message}`); }
  }
}

async function syncLegacy(client, server, users) {
  const db = getDb();
  const found = [];
  for (const u of users) {
    const t = await client.getClientTraffic(u.xui_email);
    if (!t) continue;
    const now = Date.now();
    const prev = db.prepare('SELECT * FROM user_server_usage WHERE user_id=? AND server_id=?').get(u.id, server.id);
    if (!prev) {
      db.prepare('INSERT INTO user_server_usage(user_id,server_id,up_bytes,down_bytes,updated_at) VALUES (?,?,?,?,?)').run(u.id, server.id, t.up, t.down, now);
    } else {
      const baseUp = t.up < prev.base_up ? 0 : prev.base_up;
      const baseDown = t.down < prev.base_down ? 0 : prev.base_down;
      db.prepare('UPDATE user_server_usage SET up_bytes=?,down_bytes=?,base_up=?,base_down=?,updated_at=? WHERE user_id=? AND server_id=?')
        .run(t.up, t.down, baseUp, baseDown, now, u.id, server.id);
    }
    found.push({ user: u, traffic: t });
  }
  return found;
}

async function enforceLegacy(client, server, found, log) {
  const db = getDb();
  for (const { user, traffic } of found) {
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const shouldEnable = subscriptionStatus(fresh, getUsage(fresh.id)) === 'ACTIVE';
    const row = db.prepare('SELECT disabled_on_xui FROM user_server_usage WHERE user_id=? AND server_id=?').get(user.id, server.id);
    try {
      if (!shouldEnable && traffic.enable) {
        await client.setClientEnabled(traffic.inboundId, user.xui_email, false);
        db.prepare('UPDATE user_server_usage SET disabled_on_xui=1 WHERE user_id=? AND server_id=?').run(user.id, server.id);
        audit('system', 'xui.disable_client', `user:${user.id}`, { server: server.id });
      } else if (shouldEnable && !traffic.enable && row && row.disabled_on_xui) {
        await client.setClientEnabled(traffic.inboundId, user.xui_email, true);
        db.prepare('UPDATE user_server_usage SET disabled_on_xui=0 WHERE user_id=? AND server_id=?').run(user.id, server.id);
        audit('system', 'xui.enable_client', `user:${user.id}`, { server: server.id });
      }
    } catch (e) { log(`[stats] enforce failed for ${user.username}@${server.name}: ${e.message}`); }
  }
}

async function syncAll(log = console.log) {
  if (running) return { skipped: true };
  running = true;
  const db = getDb();
  const result = { servers: 0, clients: 0, errors: [] };
  try {
    const servers = db.prepare("SELECT * FROM servers WHERE enabled=1 AND xui_url<>''").all();
    const legacyUsers = db.prepare("SELECT * FROM users WHERE xui_email IS NOT NULL AND xui_email<>''").all();
    for (const s of servers) {
      try {
        const x = new XuiClient(s.xui_url, s.xui_username, decryptSecret(s.xui_password_enc));
        await x.login();
        const seen = await syncProvisioned(x, s, log);
        result.clients += seen.length;
        const found = await syncLegacy(x, s, legacyUsers);
        if (settings.get('enforce_on_xui')) { await enforceProvisioned(x, seen, log); await enforceLegacy(x, s, found, log); }
        db.prepare('UPDATE servers SET last_sync_at=?, last_sync_error=NULL WHERE id=?').run(Date.now(), s.id);
        result.servers++;
      } catch (e) {
        db.prepare('UPDATE servers SET last_sync_error=? WHERE id=?').run(e.message, s.id);
        result.errors.push({ server: s.name, error: e.message });
        log(`[stats] ${s.name}: ${e.message}`);
      }
    }
  } finally { running = false; }
  return result;
}

function startCollector(log = console.log) {
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
        await syncAll(log);
      }
    } catch (e) {
      log(`[stats] ${e.message}`);
    }

    const interval = settings.get('stats_interval_seconds');
    schedule(Math.max(1000, interval * 1000));
  };

  schedule(3000);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = { syncAll, startCollector };
