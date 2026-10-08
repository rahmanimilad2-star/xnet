'use strict';
const { getDb, tx } = require('./db');
const { config } = require('./config');
const { Router, HttpError, v, USERNAME_RE, parseCookies } = require('./http');
const sec = require('./security');
const { parseLink, describeLink, LinkError } = require('./links');
const { GB, getUsage, subscriptionStatus, accountView, allowedConfigs, audit, STATUS_MESSAGES } = require('./services');
const stats = require('./stats');
const prov = require('./provision');
const subs = require('./subscriptions');
const userSubs = require('./user-subscription-refresh');
const crypto = require('node:crypto');
const sessions = require('./sessions');
const settings = require('./settings');

const limiter = new sec.LoginLimiter(settings.get('login_max_attempts'), settings.get('login_window_minutes') * 60000);
setInterval(() => limiter.sweep(), 60000).unref();

const CONFIG_SYNC_SECONDS = 300;
const ADMIN_COOKIE = 'admin_session';
settings.ensureTable();

// ------------------------------------------------------------------ auth
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}
function requireUser(ctx) {
  const p = sec.verifyToken(bearer(ctx.req));
  if (!p || p.role !== 'user') throw new HttpError(401, 'UNAUTHORIZED', 'لطفاً دوباره وارد شوید');
  const user = getDb().prepare('SELECT * FROM users WHERE id=?').get(p.sub);
  if (!user || user.token_version !== p.tv) throw new HttpError(401, 'UNAUTHORIZED', 'نشست شما منقضی شده است. دوباره وارد شوید');
  // single device: the token must be the user's active server-side session
  if (!sessions.check(user, p, bearer(ctx.req))) throw new HttpError(401, 'UNAUTHORIZED', 'این حساب روی دستگاه دیگری فعال است. دوباره وارد شوید');
  getDb().prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(Date.now(), user.id);
  ctx.user = user;
}
function requireAdmin(ctx) {
  const viaBearer = bearer(ctx.req);
  const token = viaBearer || parseCookies(ctx.req)[ADMIN_COOKIE];
  const p = sec.verifyToken(token);
  if (!p || p.role !== 'admin') throw new HttpError(401, 'UNAUTHORIZED', 'ورود مدیر لازم است');
  const admin = getDb().prepare('SELECT * FROM admins WHERE id=?').get(p.sub);
  if (!admin || admin.token_version !== p.tv) throw new HttpError(401, 'UNAUTHORIZED', 'نشست مدیر منقضی شده است');
  // CSRF defence for cookie-based sessions: custom header cannot be sent cross-site without CORS.
  if (!viaBearer && ctx.req.method !== 'GET' && ctx.req.headers['x-requested-with'] !== 'panel') {
    throw new HttpError(403, 'CSRF', 'درخواست نامعتبر');
  }
  ctx.admin = admin;
}

function loginGuard(ctx, kind, username) {
  limiter.configure(
    settings.get('login_max_attempts'),
    settings.get('login_window_minutes') * 60000
  );
  const keys = [`${kind}:ip:${ctx.ip}`, `${kind}:u:${String(username).toLowerCase()}`];
  const wait = limiter.check(keys);
  if (wait > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `تلاش‌های ناموفق زیاد بود. ${Math.ceil(wait / 60)} دقیقه دیگر تلاش کنید`, { retry_after: wait });
  return keys;
}

