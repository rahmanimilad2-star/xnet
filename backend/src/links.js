'use strict';
// Parse & validate VLESS / VMess / Trojan / Shadowsocks share links and
// convert them into an Xray-core outbound object (tag: "proxy").

class LinkError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const SS_METHODS = new Set([
  'aes-128-gcm', 'aes-256-gcm', 'chacha20-poly1305', 'chacha20-ietf-poly1305',
  'xchacha20-poly1305', 'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305', 'none', 'plain',
]);
const NETWORKS = new Set(['tcp', 'raw', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'splithttp']);

function b64decode(s) {
  let t = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) throw new LinkError('base64 نامعتبر است');
  return Buffer.from(t, 'base64').toString('utf8');
}
function checkHost(h) {
  const host = String(h || '').replace(/^\[|\]$/g, '');
  if (!host) throw new LinkError('آدرس سرور خالی است');
  const isV6 = host.includes(':');
  if (!isV6 && !IPV4_RE.test(host) && !HOST_RE.test(host)) throw new LinkError(`آدرس سرور نامعتبر است: ${host}`);
  return host;
}
function checkPort(p) {
  const n = Number(p);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new LinkError(`پورت نامعتبر است: ${p}`);
  return n;
}
function decodeName(hash) {
  if (!hash) return '';
  try { return decodeURIComponent(hash.replace(/^#/, '')); } catch { return hash.replace(/^#/, ''); }
}

function buildStream(o) {
  let network = (o.type || 'tcp').toLowerCase();
  if (network === 'raw') network = 'tcp';
  if (network === 'splithttp') network = 'xhttp';
  if (!NETWORKS.has(network)) throw new LinkError(`نوع انتقال پشتیبانی نمی‌شود: ${network}`);
  const security = (o.security || 'none').toLowerCase();
  if (!['none', 'tls', 'reality', ''].includes(security)) throw new LinkError(`نوع امنیت پشتیبانی نمی‌شود: ${security}`);

  const s = { network, security: security || 'none' };
  const path = o.path || (network === 'grpc' ? '' : '/');
  const host = o.host || '';

  if (network === 'tcp' && (o.headerType || '').toLowerCase() === 'http') {
    s.tcpSettings = { header: { type: 'http', request: { path: path.split(','), headers: host ? { Host: host.split(',') } : {} } } };
  } else if (network === 'ws') {
    s.wsSettings = { path, ...(host ? { host } : {}) };
  } else if (network === 'grpc') {
    s.grpcSettings = { serviceName: o.serviceName || o.path || '', multiMode: (o.mode || '') === 'multi', ...(o.authority ? { authority: o.authority } : {}) };
  } else if (network === 'httpupgrade') {
    s.httpupgradeSettings = { path, ...(host ? { host } : {}) };
  } else if (network === 'xhttp') {
    s.xhttpSettings = { path, ...(host ? { host } : {}), mode: o.mode || 'auto' };
  }

  if (s.security === 'tls') {
    s.tlsSettings = {
      serverName: o.sni || host || '',
      ...(o.fp ? { fingerprint: o.fp } : {}),
      ...(o.alpn ? { alpn: o.alpn.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
      allowInsecure: o.allowInsecure === '1' || o.allowInsecure === 'true',
    };
  } else if (s.security === 'reality') {
    if (!o.pbk) throw new LinkError('برای REALITY پارامتر pbk (کلید عمومی) لازم است');
    s.realitySettings = {
      serverName: o.sni || '',
      fingerprint: o.fp || 'chrome',
      publicKey: o.pbk,
      shortId: o.sid || '',
      spiderX: o.spx || '',
    };
  }
  return s;
}

function parseUrlLike(link) {
  let u;
  try { u = new URL(link); } catch { throw new LinkError('ساختار لینک نامعتبر است'); }
  const q = Object.fromEntries(u.searchParams.entries());
  return { u, q };
}

function parseVless(link) {
  const { u, q } = parseUrlLike(link);
  const id = decodeURIComponent(u.username);
  if (!UUID_RE.test(id)) throw new LinkError('UUID در لینک VLESS نامعتبر است');
  const address = checkHost(u.hostname);
  const port = checkPort(u.port);
  if (q.encryption && q.encryption !== 'none') throw new LinkError('فقط encryption=none برای VLESS پشتیبانی می‌شود');
  const user = { id, encryption: 'none', ...(q.flow ? { flow: q.flow } : {}) };
  return {
    protocol: 'vless', name: decodeName(u.hash), address, port,
    outbound: { tag: 'proxy', protocol: 'vless', settings: { vnext: [{ address, port, users: [user] }] }, streamSettings: buildStream(q) },
  };
}

function parseVmess(link) {
  let j;
  try { j = JSON.parse(b64decode(link.slice('vmess://'.length))); } catch (e) {
    throw new LinkError(e instanceof LinkError ? e.message : 'محتوای JSON لینک VMess نامعتبر است');
  }
  if (!UUID_RE.test(String(j.id || ''))) throw new LinkError('UUID در لینک VMess نامعتبر است');
  const address = checkHost(j.add);
  const port = checkPort(j.port);
  const stream = buildStream({
    type: j.net, security: j.tls, host: j.host, path: j.path, sni: j.sni, alpn: j.alpn, fp: j.fp,
    headerType: j.type, serviceName: j.net === 'grpc' ? j.path : undefined, mode: j.type === 'multi' ? 'multi' : undefined,
    allowInsecure: j.allowInsecure ? '1' : undefined,
  });
  return {
    protocol: 'vmess', name: j.ps || '', address, port,
    outbound: { tag: 'proxy', protocol: 'vmess', settings: { vnext: [{ address, port, users: [{ id: j.id, alterId: Number(j.aid || 0), security: j.scy || 'auto' }] }] }, streamSettings: stream },
  };
}

function parseTrojan(link) {
  const { u, q } = parseUrlLike(link);
  const password = decodeURIComponent(u.username);
  if (!password) throw new LinkError('رمز Trojan خالی است');
  const address = checkHost(u.hostname);
  const port = checkPort(u.port);
  if (!q.security) q.security = 'tls';
  return {
    protocol: 'trojan', name: decodeName(u.hash), address, port,
    outbound: { tag: 'proxy', protocol: 'trojan', settings: { servers: [{ address, port, password }] }, streamSettings: buildStream(q) },
  };
}

function parseShadowsocks(link) {
  const hashIdx = link.indexOf('#');
  const name = hashIdx >= 0 ? decodeName(link.slice(hashIdx)) : '';
  let body = link.slice('ss://'.length, hashIdx >= 0 ? hashIdx : undefined);
  const qIdx = body.indexOf('?');
  const query = qIdx >= 0 ? new URLSearchParams(body.slice(qIdx + 1)) : new URLSearchParams();
  if (qIdx >= 0) body = body.slice(0, qIdx);
  if (query.get('plugin')) throw new LinkError('پلاگین‌های Shadowsocks پشتیبانی نمی‌شوند');

  let method, password, hostPort;
  const at = body.lastIndexOf('@');
  if (at >= 0) { // SIP002: userinfo@host:port (userinfo base64 or url-encoded)
    const userinfo = decodeURIComponent(body.slice(0, at));
    hostPort = body.slice(at + 1).replace(/\/$/, '');
    const plain = userinfo.includes(':') ? userinfo : b64decode(userinfo);
    const c = plain.indexOf(':');
    if (c < 0) throw new LinkError('بخش method:password در لینک SS نامعتبر است');
    method = plain.slice(0, c); password = plain.slice(c + 1);
  } else { // legacy: base64(method:password@host:port)
    const plain = b64decode(body);
    const a = plain.lastIndexOf('@');
    if (a < 0) throw new LinkError('لینک SS نامعتبر است');
    const c = plain.indexOf(':');
    method = plain.slice(0, c); password = plain.slice(c + 1, a); hostPort = plain.slice(a + 1);
  }
  method = (method || '').toLowerCase();
  if (!SS_METHODS.has(method)) throw new LinkError(`روش رمزنگاری SS پشتیبانی نمی‌شود: ${method}`);
  if (!password) throw new LinkError('رمز SS خالی است');
  const m = hostPort.match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!m) throw new LinkError('آدرس/پورت لینک SS نامعتبر است');
  const address = checkHost(m[1]);
  const port = checkPort(m[2]);
  return {
    protocol: 'shadowsocks', name, address, port,
    outbound: { tag: 'proxy', protocol: 'shadowsocks', settings: { servers: [{ address, port, method, password }] }, streamSettings: { network: 'tcp', security: 'none' } },
  };
}

function parseLink(raw) {
  const link = String(raw || '').trim();
  if (!link) throw new LinkError('لینک خالی است');
  if (link.length > 8192) throw new LinkError('لینک بیش از حد طولانی است');
  const scheme = link.split('://')[0].toLowerCase();
  switch (scheme) {
    case 'vless': return parseVless(link);
    case 'vmess': return parseVmess(link);
    case 'trojan': return parseTrojan(link);
    case 'ss': return parseShadowsocks(link);
    default: throw new LinkError(`پروتکل پشتیبانی نمی‌شود: ${scheme || 'نامشخص'}`);
  }
}

const mask = (v) => (v ? `${String(v).slice(0, 8)}…` : '');

/** Human-readable summary of a parsed link (credentials masked) for previews in the admin panel. */
function describeLink(p) {
  const o = p.outbound; const ss = o.streamSettings || {};
  const user = o.settings?.vnext?.[0]?.users?.[0] || {};
  const srv = o.settings?.servers?.[0] || {};
  const tls = ss.tlsSettings || ss.realitySettings || {};
  const net = ss.network;
  const ns = ss[`${net}Settings`] || {};
  return {
    protocol: p.protocol, name: p.name, address: p.address, port: p.port,
    credential: mask(user.id || srv.password),
    credential_type: user.id ? 'UUID' : 'Password',
    method: srv.method || user.security || null,
    flow: user.flow || null,
    network: net, security: ss.security,
    sni: tls.serverName || null,
    path: ns.path || ns.serviceName || null,
    host: ns.host || null,
  };
}

module.exports = { parseLink, describeLink, LinkError };
