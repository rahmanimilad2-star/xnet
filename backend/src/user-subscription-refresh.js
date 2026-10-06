'use strict';
const { getDb, tx } = require('./db');
const { HttpError } = require('./http');
const subs = require('./subscriptions');

// Sharing/access to configs is NOT ownership of private traffic or subscription tokens.
// Only enabled subscriptions explicitly assigned to exactly this user may be fetched here.
function owned(userId) {
  return getDb().prepare("SELECT * FROM subscriptions WHERE enabled=1 AND scope='users' ORDER BY id").all()
    .filter((s) => {
      try {
        const ids = JSON.parse(s.user_ids);
        return Array.isArray(ids) && ids.length === 1 && Number(ids[0]) === userId;
      } catch { return false; }
    });
}

function parseUserinfo(header) {
  if (typeof header !== 'string' || !header.trim()) throw new Error('missing userinfo');
  const fields = {};
  for (const part of header.split(';')) {
    const m = part.trim().match(/^([a-z]+)\s*=\s*(\d+)$/i);
    if (!m) throw new Error('invalid userinfo');
    const key = m[1].toLowerCase();
    if (!['upload', 'download', 'total', 'expire'].includes(key) || key in fields) throw new Error('invalid userinfo');
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n)) throw new Error('invalid userinfo');
    fields[key] = n;
  }
  if (!['upload', 'download', 'total', 'expire'].every((k) => k in fields) ||
      !Number.isSafeInteger(fields.upload + fields.download) ||
      !Number.isSafeInteger(fields.expire * 1000)) throw new Error('incomplete userinfo');
  return fields;
}

function usageFor(userId) {
  const query = getDb().prepare('SELECT * FROM subscription_userinfo WHERE subscription_id=? AND user_id=?');
  return owned(userId).flatMap((s) => {
    const row = query.get(s.id, userId);
    return row ? [{
      id: s.id, name: s.name, upload_bytes: row.upload_bytes, download_bytes: row.download_bytes,
      total_bytes: row.total_bytes, expire_at: row.expire_at === 0 ? null : row.expire_at, updated_at: row.updated_at,
    }] : [];
  });
}

const inFlight = new Set();
async function refreshUser(userId, reauthorize) {
  if (inFlight.has(userId)) throw new HttpError(409, 'REFRESH_IN_PROGRESS', 'بروزرسانی اشتراک در حال انجام است.');
  const selected = owned(userId);
  if (!selected.length) throw new HttpError(404, 'NO_USER_SUBSCRIPTION', 'اشتراک اختصاصی فعالی برای این حساب وجود ندارد.');
  inFlight.add(userId);
  try {
    // Stage every response first. Invalid/missing headers or bodies leave the previous data intact.
    const fetched = await Promise.all(selected.map(async (s) => {
      let response;
      try { response = await subs.fetchText(s.url, 3, true); }
      catch { throw new HttpError(502, 'SUBSCRIPTION_REFRESH_FAILED', 'دریافت اشتراک انجام نشد؛ دوباره تلاش کنید.'); }
      let info;
      try { info = parseUserinfo(response.userinfo); }
      catch { throw new HttpError(502, 'SUBSCRIPTION_USERINFO_INVALID', 'اطلاعات مصرف اشتراک موجود نیست یا ناقص است.'); }
      if (!subs.parseBody(response.body).links.length) {
        throw new HttpError(502, 'SUBSCRIPTION_REFRESH_FAILED', 'پاسخ اشتراک کانفیگ معتبری ندارد.');
      }
      return { s, response, info };
    }));
    reauthorize(); // logout/reset during upstream HTTP must not authorize a late write
    const stillOwned = owned(userId);
    if (selected.some((s) => !stillOwned.some((n) => n.id === s.id && n.url === s.url && n.user_ids === s.user_ids))) {
      throw new HttpError(409, 'SUBSCRIPTION_CHANGED', 'اشتراک تغییر کرده است؛ دوباره تلاش کنید.');
    }
    // Reuse the existing config refresh, with the already fetched body (no second upstream request).
    for (const { s, response } of fetched) {
      const result = await subs.refreshSubscription(s, async () => response.body);
      if (!result.ok) throw new HttpError(502, 'SUBSCRIPTION_REFRESH_FAILED', 'بروزرسانی اشتراک انجام نشد؛ دوباره تلاش کنید.');
    }
    reauthorize();
    tx((db) => {
      const save = db.prepare(`INSERT INTO subscription_userinfo
        (subscription_id,user_id,upload_bytes,download_bytes,total_bytes,expire_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET
        user_id=excluded.user_id,
        upload_bytes=excluded.upload_bytes,download_bytes=excluded.download_bytes,
        total_bytes=excluded.total_bytes,expire_at=excluded.expire_at,updated_at=excluded.updated_at`);
      for (const { s, info } of fetched) save.run(s.id, userId, info.upload, info.download, info.total, info.expire * 1000, Date.now());
    });
    return { ok: true };
  } finally { inFlight.delete(userId); }
}

module.exports = { refreshUser, usageFor, parseUserinfo };