function cookieHeader(value, maxAgeS) {
  const secure = config.env === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure}`;
}

// ---------------------------------------------------------------- helpers
const gbToBytes = (gb) => Math.round(gb * GB);
function getUserOr404(id) {
  const u = getDb().prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'کاربر پیدا نشد');
  return u;
}
function getConfigOr404(id) {
  const c = getDb().prepare('SELECT * FROM configs WHERE id=?').get(id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'کانفیگ پیدا نشد');
  return c;
}
function checkIdsExist(table, ids, label) {
  if (!ids || !ids.length) return;
  const rows = getDb().prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (rows.length !== ids.length) throw new HttpError(400, 'VALIDATION', `برخی ${label} وجود ندارند`);
}
function setConfigTargets(configId, userIds, groupIds) {
  const db = getDb();
  if (userIds) {
    db.prepare('DELETE FROM config_users WHERE config_id=?').run(configId);
    const ins = db.prepare('INSERT INTO config_users(config_id,user_id) VALUES (?,?)');
    for (const u of userIds) ins.run(configId, u);
  }
  if (groupIds) {
    db.prepare('DELETE FROM config_groups WHERE config_id=?').run(configId);
    const ins = db.prepare('INSERT INTO config_groups(config_id,group_id) VALUES (?,?)');
    for (const g of groupIds) ins.run(configId, g);
  }
}
function adminUserView(u) {
  const acc = accountView(u);
  const configIds = getDb().prepare('SELECT config_id FROM config_users WHERE user_id=?').all(u.id).map((r) => r.config_id);
  return {
    ...acc, user_status: u.status, xui_email: u.xui_email, group_id: u.group_id, note: u.note,
    device_session_active: sessions.status(u.id, u.token_version).active,
    device_session_expires_at: sessions.status(u.id, u.token_version).expires_at,
    config_ids: configIds, allowed_config_count: allowedConfigs(u).length,
    online: (acc.rate_up_bps + acc.rate_down_bps) > 0,
    xui_clients: prov.clientsOf(u.id).map((c) => ({ server: c.server_name, inbound_id: c.inbound_id, protocol: c.protocol, email: c.email, enabled: !!c.enabled_on_xui, used_bytes: Math.max(0, c.up_bytes - c.base_up) + Math.max(0, c.down_bytes - c.base_down), last_error: c.last_error })),
    provision_error: u.provision_error ? JSON.parse(u.provision_error) : null,
    subscriptions: getDb().prepare("SELECT id,name,url,enabled,last_error,last_count FROM subscriptions WHERE scope='users' AND user_ids LIKE ?").all(`%${u.id}%`),
    last_login_at: u.last_login_at, last_seen_at: u.last_seen_at, created_at: u.created_at, updated_at: u.updated_at,
  };
}

function adminConfigView(c) {
  const db = getDb();
  let host = '';
  try { const p = parseLink(c.link); host = `${p.address}:${p.port}`; } catch { /* stored links are validated */ }
  return {
    id: c.id, name: c.name, country: c.country, link: c.link, protocol: c.protocol, endpoint: host,
    enabled: !!c.enabled, priority: c.priority, scope: c.scope, server_id: c.server_id, subscription_id: c.subscription_id || null, source: c.source || 'manual',
    user_ids: db.prepare('SELECT user_id FROM config_users WHERE config_id=?').all(c.id).map((r) => r.user_id),
    group_ids: db.prepare('SELECT group_id FROM config_groups WHERE config_id=?').all(c.id).map((r) => r.group_id),
    created_at: c.created_at, updated_at: c.updated_at,
  };
}
function validateLinkOr400(link) {
  try { return parseLink(link); } catch (e) {
    if (e instanceof LinkError) throw new HttpError(400, 'INVALID_LINK', `لینک نامعتبر: ${e.message}`);
    throw e;
  }
}
function parseConfigBody(b, partial) {
  const opt = { optional: partial };
  return {
    name: v.str(b.name, 'نام', { max: 100, optional: true }),
    country: v.str(b.country, 'کشور', { max: 64, optional: true }),
    enabled: v.bool(b.enabled, 'وضعیت', { optional: true }),
    priority: v.int(b.priority, 'اولویت', { min: 0, max: 100000, optional: true }),
    scope: v.oneOf(b.scope, 'دامنه تخصیص', ['all', 'groups', 'users'], { optional: true }),
    server_id: b.server_id === null ? null : v.int(b.server_id, 'سرور', { min: 1, optional: true }),
    user_ids: v.ids(b.user_ids, 'کاربران', { optional: true }),
    group_ids: v.ids(b.group_ids, 'گروه‌ها', { optional: true }),
    link: partial ? (b.link === undefined ? undefined : v.str(b.link, 'لینک', { min: 10, max: 8192 })) : v.str(b.link, 'لینک', { min: 10, max: 8192 }),
    _opt: opt,
  };
}

// ================================================================= router
const r = new Router();

// Generated per-user subscription feed. The token is stored in the existing subscriptions.url.
r.get('/api/v1/subscriptions/:token', (ctx) => {
  const token = String(ctx.params.token || '');
  if (!/^[a-f0-9]{48}$/i.test(token)) throw new HttpError(404, 'NOT_FOUND', 'Subscription پیدا نشد');
  const sub = getDb().prepare('SELECT * FROM subscriptions WHERE url LIKE ? AND enabled=1').get(`%/api/v1/subscriptions/${token}`);
  if (!sub) throw new HttpError(404, 'NOT_FOUND', 'Subscription پیدا نشد');
  const links = getDb().prepare('SELECT link FROM configs WHERE subscription_id=? AND enabled=1 ORDER BY priority,id').all(sub.id).map((x) => x.link);
  ctx.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return Buffer.from(links.join('\n'), 'utf8').toString('base64');
});

r.get('/healthz', () => ({ ok: true, time: Date.now() }));

// ---------------------------------------------------------------- app API
r.post('/api/v1/auth/login', (ctx) => {
  const username = v.str(ctx.body.username, 'نام کاربری', { min: 1, max: 64 });
  const password = v.str(ctx.body.password, 'رمز عبور', { min: 1, max: 128 });
  const keys = loginGuard(ctx, 'user', username);
  const user = getDb().prepare('SELECT * FROM users WHERE username=?').get(username);
  const ok = sec.verifyPassword(password, user ? user.password_hash : sec.DUMMY_HASH);
  if (!user || !ok) {
    limiter.fail(keys);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور اشتباه است');
  }
  limiter.reset(keys);
  if (user.status === 'blocked') throw new HttpError(403, 'BLOCKED', STATUS_MESSAGES.BLOCKED);
  // single device: atomically bind this login as the only active session (BEGIN IMMEDIATE + PK on user_id)
  const issued = sessions.claim(user.id,
    (sid, tv) => sec.signToken({ sub: user.id, role: 'user', tv, sid }, settings.get('user_token_ttl_hours')),
    { ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
  if (!issued) {
    audit(`user:${user.username}`, 'user.login_rejected_active_device', null, null, ctx.ip);
    throw new HttpError(409, 'ALREADY_ACTIVE', 'این حساب در حال حاضر روی دستگاه دیگری فعال است. ابتدا از آن دستگاه خارج شوید');
  }
  getDb().prepare('UPDATE users SET last_login_at=?, last_seen_at=? WHERE id=?').run(Date.now(), Date.now(), user.id);
  return { token: issued.token, expires_at: issued.exp, account: accountView(user) };
});

// Release the device. Idempotent: an invalid/expired token simply gets { released: false }.
r.post('/api/v1/auth/logout', (ctx) => {
  const raw = bearer(ctx.req);
  const p = sec.verifyToken(raw);
  if (!p || p.role !== 'user') return { ok: true, released: false };
  const user = getDb().prepare('SELECT * FROM users WHERE id=?').get(p.sub);
  if (!user || user.token_version !== p.tv) return { ok: true, released: false };
  const released = sessions.release(user, p, raw);
  if (released) audit(`user:${user.username}`, 'user.logout', null, null, ctx.ip);
  return { ok: true, released };
});

r.get('/api/v1/account', requireUser, (ctx) => ({ account: accountView(ctx.user) }));
// No user/subscription id or URL from the client; ownership is resolved server-side.
r.post('/api/v1/subscriptions/refresh', requireUser, async (ctx) => {
  await userSubs.refreshUser(ctx.user.id, () => requireUser(ctx));
  return { ok: true };
});


r.get('/api/v1/usage', requireUser, (ctx) => {
  const a = accountView(ctx.user);
  return { used_bytes: a.used_bytes, upload_bytes: a.upload_bytes, download_bytes: a.download_bytes, quota_bytes: a.quota_bytes, remaining_bytes: a.remaining_bytes, synced_at: a.usage_synced_at };
});

r.get('/api/v1/configs', requireUser, (ctx) => {
  const account = accountView(ctx.user);
  if (account.status !== 'ACTIVE') throw new HttpError(403, account.status, account.status_message, { account });
  const list = allowedConfigs(ctx.user).map((c) => {
    const p = parseLink(c.link);
    return { id: c.id, name: c.name, country: c.country, protocol: c.protocol, priority: c.priority, outbound: p.outbound, updated_at: c.updated_at };
  });
  if (!list.length) throw new HttpError(404, 'NO_CONFIG', STATUS_MESSAGES.NO_CONFIG, { account });
  const version = list.map((c) => `${c.id}:${c.updated_at}`).join(',');
  return { account, configs: list, version: require('node:crypto').createHash('sha1').update(version).digest('hex'), sync_after_seconds: CONFIG_SYNC_SECONDS, subscription_usage: userSubs.usageFor(ctx.user.id), support_telegram: settings.get('support_telegram') };
});

r.post('/api/v1/events', requireUser, (ctx) => {
  const type = v.oneOf(ctx.body.type, 'نوع رویداد', ['connected', 'disconnected', 'failed']);
  const configId = v.int(ctx.body.config_id, 'کانفیگ', { min: 1, optional: true });
  if (type === 'connected') getDb().prepare('UPDATE users SET last_connect_at=? WHERE id=?').run(Date.now(), ctx.user.id);
  if (type === 'failed') audit(`user:${ctx.user.username}`, 'vpn.connect_failed', configId ? `config:${configId}` : null, { error: v.str(ctx.body.error, 'خطا', { max: 300, optional: true }) }, ctx.ip);
  return { ok: true };
});

// -------------------------------------------------------------- admin API
r.post('/api/admin/login', (ctx) => {
  const username = v.str(ctx.body.username, 'نام کاربری', { min: 1, max: 64 });
  const password = v.str(ctx.body.password, 'رمز عبور', { min: 1, max: 128 });
  const keys = loginGuard(ctx, 'admin', username);
  const admin = getDb().prepare('SELECT * FROM admins WHERE username=?').get(username);
  const ok = sec.verifyPassword(password, admin ? admin.password_hash : sec.DUMMY_HASH);
  if (!admin || !ok) {
    limiter.fail(keys);
    audit(`admin:${username}`, 'admin.login_failed', null, null, ctx.ip);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور اشتباه است');
  }
  limiter.reset(keys);
  const { token, exp } = sec.signToken({ sub: admin.id, role: 'admin', tv: admin.token_version }, settings.get('admin_token_ttl_hours'));
  audit(`admin:${admin.username}`, 'admin.login', null, null, ctx.ip);
  ctx.setHeader('Set-Cookie', cookieHeader(token, settings.get('admin_token_ttl_hours') * 3600));
  return { username: admin.username, expires_at: exp };
});
r.post('/api/admin/logout', requireAdmin, (ctx) => {
  // Revoke all admin sessions for this account.
  getDb().prepare('UPDATE admins SET token_version = token_version + 1 WHERE id=?').run(ctx.admin.id);
  ctx.setHeader('Set-Cookie', cookieHeader('', 0));
  return { ok: true };
});
r.get('/api/admin/me', requireAdmin, (ctx) => ({ username: ctx.admin.username }));
r.get('/api/admin/settings', requireAdmin, () => ({
  settings: settings.getAll(),
}));

r.put('/api/admin/settings', requireAdmin, (ctx) => {
  const allowed = [
    'user_token_ttl_hours',
    'admin_token_ttl_hours',
    'login_max_attempts',
    'login_window_minutes',
    'stats_interval_seconds',
    'subscription_refresh_minutes',
    'enforce_on_xui',
    'xui_allow_insecure_tls',
    'public_url',
    'default_quota_gb',
    'default_subscription_days',
    'sync_enabled',
    'support_telegram',
  ];

  const values = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(ctx.body, key)) {
      values[key] = ctx.body[key];
    }
  }

  try {
    const result = settings.update(values);
    audit(`admin:${ctx.admin.username}`, 'admin.settings_updated', null, {
      changed: result.changed,
    }, ctx.ip);
    return result;
  } catch (e) {
    throw new HttpError(400, 'VALIDATION', e.message);
  }
});

r.post('/api/admin/password', requireAdmin, (ctx) => {
  const cur = v.str(ctx.body.current_password, 'رمز فعلی', { min: 1, max: 128 });
  const next = v.str(ctx.body.new_password, 'رمز جدید', { min: 10, max: 128 });
  if (!sec.verifyPassword(cur, ctx.admin.password_hash)) throw new HttpError(400, 'INVALID_CREDENTIALS', 'رمز فعلی اشتباه است');
  getDb().prepare('UPDATE admins SET password_hash=?, token_version=token_version+1 WHERE id=?').run(sec.hashPassword(next), ctx.admin.id);
  audit(`admin:${ctx.admin.username}`, 'admin.password_changed', null, null, ctx.ip);
  ctx.setHeader('Set-Cookie', cookieHeader('', 0));
  return { ok: true };
});

r.get('/api/admin/dashboard', requireAdmin, () => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users').all();
  const counts = { total: users.length, ACTIVE: 0, BLOCKED: 0, EXPIRED: 0, QUOTA_EXCEEDED: 0, online: 0, connected_24h: 0 };
  let traffic = 0; const now = Date.now();
  for (const u of users) {
    const usage = getUsage(u.id); traffic += usage.used;
    counts[subscriptionStatus(u, usage)]++;
    if (u.last_seen_at && now - u.last_seen_at < 10 * 60000) counts.online++;
    if (u.last_connect_at && now - u.last_connect_at < 86400000) counts.connected_24h++;
  }
  const cfg = db.prepare('SELECT COUNT(*) total, SUM(enabled) enabled FROM configs').get();
  const servers = db.prepare('SELECT id,name,country,enabled,last_sync_at,last_sync_error FROM servers ORDER BY id').all();
  return { users: counts, total_traffic_bytes: traffic, configs: { total: cfg.total, enabled: cfg.enabled || 0 }, servers };
});

// ---- users
r.get('/api/admin/users', requireAdmin, (ctx) => {
  const q = (ctx.query.get('q') || '').trim();
  const rows = q
    ? getDb().prepare("SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' ORDER BY id DESC").all(...Array(2).fill(`%${q.replace(/[%_\\]/g, '\\$&')}%`))
    : getDb().prepare('SELECT * FROM users ORDER BY id DESC').all();
  return { users: rows.map(adminUserView) };
});
r.get('/api/admin/users/:id', requireAdmin, (ctx) => ({ user: adminUserView(getUserOr404(+ctx.params.id)) }));

function parseUserBody(b, partial) {
  const opt = { optional: partial };
  const out = {
    username: v.str(b.username, 'نام کاربری', { re: USERNAME_RE, ...opt }),
    password: v.str(b.password, 'رمز عبور', { min: 6, max: 128, ...opt }),
    status: v.oneOf(b.status, 'وضعیت', ['active', 'blocked'], { optional: true }),
    quota_gb: v.num(b.quota_gb, 'حجم (GB)', { min: 0, max: 1e6, optional: true }),
    expires_at: b.expires_at === null ? null : v.int(b.expires_at, 'تاریخ انقضا', { min: 0, optional: true }),
    days: v.int(b.days, 'تعداد روز', { min: 0, max: 36500, optional: true }),
    group_id: b.group_id === null ? null : v.int(b.group_id, 'گروه', { min: 1, optional: true }),
    xui_email: b.xui_email === null || b.xui_email === '' ? null : v.str(b.xui_email, 'ایمیل 3X-UI', { max: 128, re: /^[^\s/]+$/, optional: true }),
    note: v.str(b.note, 'یادداشت', { max: 500, optional: true }),
    config_ids: v.ids(b.config_ids, 'کانفیگ‌ها', { optional: true }),
    provision_server_id: b.provision_server_id == null || b.provision_server_id === '' ? null : v.int(b.provision_server_id, 'سرور Provisioning', { min: 1, optional: true }),
    provision_inbound_id: b.provision_inbound_id == null || b.provision_inbound_id === '' ? null : v.int(b.provision_inbound_id, 'Inbound Provisioning', { min: 1, optional: true }),
    auto_provision: v.bool(b.auto_provision, 'ساخت خودکار', { optional: true }),
  };
  if (out.group_id) checkIdsExist('groups', [out.group_id], 'گروه‌ها');
  checkIdsExist('configs', out.config_ids, 'کانفیگ‌ها');
  if (!partial && out.provision_server_id != null) {
    const server = getDb().prepare('SELECT * FROM servers WHERE id=? AND enabled=1').get(out.provision_server_id);
    if (!server) throw new HttpError(400, 'VALIDATION', 'سرور Provisioning معتبر یا فعال نیست');
    const targets = prov.provisionTargets(server);
    if (out.provision_inbound_id != null && !targets.includes(out.provision_inbound_id)) {
      throw new HttpError(400, 'VALIDATION', 'Inbound انتخاب‌شده برای این سرور مجاز نیست');
    }
  }
  return out;
}
function userAssignConfigs(userId, configIds) {
  const db = getDb();
  db.prepare('DELETE FROM config_users WHERE user_id=?').run(userId);
  const ins = db.prepare('INSERT INTO config_users(config_id,user_id) VALUES (?,?)');
  for (const c of configIds) ins.run(c, userId);
}

r.post('/api/admin/users', requireAdmin, async (ctx) => {
  const b = parseUserBody(ctx.body, false);
  if (getDb().prepare('SELECT 1 FROM users WHERE username=?').get(b.username)) throw new HttpError(409, 'DUPLICATE', 'این نام کاربری قبلاً ثبت شده است');
  const now = Date.now();

  const quotaGb = b.quota_gb !== undefined
    ? b.quota_gb
    : settings.get('default_quota_gb');

  let expires;
  if (b.expires_at !== undefined) {
    expires = b.expires_at;
  } else if (b.days !== undefined) {
    expires = b.days ? now + b.days * 86400000 : null;
  } else {
    const defaultDays = settings.get('default_subscription_days');
    expires = defaultDays ? now + defaultDays * 86400000 : null;
  }

  const id = tx((db) => {
    const res = db.prepare(`INSERT INTO users(username,password_hash,status,quota_bytes,expires_at,xui_email,group_id,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.username, sec.hashPassword(b.password), b.status || 'active', gbToBytes(quotaGb), expires, b.xui_email ?? null, b.group_id ?? null, b.note || '', now, now);
    const uid = Number(res.lastInsertRowid);
    if (b.config_ids) userAssignConfigs(uid, b.config_ids);
    return uid;
  });
  audit(`admin:${ctx.admin.username}`, 'user.create', `user:${id}`, { username: b.username }, ctx.ip);
  // Automatically create this user's clients on the selected 3X-UI inbounds (with quota + expiry).
  const provision = b.auto_provision === false
    ? { created: [], errors: [], skipped: true }
    : await prov.provisionUser(getUserOr404(id), {
      server_id: b.provision_server_id,
      inbound_id: b.provision_inbound_id,
    });
  ctx.status = 201;
  return { user: adminUserView(getUserOr404(id)), provision };
});

