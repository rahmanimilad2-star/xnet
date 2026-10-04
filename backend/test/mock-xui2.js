'use strict';
// Fake 3X-UI (v2.x API) with multiple inbounds and full client CRUD, for provisioning tests.
const http = require('node:http');

function startMockXui2({ username = 'xadmin', password = 'xpass', basePath = '/p4th' } = {}) {
  const state = {
    inbounds: [
      { id: 1, remark: 'NL-Reality', protocol: 'vless', port: 443, enable: true,
        settings: { clients: [{ id: '11111111-1111-4111-8111-111111111111', email: 'seed', flow: 'xtls-rprx-vision', enable: true }], decryption: 'none' },
        streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverNames: ['www.speedtest.net'], shortIds: ['6ba85179e30d4fc2'], settings: { publicKey: 'Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw', fingerprint: 'chrome' } } } },
      { id: 2, remark: 'DE-WS', protocol: 'trojan', port: 2083, enable: true,
        settings: { clients: [] },
        streamSettings: { network: 'ws', security: 'tls', wsSettings: { path: '/tr', headers: { Host: 'de.example.com' } }, tlsSettings: { serverName: 'de.example.com', alpn: ['h2', 'http/1.1'], settings: { fingerprint: 'chrome' } } } },
      { id: 3, remark: 'SS2022', protocol: 'shadowsocks', port: 8388, enable: true,
        settings: { method: '2022-blake3-aes-128-gcm', password: 'AAAAAAAAAAAAAAAAAAAAAA==', clients: [] }, streamSettings: { network: 'tcp', security: 'none' } },
      { id: 4, remark: 'VM-GRPC', protocol: 'vmess', port: 8443, enable: true,
        settings: { clients: [] }, streamSettings: { network: 'grpc', security: 'tls', grpcSettings: { serviceName: 'svc' }, tlsSettings: { serverName: 'fr.example.com' } } },
    ],
    traffic: {}, // email -> {up, down}
    calls: [],
  };
  const SESSION = '3x-ui=s2';
  const allClients = () => state.inbounds.flatMap((ib) => ib.settings.clients.map((c) => ({ ib, c })));
  const idOf = (ib, c) => (ib.protocol === 'trojan' ? c.password : ib.protocol === 'shadowsocks' ? c.email : c.id);
  const server = http.createServer((req, res) => {
    const json = (o, s = 200, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = req.url.startsWith(basePath) ? req.url.slice(basePath.length) : null;
      if (p === null) return json({ success: false }, 404);
      if (p === '/login' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        return f.get('username') === username && f.get('password') === password
          ? json({ success: true }, 200, { 'Set-Cookie': `${SESSION}; Path=/` }) : json({ success: false, msg: 'wrong' });
      }
      if ((req.headers.cookie || '') !== SESSION) return json({ success: false }, 401);
      state.calls.push(`${req.method} ${p}`);
      const ser = (ib) => ({ ...ib, settings: JSON.stringify(ib.settings), streamSettings: JSON.stringify(ib.streamSettings) });
      let m;
      if (p === '/panel/api/inbounds/list') return json({ success: true, obj: state.inbounds.map(ser) });
      if ((m = p.match(/^\/panel\/api\/inbounds\/get\/(\d+)$/))) {
        const ib = state.inbounds.find((i) => i.id === +m[1]);
        return ib ? json({ success: true, obj: ser(ib) }) : json({ success: false, msg: 'not found' });
      }
      if (p === '/panel/api/inbounds/addClient' && req.method === 'POST') {
        const j = JSON.parse(body); const ib = state.inbounds.find((i) => i.id === j.id);
        const c = JSON.parse(j.settings).clients[0];
        if (!ib) return json({ success: false, msg: 'no inbound' });
        if (allClients().some((x) => x.c.email === c.email)) return json({ success: false, msg: 'Duplicate email' });
        ib.settings.clients.push(c); state.traffic[c.email] = { up: 0, down: 0 };
        return json({ success: true });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/updateClient\/(.+)$/))) {
        const j = JSON.parse(body); const ib = state.inbounds.find((i) => i.id === j.id);
        const upd = JSON.parse(j.settings).clients[0];
        const idx = ib.settings.clients.findIndex((c) => idOf(ib, c) === decodeURIComponent(m[1]));
        if (idx < 0) return json({ success: false, msg: 'no client' });
        ib.settings.clients[idx] = upd; return json({ success: true });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/(\d+)\/delClient\/(.+)$/))) {
        const ib = state.inbounds.find((i) => i.id === +m[1]);
        const before = ib.settings.clients.length;
        ib.settings.clients = ib.settings.clients.filter((c) => idOf(ib, c) !== decodeURIComponent(m[2]));
        return json({ success: ib.settings.clients.length < before, msg: 'no client' });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/(\d+)\/resetClientTraffic\/(.+)$/))) {
        state.traffic[decodeURIComponent(m[2])] = { up: 0, down: 0 }; return json({ success: true });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/getClientTraffics\/(.+)$/))) {
        const email = decodeURIComponent(m[1]);
        const hit = allClients().find((x) => x.c.email === email);
        if (!hit) return json({ success: true, obj: null });
        const t = state.traffic[email] || { up: 0, down: 0 };
        // emulate 3X-UI's own quota cut-off
        const depleted = hit.c.totalGB > 0 && t.up + t.down >= hit.c.totalGB;
        return json({ success: true, obj: { inboundId: hit.ib.id, email, up: t.up, down: t.down, total: hit.c.totalGB, expiryTime: hit.c.expiryTime, enable: hit.c.enable && !depleted } });
      }
      json({ success: false }, 404);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, state, url: `http://127.0.0.1:${server.address().port}${basePath}` })));
}
module.exports = { startMockXui2 };
