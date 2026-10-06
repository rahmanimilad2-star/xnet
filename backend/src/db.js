'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- پنل‌های 3X-UI (فقط برای خواندن آمار مصرف و اعمال محدودیت)
CREATE TABLE IF NOT EXISTS servers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  country          TEXT NOT NULL DEFAULT '',
  xui_url          TEXT NOT NULL DEFAULT '',   -- e.g. https://1.2.3.4:2053/secretpath
  xui_username     TEXT NOT NULL DEFAULT '',
  xui_password_enc TEXT NOT NULL DEFAULT '',   -- AES-256-GCM
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_sync_at     INTEGER,
  last_sync_error  TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  quota_bytes     INTEGER NOT NULL DEFAULT 0,      -- 0 = نامحدود
  expires_at      INTEGER,                         -- epoch ms, NULL = بدون انقضا
  xui_email       TEXT,                            -- email کلاینت در 3X-UI برای آمار واقعی
  group_id        INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  note            TEXT NOT NULL DEFAULT '',
  token_version   INTEGER NOT NULL DEFAULT 0,
  last_login_at   INTEGER,
  last_connect_at INTEGER,
  last_seen_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);

-- مصرف واقعی هر کاربر روی هر سرور (آخرین مقدار خوانده‌شده از 3X-UI)
CREATE TABLE IF NOT EXISTS user_server_usage (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  up_bytes    INTEGER NOT NULL DEFAULT 0,
  down_bytes  INTEGER NOT NULL DEFAULT 0,
  -- مقدار پایه هنگام ریست مصرف (مصرف موثر = خام - پایه)
  base_up     INTEGER NOT NULL DEFAULT 0,
  base_down   INTEGER NOT NULL DEFAULT 0,
  disabled_on_xui INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, server_id)
);

CREATE TABLE IF NOT EXISTS configs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  country    TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL,
  protocol   TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  priority   INTEGER NOT NULL DEFAULT 100,   -- عدد کمتر = اولویت بالاتر
  scope      TEXT NOT NULL DEFAULT 'users' CHECK (scope IN ('all','groups','users')),
  server_id  INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config_users (
  config_id INTEGER NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (config_id, user_id)
);
CREATE TABLE IF NOT EXISTS config_groups (
  config_id INTEGER NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (config_id, group_id)
);

-- کلاینت‌هایی که پنل به‌صورت خودکار برای هر کاربر در 3X-UI ساخته است
CREATE TABLE IF NOT EXISTS user_clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inbound_id  INTEGER NOT NULL,
  protocol    TEXT NOT NULL,
  email       TEXT NOT NULL,          -- یکتا در کل پنل 3X-UI
  client_key  TEXT NOT NULL,          -- uuid (vless/vmess) یا password (trojan/ss)
  config_id   INTEGER REFERENCES configs(id) ON DELETE SET NULL,
  up_bytes    INTEGER NOT NULL DEFAULT 0,
  down_bytes  INTEGER NOT NULL DEFAULT 0,
  base_up     INTEGER NOT NULL DEFAULT 0,
  base_down   INTEGER NOT NULL DEFAULT 0,
  rate_up     INTEGER NOT NULL DEFAULT 0,   -- بایت بر ثانیه (از اختلاف دو همگام‌سازی)
  rate_down   INTEGER NOT NULL DEFAULT 0,
  enabled_on_xui INTEGER NOT NULL DEFAULT 1,
  last_error  TEXT,
  synced_at   INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (server_id, email)
);
CREATE INDEX IF NOT EXISTS idx_user_clients_user ON user_clients(user_id);

-- Subscription URLs (e.g. from 3X-UI's subscription server): only a SOURCE of config links
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  country      TEXT NOT NULL DEFAULT '',
  priority     INTEGER NOT NULL DEFAULT 100,
  scope        TEXT NOT NULL DEFAULT 'users' CHECK (scope IN ('all','groups','users')),
  user_ids     TEXT NOT NULL DEFAULT '[]',
  group_ids    TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_fetch_at INTEGER,
  last_error   TEXT,
  last_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- One active app session per user (single device). Only a SHA-256 of the session id is stored.
CREATE TABLE IF NOT EXISTS user_sessions (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sid_hash      TEXT NOT NULL,
  token_version INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER,
  ip            TEXT,
  user_agent    TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  details    TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
`;

// v2: auto-provisioning of 3X-UI clients
function migrate(d) {
  const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const sc = cols('servers');
  if (!sc.includes('public_host')) d.exec("ALTER TABLE servers ADD COLUMN public_host TEXT NOT NULL DEFAULT ''");
  if (!sc.includes('provision_inbounds')) d.exec("ALTER TABLE servers ADD COLUMN provision_inbounds TEXT NOT NULL DEFAULT '[]'");
  const cc = cols('configs');
  if (!cc.includes('subscription_id')) d.exec('ALTER TABLE configs ADD COLUMN subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE');
  // where a config came from: manual (pasted, no panel API at all) | subscription | xui (auto-provisioned)
  if (!cc.includes('source')) {
    d.exec("ALTER TABLE configs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
    d.exec("UPDATE configs SET source='subscription' WHERE subscription_id IS NOT NULL");
    d.exec("UPDATE configs SET source='xui' WHERE id IN (SELECT config_id FROM user_clients WHERE config_id IS NOT NULL)");
  }
  const uc = cols('users');
  if (!uc.includes('provision_error')) d.exec('ALTER TABLE users ADD COLUMN provision_error TEXT');
  d.prepare('UPDATE schema_version SET version = 4 WHERE version < 4').run();
  // v5: user_sessions (created by SCHEMA above, CREATE TABLE IF NOT EXISTS)
  d.prepare('UPDATE schema_version SET version = 5 WHERE version < 5').run();

  // v6: runtime-editable admin settings
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  d.prepare('UPDATE schema_version SET version = 6 WHERE version < 6').run();
  // Private subscription traffic headers, separate from XUI/account traffic (no double counting).
  d.exec(`CREATE TABLE IF NOT EXISTS subscription_userinfo (
    subscription_id INTEGER PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    upload_bytes INTEGER NOT NULL,
    download_bytes INTEGER NOT NULL,
    total_bytes INTEGER NOT NULL,
    expire_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  d.prepare('UPDATE schema_version SET version = 7 WHERE version < 7').run();
}

let db;
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;'); // wait for a concurrent writer instead of failing
  db.exec(SCHEMA);
  const v = db.prepare('SELECT version FROM schema_version').get();
  if (!v) db.prepare('INSERT INTO schema_version(version) VALUES (1)').run();
  migrate(db);
  return db;
}
function getDb() { if (!db) throw new Error('DB not opened'); return db; }

function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try { const r = fn(d); d.exec('COMMIT'); return r; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

module.exports = { openDb, getDb, tx, SCHEMA };