r.put('/api/admin/users/:id', requireAdmin, async (ctx) => {
  const u = getUserOr404(+ctx.params.id);
  const b = parseUserBody(ctx.body, true);
  const db = getDb();
  if (b.username && b.username.toLowerCase() !== u.username.toLowerCase() && db.prepare('SELECT 1 FROM users WHERE username=?').get(b.username)) throw new HttpError(409, 'DUPLICATE', 'این نام کاربری قبلاً ثبت شده است');
  const set = []; const vals = []; const changed = [];
  const put = (col, val) => { set.push(`${col}=?`); vals.push(val); changed.push(col); };
  if (b.username !== undefined) put('username', b.username);
  if (b.password !== undefined) { put('password_hash', sec.hashPassword(b.password)); set.push('token_version=token_version+1'); }
  if (b.status !== undefined) put('status', b.status);
  if (b.quota_gb !== undefined) put('quota_bytes', gbToBytes(b.quota_gb));
  if (b.expires_at !== undefined) put('expires_at', b.expires_at);
  else if (b.days !== undefined) put('expires_at', b.days ? Date.now() + b.days * 86400000 : null);
  if (b.group_id !== undefined) put('group_id', b.group_id);
  if (b.xui_email !== undefined) put('xui_email', b.xui_email);
  if (b.note !== undefined) put('note', b.note);
  tx(() => {
    if (set.length) db.prepare(`UPDATE users SET ${set.join(',')}, updated_at=? WHERE id=?`).run(...vals, Date.now(), u.id);
    if (b.config_ids) userAssignConfigs(u.id, b.config_ids);
  });
  audit(`admin:${ctx.admin.username}`, 'user.update', `user:${u.id}`, { fields: changed.concat(b.config_ids ? ['config_ids'] : []) }, ctx.ip);
  let xui_errors = [];
  if (changed.some((c) => ['status', 'quota_bytes', 'expires_at'].includes(c))) xui_errors = await prov.pushLimits(getUserOr404(u.id));
  return { user: adminUserView(getUserOr404(u.id)), xui_errors };
});

