# النشر أونلاين: الواجهة على Vercel + الـ backend على سيرفر Docker

## ليه مش كل حاجة على Vercel؟
Vercel بتشغّل **دوال مؤقتة** (serverless) مش سيرفر شغّال طول الوقت. الـ backend عندك محتاج:
- مهام مجدولة (الفواتير الشهرية 00:05، الأحداث اليومية 07:00) وعمال إعادة المحاولة كل 30 ثانية (الإيميل والـ Webhooks) — **مش هيشتغلوا على serverless**.
- متصفح Chromium لتوليد PDF الفواتير (ثقيل وبيتجاوز حدود الدوال).
- اتصال قاعدة بيانات دايم.

**التقسيم الموصى به:**
| الجزء | المكان |
|---|---|
| الواجهة (React) | **Vercel** ✅ |
| الـ Backend (Express + Chromium + المهام) | سيرفر يشغّل Docker: **Railway / Render / Fly.io / VPS** (الـ `backend/Dockerfile` جاهز) |
| قاعدة البيانات | Postgres على نفس المنصة أو مُدار (Neon / Supabase / Railway) |

(أبسط بديل: سيب كل حاجة على Docker في VPS بدومين وHTTPS، وVercel للواجهة بس — نفس الخطوات تحت.)

## 1) ترتيب آمن (مهم لبياناتك)
1. **حدّث بياناتك محليًا الأول** بخطوات `docs/GO-LIVE.md` (نسخة احتياطية ← تحديث ← `migration-snapshot compare`). كده تتأكد إن الداتا سليمة قبل النقل.
2. بعدين انقل القاعدة المُحدَّثة للاستضافة (خطوة 3).
3. وأخيرًا اربط الواجهة على Vercel (خطوة 5).

## 2) الـ Backend
انشر `backend/Dockerfile` (**Build context = جذر المشروع**، لأن الـ Dockerfile بينسخ `backend/` و`database/`). المتغيرات:
```
DATABASE_URL=postgres://user:pass@host:5432/dbname     # من مزوّد القاعدة
DB_SSL=true                                             # Neon/Supabase/Railway بيطلبوا TLS
JWT_SECRET=<نفس القيمة الحالية — ماتغيّرهاش>
SECRETS_KEY=<نص عشوائي طويل>
ADMIN_EMAIL=...  ADMIN_PASSWORD=...  ADMIN_NAME=...
PLATFORM_ADMIN_EMAIL=<إيميلك>
CORS_ORIGIN=https://<دومين-الواجهة>                     # نفس عنوان موقع Vercel بالظبط (بدون / في الآخر)
APP_URL=https://<دومين-الواجهة>                          # لروابط الإيميل
CONTACT_NOTIFY_EMAIL=tarekamin2031@gmail.com
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   # أو من شاشة المنصة
TZ=Africa/Cairo                                          # عشان مواعيد المهام تبقى بتوقيتك
NODE_ENV=production
PORT=4000
```
- لازم **HTTPS** (المنصات دي بتوفره تلقائيًا) والـ backend يفضل شغّال دايمًا (ماتختارش خطة بتنام).
- الـ migration بيتطبق تلقائيًا مع كل تشغيل (`migrate.js`).
- اضبط الـ health check على `/api/health`.

## 3) نقل قاعدة البيانات
من الجهاز اللي عليه Docker الحالي (بعد خطوة 1):
```bash
set -a; . ./.env; set +a
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner > hosted.dump
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" hosted.dump     # DATABASE_URL = قاعدة الاستضافة (قاعدة فاضية)
```
بعدها شغّل الـ backend على الاستضافة وقارن بصمة البيانات:
```bash
DATABASE_URL=... DB_SSL=true node backend/scripts/migration-snapshot.js compare backups/snapshot-before.json
```
(لازم `All good — data is intact.`) واحتفظ بقاعدة Docker القديمة كما هي كنسخة احتياطية لحد ما تتأكد.

## 4) Vercel (الواجهة)
1. اعمل Project جديد من نفس الريبو وحدّد **Root Directory = `frontend`**.
2. Framework: Vite (بيتعرّف تلقائيًا من `frontend/vercel.json`).
3. Environment Variable (وقت البناء):
   `VITE_API_URL = https://<رابط-الـbackend>` (بدون `/` في الآخر وبدون `/api`).
4. Deploy. الصفحات الداخلية (`/login`, `/reset-password`…) شغّالة بفضل الـ rewrite في `vercel.json`.
5. لو ضفت دومين خاص: حدّث `CORS_ORIGIN` و`APP_URL` في الـ backend لنفس الدومين.

## 5) الفحص بعد التشغيل
- [ ] `https://<backend>/api/health` يرد `{"status":"ok"}`.
- [ ] فتح موقع Vercel ← الـ landing تظهر ← تسجيل الدخول بحسابك ← الأرقام زي ما كانت.
- [ ] فتح فاتورة PDF (بيتأكد إن Chromium شغّال على الاستضافة).
- [ ] «الإعدادات ← البريد ← إرسال رسالة اختبار».
- [ ] فورم التواصل من الـ landing يوصلك.
- [ ] مفيش أخطاء CORS في الـ console (لو ظهرت: راجع `CORS_ORIGIN`).

## ملاحظات
- **ماتشغّلش** `npm run isolation` ولا `npm run phase3` على الإنتاج.
- فعّل نسخ احتياطي تلقائي للقاعدة عند المزوّد (يومي على الأقل).
- ملفات `.env` ما تترفعش على الريبو؛ حطّ المتغيرات في إعدادات كل منصة.
