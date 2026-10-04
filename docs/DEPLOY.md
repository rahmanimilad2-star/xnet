# راهنمای نصب، تنظیم و به‌روزرسانی

## ۰. پیش‌نیازها
- یک VPS لینوکسی (Ubuntu 22.04/24.04 یا Debian 12) برای **پنل/بک‌اند** — حداقل ۱ CPU و ۵۱۲MB RAM کافی است.
- یک دامنه یا ساب‌دامنه (مثلاً `panel.example.com`) که رکورد A آن به IP همین VPS اشاره کند.
- سرورهای VPN شما (با 3X-UI) می‌توانند روی VPSهای جداگانه باشند.
- Node.js نسخه ۲۲.۵ به بالا (اسکریپت نصب خودش نصب می‌کند). بک‌اند **هیچ وابستگی npm ندارد**.

## ۱. نصب خودکار پنل روی VPS
```bash
# پروژه را روی سرور کپی کنید (scp/git) و سپس:
cd vpn-project
sudo bash deploy/install.sh panel.example.com you@example.com
```
این اسکریپت: Node 22، nginx و certbot را نصب می‌کند، کاربر سیستمی `vpnpanel` می‌سازد، کد را در `/opt/vpn-panel` قرار می‌دهد،
فایل `/etc/vpn-panel/env` را با کلیدهای تصادفی (`openssl rand -hex 32`) می‌سازد، سرویس systemd را فعال می‌کند،
گواهی Let's Encrypt می‌گیرد، nginx را با HTTPS + HSTS + rate-limit تنظیم و فایروال (22/80/443) را فعال می‌کند.

ساخت حساب مدیر:
```bash
cd /opt/vpn-panel/backend
sudo -u vpnpanel ENV_FILE=/etc/vpn-panel/env node --disable-warning=ExperimentalWarning src/cli.js create-admin admin
```
سپس `https://panel.example.com` را باز کنید.

### نصب دستی (بدون اسکریپت)
```bash
cd backend
cp .env.example .env         # JWT_SECRET و DATA_ENC_KEY را با openssl rand -hex 32 پر کنید
node --disable-warning=ExperimentalWarning src/cli.js create-admin admin
node --disable-warning=ExperimentalWarning src/server.js     # روی 127.0.0.1:8080
```
و nginx را با `deploy/nginx-vpn-panel.conf` جلوی آن قرار دهید. **بک‌اند را هرگز مستقیم روی اینترنت (بدون HTTPS) باز نکنید.**

## ۲. اتصال به 3X-UI (ساخت خودکار کاربر، مصرف واقعی، قطع خودکار)
1. در 3X-UI فقط **inbound** بسازید (مثلاً VLESS-REALITY یا Trojan-WS). لازم نیست برای کاربران کلاینت بسازید.
2. در پنل این پروژه ← **سرورها** ← «سرور جدید»: آدرس کامل پنل 3X-UI همراه با مسیر مخفی (مثل `https://1.2.3.4:2053/abcd`)،
   نام کاربری و رمز 3X-UI، و **آدرس عمومی سرور** (دامنه یا IP که کاربران به آن وصل می‌شوند).
3. روی «**انتخاب inbound**» بزنید؛ لیست واقعی inboundهای 3X-UI می‌آید. inboundهایی که می‌خواهید کاربران روی آن‌ها باشند را تیک بزنید.
4. حالا هر کاربری در **کاربران** بسازید (نام، رمز، حجم، مدت):
   - پنل روی هر inbound انتخاب‌شده یک **کلاینت اختصاصی** با همان حجم و تاریخ انقضا در 3X-UI می‌سازد.
   - لینک کانفیگ همان کلاینت خودکار ساخته و فقط به همان کاربر داده می‌شود (کپی دستی لینک لازم نیست).
5. هر `STATS_INTERVAL_SECONDS` (پیش‌فرض ۳۰ ثانیه) مصرف هر کلاینت از 3X-UI خوانده می‌شود؛ **مصرف، سرعت لحظه‌ای و آنلاین بودن**
   در لیست کاربران پنل و در اپ دیده می‌شود.
6. وقتی مجموع مصرف کاربر به حجمش برسد یا اعتبارش تمام شود یا مسدود شود: API دیگر کانفیگ نمی‌دهد و **کلاینت‌ها در 3X-UI غیرفعال می‌شوند**؛
   خود 3X-UI هم سقف حجم و تاریخ را روی هر کلاینت اعمال می‌کند. تمدید/افزایش حجم/ریست مصرف/مسدودی/حذف در پنل، فوراً روی 3X-UI هم اعمال می‌شود.
7. اگر موقع ساخت کاربر 3X-UI در دسترس نبود، کاربر ساخته می‌شود و علامت «3X-UI ⚠» می‌گیرد؛ در «ویرایش کاربر» دکمه
   «ساخت کلاینت‌های جاافتاده» را بزنید. برای کاربرانی که **قبل از** انتخاب inbound ساخته‌اید هم همین دکمه را بزنید.