r.post('/api/admin/users/:id/renew', requireAdmin, async (ctx) => {
  const u = getUserOr404(+ctx.params.id);
  const addDays = v.int(ctx.body.add_days, 'روز اضافه', { min: 0, max: 36500, optional: true }) || 0;
  const addGb = v.num(ctx.body.add_gb, 'حجم اضافه', { min: 0, max: 1e6, optional: true }) || 0;
  const reset = v.bool(ctx.body.reset_usage, 'ریست مصرف', { optional: true }) || false;
  const now = Date.now();
  // Extend from expiry if still valid, otherwise from now.
  const expires = addDays ? Math.max(u.expires_at || now, now) + addDays * 86400000 : u.expires_at;
  tx((db) => {
    db.prepare('UPDATE users SET expires_at=?, quota_bytes=quota_bytes+?, updated_at=? WHERE id=?').run(expires, gbToBytes(addGb), now, u.id);
    if (reset) db.prepare('UPDATE user_server_usage SET base_up=up_bytes, base_down=down_bytes WHERE user_id=?').run(u.id);
  });
  audit(`admin:${ctx.admin.username}`, 'user.renew', `user:${u.id}`, { add_days: addDays, add_gb: addGb, reset_usage: reset }, ctx.ip);
  const xui_errors = [];
  if (reset) xui_errors.push(...await prov.resetTraffic(getUserOr404(u.id)));
  xui_errors.push(...await prov.pushLimits(getUserOr404(u.id)));
  return { user: adminUserView(getUserOr404(u.id)), xui_errors };
});

