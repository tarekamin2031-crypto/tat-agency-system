# الـ backend على Hugging Face Spaces (مجاني، من غير كارت)

## الفكرة
الـ Space بيشغّل حاوية Docker. عشان كودك يفضل **خاص**، الـ Space نفسه فيه ملفين بس (`Dockerfile` و`README.md` من `deploy/huggingface/`)، والـ Dockerfile بيسحب الكود من ريبو GitHub الخاص وقت البناء بتوكن قراءة فقط. الـ Space لازم يكون **Public** عشان المتصفح (Vercel) يقدر يكلّم الـ API.

## الخطوات (بالترتيب)
**1) توكن GitHub للقراءة فقط**
https://github.com/settings/personal-access-tokens/new ← Name: `hf-read` ← Expiration: سنة ← **Repository access: Only select repositories ← `tat-agency-system`** ← Permissions ← Repository permissions ← **Contents: Read-only** ← Generate. انسخه (ما تبعتوش في الشات).

**2) Space جديد**
https://huggingface.co/new-space ← Name: `tat-backend` ← **SDK: Docker ← Blank** ← **Hardware: CPU basic · 2 vCPU · 16GB · FREE** ← **Visibility: Public** ← Create Space.

**3) الأسرار والمتغيرات (قبل رفع الملفات!)**
Space ← Settings ← Variables and secrets:

| النوع | الاسم | القيمة |
|---|---|---|
| Secret | `GITHUB_TOKEN` | توكن الخطوة 1 |
| Secret | `DATABASE_URL` | من `.env.local` (المجمّع) |
| Secret | `DATABASE_URL_UNPOOLED` | من `.env.local` (المباشر) |
| Secret | `JWT_SECRET` | نفس القيمة القديمة |
| Secret | `SECRETS_KEY` | `openssl rand -hex 32` |
| Secret | `ADMIN_PASSWORD` | أي كلمة قوية |
| Variable | `DB_SSL` | `true` |
| Variable | `TZ` | `Africa/Cairo` |
| Variable | `ADMIN_EMAIL` | `admin@tatagency.com` |
| Variable | `PLATFORM_ADMIN_EMAIL` | `admin@tatagency.com` |
| Variable | `ADMIN_NAME` | `Admin` |
| Variable | `CORS_ORIGIN` | عنوان موقع Vercel (بعد ما تعرفه) |
| Variable | `APP_URL` | نفس العنوان |

**4) ارفع الملفين**
Space ← Files ← Add file ← Upload files ← اسحب `Dockerfile` و`README.md` من `TAT-Agency-System/deploy/huggingface/` ← Commit. (يستبدل README الافتراضي.) هيبدأ البناء تلقائيًا (Logs ← Build).

**5) الفحص**
`https://<اسم-مستخدمك-على-HF>-tat-backend.hf.space/api/health` لازم يرد `{"status":"ok"}`.

**6) Vercel**
`VITE_API_URL = https://<اسم-مستخدمك>-tat-backend.hf.space` (من غير `/` ومن غير `/api`)، Root Directory = `frontend`. وبعد ما تعرف عنوان Vercel حدّث `CORS_ORIGIN` و`APP_URL` في الـ Space (بيعيد التشغيل لوحده).

## ملاحظات
- الـ Space المجاني بينام بعد فترة خمول طويلة (حوالي 48 ساعة؛ راجع الشروط الحالية). حط مراقب (UptimeRobot) على `/api/health` كل 5–10 دقايق.
- مصمم للتجارب والمشاريع الصغيرة؛ لعملاء حقيقيين فكّر في استضافة مدفوعة بعد التجربة.
- لتحديث الكود بعد رفع تعديلات على GitHub: Space ← Settings ← **Factory reboot** (بيعيد البناء ويسحب آخر نسخة).
- لو انتهى التوكن (بعد سنة) البناء يفشل بخطأ clone؛ اعمل توكن جديد وحدّث السر `GITHUB_TOKEN`.
