# مستندات API

پایه: `https://panel.example.com` · همه بدنه‌ها `application/json` · زمان‌ها epoch میلی‌ثانیه · حجم‌ها بایت.

قالب خطا (همه endpointها):
```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "حجم اشتراک شما تمام شده است.", "account": { ... } } }
```
کدهای خطای مهم: `UNAUTHORIZED`(401) · `INVALID_CREDENTIALS`(401) · `TOO_MANY_ATTEMPTS`(429, با `retry_after`) · `BLOCKED` / `EXPIRED` / `QUOTA_EXCEEDED`(403) · `NO_CONFIG`(404) · `VALIDATION` / `INVALID_LINK` / `BAD_JSON`(400) · `DUPLICATE`(409) · `CSRF`(403) · `PAYLOAD_TOO_LARGE`(413)

---
## A) API اپلیکیشن (`/api/v1`) — احراز هویت: `Authorization: Bearer <token>`

### `POST /api/v1/auth/login`
```json
{ "username": "ali", "password": "alipass1" }
```
پاسخ 200:
```json
{ "token": "eyJ...", "expires_at": 1793623991000, "account": { /* Account */ } }
```
محدودیت: ۵ تلاش ناموفق در ۱۵ دقیقه به ازای هر IP و هر نام کاربری (قابل تنظیم) ← 429.
کاربر مسدود ← 403 `BLOCKED`.

### `GET /api/v1/account`
```json
{ "account": {
  "id": 1, "username": "ali", "status": "ACTIVE", "status_message": "اشتراک فعال است",
  "quota_bytes": 53687091200, "unlimited": false,
  "used_bytes": 524288000, "upload_bytes": 104857600, "download_bytes": 419430400,
  "remaining_bytes": 53162803200, "expires_at": 1793623991000, "days_left": 30,
  "usage_synced_at": 1791031991000, "last_connect_at": 1791031000000 } }
```
`status` یکی از: `ACTIVE`, `BLOCKED`, `EXPIRED`, `QUOTA_EXCEEDED`.

### `GET /api/v1/configs`
فقط کانفیگ‌های **فعال** و **مجاز همین کاربر** (scope=all، گروه کاربر، یا تخصیص مستقیم)، به ترتیب اولویت.
لینک خام برگردانده نمی‌شود؛ backend آن را اعتبارسنجی و به outbound آماده Xray تبدیل می‌کند.
```json
{ "account": { ... },
  "configs": [ { "id": 3, "name": "هلند ۱", "country": "NL", "protocol": "vless", "priority": 10,
                 "outbound": { "tag": "proxy", "protocol": "vless", "settings": { ... }, "streamSettings": { ... } },
                 "updated_at": 1791031991000 } ],
  "version": "sha1-of-ids-and-updated_at", "sync_after_seconds": 300 }
```
اگر اشتراک فعال نباشد ← 403 با کد وضعیت؛ اگر کانفیگی نباشد ← 404 `NO_CONFIG`. تغییر `version` یعنی کانفیگ‌ها در پنل عوض شده‌اند.

### `GET /api/v1/usage`
`{ used_bytes, upload_bytes, download_bytes, quota_bytes, remaining_bytes, synced_at }`

### `POST /api/v1/events`
`{ "type": "connected" | "disconnected" | "failed", "config_id": 3, "error": "..." }` — ثبت آخرین زمان اتصال و خطاهای اتصال.

---
## B) API مدیریت (`/api/admin`)
احراز هویت: کوکی `admin_session` (HttpOnly, SameSite=Strict, Secure) که با login ست می‌شود.
برای درخواست‌های غیر GET با کوکی، هدر `X-Requested-With: panel` الزامی است (ضد CSRF).
برای اسکریپت می‌توان توکن را به‌صورت `Authorization: Bearer` هم فرستاد. توکن کاربر عادی روی این مسیرها 401 می‌گیرد.

| متد | مسیر | توضیح |
|---|---|---|
| POST | `/api/admin/login` | `{username,password}` |
| POST | `/api/admin/logout` | ابطال همه نشست‌های مدیر |
| GET | `/api/admin/me` | |
| POST | `/api/admin/password` | `{current_password,new_password}` (حداقل ۱۰ کاراکتر) |
| GET | `/api/admin/dashboard` | آمار کاربران (کل/فعال/منقضی/اتمام حجم/مسدود/آنلاین/متصل ۲۴ساعت)، کل مصرف، کانفیگ‌ها، وضعیت سرورها |
| GET | `/api/admin/users?q=` | فهرست + مصرف + وضعیت |
| POST | `/api/admin/users` | `{username,password,quota_gb,days \| expires_at,status,group_id,xui_email,note,config_ids[]}` |
| GET/PUT/DELETE | `/api/admin/users/:id` | PUT جزئی است؛ تغییر رمز همه نشست‌های کاربر را باطل می‌کند |
| POST | `/api/admin/users/:id/renew` | `{add_days, add_gb, reset_usage}` — تمدید از تاریخ انقضا (یا از الان اگر گذشته) |
| GET/POST | `/api/admin/groups` | `{name}` |
| PUT/DELETE | `/api/admin/groups/:id` | |
| GET | `/api/admin/configs` | |
| POST | `/api/admin/configs` | `{link,name?,country,priority,enabled,scope:'all'\|'groups'\|'users',user_ids[],group_ids[],server_id?}` |
| POST | `/api/admin/configs/bulk` | `{links:"خط به خط" \| [..], ...پیش‌فرض‌ها, atomic?}` ← `{created[], errors[{line,link,error}]}` |
| POST | `/api/admin/configs/validate` | `{link}` ← `{valid,protocol,address,port,network,security}` |
| PUT/DELETE | `/api/admin/configs/:id` | تعویض لینک، فعال/غیرفعال، اولویت، تخصیص |
| GET/POST | `/api/admin/servers` | پنل‌های 3X-UI: `{name,country,xui_url,xui_username,xui_password,enabled}` (رمز رمزنگاری می‌شود و هرگز برگردانده نمی‌شود) |
| PUT/DELETE | `/api/admin/servers/:id` | |
| POST | `/api/admin/stats/sync` | همگام‌سازی فوری آمار |
| GET | `/api/admin/audit?limit=` | رویدادهای مدیریتی |

### پروتکل‌ها و انتقال‌های پشتیبانی‌شده در لینک
- `vless://` (encryption=none، flow مثل xtls-rprx-vision)، `vmess://` (base64 JSON)، `trojan://`، `ss://` (SIP002 و قالب قدیمی؛ شامل 2022-blake3-*؛ بدون plugin)
- انتقال: `tcp/raw` (و header http)، `ws`، `grpc`، `httpupgrade`، `xhttp/splithttp`
- امنیت: `none`، `tls` (sni, alpn, fp, allowInsecure)، `reality` (pbk الزامی، sid, spx, fp)
- پشتیبانی‌نشده (با پیام خطا رد می‌شود): kcp، quic، h2 قدیمی، پلاگین‌های SS، پروتکل‌های دیگر.

### `GET /healthz` → `{ok:true}`