// Free a user's device slot (lost / reset phone). Their current token stops working.
r.post('/api/admin/users/:id/release-device', requireAdmin, (ctx) => {
  const u = getUserOr404(+ctx.params.id);
  const released = sessions.adminRelease(u.id);
  audit(`admin:${ctx.admin.username}`, 'user.release_device', `user:${u.id}`, { released }, ctx.ip);
  return { ok: true, released };
});

r.delete('/api/admin/users/:id', requireAdmin, async (ctx) => {
  const u = getUserOr404(+ctx.params.id);
  const cfgIds = prov.clientsOf(u.id).map((c) => c.config_id).filter(Boolean);
  const xui_errors = await prov.deprovisionUser(u.id);
  tx((db) => {
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    for (const cid of cfgIds) db.prepare('DELETE FROM configs WHERE id=?').run(cid); // per-user generated configs
  });
  audit(`admin:${ctx.admin.username}`, 'user.delete', `user:${u.id}`, { username: u.username, xui_errors: xui_errors.length }, ctx.ip);
  return { ok: true, xui_errors };
});

r.post('/api/admin/users/:id/provision', requireAdmin, async (ctx) => {
  const u = getUserOr404(+ctx.params.id);
  const provision = await prov.provisionUser(u);
  audit(`admin:${ctx.admin.username}`, 'user.provision', `user:${u.id}`, { created: provision.created.length, errors: provision.errors.length }, ctx.ip);
  return { user: adminUserView(getUserOr404(u.id)), provision };
});

// ---- groups
r.get('/api/admin/groups', requireAdmin, () => ({
  groups: getDb().prepare('SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id=g.id) AS user_count FROM groups g ORDER BY g.name').all(),
}));
r.post('/api/admin/groups', requireAdmin, (ctx) => {
  const name = v.str(ctx.body.name, 'نام گروه', { min: 1, max: 64 });
  if (getDb().prepare('SELECT 1 FROM groups WHERE name=?').get(name)) throw new HttpError(409, 'DUPLICATE', 'این گروه وجود دارد');
  const res = getDb().prepare('INSERT INTO groups(name,created_at) VALUES (?,?)').run(name, Date.now());
  audit(`admin:${ctx.admin.username}`, 'group.create', `group:${res.lastInsertRowid}`, { name }, ctx.ip);
  ctx.status = 201;
  return { group: getDb().prepare('SELECT * FROM groups WHERE id=?').get(res.lastInsertRowid) };
});
r.put('/api/admin/groups/:id', requireAdmin, (ctx) => {
  const name = v.str(ctx.body.name, 'نام گروه', { min: 1, max: 64 });
  const res = getDb().prepare('UPDATE groups SET name=? WHERE id=?').run(name, +ctx.params.id);
  if (!res.changes) throw new HttpError(404, 'NOT_FOUND', 'گروه پیدا نشد');
  audit(`admin:${ctx.admin.username}`, 'group.update', `group:${ctx.params.id}`, { name }, ctx.ip);
  return { ok: true };
});
r.delete('/api/admin/groups/:id', requireAdmin, (ctx) => {
  const res = getDb().prepare('DELETE FROM groups WHERE id=?').run(+ctx.params.id);
  if (!res.changes) throw new HttpError(404, 'NOT_FOUND', 'گروه پیدا نشد');
  audit(`admin:${ctx.admin.username}`, 'group.delete', `group:${ctx.params.id}`, null, ctx.ip);
  return { ok: true };
});

// ---- configs
r.get('/api/admin/configs', requireAdmin, () => ({ configs: getDb().prepare('SELECT * FROM configs ORDER BY priority, id').all().map(adminConfigView) }));

r.post('/api/admin/configs/validate', requireAdmin, (ctx) => {
  const p = validateLinkOr400(v.str(ctx.body.link, 'لینک', { min: 1, max: 8192 }));
  return { valid: true, ...describeLink(p) };
});

