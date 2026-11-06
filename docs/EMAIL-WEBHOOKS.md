# البريد الإلكتروني و Webhooks

## البريد (SMTP)
- **من الإعدادات ← البريد الإلكتروني** (لمدير الوكالة) بتحط SMTP خاص بالوكالة، أو بتسيب الوكالة تستخدم SMTP المنصة.
- **SMTP المنصة** (لمالك المنصة): صفحة «إدارة المنصة» ← «البريد (SMTP المنصة)». أو متغيرات البيئة كبديل أخير: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`.
- ترتيب الاختيار عند الإرسال: SMTP الوكالة (لو مفعّل) ← SMTP المنصة (قاعدة البيانات) ← متغيرات البيئة.
- كلمات مرور SMTP بتتخزن مشفّرة (AES-256-GCM) بمفتاح `SECRETS_KEY` (أو `JWT_SECRET` لو مش متحدد). **لو غيّرت المفتاح لازم تعيد كتابة كلمات المرور.**
- `APP_URL` (مثل `https://app.example.com`) بيُستخدم في روابط الإيميل (دعوة/استعادة كلمة المرور)؛ لو مش متحدد بياخد عنوان الطلب.
- الرسائل: دعوة مستخدم (رابط لتعيين كلمة المرور 24 ساعة)، استعادة كلمة المرور (ساعة، مرة واحدة)، تذكير دفع للعميل من صفحة التحصيل، إشعار سداد فاتورة لمديري الوكالة، ملخص يومي بالفواتير المتأخرة (7 صباحًا)، رسالة اختبار. كلها عربي/إنجليزي (لغة المستخدم، وإلا لغة الوكالة).
- كل رسالة بتتسجل في `email_log`؛ الفاشلة بتتعاد تلقائيًا (بعد 1 ثم 5 ثم 30 دقيقة) لحد 4 محاولات.

## Webhooks (صادرة)
**الإعدادات ← Webhooks.** كل Webhook له رابط ومفتاح سري (`whsec_…`) وقائمة أحداث (أو «كل الأحداث»).

الأحداث: `invoice.created`, `invoice.paid`, `invoice.overdue`, `client.created`, `client.updated`, `renewal.upcoming` (خلال 7 أيام)، `payment.recorded`، و`webhook.test` من زر الاختبار.

الطلب `POST` بـ JSON:
```json
{ "id": "123", "event": "invoice.paid", "created_at": "2026-11-06T10:00:00.000Z", "agency_id": 1,
  "data": { "id": 42, "number": "INV-0042", "client_id": 7, "amount": 500, "paid_amount": 500, "currency": "EGP", "status": "paid", "issue_date": "...", "due_date": "..." } }
```
الهيدرز: `X-TAT-Event`, `X-TAT-Delivery`, `X-TAT-Timestamp` (ثواني)، `X-TAT-Signature: sha256=<hex>`.

التحقق من التوقيع (Node):
```js
const crypto = require("crypto");
const ok = (secret, headers, rawBody) =>
  headers["x-tat-signature"] ===
  "sha256=" + crypto.createHmac("sha256", secret).update(`${headers["x-tat-timestamp"]}.${rawBody}`).digest("hex");
```
(يُفضّل رفض الطلبات اللي الـ timestamp بتاعها أقدم من 5 دقايق.)

- **المطلوب من المستقبِل:** يرد بكود `2xx` خلال 10 ثواني. غير كده بنعيد المحاولة بعد 1 دقيقة، 5، 30، ساعتين، 6 ساعات (6 محاولات إجمالًا) ثم نعلّمها «فشل»؛ وتقدر تعيد الإرسال يدويًا من «سجل التسليم».
- **الأمان:** الروابط المحلية والداخلية (127.x, 10.x, 192.168.x, 169.254.x …) مرفوضة، وبنفحص عنوان الدومين وقت كل إرسال، ومبنتبعش redirects. للتجارب المحلية فقط: `WEBHOOK_ALLOW_PRIVATE=1`.
- الأحداث اليومية (`invoice.overdue`, `renewal.upcoming`) بتتفحص الساعة 7 صباحًا وبتتبعت مرة واحدة لكل فاتورة/عقد.

## GET / POST و Telegram
كل Webhook له **طريقة إرسال**: `POST` (الافتراضي، JSON موقّع) أو `GET` (من غير body).

- **الرسالة الجاهزة:** كل حدث ليه نص جاهز بلغة الوكالة (مثال: `✅ فاتورة INV-0042 اتسددت — Acme — 1,500 EGP`). بيتبعت في الحقل `message` (POST) أو كـ `{{message}}` (GET). تقدر تكتب **نص مخصص** لأي Webhook.
- **Placeholders** تشتغل في الرابط والنص: `{{message}} {{number}} {{client_name}} {{amount}} {{currency}} {{name}} {{days_overdue}} {{days_left}} {{payment_amount}} {{event}}`. في الرابط بتتحوّل لـ URL-encoding تلقائيًا.
- **GET من غير placeholders:** بنضيف للرابط `event` و`message` و`id` وكل حقول الحدث كـ `data_<name>`.
- **Telegram:** اختر «Telegram» في نافذة الإنشاء، واكتب Bot Token (من @BotFather) و Chat ID. بيتبني تلقائيًا:
  `GET https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>&text={{message}}`
  - الـ Token بيتخزن داخل الرابط، وبيتخفي (`bot***`) في السجلات وسجل التسليم وعن أي مستخدم ملوش صلاحية تعديل الإعدادات.
- التوقيع (`X-TAT-Signature`…) بيتبعت مع الـ GET كمان (في الهيدرز).

## صفحة الهبوط (Landing) وطلبات التواصل
- الصفحة العامة على `/` (و`/welcome`)؛ المستخدم المسجّل بيتحوّل لصفحة البداية بتاعته. ثنائية اللغة وبتدعم الداكن/الفاتح.
- بيانات التواصل الظاهرة في القسم تتحط وقت البناء (اختيارية): `VITE_CONTACT_EMAIL`, `VITE_CONTACT_WHATSAPP` (أرقام بكود الدولة), `VITE_CONTACT_PHONE`.
- الفورم بيتخزن في «إدارة المنصة ← طلبات التواصل» (حالة، ملاحظات، حذف)، وبيوصل إيميل لمالك المنصة (و`CONTACT_NOTIFY_EMAIL` لو متحدد) وتأكيد للزائر بلغته. محتاج SMTP المنصة.
- حماية: 5 طلبات/ساعة لكل IP + حقل مخفي ضد البوتات.
