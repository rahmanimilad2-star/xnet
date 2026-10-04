'use strict';
const { getDb } = require('./db');

const GB = 1024 ** 3;

function getUsage(userId) {
  const db = getDb();
  const a = db.prepare(`SELECT COALESCE(SUM(MAX(up_bytes - base_up, 0)),0) AS up,
       COALESCE(SUM(MAX(down_bytes - base_down, 0)),0) AS down, MAX(updated_at) AS synced_at
     FROM user_server_usage WHERE user_id = ?`).get(userId);
  const b = db.prepare(`SELECT COALESCE(SUM(MAX(up_bytes - base_up, 0)),0) AS up,
       COALESCE(SUM(MAX(down_bytes - base_down, 0)),0) AS down, MAX(synced_at) AS synced_at,
       COALESCE(SUM(rate_up),0) AS rate_up, COALESCE(SUM(rate_down),0) AS rate_down
     FROM user_clients WHERE user_id = ?`).get(userId);
  const up = Number(a.up) + Number(b.up);
  const down = Number(a.down) + Number(b.down);
  return {
    up, down, used: up + down,
    synced_at: Math.max(a.synced_at || 0, b.synced_at || 0) || null,
    rate_up: Number(b.rate_up), rate_down: Number(b.rate_down),
  };
}

function subscriptionStatus(user, usage, now = Date.now()) {
  if (user.status === 'blocked') return 'BLOCKED';
  if (user.expires_at && user.expires_at <= now) return 'EXPIRED';
  if (user.quota_bytes > 0 && usage.used >= user.quota_bytes) return 'QUOTA_EXCEEDED';
  return 'ACTIVE';
}

const STATUS_MESSAGES = {
  ACTIVE: 'اشتراک فعال است',
  BLOCKED: 'حساب شما مسدود شده است. با پشتیبانی تماس بگیرید.',
  EXPIRED: 'اعتبار اشتراک شما به پایان رسیده است.',
  QUOTA_EXCEEDED: 'حجم اشتراک شما تمام شده است.',
  NO_CONFIG: 'در حال حاضر سرور فعالی برای حساب شما تعریف نشده است.',
};

/** True only if this user's traffic is actually measured somewhere (auto-provisioned 3X-UI clients or a mapped client email). */
function usageKnown(user) {
  if (user.xui_email) return true;
  return !!getDb().prepare('SELECT 1 FROM user_clients WHERE user_id=? LIMIT 1').get(user.id);
}

function accountView(user) {
  const usage = getUsage(user.id);
  const known = usageKnown(user);
  const status = subscriptionStatus(user, usage);
  const now = Date.now();
  return {
    id: user.id,
    username: user.username,
    status,
    status_message: STATUS_MESSAGES[status],
    quota_bytes: user.quota_bytes,
    unlimited: user.quota_bytes === 0,
    // false for users who only have manual / subscription configs: the app shows «حجم نامشخص» and connecting stays allowed
    usage_known: known,
    used_bytes: usage.used,
    upload_bytes: usage.up,
    download_bytes: usage.down,
    remaining_bytes: user.quota_bytes === 0 ? null : Math.max(0, user.quota_bytes - usage.used),
    expires_at: user.expires_at,
    days_left: user.expires_at ? Math.max(0, Math.ceil((user.expires_at - now) / 86400000)) : null,
    usage_synced_at: usage.synced_at,
    rate_up_bps: usage.rate_up,
    rate_down_bps: usage.rate_down,
    last_connect_at: user.last_connect_at,
  };
}

function allowedConfigs(user) {
  return getDb().prepare(`
    SELECT c.* FROM configs c
    WHERE c.enabled = 1 AND (
      c.scope = 'all'
      OR (c.scope = 'users'  AND EXISTS (SELECT 1 FROM config_users cu WHERE cu.config_id = c.id AND cu.user_id = ?))
      OR (c.scope = 'groups' AND ? IS NOT NULL AND EXISTS (SELECT 1 FROM config_groups cg WHERE cg.config_id = c.id AND cg.group_id = ?))
    )
    ORDER BY c.priority ASC, c.id ASC`).all(user.id, user.group_id, user.group_id);
}

function audit(actor, action, target, details, ip) {
  getDb().prepare('INSERT INTO audit_logs(actor,action,target,details,ip,created_at) VALUES (?,?,?,?,?,?)')
    .run(String(actor), action, target == null ? null : String(target), details ? JSON.stringify(details) : null, ip || null, Date.now());
}

module.exports = { GB, usageKnown, getUsage, subscriptionStatus, accountView, allowedConfigs, audit, STATUS_MESSAGES };
