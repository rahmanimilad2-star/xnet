'use strict';
const { config } = require('./config');

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, path) {
    if (method === 'HEAD') method = 'GET';
    let pathMatched = false;
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return pathMatched ? 'METHOD' : null;
  }
}

const MAX_BODY = 1024 * 1024; // 1 MB
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve({});
    const ct = req.headers['content-type'] || '';
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
      req.resume();
      return reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'حجم درخواست بیش از حد مجاز است'));
    }
    let size = 0; let tooBig = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; } // keep draining, drop data
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'حجم درخواست بیش از حد مجاز است'));
      if (!chunks.length) return resolve({});
      if (!ct.includes('application/json')) return reject(new HttpError(415, 'UNSUPPORTED_MEDIA', 'Content-Type باید application/json باشد'));
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'BAD_JSON', 'JSON نامعتبر است')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  }
  return req.socket.remoteAddress || '';
}

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- input validation helpers ----
const v = {
  str(val, name, { min = 0, max = 255, re, optional } = {}) {
    if (val === undefined || val === null) { if (optional) return undefined; throw new HttpError(400, 'VALIDATION', `${name} الزامی است`); }
    if (typeof val !== 'string') throw new HttpError(400, 'VALIDATION', `${name} باید متن باشد`);
    const s = val.trim();
    if (s.length < min || s.length > max) throw new HttpError(400, 'VALIDATION', `طول ${name} باید بین ${min} و ${max} باشد`);
    if (re && !re.test(s)) throw new HttpError(400, 'VALIDATION', `${name} نامعتبر است`);
    return s;
  },
  int(val, name, { min = -Infinity, max = Infinity, optional } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return undefined; throw new HttpError(400, 'VALIDATION', `${name} الزامی است`); }
    const n = Number(val);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new HttpError(400, 'VALIDATION', `${name} نامعتبر است`);
    return n;
  },
  num(val, name, { min = -Infinity, max = Infinity, optional } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return undefined; throw new HttpError(400, 'VALIDATION', `${name} الزامی است`); }
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'VALIDATION', `${name} نامعتبر است`);
    return n;
  },
  bool(val, name, { optional } = {}) {
    if (val === undefined || val === null) { if (optional) return undefined; throw new HttpError(400, 'VALIDATION', `${name} الزامی است`); }
    if (typeof val !== 'boolean') throw new HttpError(400, 'VALIDATION', `${name} باید true/false باشد`);
    return val;
  },
  ids(val, name, { optional } = {}) {
    if (val === undefined || val === null) { if (optional) return undefined; return []; }
    if (!Array.isArray(val) || val.length > 10000 || !val.every((x) => Number.isInteger(x) && x > 0)) throw new HttpError(400, 'VALIDATION', `${name} باید آرایه‌ای از شناسه‌ها باشد`);
    return [...new Set(val)];
  },
  oneOf(val, name, list, { optional } = {}) {
    if (val === undefined || val === null) { if (optional) return undefined; throw new HttpError(400, 'VALIDATION', `${name} الزامی است`); }
    if (!list.includes(val)) throw new HttpError(400, 'VALIDATION', `${name} باید یکی از ${list.join(', ')} باشد`);
    return val;
  },
};
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

module.exports = { HttpError, Router, readJson, clientIp, send, parseCookies, v, USERNAME_RE, SEC_HEADERS };
