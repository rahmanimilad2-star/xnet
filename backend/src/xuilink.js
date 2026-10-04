'use strict';
// Build a standard share link for a 3X-UI client from its inbound definition
// (same format 3X-UI itself shows), so it can be parsed by links.js like a hand-pasted link.

function streamParams(ss) {
  const p = new URLSearchParams();
  const network = ss.network || 'tcp';
  p.set('type', network);
  const security = ss.security || 'none';
  p.set('security', security);

  if (network === 'tcp') {
    const h = ss.tcpSettings?.header;
    if (h?.type === 'http') {
      p.set('headerType', 'http');
      const path = h.request?.path; if (path?.length) p.set('path', path.join(','));
      const host = h.request?.headers?.Host || h.request?.headers?.host; if (host?.length) p.set('host', [].concat(host).join(','));
    }
  } else if (network === 'ws') {
    p.set('path', ss.wsSettings?.path || '/');
    const host = ss.wsSettings?.host || ss.wsSettings?.headers?.Host; if (host) p.set('host', host);
  } else if (network === 'grpc') {
    p.set('serviceName', ss.grpcSettings?.serviceName || '');
    if (ss.grpcSettings?.multiMode) p.set('mode', 'multi');
    if (ss.grpcSettings?.authority) p.set('authority', ss.grpcSettings.authority);
  } else if (network === 'httpupgrade') {
    p.set('path', ss.httpupgradeSettings?.path || '/');
    if (ss.httpupgradeSettings?.host) p.set('host', ss.httpupgradeSettings.host);
  } else if (network === 'xhttp' || network === 'splithttp') {
    const x = ss.xhttpSettings || ss.splithttpSettings || {};
    p.set('type', 'xhttp');
    p.set('path', x.path || '/');
    if (x.host) p.set('host', x.host);
    if (x.mode) p.set('mode', x.mode);
  }

  if (security === 'tls') {
    const t = ss.tlsSettings || {};
    if (t.serverName) p.set('sni', t.serverName);
    if (t.alpn?.length) p.set('alpn', t.alpn.join(','));
    const fp = t.settings?.fingerprint || t.fingerprint; if (fp) p.set('fp', fp);
    if (t.settings?.allowInsecure || t.allowInsecure) p.set('allowInsecure', '1');
  } else if (security === 'reality') {
    const r = ss.realitySettings || {};
    const pbk = r.settings?.publicKey || r.publicKey;
    if (pbk) p.set('pbk', pbk);
    const sni = (r.serverNames || [])[0] || r.settings?.serverName; if (sni) p.set('sni', sni);
    const sid = (r.shortIds || [])[0]; if (sid !== undefined) p.set('sid', sid);
    p.set('fp', r.settings?.fingerprint || 'chrome');
    if (r.settings?.spiderX) p.set('spx', r.settings.spiderX);
  }
  return p;
}

function b64url(s) { return Buffer.from(s).toString('base64url'); }

/**
 * @param inbound {protocol, port, settings, streamSettings, remark}
 * @param client  {id|password, email, flow}
 * @param host    public address users connect to
 */
function buildShareLink(inbound, client, host, name) {
  const ss = inbound.streamSettings || {};
  const label = encodeURIComponent(name || `${inbound.remark || inbound.protocol}-${client.email}`);
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = inbound.port;
  switch (inbound.protocol) {
    case 'vless': {
      const p = streamParams(ss);
      p.set('encryption', 'none');
      if (client.flow) p.set('flow', client.flow);
      return `vless://${client.id}@${h}:${port}?${p.toString()}#${label}`;
    }
    case 'trojan': {
      const p = streamParams(ss);
      return `trojan://${encodeURIComponent(client.password)}@${h}:${port}?${p.toString()}#${label}`;
    }
    case 'vmess': {
      const p = streamParams(ss);
      const net = p.get('type');
      const j = {
        v: '2', ps: decodeURIComponent(label), add: host, port: String(port), id: client.id, aid: '0', scy: client.security || 'auto',
        net, type: net === 'tcp' ? (p.get('headerType') || 'none') : (net === 'grpc' && p.get('mode') === 'multi' ? 'multi' : 'none'),
        host: p.get('host') || '', path: net === 'grpc' ? (p.get('serviceName') || '') : (p.get('path') || ''),
        tls: p.get('security') === 'tls' ? 'tls' : '', sni: p.get('sni') || '', alpn: p.get('alpn') || '', fp: p.get('fp') || '',
      };
      return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`;
    }
    case 'shadowsocks': {
      const method = inbound.settings?.method;
      if (!method) throw new Error('shadowsocks inbound has no method');
      // 2022 multi-user: password = serverKey:userKey
      const pw = method.startsWith('2022-') && inbound.settings?.password ? `${inbound.settings.password}:${client.password}` : client.password;
      return `ss://${b64url(`${method}:${pw}`)}@${h}:${port}#${label}`;
    }
    default:
      throw new Error(`پروتکل inbound پشتیبانی نمی‌شود: ${inbound.protocol}`);
  }
}

module.exports = { buildShareLink };
