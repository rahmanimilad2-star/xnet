'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, readJson, clientIp, send, SEC_HEADERS } = require('./http');
const { router } = require('./routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
  fs.createReadStream(file).pipe(res);
  return true;
}

function createServer({ log = console.log } = {}) {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://local');
    const ctx = { req, res, ip: clientIp(req), query: url.searchParams, params: {}, body: {}, status: 200, headers: {}, setHeader(k, val) { this.headers[k] = val; } };
    try {
      const m = router.match(req.method, url.pathname);
      if (m === 'METHOD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'متد مجاز نیست');
      if (!m) {
        if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/') && serveStatic(req, res, url.pathname)) return;
        throw new HttpError(404, 'NOT_FOUND', 'مسیر پیدا نشد');
      }
      ctx.params = m.params;
      ctx.body = await readJson(req);
      let out;
      for (const h of m.handlers) { out = await h(ctx); }
      send(res, ctx.status, out ?? { ok: true }, ctx.headers);
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, e.status, { error: { code: e.code, message: e.message, ...(e.extra || {}) } }, ctx.headers);
      } else {
        log(`[error] ${req.method} ${url.pathname}: ${e.stack || e}`);
        send(res, 500, { error: { code: 'INTERNAL', message: 'خطای داخلی سرور' } });
      }
    } finally {
      if (url.pathname.startsWith('/api/')) log(`${new Date().toISOString()} ${ctx.ip} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}

module.exports = { createServer };
