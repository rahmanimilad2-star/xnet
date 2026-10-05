'use strict';
// Automatic per-user client management on 3X-UI panels.
const crypto = require('node:crypto');
const { getDb } = require('./db');
const { XuiClient } = require('./xui');
const { decryptSecret } = require('./security');
const { buildShareLink } = require('./xuilink');
const { parseLink } = require('./links');
const { audit, subscriptionStatus, getUsage } = require('./services');
const { config } = require('./config');
const settings = require('./settings');

const SUPPORTED = new Set(['vless', 'vmess', 'trojan', 'shadowsocks']);

function clientFor(server) {
  return new XuiClient(server.xui_url, server.xui_username, decryptSecret(server.xui_password_enc));
}
function publicHost(server) {
  if (server.public_host) return server.public_host;
  try { return new URL(server.xui_url).hostname; } catch { return ''; }
}
function provisionTargets(server) {
  try { const a = JSON.parse(server.provision_inbounds || '[]'); return Array.isArray(a) ? a.filter(Number.isInteger) : []; } catch { return []; }
}

function userSubscription(user) {
  const rows = getDb().prepare("SELECT * FROM subscriptions WHERE scope='users' ORDER BY id").all();
  return rows.find((row) => {
    try { return JSON.parse(row.user_ids || '[]').map(Number).includes(Number(user.id)) && String(row.url).includes('/api/v1/subscriptions/'); } catch { return false; }
  }) || null;
}

function createUserSubscription(user) {
  const existing = userSubscription(user);
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString('hex');
  const base = settings.get('public_url');
  const url = `${base}/api/v1/subscriptions/${token}`;
  const now = Date.now();
  const result = getDb().prepare(`INSERT INTO subscriptions(name,url,country,priority,scope,user_ids,group_ids,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'[]',1,?,?)`).run(`XNET · ${user.username}`, url, '', 10, 'users', JSON.stringify([user.id]), now, now);
  return getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(Number(result.lastInsertRowid));
}
function provisionServers(options = {}) {
  const rows = getDb().prepare("SELECT * FROM servers WHERE enabled=1 AND xui_url<>''").all();
  return rows
    .filter((s) => options.server_id == null || s.id === options.server_id)
    .filter((s) => provisionTargets(s).length);
}

/** Values 3X-UI should enforce for this user's clients. */
function limitsFor(user) {
  const active = subscriptionStatus(user, getUsage(user.id)) === 'ACTIVE';
  return { totalGB: user.quota_bytes || 0, expiryTime: user.expires_at || 0, enable: active };
}

function newClient(protocol, inbound, email, limits) {
  const base = { email, limitIp: 0, totalGB: limits.totalGB, expiryTime: limits.expiryTime, enable: limits.enable, tgId: '', subId: crypto.randomBytes(8).toString('hex'), reset: 0 };
  if (protocol === 'vless') {
    // reuse the inbound's flow (e.g. xtls-rprx-vision on REALITY/TCP)
    const flow = (inbound.settings?.clients || []).find((c) => c.flow)?.flow || '';
    return { ...base, id: crypto.randomUUID(), flow };
  }
  if (protocol === 'vmess') return { ...base, id: crypto.randomUUID(), security: 'auto' };
  if (protocol === 'trojan') return { ...base, password: crypto.randomBytes(12).toString('hex') };
  if (protocol === 'shadowsocks') {
    const method = inbound.settings?.method || '';
    const len = method.includes('aes-128') ? 16 : 32;
    const password = method.startsWith('2022-') ? crypto.randomBytes(len).toString('base64') : crypto.randomBytes(12).toString('hex');
    return { ...base, method: '', password };
  }
  throw new Error(`unsupported protocol ${protocol}`);
}

/**
 * Create a client for [user] on every selected inbound that does not have one yet,
 * create the matching config (assigned only to this user). Returns {created, errors}.
 */
