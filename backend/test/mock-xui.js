'use strict';
// A small fake 3X-UI panel implementing the endpoints we use, for tests.
const http = require('node:http');

function startMockXui({ username = 'xadmin', password = 'xpass', basePath = '/secret' } = {}) {
  const state = {
    inbound: { id: 1, protocol: 'vless', settings: { clients: [
      { id: 'a3482e88-686a-4a58-8126-99c9df64b7bf', email: 'ali', enable: true },
      { id: 'b3482e88-686a-4a58-8126-99c9df64b7bf', email: 'sara', enable: true },
    ] } },
    traffic: { ali: { up: 0, down: 0 }, sara: { up: 0, down: 0 } },
    updateCalls: [],
  };
  const SESSION = '3x-ui=mock-session-cookie';
  const server = http.createServer((req, res) => {
    const json = (o, s = 200, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = req.url.startsWith(basePath) ? req.url.slice(basePath.length) : null;
      if (p === null) return json({ success: false }, 404);
      if (p === '/login' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        if (f.get('username') === username && f.get('password') === password) return json({ success: true }, 200, { 'Set-Cookie': `${SESSION}; Path=/; HttpOnly` });
        return json({ success: false, msg: 'wrong' });
      }
      if ((req.headers.cookie || '') !== SESSION) return json({ success: false }, 401);
      let m;
      if ((m = p.match(/^\/panel\/api\/inbounds\/getClientTraffics\/(.+)$/))) {
        const email = decodeURIComponent(m[1]);
        const t = state.traffic[email];
        const c = state.inbound.settings.clients.find((x) => x.email === email);
        if (!t || !c) return json({ success: true, obj: null });
        return json({ success: true, obj: { id: 1, inboundId: 1, enable: c.enable, email, up: t.up, down: t.down, total: 0, expiryTime: 0 } });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/get\/(\d+)$/))) {
        return json({ success: true, obj: { id: 1, protocol: state.inbound.protocol, settings: JSON.stringify(state.inbound.settings) } });
      }
      if ((m = p.match(/^\/panel\/api\/inbounds\/updateClient\/(.+)$/)) && req.method === 'POST') {
        const j = JSON.parse(body);
        const upd = JSON.parse(j.settings).clients[0];
        const c = state.inbound.settings.clients.find((x) => x.id === decodeURIComponent(m[1]));
        if (!c) return json({ success: false, msg: 'no client' });
        Object.assign(c, upd);
        state.updateCalls.push({ id: m[1], enable: upd.enable });
        return json({ success: true });
      }
      json({ success: false }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}${basePath}` })));
}
module.exports = { startMockXui };
