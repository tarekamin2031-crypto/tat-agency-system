# الـ backend على Vercel (تجربة) + Neon

> ⚠️ خطة **Hobby** للاستخدام الشخصي/التجريبي فقط (شروط Vercel تمنع الاستخدام التجاري). للتشغيل الفعلي مع عملاء: **Pro** (~20$/شهر) أو سيرفر تاني.

## الفكرة
مشروعين على Vercel من نفس الريبو:
1. **backend** — Root Directory = `backend` (الـ Express شغال كـ Serverless Function عبر `backend/api/index.js`).
2. **frontend** — Root Directory = `frontend`.

الجدولة (الأحداث اليومية، الفواتير الشهرية، إعادة محاولة الإيميل/Webhooks) بقت **Vercel Cron** على `/api/cron/daily` (مرة يوميًا 05:00 UTC).

## 1) مشروع الـ backend
Vercel → Add New → Project → اختار الريبو → **Root Directory: `backend`** → Framework: Other.
المتغيرات (Settings → Environment Variables):

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط Neon **pooled** (فيه `-pooler`) |
| `DB_SSL` | `true` |
| `JWT_SECRET` | نفس القيمة الحالية |
| `SECRETS_KEY` | نص عشوائي طويل |
| `CRON_SECRET` | نص عشوائي طويل (Vercel بيبعته تلقائيًا للـ cron) |
| `CORS_ORIGIN` | عنوان الواجهة `https://...vercel.app` |
| `APP_URL` | نفس العنوان |
| `ADMIN_EMAIL`, `PLATFORM_ADMIN_EMAIL` | إيميل المدير الحالي |
| `CONTACT_NOTIFY_EMAIL` | tarekamin2031@gmail.com |
| `TZ` | `Africa/Cairo` (اختياري) |

بعد النشر: `https://<backend>.vercel.app/api/health` لازم يرد `{"status":"ok"}`.

## 2) الـ migration
بيتشغل **يدويًا من جهازك** (مش تلقائي على Vercel) كلما اتغيّر `database/schema.sql`:
```bash
cd backend && DATABASE_URL_UNPOOLED="<neon direct url>" DB_SSL=true node src/db/migrate.js
```
(قاعدتك على Neon متطبّق عليها الـ schema بالفعل.)

## 3) مشروع الواجهة
Root Directory = `frontend`، متغير `VITE_API_URL = https://<backend>.vercel.app` (من غير `/` ومن غير `/api`). بعدها حدّث `CORS_ORIGIN` و`APP_URL` في الـ backend بعنوان الواجهة وأعد النشر.

## حدود معروفة (لازم تعرفها)
- **حجم الطلب 4.5MB** على Vercel (التطبيق بيسمح لحد 8MB للإيصالات/اللوجو): الصور الكبيرة هتفشل — صغّرها.
- **Cron على Hobby مرة واحدة يوميًا**: إعادة محاولة الإيميل/Webhooks الفاشلة بتتأخر لحد الـ cron (على Pro تقدر تضيف `/api/cron/queues` كل دقيقة).
- **PDF**: بيستخدم Chromium الخاص بـ Serverless (`@sparticuz/chromium`). **ماتختبرش على Vercel لسه** — جرّب توليد فاتورة PDF أول ما تنشر؛ لو فشل ابعتلي سجل الأخطاء (Logs).
- **حد معدل الطلبات (rate limit)** في الذاكرة لكل نسخة function، فمش صارم زي السيرفر العادي.
- الشغل اللي بعد الرد (سجل العمليات، إشعارات) بيستخدم `waitUntil` ومفروض يكمل، ده برضه محتاج تأكيد بعد النشر.
- الـ Function Timeout = 60 ثانية (الحد الأقصى في Hobby).

## تجربة الـ cron يدويًا
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<backend>.vercel.app/api/cron/daily
```