async function provisionUser(user, options = {}) {
  const db = getDb();
  const out = { created: [], errors: [] };
  const limits = limitsFor(user);
  for (const server of provisionServers(options)) {
    let x;
    try { x = clientFor(server); await x.login(); } catch (e) { out.errors.push({ server: server.name, error: e.message }); continue; }
    let inbounds = [];
    try { inbounds = await x.listInbounds(); } catch (e) { out.errors.push({ server: server.name, error: e.message }); continue; }
    const targets = options.inbound_id == null
      ? provisionTargets(server)
      : provisionTargets(server).filter((id) => id === options.inbound_id);
    for (const inboundId of targets) {
      const exists = db.prepare('SELECT 1 FROM user_clients WHERE user_id=? AND server_id=? AND inbound_id=?').get(user.id, server.id, inboundId);
      if (exists) {
        const existingClient = db.prepare('SELECT config_id FROM user_clients WHERE user_id=? AND server_id=? AND inbound_id=?').get(user.id, server.id, inboundId);
        if (existingClient?.config_id) {
          const subscription = createUserSubscription(user);
          db.prepare('UPDATE configs SET subscription_id=? WHERE id=? AND subscription_id IS NULL').run(subscription.id, existingClient.config_id);
        }
        continue;
      }
      const inbound = inbounds.find((i) => i.id === inboundId);
      if (!inbound) { out.errors.push({ server: server.name, inbound: inboundId, error: 'inbound پیدا نشد' }); continue; }
      if (!SUPPORTED.has(inbound.protocol)) { out.errors.push({ server: server.name, inbound: inboundId, error: `پروتکل ${inbound.protocol} پشتیبانی نمی‌شود` }); continue; }
      const email = `${user.username}-s${server.id}i${inboundId}`.toLowerCase();
      try {
        const client = newClient(inbound.protocol, inbound, email, limits);
        await x.addClient(inboundId, client);
        const name = `${server.name}${inbound.remark ? ` · ${inbound.remark}` : ''}`;
        const link = buildShareLink(inbound, client, publicHost(server), name);
        const parsed = parseLink(link); // validates the generated link
        const now = Date.now();
        const subscription = createUserSubscription(user);
        const cfg = db.prepare(`INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,server_id,subscription_id,source,created_at,updated_at)
          VALUES (?,?,?,?,1,?,'users',?,?, 'xui',?,?)`).run(name, server.country || '', link, parsed.protocol, 50 + out.created.length, server.id, subscription.id, now, now);
        const configId = Number(cfg.lastInsertRowid);
        db.prepare('INSERT INTO config_users(config_id,user_id) VALUES (?,?)').run(configId, user.id);
        db.prepare(`INSERT INTO user_clients(user_id,server_id,inbound_id,protocol,email,client_key,config_id,enabled_on_xui,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(user.id, server.id, inboundId, inbound.protocol, email, client.id || client.password, configId, limits.enable ? 1 : 0, now);
        out.created.push({ server: server.name, inbound: inboundId, email, config_id: configId });
        db.prepare('UPDATE subscriptions SET last_count=(SELECT COUNT(*) FROM configs WHERE subscription_id=?), last_fetch_at=?, last_error=NULL, updated_at=? WHERE id=?')
          .run(subscription.id, now, now, subscription.id);
      } catch (e) {
        out.errors.push({ server: server.name, inbound: inboundId, error: e.message });
      }
    }
  }
  db.prepare('UPDATE users SET provision_error=? WHERE id=?').run(out.errors.length ? JSON.stringify(out.errors).slice(0, 2000) : null, user.id);
  if (out.created.length) audit('system', 'xui.provision', `user:${user.id}`, { created: out.created.length, errors: out.errors.length });
  return out;
}

function clientsOf(userId) {
  return getDb().prepare('SELECT uc.*, s.name AS server_name FROM user_clients uc JOIN servers s ON s.id=uc.server_id WHERE uc.user_id=?').all(userId);
}

async function forEachServerClient(userId, fn) {
  const errors = [];
  const byServer = new Map();
  for (const c of clientsOf(userId)) { if (!byServer.has(c.server_id)) byServer.set(c.server_id, []); byServer.get(c.server_id).push(c); }
  for (const [serverId, list] of byServer) {
    const server = getDb().prepare('SELECT * FROM servers WHERE id=?').get(serverId);
    try {
      const x = clientFor(server); await x.login();
      for (const c of list) { try { await fn(x, c); } catch (e) { errors.push({ server: server.name, email: c.email, error: e.message }); } }
    } catch (e) { errors.push({ server: server.name, error: e.message }); }
  }
  return errors;
}

/** Push quota / expiry / enable state of [user] to all its 3X-UI clients. */
async function pushLimits(user) {
  const limits = limitsFor(user);
  const errors = await forEachServerClient(user.id, async (x, c) => {
    await x.updateClientByEmail(c.inbound_id, c.email, limits);
    getDb().prepare('UPDATE user_clients SET enabled_on_xui=?, last_error=NULL WHERE id=?').run(limits.enable ? 1 : 0, c.id);
  });
  return errors;
}

async function resetTraffic(user) {
  return forEachServerClient(user.id, async (x, c) => {
    await x.resetClientTraffic(c.inbound_id, c.email);
    getDb().prepare('UPDATE user_clients SET up_bytes=0, down_bytes=0, base_up=0, base_down=0, rate_up=0, rate_down=0 WHERE id=?').run(c.id);
  });
}

/** Remove all of [userId]'s clients from 3X-UI (call before deleting the user row). */
async function deprovisionUser(userId) {
  return forEachServerClient(userId, async (x, c) => { await x.deleteClient(c.inbound_id, c.protocol, c.client_key, c.email); });
}

module.exports = { provisionUser, pushLimits, resetTraffic, deprovisionUser, clientsOf, provisionTargets, publicHost, clientFor, limitsFor, userSubscription };
