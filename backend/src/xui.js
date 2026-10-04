'use strict';
// Minimal 3X-UI API client: login + read client traffic + enable/disable client.
const http = require('node:http');
const https = require('node:https');
const { config } = require('./config');

function request(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout: timeoutMs, rejectUnauthorized: !config.xuiInsecureTls }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

class XuiClient {
  constructor(baseUrl, username, password) {
    this.base = String(baseUrl).replace(/\/+$/, '');
    this.username = username; this.password = password; this.cookie = '';
  }
  async login() {
    const body = new URLSearchParams({ username: this.username, password: this.password }).toString();
    const r = await request(`${this.base}/login`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } });
    let j = {}; try { j = JSON.parse(r.body); } catch { /* ignore */ }
    if (r.status !== 200 || !j.success) throw new Error(`3X-UI login failed (HTTP ${r.status})`);
    const sc = r.headers['set-cookie'] || [];
    this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    if (!this.cookie) throw new Error('3X-UI did not return a session cookie');
  }
  async api(method, path, json) {
    const body = json ? JSON.stringify(json) : null;
    const headers = { Cookie: this.cookie, Accept: 'application/json' };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const r = await request(`${this.base}${path}`, { method, headers, body });
    if (r.status === 401 || r.status === 404 && /login/i.test(r.body)) throw new Error('3X-UI session rejected');
    let j; try { j = JSON.parse(r.body); } catch { throw new Error(`3X-UI returned non-JSON (HTTP ${r.status})`); }
    return j;
  }
  /** @returns {Promise<null|{up:number,down:number,enable:boolean,inboundId:number,total:number,expiryTime:number}>} */
  async getClientTraffic(email) {
    const j = await this.api('GET', `/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`);
    if (!j.success || !j.obj) return null;
    return { up: Number(j.obj.up || 0), down: Number(j.obj.down || 0), enable: !!j.obj.enable, inboundId: j.obj.inboundId, total: j.obj.total, expiryTime: j.obj.expiryTime };
  }
  async listInbounds() {
    const j = await this.api('GET', '/panel/api/inbounds/list');
    if (!j.success) throw new Error(`inbounds/list failed: ${j.msg || ''}`);
    return (j.obj || []).map((ib) => ({
      id: ib.id, remark: ib.remark || '', protocol: ib.protocol, port: ib.port, enable: !!ib.enable,
      settings: safeJson(ib.settings), streamSettings: safeJson(ib.streamSettings),
    }));
  }
  async getInbound(id) {
    const j = await this.api('GET', `/panel/api/inbounds/get/${id}`);
    if (!j.success || !j.obj) throw new Error('inbound not found');
    return { ...j.obj, settings: safeJson(j.obj.settings), streamSettings: safeJson(j.obj.streamSettings) };
  }
  async addClient(inboundId, client) {
    const r = await this.api('POST', '/panel/api/inbounds/addClient', { id: inboundId, settings: JSON.stringify({ clients: [client] }) });
    if (!r.success) throw new Error(`addClient failed: ${r.msg || ''}`);
  }
  /** Merge [patch] into the client identified by email and push it. */
  async updateClientByEmail(inboundId, email, patch) {
    const ib = await this.getInbound(inboundId);
    const client = (ib.settings.clients || []).find((c) => c.email === email);
    if (!client) throw new Error('client not found in inbound');
    Object.assign(client, patch);
    const id = clientIdFor(ib.protocol, client);
    const r = await this.api('POST', `/panel/api/inbounds/updateClient/${encodeURIComponent(id)}`, { id: inboundId, settings: JSON.stringify({ clients: [client] }) });
    if (!r.success) throw new Error(`updateClient failed: ${r.msg || ''}`);
    return client;
  }
  async deleteClient(inboundId, protocol, clientKey, email) {
    const id = protocol === 'shadowsocks' ? email : clientKey;
    const r = await this.api('POST', `/panel/api/inbounds/${inboundId}/delClient/${encodeURIComponent(id)}`);
    if (!r.success) throw new Error(`delClient failed: ${r.msg || ''}`);
  }
  async resetClientTraffic(inboundId, email) {
    const r = await this.api('POST', `/panel/api/inbounds/${inboundId}/resetClientTraffic/${encodeURIComponent(email)}`);
    if (!r.success) throw new Error(`resetClientTraffic failed: ${r.msg || ''}`);
  }
  async setClientEnabled(inboundId, email, enable) {
    const ib = await this.api('GET', `/panel/api/inbounds/get/${inboundId}`);
    if (!ib.success || !ib.obj) throw new Error('inbound not found');
    const settings = JSON.parse(ib.obj.settings || '{}');
    const client = (settings.clients || []).find((c) => c.email === email);
    if (!client) throw new Error('client not found in inbound');
    if (client.enable === enable) return false;
    client.enable = enable;
    const proto = ib.obj.protocol;
    const clientId = proto === 'trojan' ? client.password : proto === 'shadowsocks' ? client.email : client.id;
    const r = await this.api('POST', `/panel/api/inbounds/updateClient/${encodeURIComponent(clientId)}`, { id: inboundId, settings: JSON.stringify({ clients: [client] }) });
    if (!r.success) throw new Error(`updateClient failed: ${r.msg || ''}`);
    return true;
  }
}

function safeJson(v) { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}'); } catch { return {}; } }
function clientIdFor(protocol, c) { return protocol === 'trojan' ? c.password : protocol === 'shadowsocks' ? c.email : c.id; }

module.exports = { XuiClient, clientIdFor };
