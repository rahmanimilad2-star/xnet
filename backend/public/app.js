'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GB = 1024 ** 3;
  const fmtBytes = (b) => {
    if (b == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(b);
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toLocaleString('fa-IR', { maximumFractionDigits: i >= 3 ? 2 : 0 })}\u00A0${u[i]}`;
  };
  const fmtSpeed = (bps) => `${fmtBytes(bps || 0)}/s`;
  const provisionMsg = (p) => {
    if (!p) return '';
    if (!p.created.length && !p.errors.length) return ''; // no auto-provisioning configured (e.g. manual configs only)
    return ` · ${p.created.length.toLocaleString('fa-IR')} کلاینت در 3X-UI ساخته شد${p.errors.length ? ` · ${p.errors.length.toLocaleString('fa-IR')} خطا: ${p.errors[0].error}` : ''}`;
  };
  const xuiErr = (r) => (r?.xui_errors?.length ? ` · خطای 3X-UI: ${r.xui_errors[0].error}` : '');
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString('fa-IR') : 'نامحدود');
  const toDateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const STATUS = { ACTIVE: ['فعال', 'ok'], BLOCKED: ['مسدود', 'bad'], EXPIRED: ['منقضی', 'warn'], QUOTA_EXCEEDED: ['اتمام حجم', 'warn'] };
  const SOURCE = { manual: 'دستی', subscription: 'Subscription', xui: '3X-UI خودکار' };
  const SCOPE = { all: 'همه کاربران', groups: 'گروه‌ها', users: 'کاربران خاص' };

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
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

  // -------------------------------------------------------------- modal
  function openModal(title, html, onSubmit) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
    const form = $('#modal-body form');
    if (form && onSubmit) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('[type=submit]'); btn.disabled = true;
        try { await onSubmit(form); } catch (e) { const er = form.querySelector('.error'); if (er) er.textContent = e.message; else toast(e.message, true); }
        finally { btn.disabled = false; }
      });
    }
  }
  const closeModal = () => $('#modal').classList.add('hidden');
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  const confirmBox = (msg) => window.confirm(msg);

  // ---------------------------------------------------------- auth/nav
  function showLogin() { $('#app-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); }
  async function showApp(name) {
    $('#admin-name').textContent = name;
    $('#login-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
    go(location.hash.slice(1) || 'dashboard');
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#login-error').textContent = '';
    try {
      const r = await api('POST', '/api/admin/login', { username: f.username.value, password: f.password.value });
      f.password.value = ''; showApp(r.username);
    } catch (err) { $('#login-error').textContent = err.message; }
  });
  $('#logout-btn').addEventListener('click', guard(async () => { await api('POST', '/api/admin/logout'); showLogin(); }));
  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('#sidebar a').forEach((a) => a.addEventListener('click', () => { go(a.dataset.page); $('#sidebar').classList.remove('open'); }));

  const pages = {};
  let current = 'dashboard';
  function go(p) {
    if (!pages[p]) p = 'dashboard';
    current = p; location.hash = p;
    $$('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.page === p));
    $('#page').innerHTML = '<p class="muted">در حال بارگذاری…</p>';
    guard(pages[p])();
  }
  const reload = () => go(current);

  // ---------------------------------------------------------- dashboard
  pages.dashboard = async () => {
    const d = await api('GET', '/api/admin/dashboard');
    const s = (l, n) => `<div class="card stat"><div class="l">${l}</div><div class="n">${esc(n)}</div></div>`;
    $('#page').innerHTML = `
      <div class="page-head"><h2>داشبورد</h2><button class="btn" id="sync-btn">🔄 همگام‌سازی آمار</button></div>
      <div class="stats">
        ${s('کل کاربران', d.users.total.toLocaleString('fa-IR'))}${s('فعال', d.users.ACTIVE.toLocaleString('fa-IR'))}
        ${s('آنلاین (۱۰ دقیقه اخیر)', d.users.online.toLocaleString('fa-IR'))}${s('متصل در ۲۴ ساعت', d.users.connected_24h.toLocaleString('fa-IR'))}
        ${s('منقضی', d.users.EXPIRED.toLocaleString('fa-IR'))}${s('اتمام حجم', d.users.QUOTA_EXCEEDED.toLocaleString('fa-IR'))}
        ${s('مسدود', d.users.BLOCKED.toLocaleString('fa-IR'))}${s('کل مصرف', fmtBytes(d.total_traffic_bytes))}
        ${s('کانفیگ فعال / کل', `${d.configs.enabled.toLocaleString('fa-IR')} / ${d.configs.total.toLocaleString('fa-IR')}`)}
      </div>
      <h3>وضعیت سرورهای آمار</h3>
      <div class="table-wrap"><table><thead><tr><th>سرور</th><th>وضعیت</th><th>آخرین همگام‌سازی</th><th>خطا</th></tr></thead><tbody>
      ${d.servers.map((x) => `<tr><td>${esc(x.name)} <span class="muted">${esc(x.country)}</span></td>
        <td>${x.enabled ? (x.last_sync_error ? '<span class="badge bad">خطا</span>' : '<span class="badge ok">سالم</span>') : '<span class="badge">غیرفعال</span>'}</td>
        <td>${fmtDate(x.last_sync_at)}</td><td class="mono">${esc(x.last_sync_error || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">سروری ثبت نشده است</td></tr>'}
      </tbody></table></div>`;
    $('#sync-btn').addEventListener('click', guard(async () => {
      const r = await api('POST', '/api/admin/stats/sync');
      toast(r.skipped ? 'همگام‌سازی در حال اجراست' : `همگام شد: ${r.servers} سرور${r.errors.length ? `، ${r.errors.length} خطا` : ''}`, r.errors?.length);
      reload();
    }));
  };

  // -------------------------------------------------------------- users
  let cache = { groups: [], configs: [], users: [] };
  async function loadRefs() {
    const [g, c] = await Promise.all([api('GET', '/api/admin/groups'), api('GET', '/api/admin/configs')]);
    cache.groups = g.groups; cache.configs = c.configs;
  }
  const groupOptions = (sel) => `<option value="">— بدون گروه —</option>${cache.groups.map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}`;
  const configChecklist = (selected = []) => `<div class="checklist">${cache.configs.filter((c) => c.scope === 'users').map((c) => `
      <label><input type="checkbox" name="config_ids" value="${c.id}" ${selected.includes(c.id) ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${esc(c.country)} · ${esc(c.protocol)}${c.enabled ? '' : ' · غیرفعال'}</span></label>`).join('') || '<span class="muted">کانفیگی با دامنه «کاربران خاص» وجود ندارد</span>'}</div>`;

  pages.users = async () => {
    await loadRefs();
    const { users } = await api('GET', '/api/admin/users');
    cache.users = users;
    $('#page').innerHTML = `
      <div class="page-head"><h2>کاربران</h2><input id="user-q" placeholder="جستجو…" class="search"><button class="btn primary" id="add-user">+ کاربر جدید</button></div>
      <div class="table-wrap"><table><thead><tr><th>نام کاربری</th><th>وضعیت</th><th>مصرف</th><th>سرعت لحظه‌ای</th><th>انقضا</th><th>آخرین اتصال</th><th>کانفیگ</th><th></th></tr></thead>
      <tbody id="users-body"></tbody></table></div>`;
    const render = (q) => {
      $('#users-body').innerHTML = users.filter((u) => !q || u.username.toLowerCase().includes(q) || (u.note || '').toLowerCase().includes(q)).map((u) => {
        const [st, cls] = STATUS[u.status];
        const pct = u.unlimited ? 0 : Math.min(100, (u.used_bytes / u.quota_bytes) * 100);
        return `<tr><td><strong>${esc(u.username)}</strong>${u.note ? `<div class="muted">${esc(u.note)}</div>` : ''}</td>
          <td><span class="badge ${cls}">${st}</span>${u.online ? ' <span class="badge ok">آنلاین</span>' : ''}${u.provision_error ? ' <span class="badge bad" title="ساخت کلاینت در 3X-UI ناقص است">3X-UI ⚠</span>' : ''}</td>
          <td><bdi>${fmtBytes(u.used_bytes)}</bdi> از <bdi>${u.unlimited ? 'نامحدود' : fmtBytes(u.quota_bytes)}</bdi>${u.unlimited ? '' : `<div class="bar ${pct >= 100 ? 'full' : ''}"><i data-pct="${pct}"></i></div>`}</td>
          <td><bdi>↓ ${fmtSpeed(u.rate_down_bps)}</bdi><div class="muted"><bdi>↑ ${fmtSpeed(u.rate_up_bps)}</bdi></div></td>
          <td>${fmtDay(u.expires_at)}${u.days_left != null ? `<div class="muted">${u.days_left.toLocaleString('fa-IR')} روز</div>` : ''}</td>
          <td>${fmtDate(u.last_connect_at)}</td><td>${u.allowed_config_count.toLocaleString('fa-IR')}</td>
          <td class="actions">
            <button class="btn sm" data-act="edit" data-id="${u.id}">ویرایش</button>
            <button class="btn sm" data-act="renew" data-id="${u.id}">تمدید</button>
            <button class="btn sm" data-act="toggle" data-id="${u.id}">${u.user_status === 'blocked' ? 'رفع مسدودی' : 'مسدود'}</button>
            <button class="btn sm danger" data-act="del" data-id="${u.id}">حذف</button></td></tr>`;
      }).join('') || '<tr><td colspan="8" class="muted">کاربری وجود ندارد</td></tr>';
      $$('.bar > i[data-pct]').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });
    };
    render('');
    $('#user-q').addEventListener('input', (e) => render(e.target.value.trim().toLowerCase()));
    $('#add-user').addEventListener('click', () => userForm());
    $('#users-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const u = users.find((x) => x.id === +b.dataset.id);
      if (b.dataset.act === 'edit') userForm(u);
      if (b.dataset.act === 'renew') renewForm(u);
      if (b.dataset.act === 'toggle') { const r = await api('PUT', `/api/admin/users/${u.id}`, { status: u.user_status === 'blocked' ? 'active' : 'blocked' }); toast(`وضعیت تغییر کرد${xuiErr(r)}`, !!r.xui_errors?.length); reload(); }
      if (b.dataset.act === 'del' && confirmBox(`کاربر «${u.username}» حذف شود؟ کلاینت‌های او در 3X-UI هم حذف می‌شوند.`)) { const r = await api('DELETE', `/api/admin/users/${u.id}`); toast(`کاربر حذف شد${xuiErr(r)}`, !!r.xui_errors?.length); reload(); }
    }));
  };

  function userForm(u) {
    const edit = !!u;
    openModal(edit ? `ویرایش ${u.username}` : 'کاربر جدید', `
      <form class="grid2">
        <label>نام کاربری<input name="username" class="ltr" value="${esc(u?.username)}" required pattern="[a-zA-Z0-9._\\-]{3,32}" title="۳ تا ۳۲ کاراکتر انگلیسی، عدد، . _ -"></label>
        <label>رمز عبور ${edit ? '<span class="muted">(خالی = بدون تغییر)</span>' : ''}<input name="password" class="ltr" type="text" minlength="6" ${edit ? '' : 'required'} autocomplete="new-password"></label>
        <label>حجم کل (GB) <span class="muted">۰ = نامحدود</span><input name="quota_gb" type="number" step="0.01" min="0" value="${u ? +(u.quota_bytes / GB).toFixed(2) : 50}"></label>
        ${edit ? `<label>تاریخ انقضا (میلادی)<input name="expires" type="date" class="ltr" value="${toDateInput(u.expires_at)}"></label>`
              : '<label>مدت اعتبار (روز) <span class="muted">۰ = بدون انقضا</span><input name="days" type="number" min="0" value="30"></label>'}
        <label>گروه<select name="group_id">${groupOptions(u?.group_id)}</select></label>
        <label>ایمیل کلاینت دستی در 3X-UI <span class="muted">(اختیاری؛ فقط برای کلاینت‌های قدیمی)</span><input name="xui_email" class="ltr" value="${esc(u?.xui_email)}"></label>
        ${edit ? `<div class="full"><div class="muted sub">کلاینت‌های خودکار در 3X-UI</div>${u.xui_clients.length ? `<div class="checklist">${u.xui_clients.map((c) => `<div><span class="badge ${c.enabled ? 'ok' : 'bad'}">${c.enabled ? 'فعال' : 'قطع'}</span> ${esc(c.server)} · ${esc(c.protocol)} · <span class="mono">${esc(c.email)}</span> · <bdi>${fmtBytes(c.used_bytes)}</bdi>${c.last_error ? ` <span class="err-text">${esc(c.last_error)}</span>` : ''}</div>`).join('')}</div>` : '<span class="muted">هنوز کلاینتی ساخته نشده</span>'}
          <div class="actions sub-actions"><button type="button" class="btn sm" id="provision-btn">ساخت کلاینت‌های جاافتاده در 3X-UI</button></div></div>` : '<p class="muted full">بعد از ایجاد، برای این کاربر روی inboundهای انتخاب‌شده در «سرورها» خودکار کلاینت با همین حجم و تاریخ انقضا ساخته می‌شود.</p>'}
        <label class="full">یادداشت<input name="note" value="${esc(u?.note)}"></label>
        <div class="full"><div class="muted sub">کانفیگ‌های اختصاصی</div>${configChecklist(u?.config_ids)}</div>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">${edit ? 'ذخیره' : 'ایجاد'}</button></div>
      </form>`, async (f) => {
      const body = {
        username: f.username.value.trim(), quota_gb: Number(f.quota_gb.value || 0),
        group_id: f.group_id.value ? +f.group_id.value : null, xui_email: f.xui_email.value.trim() || null, note: f.note.value,
        config_ids: $$('input[name=config_ids]:checked', f).map((x) => +x.value),
      };
      if (f.password.value) body.password = f.password.value;
      if (edit) body.expires_at = f.expires.value ? new Date(`${f.expires.value}T23:59:59`).getTime() : null;
      else body.days = Number(f.days.value || 0);
      const r = await api(edit ? 'PUT' : 'POST', edit ? `/api/admin/users/${u.id}` : '/api/admin/users', body);
      const bad = !!(r.provision?.errors?.length || r.xui_errors?.length);
      closeModal(); toast(edit ? `ذخیره شد${xuiErr(r)}` : `کاربر ایجاد شد${provisionMsg(r.provision)}`, bad); reload();
    });
    const pb = $('#provision-btn');
    if (pb) pb.addEventListener('click', guard(async () => {
      const r = await api('POST', `/api/admin/users/${u.id}/provision`);
      toast(`انجام شد${provisionMsg(r.provision)}`, r.provision.errors.length > 0); closeModal(); reload();
    }));
  }
  function renewForm(u) {
    openModal(`تمدید / افزایش حجم: ${u.username}`, `
      <form class="grid2">
        <label>افزودن روز<input name="add_days" type="number" min="0" value="30"></label>
        <label>افزودن حجم (GB)<input name="add_gb" type="number" min="0" step="0.01" value="0"></label>
        <label class="switch full"><input type="checkbox" name="reset_usage"> صفر کردن مصرف (شروع دوره جدید)</label>
        <p class="muted full">انقضای فعلی: ${fmtDay(u.expires_at)} · حجم فعلی: ${u.unlimited ? 'نامحدود' : fmtBytes(u.quota_bytes)} · مصرف: ${fmtBytes(u.used_bytes)}</p>
        <p class="error full"></p>
        <div class="form-actions full"><button class="btn primary" type="submit">اعمال</button></div>
      </form>`, async (f) => {
      const r = await api('POST', `/api/admin/users/${u.id}/renew`, { add_days: +f.add_days.value || 0, add_gb: +f.add_gb.value || 0, reset_usage: f.reset_usage.checked });
      closeModal(); toast(`اشتراک به‌روز شد${xuiErr(r)}`, !!r.xui_errors?.length); reload();
    });
  }

  // ------------------------------------------------------------ configs
  pages.configs = async () => {
    await loadRefs();
    const [{ users }, { servers }, { subscriptions }] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/servers'), api('GET', '/api/admin/subscriptions')]);
    cache.users = users; cache.servers = servers; cache.subs = subscriptions;
    const target = (c) => c.scope === 'all' ? 'همه' : c.scope === 'groups'
      ? c.group_ids.map((id) => cache.groups.find((g) => g.id === id)?.name).filter(Boolean).join('، ') || '—'
      : `${c.user_ids.length.toLocaleString('fa-IR')} کاربر`;
    $('#page').innerHTML = `
      <div class="page-head"><h2>کانفیگ‌ها</h2><button class="btn primary" id="import-cfg">+ افزودن کانفیگ دستی</button><button class="btn" id="add-sub">+ Subscription</button><button class="btn" id="bulk-cfg">+ افزودن گروهی</button><button class="btn" id="add-cfg">+ تکی</button></div>
      ${subscriptions.length ? `<h3>لینک‌های Subscription</h3>
      <div class="table-wrap"><table><thead><tr><th>نام</th><th>آدرس</th><th>کانفیگ‌ها</th><th>آخرین دریافت</th><th>وضعیت</th><th></th></tr></thead><tbody id="sub-body">
      ${subscriptions.map((x) => `<tr><td><strong>${esc(x.name)}</strong><div class="muted">${SCOPE[x.scope]}</div></td><td class="mono">${esc(x.url.length > 48 ? `${x.url.slice(0, 48)}…` : x.url)}</td>
        <td>${x.config_count.toLocaleString('fa-IR')}</td><td>${fmtDate(x.last_fetch_at)}</td>
        <td>${!x.enabled ? '<span class="badge">غیرفعال</span>' : x.last_error ? `<span class="badge warn" title="${esc(x.last_error)}">${esc(x.last_error)}</span>` : '<span class="badge ok">سالم</span>'}</td>
        <td class="actions"><button class="btn sm primary" data-act="refresh" data-id="${x.id}">به‌روزرسانی</button><button class="btn sm" data-act="edit" data-id="${x.id}">ویرایش</button><button class="btn sm danger" data-act="del" data-id="${x.id}">حذف</button></td></tr>`).join('')}
      </tbody></table></div><h3>همه کانفیگ‌ها</h3>` : ''}
      <div class="table-wrap"><table><thead><tr><th>اولویت</th><th>نام</th><th>پروتکل</th><th>سرور</th><th>تخصیص</th><th>وضعیت</th><th></th></tr></thead><tbody id="cfg-body">
      ${cache.configs.map((c) => `<tr><td>${c.priority.toLocaleString('fa-IR')}</td><td><strong>${esc(c.name)}</strong><div class="muted">${esc(c.country)}</div><span class="badge ${c.source === 'xui' ? 'ok' : ''}">${SOURCE[c.source] || 'دستی'}</span></td>
        <td><span class="badge">${esc(c.protocol)}</span></td><td class="mono">${esc(c.endpoint)}</td>
        <td>${SCOPE[c.scope]}: ${esc(target(c))}</td>
        <td>${c.enabled ? '<span class="badge ok">فعال</span>' : '<span class="badge">غیرفعال</span>'}</td>
        <td class="actions"><button class="btn sm" data-act="edit" data-id="${c.id}">ویرایش</button>
          <button class="btn sm" data-act="toggle" data-id="${c.id}">${c.enabled ? 'غیرفعال' : 'فعال'}</button>
          <button class="btn sm danger" data-act="del" data-id="${c.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">کانفیگی ثبت نشده است</td></tr>'}
      </tbody></table></div>`;
    $('#add-cfg').addEventListener('click', () => configForm());
    $('#bulk-cfg').addEventListener('click', () => bulkForm());
    $('#add-sub').addEventListener('click', () => subForm());
    $('#import-cfg').addEventListener('click', () => importForm());
    const sb = $('#sub-body');
    if (sb) sb.addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const x = cache.subs.find((y) => y.id === +b.dataset.id);
      if (b.dataset.act === 'refresh') { const r = await api('POST', `/api/admin/subscriptions/${x.id}/refresh`); toast(subMsg(r.refresh), !r.refresh.ok); reload(); }
      if (b.dataset.act === 'edit') subForm(x);
      if (b.dataset.act === 'del' && confirmBox(`Subscription «${x.name}» و همه کانفیگ‌هایش حذف شوند؟`)) { await api('DELETE', `/api/admin/subscriptions/${x.id}`); toast('حذف شد'); reload(); }
    }));
    $('#cfg-body').addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const c = cache.configs.find((x) => x.id === +b.dataset.id);
      if (b.dataset.act === 'edit') configForm(c);
      if (b.dataset.act === 'toggle') { await api('PUT', `/api/admin/configs/${c.id}`, { enabled: !c.enabled }); toast('وضعیت تغییر کرد'); reload(); }
      if (b.dataset.act === 'del' && confirmBox(`کانفیگ «${c.name}» حذف شود؟`)) { await api('DELETE', `/api/admin/configs/${c.id}`); toast('حذف شد'); reload(); }
    }));
  };
  const assignFields = (c) => `
    <label>دامنه تخصیص<select name="scope">${Object.entries(SCOPE).map(([k, v]) => `<option value="${k}" ${(c?.scope || 'users') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>سرور آمار (اختیاری)<select name="server_id"><option value="">—</option>${(cache.servers || []).map((s) => `<option value="${s.id}" ${c?.server_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <div class="full" data-scope="users"><div class="muted sub">کاربران</div><div class="checklist">${cache.users.map((u) => `<label><input type="checkbox" name="user_ids" value="${u.id}" ${c?.user_ids?.includes(u.id) ? 'checked' : ''}> ${esc(u.username)}</label>`).join('') || '<span class="muted">کاربری نیست</span>'}</div></div>
    <div class="full" data-scope="groups"><div class="muted sub">گروه‌ها</div><div class="checklist">${cache.groups.map((g) => `<label><input type="checkbox" name="group_ids" value="${g.id}" ${c?.group_ids?.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('') || '<span class="muted">گروهی نیست</span>'}</div></div>`;
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
        <label class="full">لینک کانفیگ (vless / vmess / trojan / ss)<textarea name="link" required>${esc(c?.link)}</textarea></label>
        <div class="full actions"><button class="btn sm" type="button" id="validate-btn">بررسی لینک</button><span id="validate-out" class="muted"></span></div>
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
        out.innerHTML = `<span class="badge ok">معتبر</span> ${esc(r.protocol)} · ${esc(r.address)}:${r.port} · ${esc(r.network)}/${esc(r.security)}`;
        if (!f.name.value && r.name) f.name.value = r.name;
      } catch (e) { out.innerHTML = `<span class="badge bad">نامعتبر</span> ${esc(e.message)}`; }
    });
  }
  const subMsg = (r) => (r.ok
    ? `${r.total.toLocaleString('fa-IR')} کانفیگ · ${r.added.toLocaleString('fa-IR')} جدید · ${r.removed.toLocaleString('fa-IR')} حذف${r.invalid ? ` · ${r.invalid.toLocaleString('fa-IR')} نامعتبر` : ''}`
    : `دریافت نشد: ${r.error}`);
  function importForm() {
    openModal('افزودن کانفیگ دستی', `
      <form class="grid2">
        <p class="muted full">کانفیگ را از هر پنل یا منبعی کپی و این‌جا Paste کنید (هر مورد در یک خط): <span class="mono">vless:// vmess:// trojan:// ss://</span> یا لینک Subscription <span class="mono">https://…</span>.
          هیچ API، نام کاربری، رمز یا توکنِ پنلِ مبدأ لازم نیست و ذخیره نمی‌شود؛ فقط خود کانفیگ نگه داشته می‌شود.</p>
        <label class="full">متن یا لینک کانفیگ<textarea name="text" required placeholder="vless://...&#10;vmess://...&#10;trojan://...&#10;ss://...&#10;https://example.com/sub/..."></textarea></label>
        <div class="full actions"><button class="btn" type="button" id="import-check">بررسی</button><span class="muted" id="import-sum"></span></div>
        <div class="full" id="import-preview"></div>
        <label>نام <span class="muted">(اختیاری، فقط وقتی یک مورد است)</span><input name="name"></label>
        <label>کشور / موقعیت<input name="country"></label>
        <label>اولویت<input name="priority" type="number" min="0" value="100"></label>
        <label class="switch"><input type="checkbox" name="enabled" checked> فعال</label>
        ${assignFields({ scope: 'all' })}
        <p class="muted full">حجم و مصرف برای کانفیگ دستی اختیاری است؛ اگر اطلاعات مصرف نباشد، اپ «حجم نامشخص» نشان می‌دهد و اتصال فعال می‌ماند.</p>
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
      ${i.valid && i.kind === 'subscription' ? `<div class="kv">${row('آدرس', i.input)}${row('تعداد کانفیگ', i.count)}</div>` : ''}
      ${!i.valid ? `<div class="err-text">${esc(i.error)}</div><div class="mono muted">${esc(i.input)}</div>` : ''}
    </div>`).join('')}</div>`;
  }
  function subForm(x) {
    const edit = !!x;
    openModal(edit ? `ویرایش ${x.name}` : 'افزودن Subscription', `
      <form class="grid2">
        <p class="muted full">لینک Subscription (مثلاً از 3X-UI) فقط منبع کانفیگ است: سرور پنل آن را می‌خواند و کانفیگ‌ها را ذخیره می‌کند. اپ هیچ‌وقت به این آدرس وصل نمی‌شود.</p>
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
        <label class="switch"><input type="checkbox" name="atomic"> در صورت وجود لینک نامعتبر، هیچ‌کدام ثبت نشود</label>
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
    $('#bulk-errors').innerHTML = `<div class="errlist"><strong>لینک‌های نامعتبر:</strong>${errs.map((e) => `<div>خط ${e.line.toLocaleString('fa-IR')}: <span class="mono">${esc(e.link)}…</span> — ${esc(e.error)}</div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------- groups
  pages.groups = async () => {
    const { groups } = await api('GET', '/api/admin/groups');
    $('#page').innerHTML = `
      <div class="page-head"><h2>گروه‌ها</h2><button class="btn primary" id="add-group">+ گروه جدید</button></div>
      <div class="table-wrap"><table><thead><tr><th>نام</th><th>تعداد کاربر</th><th></th></tr></thead><tbody id="g-body">
      ${groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.user_count.toLocaleString('fa-IR')}</td><td class="actions"><button class="btn sm" data-act="edit" data-id="${g.id}">تغییر نام</button><button class="btn sm danger" data-act="del" data-id="${g.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">گروهی وجود ندارد</td></tr>'}
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
    $('#page').innerHTML = `
      <div class="page-head"><h2>سرورهای 3X-UI</h2><button class="btn primary" id="add-srv">+ سرور جدید</button></div>
      <p class="muted">پنل 3X-UI را اضافه کنید، سپس «انتخاب inbound» را بزنید. برای هر کاربری که می‌سازید روی همین inboundها خودکار یک کلاینت با حجم و تاریخ انقضای او ساخته می‌شود و مصرف و سرعت واقعی از همان خوانده می‌شود.</p>
      <div class="table-wrap"><table><thead><tr><th>نام</th><th>آدرس پنل</th><th>inbound / کلاینت</th><th>وضعیت</th><th>آخرین همگام‌سازی</th><th></th></tr></thead><tbody id="s-body">
      ${servers.map((s) => `<tr><td>${esc(s.name)} <span class="muted">${esc(s.country)}</span></td><td class="mono">${esc(s.xui_url)}</td>
        <td>${s.provision_inbounds.length ? `${s.provision_inbounds.length.toLocaleString('fa-IR')} inbound · ${s.client_count.toLocaleString('fa-IR')} کلاینت` : '<span class="badge warn">inbound انتخاب نشده</span>'}</td>
        <td>${s.enabled ? (s.last_sync_error ? `<span class="badge bad" title="${esc(s.last_sync_error)}">خطا</span>` : '<span class="badge ok">فعال</span>') : '<span class="badge">غیرفعال</span>'}</td>
        <td>${fmtDate(s.last_sync_at)}${s.last_sync_error ? `<div class="mono err-text">${esc(s.last_sync_error)}</div>` : ''}</td>
        <td class="actions"><button class="btn sm primary" data-act="inbounds" data-id="${s.id}">انتخاب inbound</button><button class="btn sm" data-act="edit" data-id="${s.id}">ویرایش</button><button class="btn sm danger" data-act="del" data-id="${s.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">سروری ثبت نشده است</td></tr>'}
      </tbody></table></div>`;
    const form = (s) => openModal(s ? `ویرایش ${s.name}` : 'سرور جدید', `
      <form class="grid2">
        <label>نام<input name="name" value="${esc(s?.name)}" required></label>
        <label>کشور<input name="country" value="${esc(s?.country)}"></label>
        <label class="full">آدرس کامل پنل 3X-UI (همراه با مسیر مخفی)<input name="xui_url" class="ltr" placeholder="https://1.2.3.4:2053/mypath" value="${esc(s?.xui_url)}"></label>
        <label>نام کاربری 3X-UI<input name="xui_username" class="ltr" value="${esc(s?.xui_username)}"></label>
        <label>رمز 3X-UI ${s?.has_password ? '<span class="muted">(خالی = بدون تغییر)</span>' : ''}<input name="xui_password" class="ltr" type="password" autocomplete="new-password"></label>
        <label class="full">آدرس عمومی سرور در لینک کانفیگ <span class="muted">(دامنه یا IP که کاربر به آن وصل می‌شود؛ خالی = همان آدرس پنل${s?.effective_host ? `: ${esc(s.effective_host)}` : ''})</span><input name="public_host" class="ltr" placeholder="vpn.example.com" value="${esc(s?.public_host)}"></label>
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
      if (b.dataset.act === 'inbounds') await inboundPicker(s);
      if (b.dataset.act === 'del' && confirmBox(`سرور «${s.name}» حذف شود؟ آمار ذخیره‌شده آن هم حذف می‌شود.`)) { await api('DELETE', `/api/admin/servers/${s.id}`); reload(); }
    }));
  };

  async function inboundPicker(s) {
    const { inbounds } = await api('GET', `/api/admin/servers/${s.id}/inbounds`);
    openModal(`انتخاب inbound: ${s.name}`, `
      <form>
        <p class="muted">برای هر کاربر جدید، روی inboundهای تیک‌خورده یک کلاینت اختصاصی ساخته می‌شود.</p>
        <div class="checklist">${inbounds.map((i) => `<label><input type="checkbox" name="ib" value="${i.id}" ${s.provision_inbounds.includes(i.id) ? 'checked' : ''} ${i.supported ? '' : 'disabled'}>
          <span><strong>${esc(i.remark || `#${i.id}`)}</strong> <span class="muted">· ${esc(i.protocol)} · ${esc(i.network)}/${esc(i.security)} · پورت <bdi>${i.port}</bdi>${i.enable ? '' : ' · خاموش'}${i.supported ? '' : ' · پشتیبانی نمی‌شود'}</span></span></label>`).join('') || '<span class="muted">در این پنل inbound‌ای نیست؛ اول در 3X-UI یک inbound بسازید.</span>'}</div>
        <p class="error"></p>
        <div class="form-actions"><button class="btn primary" type="submit">ذخیره</button></div>
      </form>`, async (f) => {
      await api('PUT', `/api/admin/servers/${s.id}`, { provision_inbounds: $$('input[name=ib]:checked', f).map((x) => +x.value) });
      closeModal(); toast('ذخیره شد. کاربران جدید روی این inboundها ساخته می‌شوند. برای کاربران قبلی از «ویرایش کاربر» دکمه ساخت کلاینت را بزنید.'); reload();
    });
  }

  // -------------------------------------------------------------- audit
  pages.audit = async () => {
    const { logs } = await api('GET', '/api/admin/audit?limit=200');
    $('#page').innerHTML = `<div class="page-head"><h2>رویدادهای مدیریتی</h2></div>
      <div class="table-wrap"><table><thead><tr><th>زمان</th><th>انجام‌دهنده</th><th>عملیات</th><th>هدف</th><th>جزئیات</th><th>IP</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td class="mono">${esc(l.actor)}</td><td class="mono">${esc(l.action)}</td><td class="mono">${esc(l.target || '')}</td><td class="mono">${esc(l.details || '')}</td><td class="mono">${esc(l.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">رویدادی نیست</td></tr>'}
      </tbody></table></div>`;
  };

  // ----------------------------------------------------------- settings
  pages.settings = async () => {
    $('#page').innerHTML = `<div class="page-head"><h2>تنظیمات</h2></div>
      <form class="card narrow-form" id="pw-form">
        <h3 class="m0">تغییر رمز مدیر</h3>
        <label>رمز فعلی<input name="current" type="password" required autocomplete="current-password"></label>
        <label>رمز جدید (حداقل ۱۰ کاراکتر)<input name="next" type="password" minlength="10" required autocomplete="new-password"></label>
        <p class="error"></p><button class="btn primary" type="submit">تغییر رمز</button></form>`;
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api('POST', '/api/admin/password', { current_password: f.current.value, new_password: f.next.value }); toast('رمز تغییر کرد؛ دوباره وارد شوید'); showLogin(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    });
  };

  // Mobile: tables render as cards; each cell gets its column title as a label.
  new MutationObserver(() => {
    $$('#page table').forEach((t) => {
      const heads = $$('thead th', t).map((th) => th.textContent.trim());
      $$('tbody tr', t).forEach((tr) => [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('data-label') && heads[i] && td.colSpan === 1) {
          td.setAttribute('data-label', heads[i]);
          // keep multi-part cell content together (so flex layout doesn't spread it)
          if (!td.classList.contains('actions') && td.childNodes.length > 1) {
            const w = document.createElement('span'); w.className = 'cell';
            while (td.firstChild) w.appendChild(td.firstChild);
            td.appendChild(w);
          }
        }
      }));
    });
  }).observe($('#page'), { childList: true, subtree: true });

  // Live refresh of usage/speed (dashboard + users) while nothing is being edited.
  setInterval(() => {
    if (document.hidden || !$('#modal').classList.contains('hidden') || $('#app-view').classList.contains('hidden')) return;
    if (current === 'users' || current === 'dashboard') { const q = $('#user-q')?.value; guard(pages[current])().then(() => { if (q && $('#user-q')) { $('#user-q').value = q; $('#user-q').dispatchEvent(new Event('input')); } }); }
  }, 30000);

  // --------------------------------------------------------------- boot
  window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p !== current && pages[p]) go(p); });
  api('GET', '/api/admin/me').then((r) => showApp(r.username)).catch(() => showLogin());
})();