function insertConfig(db, b, parsed, now) {
  const res = db.prepare(`INSERT INTO configs(name,country,link,protocol,enabled,priority,scope,server_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.name || parsed.name || `${parsed.protocol}-${parsed.address}`, b.country || '', b.link, parsed.protocol,
    b.enabled === false ? 0 : 1, b.priority ?? 100, b.scope || 'users', b.server_id ?? null, now, now);
  const id = Number(res.lastInsertRowid);
  setConfigTargets(id, b.user_ids, b.group_ids);
  return id;
}

r.post('/api/admin/configs', requireAdmin, (ctx) => {
  const b = parseConfigBody(ctx.body, false);
  const parsed = validateLinkOr400(b.link);
  checkIdsExist('users', b.user_ids, 'کاربران'); checkIdsExist('groups', b.group_ids, 'گروه‌ها');
  if (b.server_id) checkIdsExist('servers', [b.server_id], 'سرورها');
  const id = tx((db) => insertConfig(db, b, parsed, Date.now()));
  audit(`admin:${ctx.admin.username}`, 'config.create', `config:${id}`, { protocol: parsed.protocol }, ctx.ip);
  ctx.status = 201;
  return { config: adminConfigView(getConfigOr404(id)) };
});

// Paste anything: vless:// vmess:// trojan:// ss:// links and/or https:// subscription URLs (mixed, one per line).
// Manual configs need NO panel API, credentials or token: only the link itself is stored.
r.post('/api/admin/configs/import', requireAdmin, async (ctx) => {
  const text = v.str(ctx.body.text, 'متن کانفیگ', { min: 1, max: 1024 * 512 });
  const save = ctx.body.save === true;
  const d = parseConfigBody({ ...ctx.body, link: 'placeholder-link' }, true);
  checkIdsExist('users', d.user_ids, 'کاربران'); checkIdsExist('groups', d.group_ids, 'گروه‌ها');
  const tokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 500) throw new HttpError(400, 'VALIDATION', 'حداکثر ۵۰۰ مورد در هر بار');
  const items = [];
  for (const [i, t] of tokens.entries()) {
    if (/^https?:\/\//i.test(t)) {
      let ok = false; let count = 0; let error = null;
      try { const u = new URL(t); ok = !!u.hostname; } catch { error = 'آدرس Subscription نامعتبر است'; }
      if (ok) {
        try {
          const { links, errors } = subs.parseBody(await subs.fetchText(t));
          count = links.length;
          if (!count) { ok = false; error = errors.length ? `هیچ لینک معتبری در Subscription نبود (${errors[0].error})` : 'Subscription خالی است'; }
        } catch (e) { ok = false; error = `دریافت Subscription ناموفق بود: ${e.message}`; }
      }
      items.push({ index: i + 1, kind: 'subscription', input: t, valid: ok, count, error });
    } else {
      try {
        const parsed = parseLink(t);
        items.push({ index: i + 1, kind: 'config', input: t.slice(0, 60), valid: true, details: describeLink(parsed), _link: t, _parsed: parsed });
      } catch (e) {
        items.push({ index: i + 1, kind: 'config', input: t.slice(0, 60), valid: false, error: e instanceof LinkError ? e.message : 'لینک نامعتبر است' });
      }
    }
  }
  const result = { items: items.map(({ _link, _parsed, ...rest }) => rest), saved: { configs: 0, subscriptions: 0 } };
  if (!save) return result;

  const valid = items.filter((x) => x.valid);
  if (!valid.length) throw new HttpError(400, 'INVALID_LINK', 'هیچ مورد معتبری برای ذخیره وجود ندارد', { items: result.items });
  const now = Date.now();
  const singleName = valid.length === 1 ? d.name : undefined;
  tx((db) => {
    valid.filter((x) => x.kind === 'config').forEach((x, k) => {
      insertConfig(db, { ...d, name: singleName, server_id: null, link: x._link, priority: (d.priority ?? 100) + k }, x._parsed, now);
      result.saved.configs++;
    });
  });
  for (const x of valid.filter((y) => y.kind === 'subscription')) {
    const host = (() => { try { return new URL(x.input).hostname; } catch { return 'sub'; } })();
    const res = getDb().prepare(`INSERT INTO subscriptions(name,url,country,priority,scope,user_ids,group_ids,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(singleName || `Subscription ${host}`, x.input, d.country || '', d.priority ?? 100, d.scope || 'users',
      JSON.stringify(d.user_ids || []), JSON.stringify(d.group_ids || []), d.enabled === false ? 0 : 1, now, now);
    await subs.refreshSubscription(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(Number(res.lastInsertRowid)));
    result.saved.subscriptions++;
  }
  audit(`admin:${ctx.admin.username}`, 'config.import', null, result.saved, ctx.ip);
  ctx.status = 201;
  return result;
});

r.post('/api/admin/configs/bulk', requireAdmin, (ctx) => {
  const raw = ctx.body.links;
  const links = (Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/)).map((s) => String(s).trim()).filter(Boolean);
  if (!links.length) throw new HttpError(400, 'VALIDATION', 'هیچ لینکی وارد نشده است');
  if (links.length > 500) throw new HttpError(400, 'VALIDATION', 'حداکثر ۵۰۰ لینک در هر بار');
  const d = parseConfigBody({ ...ctx.body, link: 'placeholder-link' }, true);
  checkIdsExist('users', d.user_ids, 'کاربران'); checkIdsExist('groups', d.group_ids, 'گروه‌ها');
  const errors = []; const valid = [];
  links.forEach((link, i) => {
    try { valid.push({ link, parsed: parseLink(link) }); } catch (e) { errors.push({ line: i + 1, link: link.slice(0, 60), error: e.message }); }
  });
  const atomic = ctx.body.atomic === true;
  if (atomic && errors.length) throw new HttpError(400, 'INVALID_LINK', 'برخی لینک‌ها نامعتبرند؛ هیچ موردی ثبت نشد', { errors });
  const now = Date.now();
  const ids = tx((db) => valid.map(({ link, parsed }, i) => insertConfig(db, { ...d, name: undefined, link, priority: (d.priority ?? 100) + i }, parsed, now)));
  audit(`admin:${ctx.admin.username}`, 'config.bulk_create', null, { created: ids.length, failed: errors.length }, ctx.ip);
  ctx.status = 201;
  return { created: ids.map((id) => adminConfigView(getConfigOr404(id))), errors };
});

