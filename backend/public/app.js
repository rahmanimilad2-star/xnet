'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GB = 1024 ** 3;
  const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
  const fmtBytes = (b) => {
    if (b == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(b);
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toLocaleString('fa-IR', { maximumFractionDigits: i >= 3 ? 2 : 0 })}\u00A0${u[i]}`;
  };
  const fmtSpeed = (bps) => `${fmtBytes(bps || 0)}/s`;
  const fb = (b) => `<bdi>${fmtBytes(b)}</bdi>`; // traffic value isolated for correct RTL order
  const provisionMsg = (p) => {
    if (!p) return '';
    if (!p.created.length && !p.errors.length) return ''; // no auto-provisioning configured (e.g. manual configs only)
    return ` · ${p.created.length.toLocaleString('fa-IR')} کلاینت در 3X-UI ساخته شد${p.errors.length ? ` · ${p.errors.length.toLocaleString('fa-IR')} خطا: ${p.errors[0].error}` : ''}`;
  };
  const xuiErr = (r) => (r?.xui_errors?.length ? ` · خطای 3X-UI: ${r.xui_errors[0].error}` : '');
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString('fa-IR') : 'نامحدود');
  const toDateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const ago = (ms) => {
    if (!ms) return 'هرگز';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'لحظاتی پیش';
    if (s < 3600) return `${fa(Math.round(s / 60))} دقیقه پیش`;
    if (s < 86400) return `${fa(Math.round(s / 3600))} ساعت پیش`;
    return `${fa(Math.round(s / 86400))} روز پیش`;
  };
  /** Shorten long URLs/tokens in the middle so both ends stay recognisable. */
  const truncMid = (s, max = 42) => { s = String(s || ''); return s.length <= max ? s : `${s.slice(0, max - 10)}…${s.slice(-8)}`; };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return url || ''; } };
  const initial = (name) => esc(String(name || '?').trim().charAt(0) || '?');
  const STATUS = { ACTIVE: ['فعال', 'ok'], BLOCKED: ['مسدود', 'bad'], EXPIRED: ['منقضی', 'warn'], QUOTA_EXCEEDED: ['اتمام حجم', 'warn'] };
  const SOURCE = { manual: 'دستی', subscription: 'Subscription', xui: '3X-UI خودکار' };
  const SCOPE = { all: 'همه کاربران', groups: 'گروه‌ها', users: 'کاربران خاص' };
  const TITLES = { dashboard: 'داشبورد', users: 'کاربران', servers: 'سرورها', configs: 'لینک‌ها و کانفیگ‌ها', groups: 'گروه‌ها', audit: 'رویدادها', settings: 'تنظیمات' };

  // Small stroke icon set (inline SVG; no external assets, CSP-safe).
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m22 4-10 10-3-3"/>',
    server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24">${P[n] || ''}</svg>`;
  const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
  const statusBadge = (s) => { const [t, c] = STATUS[s] || [s, '']; return badge(t, c); };
  const pageHead = (title, desc, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
  const copyField = (value, label = 'کپی') => `<div class="copy-field"><bdi class="mono" title="${esc(value)}">${esc(truncMid(value, 64))}</bdi><button type="button" class="btn sm" data-copy="${esc(value)}">${ic('copy')}${esc(label)}</button></div>`;
  /** Widths are applied through the CSSOM (inline style attributes are blocked by the CSP). */
  const paint = (root = document) => $$('[data-pct]', root).forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, +el.dataset.pct || 0))}%`; });
  const usagePct = (u) => (u.unlimited || !u.quota_bytes ? 0 : Math.min(100, (u.used_bytes / u.quota_bytes) * 100));
  const usageBar = (u, cls = '') => {
    if (u.unlimited) return '';
    const p = usagePct(u);
    return `<div class="bar ${cls} ${p >= 100 ? 'full' : p >= 80 ? 'warn' : ''}"><i data-pct="${p}"></i></div>`;
  };

  // ---------------------------------------------------------------- API
  async function api(method, path, body) {
    const opt = { method, headers: { 'X-Requested-With': 'panel' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(path, opt);
    let data = {}; try { data = await r.json(); } catch { /* empty */ }
    if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(data.error?.message || 'نشست منقضی شد'); }
    if (!r.ok) { const e = new Error(data.error?.message || `خطا (${r.status})`); e.data = data.error; throw e; }
    return data;
  }
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = `toast${bad ? ' bad' : ''}`;
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 4000);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'copy-buffer';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('کپی شد');
  }
  // One delegated handler for every copy button in pages and modals.
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { e.preventDefault(); copyText(b.dataset.copy); } });

  // -------------------------------------------------------------- modal
  // One modal system: centered overlay, fixed header, independently scrolling body,
  // sticky footer (.form-actions) with a Cancel button added automatically.
  function openModal(title, html, onSubmit, opts = {}) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal .modal-box').classList.toggle('wide', !!opts.wide);
    $('#modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    $('#modal-body').scrollTop = 0;
    const form = $('#modal-body form');
    const actions = form && form.querySelector('.form-actions');
    if (actions && !actions.querySelector('[data-cancel]')) {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'btn ghost'; c.dataset.cancel = '1'; c.textContent = 'انصراف';
      c.addEventListener('click', closeModal); actions.appendChild(c);
    }
    if (form && onSubmit) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('[type=submit]'); btn.disabled = true;
        const er = form.querySelector('.error'); if (er) er.textContent = '';
        try { await onSubmit(form); } catch (e) { if (er) { er.textContent = e.message; er.scrollIntoView({ block: 'nearest' }); } else toast(e.message, true); }
        finally { btn.disabled = false; }
      });
    }
    paint($('#modal-body'));
    const first = $('#modal-body input:not([type=hidden]):not([type=checkbox]), #modal-body textarea');
    if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('#modal').classList.add('hidden'); document.body.classList.remove('modal-open'); }
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });
  const confirmBox = (msg) => window.confirm(msg);

  // ---------------------------------------------------------- auth/nav
  function showLogin() { closeModal(); $('#app-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); }
  async function showApp(name) {
    $('#admin-name').textContent = name;
    $('#side-admin').textContent = name;
    $('#top-avatar').textContent = String(name || 'A').charAt(0);
    $('#side-avatar').textContent = String(name || 'A').charAt(0);
    $('#login-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
    go(location.hash.slice(1) || 'dashboard');
    refreshStatus();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#login-error').textContent = '';
    try {
      const r = await api('POST', '/api/admin/login', { username: f.username.value, password: f.password.value });
      f.password.value = ''; showApp(r.username);
    } catch (err) { $('#login-error').textContent = err.message; }
  });
  $('#logout-btn').addEventListener('click', guard(async () => { await api('POST', '/api/admin/logout'); showLogin(); }));
  const setMenu = (open) => { $('#sidebar').classList.toggle('open', open); $('#sidebar-backdrop').classList.toggle('show', open); };
  $('#menu-toggle').addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('open')));
  $('#sidebar-backdrop').addEventListener('click', () => setMenu(false));
  $$('#sidebar a').forEach((a) => a.addEventListener('click', () => { go(a.dataset.page); setMenu(false); }));

  /** Header status chip: derived only from real server sync data. */
  async function refreshStatus(servers) {
    const el = $('#sys-status');
    try {
      const list = servers || (await api('GET', '/api/admin/servers')).servers;
      const active = list.filter((s) => s.enabled);
      const bad = active.filter((s) => s.last_sync_error).length;
      const ok = active.filter((s) => s.last_sync_at && !s.last_sync_error).length;
      if (!active.length) { el.className = 'badge'; el.textContent = 'سرور فعالی ثبت نشده'; }
      else if (bad) { el.className = 'badge bad'; el.textContent = `${fa(bad)} سرور با خطا`; }
      else if (ok === active.length) { el.className = 'badge ok'; el.textContent = `${fa(ok)} سرور متصل`; }
      else { el.className = 'badge warn'; el.textContent = `${fa(active.length - ok)} سرور بررسی نشده`; }
    } catch { el.className = 'badge'; el.textContent = 'وضعیت سرورها نامشخص'; }
  }

  const pages = {};
  let current = 'dashboard';
  function go(p) {
    if (!pages[p]) p = 'dashboard';
    current = p; location.hash = p;
    $$('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
    $('#top-title').textContent = TITLES[p] || '';
    $('#page').innerHTML = '<div class="loading"><span class="spinner"></span>در حال بارگذاری…</div>';
    guard(async () => { await pages[p](); paint($('#page')); })();
  }
  const reload = () => go(current);

  // ---------------------------------------------------------- dashboard
  const ACTIONS = {
    'user.create': 'ساخت کاربر', 'user.update': 'ویرایش کاربر', 'user.delete': 'حذف کاربر', 'user.renew': 'تمدید کاربر', 'user.provision': 'Provisioning کاربر',
    'config.create': 'افزودن کانفیگ', 'config.update': 'ویرایش کانفیگ', 'config.delete': 'حذف کانفیگ', 'config.bulk_create': 'افزودن گروهی کانفیگ', 'config.import': 'وارد کردن کانفیگ',
    'subscription.create': 'افزودن Subscription', 'subscription.update': 'ویرایش Subscription', 'subscription.delete': 'حذف Subscription', 'subscription.refresh': 'به‌روزرسانی Subscription',
    'server.create': 'افزودن سرور', 'server.update': 'ویرایش سرور', 'server.delete': 'حذف سرور', 'admin.login': 'ورود مدیر', 'admin.logout': 'خروج مدیر', 'user.release_device': 'آزادسازی دستگاه کاربر',
    'xui.provision': 'ساخت کلاینت 3X-UI', 'xui.disable_client': 'قطع کلاینت 3X-UI', 'xui.enable_client': 'فعال‌سازی کلاینت 3X-UI', 'vpn.connect_failed': 'خطای اتصال کاربر',
  };
  const serverState = (s) => {
    if (!s.enabled) return ['غیرفعال', ''];
    if (s.last_sync_error) return ['خطا در اتصال', 'bad'];
    if (s.last_sync_at) return ['متصل', 'ok'];
    return ['بررسی نشده', 'warn'];
  };

  pages.dashboard = async () => {
    const [d, ur, ar] = await Promise.all([
      api('GET', '/api/admin/dashboard'),
      api('GET', '/api/admin/users').catch(() => ({ users: [] })),
      api('GET', '/api/admin/audit?limit=8').catch(() => ({ logs: [] })),
    ]);
    const healthy = d.servers.filter((x) => x.enabled && x.last_sync_at && !x.last_sync_error).length;
    const stat = (label, value, sub, icon, cls = '') => `<div class="card stat"><div class="stat-top"><span class="l">${esc(label)}</span><span class="stat-ic ${cls}">${ic(icon)}</span></div><div><div class="n">${value}</div><div class="s">${sub}</div></div></div>`;
    const recentUsers = ur.users.slice(0, 6).map((u) => `<div class="list-row"><div class="main"><span class="avatar">${initial(u.username)}</span><div><strong>${esc(u.username)}</strong><small>${u.unlimited ? 'نامحدود' : `${fb(u.used_bytes)} از ${fb(u.quota_bytes)}`} · ${fmtDay(u.expires_at)}</small></div></div>${statusBadge(u.status)}</div>`).join('') || '<div class="list-empty">هنوز کاربری ساخته نشده</div>';
    const activity = ar.logs.map((l) => `<div class="list-row"><div class="main"><span class="act-ic">${ic('activity')}</span><div><strong>${esc(ACTIONS[l.action] || l.action)}</strong><small><bdi class="mono">${esc(l.actor)}</bdi>${l.target ? ` · <bdi class="mono">${esc(l.target)}</bdi>` : ''}</small></div></div><span class="muted">${ago(l.created_at)}</span></div>`).join('') || '<div class="list-empty">رویدادی ثبت نشده</div>';
    $('#page').innerHTML = `
      ${pageHead('داشبورد', 'نمای کلی کاربران، سرورها و سرویس', `<button class="btn" id="sync-btn">${ic('refresh')}همگام‌سازی آمار</button>`)}
      <div class="stats">
        ${stat('کاربران', fa(d.users.total), `${fa(d.users.online)} آنلاین · ${fa(d.users.connected_24h)} متصل در ۲۴ ساعت`, 'users')}
        ${stat('اشتراک‌های فعال', fa(d.users.ACTIVE), `${fa(d.users.EXPIRED)} منقضی · ${fa(d.users.QUOTA_EXCEEDED)} اتمام حجم`, 'check', 'ok')}
        ${stat('سرورها', fa(d.servers.length), d.servers.length ? `${fa(healthy)} متصل از ${fa(d.servers.length)}` : 'سروری ثبت نشده', 'server', 'info')}
        ${stat('کانفیگ‌ها', fa(d.configs.enabled), `فعال از ${fa(d.configs.total)} · مصرف کل ${fb(d.total_traffic_bytes)}`, 'link', 'warn')}
      </div>
      <div class="grid-2 section">
        <div class="card">
          <div class="card-head"><h3>سلامت سرورها</h3><span class="muted">آخرین همگام‌سازی آمار از 3X-UI</span></div>
          <div class="table-wrap"><table class="compact"><thead><tr><th>سرور</th><th>وضعیت</th><th>آخرین بررسی</th><th>خطا</th></tr></thead><tbody>
          ${d.servers.map((x) => { const [t, c] = serverState(x); return `<tr><td><strong>${esc(x.name)}</strong> <span class="muted">${esc(x.country)}</span></td><td>${badge(t, c)}</td><td class="num">${ago(x.last_sync_at)}</td><td class="cell-trunc"><bdi class="mono trunc" title="${esc(x.last_sync_error || '')}">${esc(x.last_sync_error || '—')}</bdi></td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">سروری ثبت نشده است</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>وضعیت اشتراک‌ها</h3><span class="muted">بر اساس داده واقعی کاربران</span></div>
          <div class="mini-stats"><div><span>آنلاین (۱۰ دقیقه)</span><strong>${fa(d.users.online)}</strong></div><div><span>مسدود</span><strong>${fa(d.users.BLOCKED)}</strong></div><div><span>کل مصرف</span><strong>${fb(d.total_traffic_bytes)}</strong></div></div>
        </div>
      </div>
      <div class="grid-2 even section">
        <div class="card"><div class="card-head"><h3>آخرین کاربران</h3><button class="btn ghost sm" data-goto="users">مشاهده همه</button></div>${recentUsers}</div>
        <div class="card"><div class="card-head"><h3>آخرین فعالیت‌ها</h3><button class="btn ghost sm" data-goto="audit">مشاهده همه</button></div>${activity}</div>
      </div>`;
    $$('#page [data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
    $('#sync-btn').addEventListener('click', guard(async () => {
      const r = await api('POST', '/api/admin/stats/sync');
      toast(r.skipped ? 'همگام‌سازی در حال اجراست' : `همگام شد: ${r.servers} سرور${r.errors.length ? `، ${r.errors.length} خطا` : ''}`, r.errors?.length);
      refreshStatus(); reload();
    }));
  };

  // -------------------------------------------------------------- users
  let cache = { groups: [], configs: [], users: [], servers: [], subs: [] };
  async function loadRefs() {
    const [g, c, s, sub] = await Promise.all([api('GET', '/api/admin/groups'), api('GET', '/api/admin/configs'), api('GET', '/api/admin/servers'), api('GET', '/api/admin/subscriptions')]);
    cache.groups = g.groups; cache.configs = c.configs; cache.servers = s.servers; cache.subs = sub.subscriptions;
  }
  const groupOptions = (sel) => `<option value="">— بدون گروه —</option>${cache.groups.map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}`;
  const configChecklist = (selected = []) => `<div class="checklist">${cache.configs.filter((c) => c.scope === 'users').map((c) => `
      <label><input type="checkbox" name="config_ids" value="${c.id}" ${selected.includes(c.id) ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${esc(c.country)} · ${esc(c.protocol)}${c.enabled ? '' : ' · غیرفعال'}</span></label>`).join('') || '<span class="muted">کانفیگی با دامنه «کاربران خاص» وجود ندارد</span>'}</div>`;
  const groupName = (id) => cache.groups.find((g) => g.id === id)?.name;

  pages.users = async () => {
    await loadRefs();
    const { users } = await api('GET', '/api/admin/users');
    cache.users = users;
    $('#page').innerHTML = `
      ${pageHead('کاربران', 'مدیریت کاربران، اشتراک‌ها و provisioning در 3X-UI', `<button class="btn primary" id="add-user">${ic('plus')}افزودن کاربر</button>`)}
      <div class="toolbar">
        <div class="search">${ic('search')}<input id="user-q" placeholder="جستجوی نام کاربری یا یادداشت…"></div>
        <span class="spacer"></span><span class="muted" id="user-count"></span>
      </div>
      <div class="table-wrap"><table><thead><tr><th>کاربر</th><th>اشتراک</th><th>مصرف</th><th>انقضا</th><th>وضعیت</th><th class="actions">عملیات</th></tr></thead>
      <tbody id="users-body"></tbody></table></div>`;
    const render = (q) => {
      const list = users.filter((u) => !q || u.username.toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q));
      $('#user-count').textContent = `${fa(list.length)} کاربر`;
      $('#users-body').innerHTML = list.map((u) => `<tr>
          <td><div class="user-cell"><span class="avatar">${initial(u.username)}</span><div class="meta"><strong>${esc(u.username)}</strong>${u.note ? `<span class="sub-line trunc">${esc(u.note)}</span>` : `<span class="sub-line">آخرین اتصال: ${ago(u.last_connect_at)}</span>`}</div></div></td>
          <td class="num"><bdi>${u.unlimited ? 'نامحدود' : fmtBytes(u.quota_bytes)}</bdi><span class="sub-line">${esc(groupName(u.group_id) || 'بدون گروه')} · ${fa(u.allowed_config_count)} کانفیگ</span></td>
          <td class="num"><bdi>${fmtBytes(u.used_bytes)}</bdi> <span class="muted">از</span> <bdi>${u.unlimited ? 'نامحدود' : fmtBytes(u.quota_bytes)}</bdi>${usageBar(u)}</td>
          <td class="num">${fmtDay(u.expires_at)}${u.days_left != null ? `<span class="sub-line">${fa(u.days_left)} روز مانده</span>` : ''}</td>
          <td><div class="badges">${statusBadge(u.status)}${u.online ? badge('آنلاین', 'info') : ''}${u.provision_error ? '<span class="badge bad" title="ساخت کلاینت در 3X-UI ناقص است">3X-UI ⚠</span>' : ''}</div></td>
          <td class="actions"><div class="btn-group">
            <button class="btn sm primary-soft" data-act="detail" data-id="${u.id}">${ic('eye')}مشاهده</button>
            <button class="btn sm ghost" data-act="edit" data-id="${u.id}">ویرایش</button>
            <button class="btn sm ghost" data-act="renew" data-id="${u.id}">تمدید</button>
            <button class="btn sm ghost" data-act="toggle" data-id="${u.id}">${u.user_status === 'blocked' ? 'رفع مسدودی' : 'مسدود'}</button>
            <button class="btn sm ${u.device_session_active ? 'primary-soft' : 'ghost'}" data-act="release" data-id="${u.id}" ${u.device_session_active ? '' : 'disabled title="این کاربر Session فعالی ندارد"'}>${u.device_session_active ? 'Reset Session' : 'بدون Session فعال'}</button>
            <button class="btn sm ghost" data-act="del" data-id="${u.id}">حذف</button>
          </div></td></tr>`).join('') || `<tr><td colspan="6" class="empty">${q ? 'کاربری با این جستجو پیدا نشد' : 'هنوز کاربری ساخته نشده است'}</td></tr>`;
      paint($('#users-body'));
    };
    render('');
    $('#user-q').addEventListener('input', (e) => render(e.target.value.trim().toLowerCase()));
    $('#add-user').addEventListener('click', () => userForm());
    $('#users-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const u = users.find((x) => x.id === +b.dataset.id);
      await userAction(b.dataset.act, u);
    }));
  };

  async function userAction(act, u) {
    if (act === 'detail') userDetail(u);
    if (act === 'edit') userForm(u);
    if (act === 'renew') renewForm(u);
    if (act === 'toggle') { const r = await api('PUT', `/api/admin/users/${u.id}`, { status: u.user_status === 'blocked' ? 'active' : 'blocked' }); closeModal(); toast(`وضعیت تغییر کرد${xuiErr(r)}`, !!r.xui_errors?.length); reload(); }
    if (act === 'release' && confirmBox(`Session کاربر «${u.username}» ریست شود؟ ورود فعلی او باطل می‌شود و می‌تواند دوباره با نام کاربری و رمز خودش وارد شود. حساب، اشتراک و حجم تغییری نمی‌کند.`)) {
      const r = await api('POST', `/api/admin/users/${u.id}/release-device`);
      const released = !!r.released;
      closeModal();
      toast(released ? 'Session ریست شد؛ کاربر می‌تواند دوباره وارد شود' : 'این کاربر Session فعالی نداشت', false);
      reload();
    }
    if (act === 'provision') { const r = await api('POST', `/api/admin/users/${u.id}/provision`); closeModal(); toast(`Provisioning انجام شد${provisionMsg(r.provision)}`, r.provision.errors.length > 0); reload(); }
    if (act === 'del' && confirmBox(`کاربر «${u.username}» حذف شود؟ کلاینت‌های او در 3X-UI هم حذف می‌شوند.`)) { const r = await api('DELETE', `/api/admin/users/${u.id}`); closeModal(); toast(`کاربر حذف شد${xuiErr(r)}`, !!r.xui_errors?.length); reload(); }
  }

  function userDetail(u) {
    const remaining = u.unlimited ? 'نامحدود' : fmtBytes(Math.max(0, u.quota_bytes - u.used_bytes));
    const configs = (u.config_ids || []).map((id) => cache.configs.find((c) => c.id === id)).filter(Boolean);
    const subs = u.subscriptions || [];
    const clients = u.xui_clients || [];
    const perr = u.provision_error ? (Array.isArray(u.provision_error) ? u.provision_error : [u.provision_error]) : [];
    const section = (title, meta, body) => `<section class="ud-section"><header><h3>${esc(title)}</h3><span class="muted">${meta}</span></header>${body}</section>`;
    openModal(`کاربر ${u.username}`, `
      <div class="ud-head">
        <div class="ud-id"><span class="avatar lg">${initial(u.username)}</span><div><h2>${esc(u.username)}</h2>
          <div class="badges">${statusBadge(u.status)}${u.online ? badge('آنلاین', 'info') : badge('آفلاین')}${perr.length ? badge('خطای Provisioning', 'bad') : clients.length ? badge('Provisioned', 'brand') : ''}</div></div></div>
        <div class="btn-group">
          <button class="btn sm" data-uact="edit">ویرایش</button>
          <button class="btn sm" data-uact="renew">تمدید / حجم</button>
          <button class="btn sm" data-uact="provision">${ic('refresh')}Re-provision</button>
          <button class="btn sm" data-uact="toggle">${u.user_status === 'blocked' ? 'رفع مسدودی' : 'مسدود'}</button>
          <button class="btn sm ${u.device_session_active ? 'primary-soft' : 'ghost'}" data-uact="release" ${u.device_session_active ? '' : 'disabled title="این کاربر Session فعالی ندارد"'}>${u.device_session_active ? 'Reset Session' : 'بدون Session فعال'}</button>
          <button class="btn sm danger" data-uact="del">حذف</button>
        </div>
      </div>
      <div class="ud-stats">
        <div class="ud-stat"><span>مصرف‌شده</span><strong><bdi>${fmtBytes(u.used_bytes)}</bdi></strong><small>از ${u.unlimited ? 'نامحدود' : fb(u.quota_bytes)}</small></div>
        <div class="ud-stat"><span>باقی‌مانده</span><strong><bdi>${remaining}</bdi></strong><small>${u.unlimited ? 'بدون سقف حجم' : `${fa(Math.round(100 - usagePct(u)))}٪ از سهمیه`}</small></div>
        <div class="ud-stat"><span>انقضا</span><strong>${fmtDay(u.expires_at)}</strong><small>${u.days_left != null ? `${fa(u.days_left)} روز مانده` : 'بدون تاریخ انقضا'}</small></div>
        <div class="ud-stat"><span>اتصال</span><strong>${u.online ? 'آنلاین' : 'آفلاین'}</strong><small>آخرین اتصال: ${ago(u.last_connect_at)}</small></div>
      </div>
      ${usageBar(u, 'lg')}
      ${section('Subscription', `${fa(subs.length)} مورد`, subs.length ? subs.map((s) => `<div class="list-row"><div class="main"><div><strong>${esc(s.name)}</strong><small>${fa(s.last_count)} کانفیگ · ${s.last_error ? 'خطا در آخرین دریافت' : s.enabled ? 'فعال' : 'غیرفعال'}</small></div></div></div><div class="list-row">${copyField(s.url, 'کپی Subscription')}</div>`).join('') : '<div class="list-empty">Subscription اختصاصی برای این کاربر ثبت نشده است</div>')}
      ${section('3X-UI · سرور و Inbound', `${fa(clients.length)} کلاینت`, `${clients.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>سرور</th><th>Inbound</th><th>پروتکل</th><th>Client</th><th>مصرف</th><th>وضعیت</th></tr></thead><tbody>${clients.map((c) => `<tr><td>${esc(c.server)}</td><td class="num"><bdi class="mono">#${esc(c.inbound_id)}</bdi></td><td><bdi class="mono">${esc(c.protocol)}</bdi></td><td class="cell-trunc"><bdi class="mono trunc" title="${esc(c.email)}">${esc(c.email)}</bdi>${c.last_error ? `<span class="sub-line err-text trunc">${esc(c.last_error)}</span>` : ''}</td><td class="num"><bdi>${fmtBytes(c.used_bytes)}</bdi></td><td>${c.enabled ? badge('فعال', 'ok') : badge('قطع', 'bad')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="list-empty">کلاینتی در 3X-UI برای این کاربر ساخته نشده است</div>'}${perr.length ? `<div class="error-box">${perr.map((x) => esc([x.server, x.inbound ? `inbound ${x.inbound}` : '', x.error].filter(Boolean).join(' · '))).join('<br>')}</div>` : ''}`)}
      ${section('کانفیگ‌ها', `${fa(configs.length)} کانفیگ اختصاصی · ${fa(u.allowed_config_count)} در دسترس`, configs.length ? configs.map((c) => `<div class="list-row"><div class="main"><span class="act-ic">${ic('link')}</span><div><strong>${esc(c.name)}</strong><small><bdi class="mono">${esc(c.protocol)}</bdi> · <bdi class="mono">${esc(c.endpoint)}</bdi>${c.country ? ` · ${esc(c.country)}` : ''}</small></div></div><div class="btn-group">${c.enabled ? '' : badge('غیرفعال')}<button class="btn sm" data-copy="${esc(c.link || '')}">${ic('copy')}کپی کانفیگ</button></div></div>`).join('') : '<div class="list-empty">کانفیگ اختصاصی ندارد؛ کانفیگ‌های عمومی/گروهی همچنان در دسترس‌اند</div>')}
      <div class="ud-meta"><span>ساخته‌شده: ${fmtDate(u.created_at)}</span><span>آخرین ورود به اپ: ${fmtDate(u.last_login_at)}</span>${u.note ? `<span>یادداشت: ${esc(u.note)}</span>` : ''}</div>
    `, null, { wide: true, noFocus: true });
    $$('#modal-body [data-uact]').forEach((b) => b.addEventListener('click', guard(async () => {
      const act = b.dataset.uact;
      if (act === 'edit' || act === 'renew') { closeModal(); return userAction(act, u); }
      b.disabled = true;
      try { await userAction(act, u); } finally { b.disabled = false; }
    })));
  }

  function userForm(u) {
    const edit = !!u;
    const servers = (cache.servers || []).filter((s) => s.enabled && s.xui_url);
    const serverOptions = servers.map((s) => `<option value="${s.id}" ${s.provision_inbounds.length ? '' : 'disabled'}>${esc(s.name)}${s.country ? ` · ${esc(s.country)}` : ''}${s.provision_inbounds.length ? '' : ' (inbound انتخاب نشده)'}</option>`).join('');
    openModal(edit ? `ویرایش ${u.username}` : 'افزودن کاربر', `
      <form class="grid2" novalidate>
        <div class="form-section">حساب کاربری</div>
        <label>نام کاربری<input name="username" class="ltr" value="${esc(u?.username)}" required pattern="[a-zA-Z0-9._\\-]{3,32}" title="۳ تا ۳۲ کاراکتر انگلیسی، عدد، . _ -"><span class="hint">۳ تا ۳۲ کاراکتر انگلیسی، عدد، . _ -</span></label>
        <label>رمز عبور ${edit ? '<span class="muted">(خالی = بدون تغییر)</span>' : ''}<input name="password" class="ltr" type="text" minlength="6" ${edit ? '' : 'required'} autocomplete="new-password"><span class="hint">حداقل ۶ کاراکتر؛ برای ورود به اپ</span></label>
        <div class="form-section">اشتراک</div>
        <label>حجم کل (GB) <input name="quota_gb" type="number" step="0.01" min="0" value="${u ? +(u.quota_bytes / GB).toFixed(2) : 50}"><span class="hint">۰ = نامحدود</span></label>
        ${edit ? `<label>تاریخ انقضا (میلادی)<input name="expires" type="date" class="ltr" value="${toDateInput(u.expires_at)}"><span class="hint">خالی = بدون انقضا</span></label>`
              : '<label>مدت اعتبار (روز)<input name="days" type="number" min="0" value="30"><span class="hint">۰ = بدون انقضا</span></label>'}
        <label>گروه<select name="group_id">${groupOptions(u?.group_id)}</select></label>
        <label>یادداشت<input name="note" value="${esc(u?.note)}" placeholder="اختیاری"></label>
        ${!edit ? `<div class="wizard-block"><h3>Provisioning در 3X-UI</h3><p>کلاینت 3X-UI، کانفیگ اختصاصی و Subscription همین کاربر در همین مرحله ساخته می‌شود. اگر سروری انتخاب نکنید، روی همه inboundهای انتخاب‌شده در بخش سرورها ساخته می‌شود.</p>
          <label>سرور 3X-UI<select name="provision_server_id" id="provision-server"><option value="">همه سرورها و inboundهای انتخاب‌شده</option>${serverOptions}</select></label>
          <label>Inbound<select name="provision_inbound_id" id="provision-inbound" disabled><option value="">ابتدا سرور را انتخاب کنید</option></select></label>
          <label class="switch full"><input type="checkbox" name="auto_provision" checked> ساخت خودکار Client، Config و Subscription</label>
        </div>` : `<div class="full"><div class="sub">کلاینت‌های خودکار در 3X-UI</div>${u.xui_clients.length ? `<div class="checklist">${u.xui_clients.map((c) => `<div><span class="badge ${c.enabled ? 'ok' : 'bad'}">${c.enabled ? 'فعال' : 'قطع'}</span> ${esc(c.server)} · <bdi class="mono">${esc(c.protocol)}</bdi> · <bdi class="mono">${esc(c.email)}</bdi> · <bdi>${fmtBytes(c.used_bytes)}</bdi>${c.last_error ? ` <span class="err-text">${esc(c.last_error)}</span>` : ''}</div>`).join('')}</div>` : '<span class="muted">هنوز کلاینتی ساخته نشده</span>'}
          <div class="actions sub-actions"><button type="button" class="btn sm" id="provision-btn">${ic('refresh')}ساخت کلاینت‌های جاافتاده در 3X-UI</button></div></div>`}
        <div class="form-section">پیشرفته</div>
        <label class="full">ایمیل کلاینت دستی در 3X-UI <span class="muted">(اختیاری؛ فقط برای کلاینت‌های قدیمی)</span><input name="xui_email" class="ltr" value="${esc(u?.xui_email)}"></label>
        <div class="full"><div class="sub">کانفیگ‌های اختصاصی</div>${configChecklist(u?.config_ids)}</div>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">${edit ? 'ذخیره تغییرات' : 'ایجاد کاربر'}</button></div>
      </form>`, async (f) => {
      const username = f.username.value.trim();
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new Error('نام کاربری باید ۳ تا ۳۲ کاراکتر انگلیسی، عدد یا . _ - باشد');
      if (!edit && f.password.value.length < 6) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد');
      if (edit && f.password.value && f.password.value.length < 6) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد');
      const quota = Number(f.quota_gb.value || 0);
      if (!Number.isFinite(quota) || quota < 0) throw new Error('حجم باید عدد صفر یا بیشتر باشد');
      const body = {
        username, quota_gb: quota,
        group_id: f.group_id.value ? +f.group_id.value : null, xui_email: f.xui_email.value.trim() || null, note: f.note.value,
        config_ids: $$('input[name=config_ids]:checked', f).map((x) => +x.value),
      };
      if (!edit) {
        body.auto_provision = f.auto_provision.checked;
        body.provision_server_id = f.provision_server_id.value ? +f.provision_server_id.value : null;
        body.provision_inbound_id = f.provision_inbound_id.value ? +f.provision_inbound_id.value : null;
        if (body.auto_provision && body.provision_server_id && !body.provision_inbound_id) throw new Error('برای سرور انتخاب‌شده، Inbound را هم انتخاب کنید');
      }
      if (f.password.value) body.password = f.password.value;
      if (edit) body.expires_at = f.expires.value ? new Date(`${f.expires.value}T23:59:59`).getTime() : null;
      else {
        const days = Number(f.days.value || 0);
        if (!Number.isInteger(days) || days < 0) throw new Error('مدت اعتبار باید عدد صحیح صفر یا بیشتر باشد');
        body.days = days;
      }
      const r = await api(edit ? 'PUT' : 'POST', edit ? `/api/admin/users/${u.id}` : '/api/admin/users', body);
      const bad = !!(r.provision?.errors?.length || r.xui_errors?.length);
      closeModal(); toast(edit ? `ذخیره شد${xuiErr(r)}` : `کاربر ایجاد شد${provisionMsg(r.provision)}`, bad); reload();
    });
    // Server -> only the inbounds of that server that are selected as provisioning targets.
    const server = $('#provision-server');
    const inbound = $('#provision-inbound');
    if (server && inbound) server.addEventListener('change', guard(async () => {
      inbound.disabled = true;
      if (!server.value) { inbound.innerHTML = '<option value="">ابتدا سرور را انتخاب کنید</option>'; return; }
      inbound.innerHTML = '<option value="">در حال دریافت Inboundها…</option>';
      const s = cache.servers.find((x) => x.id === +server.value);
      try {
        const r = await api('GET', `/api/admin/servers/${server.value}/inbounds`);
        const list = r.inbounds.filter((x) => x.supported !== false && (!s || s.provision_inbounds.includes(x.id)));
        inbound.innerHTML = list.length
          ? `<option value="">یک Inbound را انتخاب کنید</option>${list.map((x) => `<option value="${x.id}">${esc(x.remark || `#${x.id}`)} · ${esc(x.protocol)} · ${x.port}</option>`).join('')}`
          : '<option value="">Inbound قابل استفاده‌ای برای این سرور انتخاب نشده</option>';
        inbound.disabled = !list.length;
      } catch (e) { inbound.innerHTML = '<option value="">دریافت Inboundها ناموفق بود</option>'; throw e; }
    }));
    const pb = $('#provision-btn');
    if (pb) pb.addEventListener('click', guard(async () => {
      const r = await api('POST', `/api/admin/users/${u.id}/provision`);
      toast(`انجام شد${provisionMsg(r.provision)}`, r.provision.errors.length > 0); closeModal(); reload();
    }));
  }
  function renewForm(u) {
    openModal(`تمدید / تغییر حجم: ${u.username}`, `
      <form class="grid2">
        <div class="callout full">${ic('info')}<span>انقضای فعلی: <strong>${fmtDay(u.expires_at)}</strong> · حجم فعلی: <strong><bdi>${u.unlimited ? 'نامحدود' : fmtBytes(u.quota_bytes)}</bdi></strong> · مصرف: <strong><bdi>${fmtBytes(u.used_bytes)}</bdi></strong></span></div>
        <label>افزودن روز<input name="add_days" type="number" min="0" value="30"></label>
        <label>افزودن حجم (GB)<input name="add_gb" type="number" min="0" step="0.01" value="0"></label>
        <label class="switch full"><input type="checkbox" name="reset_usage"> صفر کردن مصرف (شروع دوره جدید)</label>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">اعمال</button></div>
      </form>`, async (f) => {
      const r = await api('POST', `/api/admin/users/${u.id}/renew`, { add_days: +f.add_days.value || 0, add_gb: +f.add_gb.value || 0, reset_usage: f.reset_usage.checked });
      closeModal(); toast(`اشتراک به‌روز شد${xuiErr(r)}`, !!r.xui_errors?.length); reload();
    });
  }

  // ------------------------------------------------------------ configs
  // Presentation-only grouping. Every config stays an independent record in the backend;
  // the page just shows them under the thing that really owns them:
  //   1. configs with subscription_id        -> grouped under that Subscription
  //   2. 3X-UI configs of exactly one user   -> grouped under that user (no subscription link)
  //   3. everything else (manual, shared)    -> listed individually
  const subHealth = (x) => (!x.enabled ? badge('غیرفعال') : x.last_error ? `<span class="badge warn" title="${esc(x.last_error)}">خطا</span>` : x.last_fetch_at ? badge('فعال', 'ok') : badge('دریافت نشده', 'warn'));
  const regionName = (() => { try { const d = new Intl.DisplayNames(['fa'], { type: 'region' }); return (cc) => { try { return d.of(cc); } catch { return cc; } }; } catch { return (cc) => cc; } })();
  /** Location label of one config, read from its own data: flag emoji in the name, then its country field, then its name. */
  function locationOf(c) {
    const flag = String(c.name || '').match(/([\u{1F1E6}-\u{1F1FF}]{2})/u);
    if (flag) {
      const cc = [...flag[1]].map((ch) => String.fromCharCode(ch.codePointAt(0) - 0x1F1E6 + 65)).join('');
      return { flag: flag[1], label: regionName(cc) };
    }
    if (c.country) return { flag: '', label: c.country };
    return { flag: '', label: c.name || c.endpoint || `#${c.id}` };
  }
  const locationsLine = (configs, max = 4) => {
    const seen = new Map();
    configs.forEach((c) => { const l = locationOf(c); if (!seen.has(l.label)) seen.set(l.label, l); });
    const all = [...seen.values()];
    if (!all.length) return '<span class="muted">بدون کانفیگ</span>';
    const shown = all.slice(0, max).map((l) => `<span>${l.flag ? `${l.flag} ` : ''}${esc(l.label)}</span>`).join('<i>·</i>');
    return `${shown}${all.length > max ? `<i>·</i><span class="muted">+${fa(all.length - max)} مورد دیگر</span>` : ''}`;
  };
  const usernames = (ids) => (ids || []).map((id) => cache.users.find((u) => u.id === id)?.username).filter(Boolean);
  const scopeLine = (scope, userIds, groupIds) => {
    if (scope === 'all') return 'همه کاربران';
    if (scope === 'groups') { const g = (groupIds || []).map(groupName).filter(Boolean); return `گروه‌ها · ${g.length ? g.join('، ') : '—'}`; }
    return `کاربر خاص · ${fa((userIds || []).length)} کاربر`;
  };

  function buildGroups() {
    const groups = [];
    const used = new Set();
    for (const s of cache.subs) {
      const configs = cache.configs.filter((c) => c.subscription_id === s.id);
      configs.forEach((c) => used.add(c.id));
      const owners = s.scope === 'users' ? usernames(s.user_ids) : [];
      groups.push({ key: `s${s.id}`, kind: 'sub', sub: s, configs,
        title: owners.length === 1 ? owners[0] : s.name,
        subtitle: owners.length === 1 && s.name !== owners[0] ? s.name : '',
        scope: scopeLine(s.scope, s.user_ids, s.group_ids), url: s.url });
    }
    const byUser = new Map();
    for (const c of cache.configs) {
      if (used.has(c.id) || c.source !== 'xui' || c.scope !== 'users' || c.user_ids.length !== 1) continue;
      const uid = c.user_ids[0];
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(c); used.add(c.id);
    }
    for (const [uid, configs] of byUser) {
      const user = cache.users.find((u) => u.id === uid);
      groups.push({ key: `u${uid}`, kind: 'user', user, configs, title: user?.username || `کاربر #${uid}`, subtitle: '', scope: 'کاربر خاص · ۱ کاربر', url: '' });
    }
    const standalone = cache.configs.filter((c) => !used.has(c.id));
    return { groups, standalone };
  }
  const groupStatus = (g) => {
    const off = g.configs.filter((c) => !c.enabled).length;
    const main = g.kind === 'sub' ? subHealth(g.sub) : (off === g.configs.length ? badge('غیرفعال') : badge('فعال', 'ok'));
    return `${main}${off && off < g.configs.length ? badge(`${fa(off)} غیرفعال`, 'warn') : ''}`;
  };
  const moreMenu = (items) => `<details class="more"><summary class="btn sm ghost" aria-label="بیشتر">⋯</summary><div class="menu">${items}</div></details>`;
  function groupRow(g) {
    const kindLabel = g.kind === 'sub' ? 'Subscription' : '3X-UI · کانفیگ‌های کاربر';
    return `<div class="group-row" data-key="${g.key}">
      <div class="g-main">
        <span class="act-ic">${ic(g.kind === 'sub' ? 'link' : 'users')}</span>
        <div class="g-text">
          <div class="g-title"><strong>${esc(g.title)}</strong>${g.subtitle ? `<span class="muted trunc">${esc(g.subtitle)}</span>` : ''}</div>
          <div class="g-meta"><span>${kindLabel}</span><i>·</i><span>${fa(g.configs.length)} کانفیگ</span><i>·</i><span>${esc(g.scope)}</span>${g.kind === 'sub' ? `<i>·</i><span>به‌روزرسانی ${ago(g.sub.last_fetch_at)}</span>` : ''}</div>
          <div class="loc-line">${locationsLine(g.configs)}</div>
        </div>
      </div>
      <div class="g-side">
        <div class="badges">${groupStatus(g)}</div>
        ${g.url ? `<bdi class="mono trunc g-url" title="${esc(g.url)}">${esc(truncMid(g.url, 34))}</bdi>` : ''}
        <div class="btn-group">
          <button class="btn sm primary-soft" data-act="view">${ic('eye')}مشاهده</button>
          ${g.url ? `<button class="btn sm ghost" data-copy="${esc(g.url)}">${ic('copy')}کپی لینک</button>` : `<button class="btn sm ghost" data-copy="${esc(g.configs.map((c) => c.link).join('\n'))}">${ic('copy')}کپی کانفیگ‌ها</button>`}
          <button class="btn sm ghost" data-act="edit">ویرایش</button>
          ${g.kind === 'sub' ? moreMenu(`<button type="button" data-act="refresh">${ic('refresh')}به‌روزرسانی Subscription</button><button type="button" class="danger" data-act="del">حذف Subscription و کانفیگ‌هایش</button>`) : ''}
        </div>
      </div>
    </div>`;
  }
  /** One config inside a group's detail view, with its own actions. */
  const configRow = (c) => { const l = locationOf(c); return `<div class="list-row cfg-row" data-cid="${c.id}">
      <div class="main"><span class="loc-flag">${l.flag || ic('link')}</span><div><strong>${esc(l.label)}</strong><small><bdi class="mono">${esc(c.protocol)}</bdi> · <bdi class="mono">${esc(c.endpoint)}</bdi> · اولویت ${fa(c.priority)}${l.label !== c.name ? ` · ${esc(c.name)}` : ''}</small></div></div>
      <div class="btn-group">${c.enabled ? badge('فعال', 'ok') : badge('غیرفعال')}
        <button class="btn sm ghost" data-copy="${esc(c.link || '')}">کپی</button>
        <button class="btn sm ghost" data-cact="edit">ویرایش</button>
        <button class="btn sm ghost" data-cact="toggle">${c.enabled ? 'غیرفعال' : 'فعال'}</button>
        <button class="btn sm ghost" data-cact="del">حذف</button></div></div>`; };

  async function configAction(act, c) {
    if (act === 'edit') { closeModal(); configForm(c); return false; }
    if (act === 'toggle') { await api('PUT', `/api/admin/configs/${c.id}`, { enabled: !c.enabled }); toast('وضعیت تغییر کرد'); return true; }
    if (act === 'del' && confirmBox(`کانفیگ «${c.name}» حذف شود؟`)) { await api('DELETE', `/api/admin/configs/${c.id}`); toast('حذف شد'); return true; }
    return false;
  }
  async function subAction(act, x) {
    if (act === 'refresh') { const r = await api('POST', `/api/admin/subscriptions/${x.id}/refresh`); toast(subMsg(r.refresh), !r.refresh.ok); return true; }
    if (act === 'edit') { closeModal(); subForm(x); return false; }
    if (act === 'del' && confirmBox(`Subscription «${x.name}» و همه کانفیگ‌هایش حذف شوند؟`)) { await api('DELETE', `/api/admin/subscriptions/${x.id}`); closeModal(); toast('حذف شد'); return true; }
    return false;
  }

  pages.configs = async () => {
    await loadRefs();
    const { users } = await api('GET', '/api/admin/users');
    cache.users = users;
    const target = (c) => c.scope === 'all' ? 'همه کاربران' : c.scope === 'groups'
      ? c.group_ids.map((id) => groupName(id)).filter(Boolean).join('، ') || '—'
      : `${fa(c.user_ids.length)} کاربر`;
    const { groups, standalone } = buildGroups();
    $('#page').innerHTML = `
      ${pageHead('لینک‌ها و کانفیگ‌ها', 'هر Subscription یا کاربر یک ردیف است؛ کانفیگ‌های هر کدام در «مشاهده»', `
        <button class="btn ghost" id="bulk-cfg">افزودن گروهی</button>
        <button class="btn ghost" id="add-cfg">کانفیگ تکی</button>
        <button class="btn" id="add-sub">${ic('link')}افزودن Subscription</button>
        <button class="btn primary" id="import-cfg">${ic('plus')}افزودن لینک</button>`)}
      <div class="section-head"><div><h2>Subscriptionها و کانفیگ‌های کاربران</h2><p>${fa(groups.length)} مورد · ${fa(groups.reduce((n, g) => n + g.configs.length, 0))} کانفیگ</p></div></div>
      <div class="card group-list" id="sub-body">${groups.map(groupRow).join('') || '<div class="list-empty">Subscription یا کانفیگ کاربری ثبت نشده است</div>'}</div>

      <div class="section">
        <div class="section-head"><div><h2>کانفیگ‌های مستقل</h2><p>کانفیگ‌های دستی یا اشتراکی که به Subscription یا کاربر مشخصی تعلق ندارند</p></div><span class="badge plain">${fa(standalone.length)} کانفیگ</span></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>نام</th><th>منبع</th><th>پروتکل</th><th>سرور</th><th>تخصیص</th><th>اولویت</th><th>وضعیت</th><th class="actions">عملیات</th></tr></thead><tbody id="cfg-body">
        ${standalone.map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.country ? `<span class="sub-line">${esc(c.country)}</span>` : ''}</td>
          <td><span class="badge plain ${c.source === 'xui' ? 'brand' : c.source === 'subscription' ? 'info' : ''}">${SOURCE[c.source] || 'دستی'}</span></td>
          <td><bdi class="mono">${esc(c.protocol)}</bdi></td><td class="cell-trunc"><bdi class="mono trunc" title="${esc(c.endpoint)}">${esc(c.endpoint)}</bdi></td>
          <td>${SCOPE[c.scope]}<span class="sub-line">${esc(target(c))}</span></td>
          <td class="num">${fa(c.priority)}</td>
          <td>${c.enabled ? badge('فعال', 'ok') : badge('غیرفعال')}</td>
          <td class="actions"><div class="btn-group"><button class="btn sm ghost" data-copy="${esc(c.link || '')}">کپی</button><button class="btn sm ghost" data-act="edit" data-id="${c.id}">ویرایش</button>
            <button class="btn sm ghost" data-act="toggle" data-id="${c.id}">${c.enabled ? 'غیرفعال' : 'فعال'}</button>
            <button class="btn sm ghost" data-act="del" data-id="${c.id}">حذف</button></div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">کانفیگ مستقلی وجود ندارد</td></tr>'}
        </tbody></table></div>
      </div>`;
    $('#add-cfg').addEventListener('click', () => configForm());
    $('#bulk-cfg').addEventListener('click', () => bulkForm());
    $('#add-sub').addEventListener('click', () => subForm());
    $('#import-cfg').addEventListener('click', () => importForm());
    $('#sub-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const g = groups.find((x) => x.key === b.closest('.group-row').dataset.key);
      b.closest('details')?.removeAttribute('open');
      if (b.dataset.act === 'view') return groupDetail(g.key);
      if (b.dataset.act === 'edit') return g.kind === 'sub' ? subForm(g.sub) : (g.user ? userForm(g.user) : null);
      b.disabled = true;
      try { if (g.kind === 'sub' && await subAction(b.dataset.act, g.sub)) reload(); } finally { b.disabled = false; }
    }));
    $('#cfg-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const c = cache.configs.find((x) => x.id === +b.dataset.id);
      if (await configAction(b.dataset.act, c)) reload();
    }));
  };

  /** Detail view of one group (Subscription or user). Re-reads data after every change so it never shows stale rows. */
  async function groupDetail(key) {
    const g = buildGroups().groups.find((x) => x.key === key);
    if (!g) { closeModal(); return; }
    const s = g.sub;
    openModal(g.kind === 'sub' ? `Subscription · ${g.title}` : `کانفیگ‌های ${g.title}`, `
      <div class="ud-stats">
        <div class="ud-stat"><span>وضعیت</span><strong>${s ? (s.enabled ? (s.last_error ? 'خطا' : 'فعال') : 'غیرفعال') : `${fa(g.configs.filter((c) => c.enabled).length)} فعال`}</strong><small class="trunc">${esc(s?.last_error || (s ? `آخرین دریافت: ${fa(s.last_count)} کانفیگ` : 'از 3X-UI'))}</small></div>
        <div class="ud-stat"><span>کانفیگ‌ها</span><strong>${fa(g.configs.length)}</strong><small>${fa(g.configs.filter((c) => !c.enabled).length)} غیرفعال</small></div>
        <div class="ud-stat"><span>آخرین به‌روزرسانی</span><strong>${s ? ago(s.last_fetch_at) : '—'}</strong><small>${s ? fmtDate(s.last_fetch_at) : 'Provisioning خودکار'}</small></div>
        <div class="ud-stat"><span>تخصیص</span><strong class="trunc">${esc(g.scope.split(' · ')[0])}</strong><small class="trunc">${esc(s && s.scope === 'users' ? usernames(s.user_ids).join('، ') || '—' : g.scope.split(' · ')[1] || g.title)}</small></div>
      </div>
      ${g.url ? `<section class="ud-section"><header><h3>لینک Subscription</h3><span class="muted">آدرس واقعی ذخیره‌شده</span></header><div class="list-row">${copyField(g.url, 'کپی لینک')}</div></section>` : ''}
      <section class="ud-section"><header><h3>کانفیگ‌ها</h3><span class="muted">${fa(g.configs.length)} مورد · هر کدام جدا قابل مدیریت</span></header>
        <div id="group-configs">${g.configs.map(configRow).join('') || '<div class="list-empty">کانفیگی در این گروه نیست</div>'}</div>
      </section>
      ${s ? `<div class="form-actions"><button class="btn primary" id="sub-refresh">${ic('refresh')}به‌روزرسانی الان</button><button class="btn" id="sub-edit">ویرایش Subscription</button><span class="spacer"></span><button class="btn danger" id="sub-del">حذف</button></div>` : ''}
    `, null, { wide: true, noFocus: true });
    const again = async () => { await loadRefs(); groupDetail(key); };
    $('#group-configs').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('[data-cact]'); if (!b) return;
      const c = g.configs.find((x) => x.id === +b.closest('[data-cid]').dataset.cid);
      b.disabled = true;
      try { if (await configAction(b.dataset.cact, c)) { await again(); refreshUnderlying(); } } finally { b.disabled = false; }
    }));
    if (s) {
      $('#sub-refresh').addEventListener('click', guard(async (e) => { e.currentTarget.disabled = true; if (await subAction('refresh', s)) { await again(); refreshUnderlying(); } }));
      $('#sub-edit').addEventListener('click', () => subAction('edit', s));
      $('#sub-del').addEventListener('click', guard(async () => { if (await subAction('del', s)) reload(); }));
    }
  }
  /** Re-render the configs page behind an open modal without closing it. */
  function refreshUnderlying() { if (current === 'configs') guard(async () => { await pages.configs(); paint($('#page')); })(); }

  const assignFields = (c) => `
    <div class="form-section">تخصیص</div>
    <label>دامنه تخصیص<select name="scope">${Object.entries(SCOPE).map(([k, v]) => `<option value="${k}" ${(c?.scope || 'users') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>سرور آمار <span class="muted">(اختیاری)</span><select name="server_id"><option value="">—</option>${(cache.servers || []).map((s) => `<option value="${s.id}" ${c?.server_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="full" data-scope="users"><div class="sub">کاربران</div><div class="checklist">${cache.users.map((u) => `<label><input type="checkbox" name="user_ids" value="${u.id}" ${c?.user_ids?.includes(u.id) ? 'checked' : ''}> ${esc(u.username)}</label>`).join('') || '<span class="muted">کاربری نیست</span>'}</div></div>
    <div class="full" data-scope="groups"><div class="sub">گروه‌ها</div><div class="checklist">${cache.groups.map((g) => `<label><input type="checkbox" name="group_ids" value="${g.id}" ${c?.group_ids?.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('') || '<span class="muted">گروهی نیست</span>'}</div></div>`;
  function bindScope(f) {
    const upd = () => $$('[data-scope]', f).forEach((el) => el.classList.toggle('hidden', el.dataset.scope !== f.scope.value));
    f.scope.addEventListener('change', upd); upd();
  }
  const assignBody = (f) => ({
    scope: f.scope.value, server_id: f.server_id.value ? +f.server_id.value : null,
    user_ids: $$('input[name=user_ids]:checked', f).map((x) => +x.value), group_ids: $$('input[name=group_ids]:checked', f).map((x) => +x.value),
  });

  function configForm(c) {
    const edit = !!c;
    openModal(edit ? `ویرایش ${c.name}` : 'کانفیگ جدید', `
      <form class="grid2">
        <div class="form-section">لینک</div>
        <label class="full">لینک کانفیگ <span class="muted">(vless / vmess / trojan / ss)</span><textarea name="link" required>${esc(c?.link)}</textarea></label>
        <div class="full actions"><button class="btn sm" type="button" id="validate-btn">بررسی لینک</button><span id="validate-out" class="muted"></span></div>
        <div class="form-section">جزئیات</div>
        <label>نام <span class="muted">(خالی = از لینک)</span><input name="name" value="${esc(c?.name)}"></label>
        <label>کشور / موقعیت<input name="country" value="${esc(c?.country)}"></label>
        <label>اولویت <span class="muted">(کمتر = مهم‌تر)</span><input name="priority" type="number" min="0" value="${c?.priority ?? 100}"></label>
        <label class="switch"><input type="checkbox" name="enabled" ${!c || c.enabled ? 'checked' : ''}> فعال</label>
        ${assignFields(c)}
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">${edit ? 'ذخیره' : 'افزودن'}</button></div>
      </form>`, async (f) => {
      const body = { link: f.link.value.trim(), country: f.country.value.trim(), priority: +f.priority.value || 0, enabled: f.enabled.checked, ...assignBody(f) };
      if (f.name.value.trim()) body.name = f.name.value.trim();
      await api(edit ? 'PUT' : 'POST', edit ? `/api/admin/configs/${c.id}` : '/api/admin/configs', body);
      closeModal(); toast('ذخیره شد'); reload();
    });
    const f = $('#modal-body form'); bindScope(f);
    $('#validate-btn').addEventListener('click', async () => {
      const out = $('#validate-out');
      try {
        const r = await api('POST', '/api/admin/configs/validate', { link: f.link.value.trim() });
        out.innerHTML = `<span class="badge ok">معتبر</span> <bdi class="mono">${esc(r.protocol)} · ${esc(r.address)}:${r.port} · ${esc(r.network)}/${esc(r.security)}</bdi>`;
        if (!f.name.value && r.name) f.name.value = r.name;
      } catch (e) { out.innerHTML = `<span class="badge bad">نامعتبر</span> ${esc(e.message)}`; }
    });
  }
  const subMsg = (r) => (r.ok
    ? `${r.total.toLocaleString('fa-IR')} کانفیگ · ${r.added.toLocaleString('fa-IR')} جدید · ${r.removed.toLocaleString('fa-IR')} حذف${r.invalid ? ` · ${r.invalid.toLocaleString('fa-IR')} نامعتبر` : ''}`
    : `دریافت نشد: ${r.error}`);
  function importForm() {
    openModal('افزودن لینک', `
      <form class="grid2">
        <div class="callout full">${ic('info')}<span>هر مورد در یک خط: <bdi class="mono">vless:// vmess:// trojan:// ss://</bdi> یا لینک Subscription <bdi class="mono">https://…</bdi>. هیچ API یا رمزی از پنل مبدأ لازم نیست؛ فقط خود کانفیگ ذخیره می‌شود.</span></div>
        <label class="full">متن یا لینک کانفیگ<textarea name="text" required placeholder="vless://...&#10;vmess://...&#10;trojan://...&#10;ss://...&#10;https://example.com/sub/..."></textarea></label>
        <div class="full actions"><button class="btn sm" type="button" id="import-check">بررسی</button><span class="muted" id="import-sum"></span></div>
        <div class="full" id="import-preview"></div>
        <div class="form-section">جزئیات</div>
        <label>نام <span class="muted">(اختیاری، فقط وقتی یک مورد است)</span><input name="name"></label>
        <label>کشور / موقعیت<input name="country"></label>
        <label>اولویت<input name="priority" type="number" min="0" value="100"></label>
        <label class="switch"><input type="checkbox" name="enabled" checked> فعال</label>
        ${assignFields({ scope: 'all' })}
        <p class="hint full">حجم و مصرف برای کانفیگ دستی اختیاری است؛ اگر اطلاعات مصرف نباشد، اپ «حجم نامشخص» نشان می‌دهد و اتصال فعال می‌ماند.</p>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">ذخیره</button></div>
      </form>`, async (f) => {
      try {
        const r = await api('POST', '/api/admin/configs/import', { ...importBody(f), save: true });
        renderImport(r.items);
        const bad = r.items.filter((i) => !i.valid).length;
        toast(`${r.saved.configs.toLocaleString('fa-IR')} کانفیگ${r.saved.subscriptions ? ` و ${r.saved.subscriptions.toLocaleString('fa-IR')} Subscription` : ''} ذخیره شد${bad ? ` · ${bad.toLocaleString('fa-IR')} مورد نامعتبر رد شد` : ''}`, bad > 0);
        if (!bad) { closeModal(); reload(); }
      } catch (e) { if (e.data?.items) renderImport(e.data.items); throw e; }
    });
    const f = $('#modal-body form'); bindScope(f);
    $('#import-check').addEventListener('click', guard(async () => {
      if (!f.text.value.trim()) return;
      const r = await api('POST', '/api/admin/configs/import', { ...importBody(f), save: false });
      renderImport(r.items);
    }));
  }
  const importBody = (f) => {
    const b = { text: f.text.value, country: f.country.value.trim(), priority: +f.priority.value || 0, enabled: f.enabled.checked, ...assignBody(f) };
    delete b.server_id;
    if (f.name.value.trim()) b.name = f.name.value.trim();
    return b;
  };
  function renderImport(items) {
    const ok = items.filter((i) => i.valid).length;
    $('#import-sum').textContent = `${ok.toLocaleString('fa-IR')} معتبر · ${(items.length - ok).toLocaleString('fa-IR')} نامعتبر`;
    const row = (k, val) => (val || val === 0 ? `<span><span class="muted">${k}:</span> <bdi class="mono">${esc(val)}</bdi></span>` : '');
    $('#import-preview').innerHTML = `<div class="checklist import-list">${items.map((i) => `<div class="import-item">
      <div><span class="badge ${i.valid ? 'ok' : 'bad'}">${i.valid ? 'معتبر' : 'نامعتبر'}</span> <strong>${i.kind === 'subscription' ? 'Subscription' : esc(i.details?.name || i.details?.protocol || 'کانفیگ')}</strong> <span class="muted">· مورد ${i.index.toLocaleString('fa-IR')}</span></div>
      ${i.valid && i.kind === 'config' ? `<div class="kv">${row('پروتکل', i.details.protocol)}${row('سرور', i.details.address)}${row('پورت', i.details.port)}${row(i.details.credential_type, i.details.credential)}${row('Network', i.details.network)}${row('Security', i.details.security)}${row('SNI', i.details.sni)}${row('Flow', i.details.flow)}${row('Method', i.details.method)}${row('Path', i.details.path)}</div>` : ''}
      ${i.valid && i.kind === 'subscription' ? `<div class="kv">${row('آدرس', truncMid(i.input, 60))}${row('تعداد کانفیگ', i.count)}</div>` : ''}
      ${!i.valid ? `<div class="err-text">${esc(i.error)}</div><div class="mono muted trunc">${esc(i.input)}</div>` : ''}
    </div>`).join('')}</div>`;
  }
  function subForm(x) {
    const edit = !!x;
    openModal(edit ? `ویرایش ${x.name}` : 'افزودن Subscription', `
      <form class="grid2">
        <div class="callout full">${ic('info')}<span>پنل این لینک را دریافت می‌کند، کانفیگ‌ها را ذخیره می‌کند و اپ کاربر در به‌روزرسانی بعدی آن‌ها را می‌گیرد. اپ مستقیماً به آدرس Subscription وصل نمی‌شود.</span></div>
        <label>نام<input name="name" value="${esc(x?.name)}" required></label>
        <label>کشور / موقعیت<input name="country" value="${esc(x?.country)}"></label>
        <label class="full">آدرس Subscription<input name="url" class="ltr" required placeholder="https://sub.example.com:2096/sub/xxxx" value="${esc(x?.url)}"></label>
        <label>اولویت شروع<input name="priority" type="number" min="0" value="${x?.priority ?? 100}"></label>
        <label class="switch"><input type="checkbox" name="enabled" ${!x || x.enabled ? 'checked' : ''}> فعال</label>
        ${assignFields(x)}
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">${edit ? 'ذخیره و به‌روزرسانی' : 'افزودن و دریافت'}</button></div>
      </form>`, async (f) => {
      const body = { name: f.name.value.trim(), country: f.country.value.trim(), url: f.url.value.trim(), priority: +f.priority.value || 0, enabled: f.enabled.checked, ...assignBody(f) };
      delete body.server_id;
      const r = await api(edit ? 'PUT' : 'POST', edit ? `/api/admin/subscriptions/${x.id}` : '/api/admin/subscriptions', body);
      closeModal(); toast(subMsg(r.refresh), !r.refresh.ok); reload();
    });
    bindScope($('#modal-body form'));
  }
  function bulkForm() {
    openModal('افزودن گروهی کانفیگ', `
      <form class="grid2">
        <label class="full">هر لینک در یک خط<textarea name="links" required placeholder="vless://...&#10;vmess://...&#10;trojan://...&#10;ss://..."></textarea></label>
        <label>کشور / موقعیت<input name="country"></label>
        <label>اولویت شروع<input name="priority" type="number" min="0" value="100"></label>
        <label class="switch"><input type="checkbox" name="enabled" checked> فعال</label>
        <label class="switch"><input type="checkbox" name="atomic"> اگر لینک نامعتبر بود، هیچ‌کدام ثبت نشود</label>
        ${assignFields()}
        <div class="full" id="bulk-errors"></div>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">ثبت</button></div>
      </form>`, async (f) => {
      try {
        const r = await api('POST', '/api/admin/configs/bulk', { links: f.links.value, country: f.country.value.trim(), priority: +f.priority.value || 0, enabled: f.enabled.checked, atomic: f.atomic.checked, ...assignBody(f) });
        toast(`${r.created.length} کانفیگ ثبت شد${r.errors.length ? ` · ${r.errors.length} نامعتبر` : ''}`, r.errors.length > 0);
        if (r.errors.length) { showBulkErrors(r.errors); const bad = new Set(r.errors.map((e) => e.line)); f.links.value = f.links.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((_, i) => bad.has(i + 1)).join('\n'); }
        else { closeModal(); reload(); }
      } catch (e) { if (e.data?.errors) showBulkErrors(e.data.errors); throw e; }
    });
    bindScope($('#modal-body form'));
  }
  function showBulkErrors(errs) {
    $('#bulk-errors').innerHTML = `<div class="errlist"><strong>لینک‌های نامعتبر:</strong>${errs.map((e) => `<div>خط ${e.line.toLocaleString('fa-IR')}: <bdi class="mono">${esc(e.link)}…</bdi> — ${esc(e.error)}</div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------- groups
  pages.groups = async () => {
    const { groups } = await api('GET', '/api/admin/groups');
    $('#page').innerHTML = `
      ${pageHead('گروه‌ها', 'گروه‌بندی کاربران برای تخصیص یکجای کانفیگ‌ها', `<button class="btn primary" id="add-group">${ic('plus')}گروه جدید</button>`)}
      <div class="table-wrap"><table class="compact"><thead><tr><th>نام گروه</th><th>تعداد کاربر</th><th class="actions">عملیات</th></tr></thead><tbody id="g-body">
      ${groups.map((g) => `<tr><td><div class="user-cell"><span class="act-ic">${ic('layers')}</span><strong>${esc(g.name)}</strong></div></td><td class="num">${fa(g.user_count)} کاربر</td><td class="actions"><div class="btn-group"><button class="btn sm ghost" data-act="edit" data-id="${g.id}">تغییر نام</button><button class="btn sm ghost" data-act="del" data-id="${g.id}">حذف</button></div></td></tr>`).join('') || '<tr><td colspan="3" class="empty">گروهی وجود ندارد</td></tr>'}
      </tbody></table></div>`;
    const form = (g) => openModal(g ? 'تغییر نام گروه' : 'گروه جدید', `<form><label>نام گروه<input name="name" value="${esc(g?.name)}" required></label><p class="error"></p><div class="form-actions"><button class="btn primary" type="submit">ذخیره</button></div></form>`, async (f) => {
      await api(g ? 'PUT' : 'POST', g ? `/api/admin/groups/${g.id}` : '/api/admin/groups', { name: f.name.value.trim() }); closeModal(); reload();
    });
    $('#add-group').addEventListener('click', () => form());
    $('#g-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const g = groups.find((x) => x.id === +b.dataset.id);
      if (b.dataset.act === 'edit') form(g);
      if (b.dataset.act === 'del' && confirmBox(`گروه «${g.name}» حذف شود؟ کاربران آن بدون گروه می‌شوند.`)) { await api('DELETE', `/api/admin/groups/${g.id}`); reload(); }
    }));
  };

  // ------------------------------------------------------------ servers
  pages.servers = async () => {
    const { servers } = await api('GET', '/api/admin/servers');
    refreshStatus(servers);
    $('#page').innerHTML = `
      ${pageHead('سرورها', 'پنل‌های 3X-UI؛ کلاینت هر کاربر روی inboundهای انتخاب‌شده ساخته می‌شود', `<button class="btn primary" id="add-srv">${ic('plus')}سرور جدید</button>`)}
      <div class="server-grid" id="s-body">
      ${servers.map((s) => { const [t, c] = serverState(s); return `<article class="server-card">
        <div class="server-top"><div><h3>${esc(s.name)} ${s.country ? `<span class="muted">· ${esc(s.country)}</span>` : ''}</h3><bdi class="mono trunc host" title="${esc(s.xui_url)}">${esc(s.effective_host || hostOf(s.xui_url) || '—')}</bdi></div>${badge(t, c)}</div>
        <div class="server-metrics">
          <div><span>Inbound</span><strong>${s.provision_inbounds.length ? `${fa(s.provision_inbounds.length)} inbound` : '<span class="badge warn">inbound انتخاب نشده</span>'}</strong></div>
          <div><span>کلاینت‌ها</span><strong>${fa(s.client_count)} کلاینت</strong></div>
          <div><span>آخرین بررسی</span><strong>${ago(s.last_sync_at)}</strong></div>
        </div>
        ${s.last_sync_error ? `<div class="server-error" title="${esc(s.last_sync_error)}">${esc(s.last_sync_error)}</div>` : ''}
        <div class="server-actions"><button class="btn sm primary-soft" data-act="inbounds" data-id="${s.id}">${ic('plug')}انتخاب inbound</button><button class="btn sm ghost" data-act="edit" data-id="${s.id}">ویرایش</button><span class="spacer"></span><button class="btn sm ghost" data-act="del" data-id="${s.id}">حذف</button></div>
      </article>`; }).join('') || `<div class="empty-state"><h3>هنوز سروری اضافه نشده</h3><p>آدرس پنل 3X-UI و اطلاعات ورود را وارد کنید، سپس inboundهای provisioning را انتخاب کنید.</p></div>`}
      </div>`;
    const form = (s) => openModal(s ? `ویرایش ${s.name}` : 'سرور جدید', `
      <form class="grid2">
        <div class="form-section">مشخصات</div>
        <label>نام<input name="name" value="${esc(s?.name)}" required></label>
        <label>کشور<input name="country" value="${esc(s?.country)}"></label>
        <div class="form-section">اتصال به 3X-UI</div>
        <label class="full">آدرس کامل پنل 3X-UI <span class="muted">(همراه با مسیر مخفی)</span><input name="xui_url" class="ltr" placeholder="https://1.2.3.4:2053/mypath" value="${esc(s?.xui_url)}"></label>
        <label>نام کاربری 3X-UI<input name="xui_username" class="ltr" value="${esc(s?.xui_username)}"></label>
        <label>رمز 3X-UI ${s?.has_password ? '<span class="muted">(خالی = بدون تغییر)</span>' : ''}<input name="xui_password" class="ltr" type="password" autocomplete="new-password"></label>
        <label class="full">آدرس عمومی سرور در لینک کانفیگ<input name="public_host" class="ltr" placeholder="vpn.example.com" value="${esc(s?.public_host)}"><span class="hint">دامنه یا IP که کاربر به آن وصل می‌شود؛ خالی = همان آدرس پنل${s?.effective_host ? ` (${esc(s.effective_host)})` : ''}</span></label>
        <label class="switch"><input type="checkbox" name="enabled" ${!s || s.enabled ? 'checked' : ''}> فعال</label>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">ذخیره</button></div>
      </form>`, async (f) => {
      const body = { name: f.name.value.trim(), country: f.country.value.trim(), xui_url: f.xui_url.value.trim(), xui_username: f.xui_username.value.trim(), public_host: f.public_host.value.trim(), enabled: f.enabled.checked };
      if (f.xui_password.value) body.xui_password = f.xui_password.value;
      await api(s ? 'PUT' : 'POST', s ? `/api/admin/servers/${s.id}` : '/api/admin/servers', body); closeModal(); reload();
    });
    $('#add-srv').addEventListener('click', () => form());
    $('#s-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const s = servers.find((x) => x.id === +b.dataset.id);
      if (b.dataset.act === 'edit') form(s);
      if (b.dataset.act === 'inbounds') { b.disabled = true; try { await inboundPicker(s); } finally { b.disabled = false; } }
      if (b.dataset.act === 'del' && confirmBox(`سرور «${s.name}» حذف شود؟ آمار ذخیره‌شده آن هم حذف می‌شود.`)) { await api('DELETE', `/api/admin/servers/${s.id}`); reload(); }
    }));
  };

  async function inboundPicker(s) {
    const { inbounds } = await api('GET', `/api/admin/servers/${s.id}/inbounds`);
    openModal(`انتخاب inbound · ${s.name}`, `
      <form>
        <div class="callout">${ic('info')}<span>برای هر کاربر جدید، روی inboundهای تیک‌خورده یک کلاینت اختصاصی با حجم و تاریخ انقضای همان کاربر ساخته می‌شود.</span></div>
        <div class="checklist">${inbounds.map((i) => `<label><input type="checkbox" name="ib" value="${i.id}" ${s.provision_inbounds.includes(i.id) ? 'checked' : ''} ${i.supported ? '' : 'disabled'}>
          <span><strong>${esc(i.remark || `#${i.id}`)}</strong> <span class="muted">· <bdi class="mono">${esc(i.protocol)} · ${esc(i.network)}/${esc(i.security)}</bdi> · پورت <bdi>${i.port}</bdi>${i.enable ? '' : ' · خاموش'}${i.supported ? '' : ' · پشتیبانی نمی‌شود'}</span></span></label>`).join('') || '<span class="muted">در این پنل inbound‌ای نیست؛ اول در 3X-UI یک inbound بسازید.</span>'}</div>
        <p class="error"></p>
        <div class="form-actions"><button class="btn primary" type="submit">ذخیره</button></div>
      </form>`, async (f) => {
      await api('PUT', `/api/admin/servers/${s.id}`, { provision_inbounds: $$('input[name=ib]:checked', f).map((x) => +x.value) });
      closeModal(); toast('ذخیره شد. کاربران جدید روی این inboundها ساخته می‌شوند. برای کاربران قبلی از جزئیات کاربر «Re-provision» را بزنید.'); reload();
    }, { noFocus: true });
  }

  // -------------------------------------------------------------- audit
  pages.audit = async () => {
    const { logs } = await api('GET', '/api/admin/audit?limit=200');
    $('#page').innerHTML = `${pageHead('رویدادها', 'آخرین ۲۰۰ عملیات مدیریتی و سیستمی')}
      <div class="table-wrap"><table class="compact"><thead><tr><th>زمان</th><th>انجام‌دهنده</th><th>عملیات</th><th>هدف</th><th>جزئیات</th><th>IP</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td class="num">${fmtDate(l.created_at)}</td><td><bdi class="mono">${esc(l.actor)}</bdi></td><td>${esc(ACTIONS[l.action] || '')}<span class="sub-line"><bdi class="mono">${esc(l.action)}</bdi></span></td><td><bdi class="mono">${esc(l.target || '—')}</bdi></td><td class="cell-trunc"><bdi class="mono trunc" title="${esc(l.details || '')}">${esc(l.details || '—')}</bdi></td><td><bdi class="mono">${esc(l.ip || '—')}</bdi></td></tr>`).join('') || '<tr><td colspan="6" class="empty">رویدادی نیست</td></tr>'}
      </tbody></table></div>`;
  };

  // ----------------------------------------------------------- settings
  pages.settings = async () => {
    const r = await api('GET', '/api/admin/settings');
    const s = r.settings || {};

    const checked = (v) => v ? 'checked' : '';

    $('#page').innerHTML = `${pageHead('تنظیمات', 'مدیریت کامل تنظیمات سیستم')}

      <div class="settings-grid">

        <form class="card card-pad" id="runtime-settings-form">
          <div class="section-head">
            <div>
              <h3 class="m0">تنظیمات نشست و امنیت</h3>
              <div class="hint">مدیریت اعتبار ورود و محدودیت تلاش‌های ناموفق</div>
            </div>
          </div>

          <div class="form-grid">
            <label>
              اعتبار Token کاربر (ساعت)
              <input name="user_token_ttl_hours" type="number" min="1" max="87600"
                value="${esc(s.user_token_ttl_hours)}" required>
            </label>

            <label>
              اعتبار Token مدیر (ساعت)
              <input name="admin_token_ttl_hours" type="number" min="1" max="87600"
                value="${esc(s.admin_token_ttl_hours)}" required>
            </label>

            <label>
              حداکثر تلاش ورود
              <input name="login_max_attempts" type="number" min="1" max="1000"
                value="${esc(s.login_max_attempts)}" required>
            </label>

            <label>
              بازه محدودیت ورود (دقیقه)
              <input name="login_window_minutes" type="number" min="1" max="1440"
                value="${esc(s.login_window_minutes)}" required>
            </label>
          </div>
        </form>

        <form class="card card-pad" id="subscription-settings-form">
          <div class="section-head">
            <div>
              <h3 class="m0">تنظیمات اشتراک</h3>
              <div class="hint">مقادیر پیش‌فرض هنگام ساخت کاربر جدید</div>
            </div>
          </div>

          <div class="form-grid">
            <label>
              حجم پیش‌فرض کاربر (GB)
              <input name="default_quota_gb" type="number" min="0" max="1000000"
                value="${esc(s.default_quota_gb)}" required>
              <span class="hint">۰ یعنی نامحدود</span>
            </label>

            <label>
              مدت پیش‌فرض اشتراک (روز)
              <input name="default_subscription_days" type="number" min="0" max="36500"
                value="${esc(s.default_subscription_days)}" required>
              <span class="hint">۰ یعنی بدون تاریخ انقضا</span>
            </label>
          </div>
        </form>

        <form class="card card-pad" id="sync-settings-form">
          <div class="section-head">
            <div>
              <h3 class="m0">همگام‌سازی</h3>
              <div class="hint">کنترل Sync آمار و بروزرسانی اشتراک‌ها</div>
            </div>
          </div>

          <label class="toggle-row">
            <input name="sync_enabled" type="checkbox" ${checked(s.sync_enabled)}>
            <span>
              <strong>فعال بودن همگام‌سازی</strong>
              <small>Sync آمار 3X-UI و Refresh اشتراک‌ها</small>
            </span>
          </label>

          <div class="form-grid">
            <label>
              فاصله Sync آمار (ثانیه)
              <input name="stats_interval_seconds" type="number" min="5" max="86400"
                value="${esc(s.stats_interval_seconds)}" required>
            </label>

            <label>
              Refresh اشتراک‌ها (دقیقه)
              <input name="subscription_refresh_minutes" type="number" min="1" max="43200"
                value="${esc(s.subscription_refresh_minutes)}" required>
            </label>
          </div>
        </form>

        <form class="card card-pad" id="xui-settings-form">
          <div class="section-head">
            <div>
              <h3 class="m0">3X-UI</h3>
              <div class="hint">نحوه اعمال محدودیت‌ها روی پنل‌های 3X-UI</div>
            </div>
          </div>

          <label class="toggle-row">
            <input name="enforce_on_xui" type="checkbox" ${checked(s.enforce_on_xui)}>
            <span>
              <strong>اعمال محدودیت روی 3X-UI</strong>
              <small>حجم، انقضا و وضعیت کاربر روی کلاینت 3X-UI اعمال شود</small>
            </span>
          </label>

          <label class="toggle-row">
            <input name="xui_allow_insecure_tls" type="checkbox" ${checked(s.xui_allow_insecure_tls)}>
            <span>
              <strong>اجازه TLS ناامن</strong>
              <small>فقط برای پنل‌هایی که گواهی TLS معتبر ندارند</small>
            </span>
          </label>
        </form>

        <form class="card card-pad" id="system-settings-form">
          <div class="section-head">
            <div>
              <h3 class="m0">سیستم</h3>
              <div class="hint">آدرس عمومی سرویس اشتراک</div>
            </div>
          </div>

          <label>
            Public URL
            <input name="public_url" class="ltr" type="url"
              value="${esc(s.public_url || '')}"
              placeholder="https://core.xnetify.ir">
            <span class="hint">برای ساخت لینک عمومی اشتراک‌ها استفاده می‌شود.</span>
          </label>
        </form>

        <form class="card card-pad" id="pw-form">
          <div class="section-head">
            <div>
              <h3 class="m0">حساب مدیر</h3>
              <div class="hint">تغییر رمز ورود به پنل مدیریت</div>
            </div>
          </div>

          <label>
            رمز فعلی
            <input name="current" class="ltr" type="password"
              required autocomplete="current-password">
          </label>

          <label>
            رمز جدید
            <input name="next" class="ltr" type="password"
              minlength="10" required autocomplete="new-password">
            <span class="hint">حداقل ۱۰ کاراکتر</span>
          </label>

          <p class="error"></p>
          <div class="form-actions">
            <button class="btn" type="submit">تغییر رمز مدیر</button>
          </div>
        </form>

      </div>

      <div class="card card-pad settings-save-bar">
        <p class="error" id="settings-error"></p>
        <button class="btn primary" id="save-settings" type="button">ذخیره تنظیمات</button>
      </div>`;

    const forms = [
      '#runtime-settings-form',
      '#subscription-settings-form',
      '#sync-settings-form',
      '#xui-settings-form',
      '#system-settings-form',
    ];

    const collect = () => {
      const out = {};

      for (const selector of forms) {
        const form = $(selector);
        if (!form) continue;

        for (const input of $$('input[name]', form)) {
          if (input.type === 'checkbox') {
            out[input.name] = input.checked;
          } else if (input.type === 'number') {
            out[input.name] = Number(input.value);
          } else {
            out[input.name] = input.value.trim();
          }
        }
      }

      return out;
    };

    $('#save-settings').addEventListener('click', async () => {
      const error = $('#settings-error');
      error.textContent = '';

      try {
        await api('PUT', '/api/admin/settings', collect());
        toast('تنظیمات با موفقیت ذخیره شد');
      } catch (err) {
        error.textContent = err.message;
      }
    });

    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;

      try {
        await api('POST', '/api/admin/password', {
          current_password: f.current.value,
          new_password: f.next.value,
        });

        toast('رمز تغییر کرد؛ دوباره وارد شوید');
        showLogin();
      } catch (err) {
        f.querySelector('.error').textContent = err.message;
      }
    });
  };
  // Live refresh of usage (dashboard + users) while nothing is being edited.
  setInterval(() => {
    if (document.hidden || !$('#modal').classList.contains('hidden') || $('#app-view').classList.contains('hidden')) return;
    if (current === 'users' || current === 'dashboard') { const q = $('#user-q')?.value; guard(async () => { await pages[current](); paint($('#page')); })().then(() => { if (q && $('#user-q')) { $('#user-q').value = q; $('#user-q').dispatchEvent(new Event('input')); } }); }
  }, 30000);

  // --------------------------------------------------------------- boot
  window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p !== current && pages[p]) go(p); });
  api('GET', '/api/admin/me').then((r) => showApp(r.username)).catch(() => showLogin());
})();