8. توصیه: پنل 3X-UI را با HTTPS معتبر اجرا کنید و پورتش را فقط برای IP سرور پنل باز بگذارید
   (`ufw allow from <backend-ip> to any port 2053`). اگر گواهی self-signed است `XUI_ALLOW_INSECURE_TLS=true`.

> نسخه‌های 3X-UI که API آن‌ها `/panel/api/inbounds/list`، `addClient`، `updateClient`، `{id}/delClient` و `getClientTraffics` را دارند (سری 2.x) پشتیبانی می‌شوند.
> فیلد «ایمیل کلاینت دستی» فقط برای کلاینت‌های قدیمی است که خودتان در 3X-UI ساخته‌اید.

## ۳. ساخت APK

### روش پیشنهادی: GitHub Actions (بدون نیاز به Android Studio)
فایل `.github/workflows/android.yml` با هر push روی شاخه main/master (یا دستی از تب Actions ← Run workflow):
Java 21، Android SDK 34 و Build Tools 34.0.0، Gradle 8.14.3 را نصب می‌کند، `libv2ray.aar` را از Releases پروژه
2dust/AndroidLibXrayLite دانلود می‌کند، Gradle wrapper را می‌سازد، `assembleDebug` را اجرا می‌کند و فایل
`app-debug.apk` را در بخش Artifacts همان اجرا برای دانلود می‌گذارد.
آدرس بک‌اند: در GitHub ← Settings ← Secrets and variables ← Actions ← Variables یک متغیر `VPN_API_BASE_URL`
(مثلاً `https://panel.example.com`) بسازید؛ اگر نسازید مقدار `gradle.properties` استفاده می‌شود.

### روش دستی
پیش‌نیاز: Android Studio (Koala به بالا) یا JDK 17 + Android SDK 34.
1. فایل `libv2ray.aar` را از Releases پروژه [AndroidLibXrayLite](https://github.com/2dust/AndroidLibXrayLite) دانلود و در `android/app/libs/` بگذارید.
2. آدرس بک‌اند را در `android/gradle.properties` تنظیم کنید: `vpnApiBaseUrl=https://panel.example.com` (فقط HTTPS؛ نسخه release اجازه http نمی‌دهد).
3. پوشه `android` را در Android Studio باز کنید (Gradle wrapper خودکار ساخته می‌شود) یا: `gradle wrapper --gradle-version 8.7` و سپس:
```bash
cd android
./gradlew testDebugUnitTest          # تست واحد سازنده کانفیگ Xray
./gradlew assembleDebug              # app/build/outputs/apk/debug/app-debug.apk
# نسخه امضاشده:
keytool -genkeypair -v -keystore ~/vpn-release.jks -alias vpn -keyalg RSA -keysize 4096 -validity 10000
VPN_KEYSTORE=~/vpn-release.jks VPN_KEYSTORE_PASSWORD=*** VPN_KEY_ALIAS=vpn VPN_KEY_PASSWORD=*** ./gradlew assembleRelease
```
تست روی شبیه‌ساز با بک‌اند محلی: در نسخه debug می‌توانید `-PvpnApiBaseUrl=http://10.0.2.2:8080` بدهید.

## ۴. به‌روزرسانی
```bash
sudo bash deploy/backup.sh                                    # پشتیبان DB
sudo rsync -a --delete --exclude 'data.db*' backend/ /opt/vpn-panel/backend/
sudo systemctl restart vpn-panel && sudo journalctl -u vpn-panel -n 50
```
اسکیمای دیتابیس با `CREATE TABLE IF NOT EXISTS` ساخته می‌شود و جدول `schema_version` برای مهاجرت‌های بعدی است.
تغییر کانفیگ‌ها و سرورها **نیازی به انتشار نسخه جدید اپ ندارد**؛ اپ در همگام‌سازی بعدی (هر `sync_after_seconds`=۳۰۰ ثانیه، یا هنگام اتصال) آن‌ها را می‌گیرد.

## ۵. نگهداری
- لاگ‌ها: `journalctl -u vpn-panel -f`
- پشتیبان روزانه: `echo "0 3 * * * root /opt/vpn-panel/deploy/backup.sh" | sudo tee /etc/cron.d/vpn-panel-backup` (اسکریپت را به `/opt/vpn-panel/deploy` کپی کنید)
- تغییر رمز مدیر: از پنل (تنظیمات) یا دوباره `create-admin` با همان نام.
- چرخش `JWT_SECRET` همه نشست‌ها را باطل می‌کند. **`DATA_ENC_KEY` را عوض نکنید** مگر رمز سرورهای 3X-UI را دوباره وارد کنید.