r.put('/api/admin/configs/:id', requireAdmin, (ctx) => {
  const c = getConfigOr404(+ctx.params.id);
  const b = parseConfigBody(ctx.body, true);
  const set = []; const vals = [];
  const put = (col, val) => { set.push(`${col}=?`); vals.push(val); };
  if (b.link !== undefined) { const p = validateLinkOr400(b.link); put('link', b.link); put('protocol', p.protocol); }
  if (b.name !== undefined) put('name', b.name);
  if (b.country !== undefined) put('country', b.country);
  if (b.enabled !== undefined) put('enabled', b.enabled ? 1 : 0);
  if (b.priority !== undefined) put('priority', b.priority);
  if (b.scope !== undefined) put('scope', b.scope);
  if (b.server_id !== undefined) { if (b.server_id) checkIdsExist('servers', [b.server_id], 'سرورها'); put('server_id', b.server_id); }
  checkIdsExist('users', b.user_ids, 'کاربران'); checkIdsExist('groups', b.group_ids, 'گروه‌ها');
  tx((db) => {
    db.prepare(`UPDATE configs SET ${set.concat('updated_at=?').join(',')} WHERE id=?`).run(...vals, Date.now(), c.id);
    setConfigTargets(c.id, b.user_ids, b.group_ids);
  });
  audit(`admin:${ctx.admin.username}`, 'config.update', `config:${c.id}`, { fields: Object.keys(ctx.body) }, ctx.ip);
  return { config: adminConfigView(getConfigOr404(c.id)) };
});

r.delete('/api/admin/configs/:id', requireAdmin, (ctx) => {
  const c = getConfigOr404(+ctx.params.id);
  getDb().prepare('DELETE FROM configs WHERE id=?').run(c.id);
  audit(`admin:${ctx.admin.username}`, 'config.delete', `config:${c.id}`, { name: c.name }, ctx.ip);
  return { ok: true };
});

// ---- Subscription URLs (config source only)
const subView = (x) => ({ id: x.id, name: x.name, url: x.url, country: x.country, priority: x.priority, scope: x.scope,
  user_ids: JSON.parse(x.user_ids || '[]'), group_ids: JSON.parse(x.group_ids || '[]'), enabled: !!x.enabled,
  last_fetch_at: x.last_fetch_at, last_error: x.last_error, last_count: x.last_count,
  config_count: getDb().prepare('SELECT COUNT(*) n FROM configs WHERE subscription_id=?').get(x.id).n });
