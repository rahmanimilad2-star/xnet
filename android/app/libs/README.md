# هسته Xray (libv2ray.aar)

این اپ برای اتصال واقعی از Xray-core استفاده می‌کند که از طریق کتابخانه
[AndroidLibXrayLite](https://github.com/2dust/AndroidLibXrayLite) (همان هسته‌ی v2rayNG) بسته‌بندی شده است.

1. از صفحه Releases پروژه AndroidLibXrayLite فایل `libv2ray.aar` را دانلود کنید
   (نسخه‌ای که `CoreController.startLoop(config, tunFd)` دارد؛ نسخه‌های v25.x به بعد).
2. فایل را دقیقاً در همین پوشه قرار دهید: `android/app/libs/libv2ray.aar`
3. پروژه را build کنید.

تمام ارتباط با هسته فقط در فایل `vpn/XrayCore.kt` است؛ اگر نسخه دیگری از aar استفاده کنید
که امضای متدها در آن فرق دارد، فقط همین فایل را تطبیق دهید.
