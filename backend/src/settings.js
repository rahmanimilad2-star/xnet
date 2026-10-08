'use strict';

const { getDb } = require('./db');
const { config } = require('./config');

const DEFAULTS = Object.freeze({
  user_token_ttl_hours: 720,
  admin_token_ttl_hours: 12,
  login_max_attempts: 5,
  login_window_minutes: 15,
  stats_interval_seconds: 30,
  subscription_refresh_minutes: 60,
  enforce_on_xui: true,
  xui_allow_insecure_tls: false,
  public_url: config.publicUrl || '',
  default_quota_gb: 0,
  default_subscription_days: 0,
  sync_enabled: true,
  support_telegram: '@Xnetservice2',
});

const BOOLEAN_KEYS = new Set([
  'enforce_on_xui',
  'xui_allow_insecure_tls',
  'sync_enabled',
]);

const NUMBER_RULES = {
  user_token_ttl_hours: [1, 87600],
  admin_token_ttl_hours: [1, 87600],
  login_max_attempts: [1, 1000],
  login_window_minutes: [1, 1440],
  stats_interval_seconds: [5, 86400],
  subscription_refresh_minutes: [1, 43200],
  default_quota_gb: [0, 1000000],
  default_subscription_days: [0, 36500],
};

function ensureTable(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES (?,?,?)'
  );

  for (const [key, value] of Object.entries(DEFAULTS)) {
    insert.run(key, encode(value), now);
  }
}

function encode(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}

function decode(key, value) {
  if (BOOLEAN_KEYS.has(key)) return /^(1|true|yes|on)$/i.test(String(value));
  if (Object.prototype.hasOwnProperty.call(NUMBER_RULES, key)) return Number(value);
  return String(value ?? '');
}

function getAll() {
  ensureTable();
  const rows = getDb().prepare('SELECT key,value FROM settings ORDER BY key').all();
  const out = { ...DEFAULTS };
  for (const row of rows) out[row.key] = decode(row.key, row.value);
  return out;
}

function get(key) {
  return getAll()[key];
}

function validate(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error(`Unknown setting: ${key}`);
  }

  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== 'boolean') throw new Error(`Invalid boolean setting: ${key}`);
    return value;
  }

  if (Object.prototype.hasOwnProperty.call(NUMBER_RULES, key)) {
    const n = Number(value);
    const [min, max] = NUMBER_RULES[key];
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`Invalid numeric setting: ${key}`);
    }
    return n;
  }

  if (key === 'public_url') {
    const s = String(value ?? '').trim();
    if (s.length > 2048) throw new Error('public_url is too long');
    if (s && !/^https?:\/\/[^\s]+$/i.test(s)) {
      throw new Error('public_url must be a valid http/https URL');
    }
    return s.replace(/\/+$/, '');
  }

  if (key === 'support_telegram') {
    const s = String(value ?? '').trim();
    if (s.length > 128) throw new Error('support_telegram is too long');
    if (!s) throw new Error('support_telegram cannot be empty');
    return s.startsWith('@') ? s : `@${s}`;
  }

  throw new Error(`Unsupported setting: ${key}`);
}

function update(values) {
  ensureTable();
  const db = getDb();
  const now = Date.now();
  const put = db.prepare(
    'INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at'
  );

  const changed = [];

  db.exec('BEGIN');
  try {
    for (const [key, raw] of Object.entries(values || {})) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
      const value = validate(key, raw);
      put.run(key, encode(value), now);
      changed.push(key);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { settings: getAll(), changed };
}

module.exports = {
  DEFAULTS,
  ensureTable,
  get,
  getAll,
  update,
};
