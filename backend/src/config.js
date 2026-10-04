'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependency). Real env vars take precedence.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv(process.env.ENV_FILE || path.join(__dirname, '..', '.env'));

const env = process.env;
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const config = {
  env: env.NODE_ENV || 'development',
  host: env.HOST || '127.0.0.1',
  port: num(env.PORT, 8080),
  publicUrl: env.PUBLIC_URL || '',
  trustProxy: bool(env.TRUST_PROXY, false),
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data.db'),
  jwtSecret: env.JWT_SECRET || '',
  dataEncKey: env.DATA_ENC_KEY || '',
  userTokenTtlH: num(env.USER_TOKEN_TTL_HOURS, 720),
  adminTokenTtlH: num(env.ADMIN_TOKEN_TTL_HOURS, 12),
  loginMaxAttempts: num(env.LOGIN_MAX_ATTEMPTS, 5),
  loginWindowMin: num(env.LOGIN_WINDOW_MINUTES, 15),
  statsIntervalS: num(env.STATS_INTERVAL_SECONDS, 30),
  enforceOnXui: bool(env.ENFORCE_ON_XUI, true),
  subRefreshMin: num(env.SUBSCRIPTION_REFRESH_MINUTES, 60),
  xuiInsecureTls: bool(env.XUI_ALLOW_INSECURE_TLS, false),
};

function validateConfig() {
  const bad = (s) => !s || s.startsWith('change_me') || s.length < 32;
  if (bad(config.jwtSecret)) throw new Error('JWT_SECRET is missing/weak. Generate with: openssl rand -hex 32');
  if (!/^[0-9a-fA-F]{64}$/.test(config.dataEncKey)) throw new Error('DATA_ENC_KEY must be 64 hex chars. Generate with: openssl rand -hex 32');
}

module.exports = { config, validateConfig };
