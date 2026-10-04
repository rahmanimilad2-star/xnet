-- Generated from backend/src/db.js (SQLite)
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