function parseSubBody(b, partial) {
  const opt = { optional: partial };
  const url = v.str(b.url, 'آدرس Subscription', { min: 8, max: 2000, ...opt });
  if (url !== undefined) { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { throw new HttpError(400, 'VALIDATION', 'آدرس Subscription باید http یا https باشد'); } }
  const out = {
    name: v.str(b.name, 'نام', { min: 1, max: 100, ...opt }), url,
    country: v.str(b.country, 'کشور', { max: 64, optional: true }),
    priority: v.int(b.priority, 'اولویت', { min: 0, max: 100000, optional: true }),
    scope: v.oneOf(b.scope, 'دامنه تخصیص', ['all', 'groups', 'users'], { optional: true }),
    user_ids: v.ids(b.user_ids, 'کاربران', { optional: true }), group_ids: v.ids(b.group_ids, 'گروه‌ها', { optional: true }),
    enabled: v.bool(b.enabled, 'وضعیت', { optional: true }),
  };
  checkIdsExist('users', out.user_ids, 'کاربران'); checkIdsExist('groups', out.group_ids, 'گروه‌ها');
  return out;
}
r.get('/api/admin/subscriptions', requireAdmin, () => ({ subscriptions: getDb().prepare('SELECT * FROM subscriptions ORDER BY id').all().map(subView) }));
r.post('/api/admin/subscriptions', requireAdmin, async (ctx) => {
  const b = parseSubBody(ctx.body, false); const now = Date.now();
  const res = getDb().prepare(`INSERT INTO subscriptions(name,url,country,priority,scope,user_ids,group_ids,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.name, b.url, b.country || '', b.priority ?? 100, b.scope || 'users', JSON.stringify(b.user_ids || []), JSON.stringify(b.group_ids || []), b.enabled === false ? 0 : 1, now, now);
  const id = Number(res.lastInsertRowid);
  audit(`admin:${ctx.admin.username}`, 'subscription.create', `subscription:${id}`, { name: b.name }, ctx.ip);
  const refresh = await subs.refreshSubscription(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(id));
  ctx.status = 201;
  return { subscription: subView(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(id)), refresh };
});
r.put('/api/admin/subscriptions/:id', requireAdmin, async (ctx) => {
  const x = getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(+ctx.params.id);
  if (!x) throw new HttpError(404, 'NOT_FOUND', 'Subscription پیدا نشد');
  const b = parseSubBody(ctx.body, true);
  const set = []; const vals = []; const put = (c, val) => { set.push(`${c}=?`); vals.push(val); };
  for (const k of ['name', 'url', 'country', 'priority', 'scope']) if (b[k] !== undefined) put(k, b[k]);
  if (b.user_ids !== undefined) put('user_ids', JSON.stringify(b.user_ids));
  if (b.group_ids !== undefined) put('group_ids', JSON.stringify(b.group_ids));
  if (b.enabled !== undefined) { put('enabled', b.enabled ? 1 : 0); getDb().prepare('UPDATE configs SET enabled=? WHERE subscription_id=?').run(b.enabled ? 1 : 0, x.id); }
  getDb().prepare(`UPDATE subscriptions SET ${set.concat('updated_at=?').join(',')} WHERE id=?`).run(...vals, Date.now(), x.id);
  audit(`admin:${ctx.admin.username}`, 'subscription.update', `subscription:${x.id}`, { fields: Object.keys(ctx.body) }, ctx.ip);
  const refresh = await subs.refreshSubscription(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(x.id));
  return { subscription: subView(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(x.id)), refresh };
});
r.post('/api/admin/subscriptions/:id/refresh', requireAdmin, async (ctx) => {
  const x = getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(+ctx.params.id);
  if (!x) throw new HttpError(404, 'NOT_FOUND', 'Subscription پیدا نشد');
  const refresh = await subs.refreshSubscription(x);
  return { subscription: subView(getDb().prepare('SELECT * FROM subscriptions WHERE id=?').get(x.id)), refresh };
});
r.delete('/api/admin/subscriptions/:id', requireAdmin, (ctx) => {
  const res = tx((db) => { db.prepare('DELETE FROM configs WHERE subscription_id=?').run(+ctx.params.id); return db.prepare('DELETE FROM subscriptions WHERE id=?').run(+ctx.params.id); });
  if (!res.changes) throw new HttpError(404, 'NOT_FOUND', 'Subscription پیدا نشد');
  audit(`admin:${ctx.admin.username}`, 'subscription.delete', `subscription:${ctx.params.id}`, null, ctx.ip);
  return { ok: true };
});

// ---- 3X-UI servers (stats source)
const serverView = (s) => ({ id: s.id, name: s.name, country: s.country, xui_url: s.xui_url, xui_username: s.xui_username, has_password: !!s.xui_password_enc, enabled: !!s.enabled, last_sync_at: s.last_sync_at, last_sync_error: s.last_sync_error,
  public_host: s.public_host || '', effective_host: prov.publicHost(s), provision_inbounds: prov.provisionTargets(s),
  client_count: getDb().prepare('SELECT COUNT(*) n FROM user_clients WHERE server_id=?').get(s.id).n });
function parseServerBody(b, partial) {
  const opt = { optional: partial };
  const url = v.str(b.xui_url, 'آدرس پنل 3X-UI', { max: 300, optional: true });
  if (url) { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { throw new HttpError(400, 'VALIDATION', 'آدرس پنل 3X-UI نامعتبر است'); } }
  return {
    name: v.str(b.name, 'نام سرور', { min: 1, max: 100, ...opt }),
    country: v.str(b.country, 'کشور', { max: 64, optional: true }),
    xui_url: url, xui_username: v.str(b.xui_username, 'نام کاربری 3X-UI', { max: 100, optional: true }),
    xui_password: v.str(b.xui_password, 'رمز 3X-UI', { max: 200, optional: true }),
    enabled: v.bool(b.enabled, 'وضعیت', { optional: true }),
    public_host: v.str(b.public_host, 'آدرس عمومی سرور', { max: 253, re: /^[a-zA-Z0-9.:\-\[\]]*$/, optional: true }),
    provision_inbounds: v.ids(b.provision_inbounds, 'inboundها', { optional: true }),
  };
}
r.get('/api/admin/servers', requireAdmin, () => ({ servers: getDb().prepare('SELECT * FROM servers ORDER BY id').all().map(serverView) }));
r.post('/api/admin/servers', requireAdmin, (ctx) => {
  const b = parseServerBody(ctx.body, false); const now = Date.now();
  const res = getDb().prepare('INSERT INTO servers(name,country,xui_url,xui_username,xui_password_enc,enabled,public_host,provision_inbounds,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.country || '', b.xui_url || '', b.xui_username || '', sec.encryptSecret(b.xui_password || ''), b.enabled === false ? 0 : 1, b.public_host || '', JSON.stringify(b.provision_inbounds || []), now, now);
  audit(`admin:${ctx.admin.username}`, 'server.create', `server:${res.lastInsertRowid}`, { name: b.name }, ctx.ip);
  ctx.status = 201;
  return { server: serverView(getDb().prepare('SELECT * FROM servers WHERE id=?').get(res.lastInsertRowid)) };
});
r.put('/api/admin/servers/:id', requireAdmin, (ctx) => {
  const s = getDb().prepare('SELECT * FROM servers WHERE id=?').get(+ctx.params.id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'سرور پیدا نشد');
  const b = parseServerBody(ctx.body, true);
  const set = []; const vals = [];
  const put = (c, val) => { set.push(`${c}=?`); vals.push(val); };
  if (b.name !== undefined) put('name', b.name);
  if (b.country !== undefined) put('country', b.country);
  if (b.xui_url !== undefined) put('xui_url', b.xui_url);
  if (b.xui_username !== undefined) put('xui_username', b.xui_username);
  if (b.xui_password) put('xui_password_enc', sec.encryptSecret(b.xui_password));
  if (b.enabled !== undefined) put('enabled', b.enabled ? 1 : 0);
  if (b.public_host !== undefined) put('public_host', b.public_host);
  if (b.provision_inbounds !== undefined) put('provision_inbounds', JSON.stringify(b.provision_inbounds));
  getDb().prepare(`UPDATE servers SET ${set.concat('updated_at=?').join(',')} WHERE id=?`).run(...vals, Date.now(), s.id);
  audit(`admin:${ctx.admin.username}`, 'server.update', `server:${s.id}`, { fields: Object.keys(ctx.body).filter((k) => k !== 'xui_password') }, ctx.ip);
  return { server: serverView(getDb().prepare('SELECT * FROM servers WHERE id=?').get(s.id)) };
});
r.delete('/api/admin/servers/:id', requireAdmin, (ctx) => {
  const res = getDb().prepare('DELETE FROM servers WHERE id=?').run(+ctx.params.id);
  if (!res.changes) throw new HttpError(404, 'NOT_FOUND', 'سرور پیدا نشد');
  audit(`admin:${ctx.admin.username}`, 'server.delete', `server:${ctx.params.id}`, null, ctx.ip);
  return { ok: true };
});
// Test the connection and list inbounds (to choose where user clients are created).
r.get('/api/admin/servers/:id/inbounds', requireAdmin, async (ctx) => {
  const s = getDb().prepare('SELECT * FROM servers WHERE id=?').get(+ctx.params.id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'سرور پیدا نشد');
  try {
    const x = prov.clientFor(s); await x.login();
    const list = await x.listInbounds();
    return { inbounds: list.map((i) => ({ id: i.id, remark: i.remark, protocol: i.protocol, port: i.port, enable: i.enable,
      network: i.streamSettings.network || 'tcp', security: i.streamSettings.security || 'none', clients: (i.settings.clients || []).length,
      supported: ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(i.protocol) })) };
  } catch (e) {
    throw new HttpError(502, 'XUI_ERROR', `اتصال به 3X-UI ناموفق بود: ${e.message}`);
  }
});
r.post('/api/admin/stats/sync', requireAdmin, async (ctx) => {
  const result = await stats.syncAll(() => {});
  audit(`admin:${ctx.admin.username}`, 'stats.manual_sync', null, result, ctx.ip);
  return result;
});

r.get('/api/admin/audit', requireAdmin, (ctx) => {
  const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 100));
  return { logs: getDb().prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) };
});

module.exports = { router: r, limiter };
