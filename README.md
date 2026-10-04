# پروژه VPN اختصاصی: اپ اندروید + پنل مدیریت + بک‌اند

## معماری
```
 ┌──────────────────────┐   HTTPS (Bearer token)   ┌───────────────────────────────┐
 │  اپ اندروید (Kotlin)  │ ───────────────────────▶ │  بک‌اند Node.js 22 + SQLite     │
 │  Compose · RTL فارسی  │  login / account /       │  (VPS پنل، پشت nginx + TLS)     │
 │  VpnService + Xray    │  configs / events        │  ├─ API اپ  /api/v1             │
 └─────────┬────────────┘                           │  ├─ API ادمین /api/admin        │
           │ ترافیک واقعی VPN (VLESS/VMess/          │  ├─ پنل وب (public/)            │
           │ Trojan/SS) از طریق Xray-core            │  └─ جمع‌آورنده آمار (هر ۲ دقیقه) │
           ▼                                         └──────────────┬────────────────┘
 ┌──────────────────────────────┐   API 3X-UI (خواندن آمار،         │
 │ سرورهای VPN با 3X-UI         │ ◀────────────────────────────────┘
 │ (VPSهای جدا)                 │   غیرفعال/فعال‌سازی Client)
 └──────────────────────────────┘
```

**انتخاب‌ها و دلیلشان**
- **بک‌اند: Node.js 22 بدون هیچ وابستگی npm** (http، crypto، `node:sqlite` داخلی) ← نصب ساده روی هر VPS، سطح حمله کمتر، بدون دردسر به‌روزرسانی پکیج.
- **دیتابیس: SQLite (WAL)** ← برای این مقیاس کافی، بدون سرویس جداگانه، پشتیبان‌گیری با یک دستور.
- **هسته VPN: Xray-core** از طریق AndroidLibXrayLite (همان هسته v2rayNG) ← سازگاری کامل با کانفیگ‌های 3X-UI (VLESS/REALITY/VMess/Trojan/SS).
- **تبدیل لینک در سرور**: لینک فقط یک‌بار در بک‌اند اعتبارسنجی و به outbound آماده Xray تبدیل می‌شود؛ اپ هیچ لینک یا رمزی در کد ندارد.
- **آمار واقعی**: از شمارنده‌های خود 3X-UI برای هر Client (بر اساس email) خوانده می‌شود؛ اعمال محدودیت با غیرفعال‌کردن Client در 3X-UI (سمت سرور) + امتناع API از تحویل کانفیگ.
- **پنل: HTML/JS/CSS خالص** (بدون build)، فارسی، راست‌چین، واکنش‌گرا، با CSP سخت‌گیرانه.

## ساختار
```
backend/
  src/server.js        نقطه شروع          src/routes.js    همه endpointها
  src/app.js           سرور HTTP/استاتیک   src/http.js      روتر، اعتبارسنجی، هدرهای امنیتی
  src/db.js            اسکیمای SQLite      src/security.js  scrypt، JWT، AES-GCM، rate limit
  src/links.js         پارسر لینک → Xray   src/xui.js       کلاینت API 3X-UI
  src/stats.js         جمع‌آوری مصرف + اعمال محدودیت      src/cli.js  ساخت مدیر
  public/              پنل مدیریت           test/           تست API + mock 3X-UI + E2E مرورگر
  .env.example
android/               پروژه Gradle اپ (Kotlin + Compose)
  app/src/main/java/com/milad/vpn/
    data/   ApiClient، SessionStore (EncryptedSharedPreferences)، Repository
    vpn/    AppVpnService (failover، تغییر شبکه، sync)، XrayCore (آداپتور هسته)، XrayConfigBuilder
    ui/     MainActivity، صفحات ورود/خانه/سرورها/حساب
deploy/   install.sh · nginx-vpn-panel.conf · vpn-panel.service · backup.sh
docs/     API.md · DEPLOY.md · TEST-REPORT.md · schema.sql · screenshots/
```

## شروع سریع (محلی)
```bash
cd backend
cp .env.example .env && sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/; s/^DATA_ENC_KEY=.*/DATA_ENC_KEY=$(openssl rand -hex 32)/; s/^NODE_ENV=.*/NODE_ENV=development/; s#^DB_PATH=.*#DB_PATH=./data.db#" .env
npm run create-admin -- admin
npm start                        # http://127.0.0.1:8080
npm test                         # ۱۳ تست API
```
نصب روی VPS، تنظیم دامنه/HTTPS، 3X-UI و ساخت APK: **[docs/DEPLOY.md](docs/DEPLOY.md)** · مستندات API: **[docs/API.md](docs/API.md)** · نتیجه تست‌ها: **[docs/TEST-REPORT.md](docs/TEST-REPORT.md)**

## امنیت (خلاصه)
رمزها با scrypt (salt مجزا) · JWT HS256 با ابطال از طریق token_version · کوکی ادمین HttpOnly/SameSite=Strict/Secure + هدر ضد CSRF ·
محدودیت تلاش ورود به ازای IP و نام کاربری (+ limit_req در nginx) · زمان‌سنجی یکسان برای کاربر ناموجود · رمز پنل‌های 3X-UI با AES-256-GCM ·
همه کلیدها در env · اعتبارسنجی همه ورودی‌ها و سقف حجم بدنه · CSP/X-Frame-Options/nosniff · لاگ رویدادهای مدیریتی ·
کاربر عادی هیچ دسترسی به API ادمین یا داده دیگران ندارد · اپ فقط HTTPS (release) و فقط توکن را رمزنگاری‌شده ذخیره می‌کند (نه رمز).

## وضعیت صادقانه
✅ بک‌اند، دیتابیس، پنل مدیریت و منطق آمار/محدودیت: پیاده‌سازی و **تست‌شده** (۱۳ تست API + ۱۹ مرحله E2E مرورگر).
⚠️ اپ اندروید: سورس کامل نوشته شده ولی در این محیط **build و روی دستگاه تست نشده** (نبود Android SDK و اینترنت). جزئیات در TEST-REPORT.md.
