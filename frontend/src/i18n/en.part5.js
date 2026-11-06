// Arabic -> English, part 5 (webhook methods, Telegram preset, message templates)
export default {
  "اكتب Bot Token و Chat ID": "Enter the Bot Token and Chat ID",
  "النوع": "Type",
  "رابط مخصص (Zapier / Make / n8n…)": "Custom URL (Zapier / Make / n8n…)",
  "اعمل بوت من @BotFather وخد الـ Token، ضيفه للجروب أو ابعتله رسالة، وجيب الـ Chat ID من @userinfobot أو من getUpdates. الرسالة بتتبعت بطريقة GET.": "Create a bot with @BotFather and copy its token, add it to your group (or message it), and get the Chat ID from @userinfobot or getUpdates. The message is sent with GET.",
  "طريقة الإرسال": "Method",
  "GET: لو الرابط فيه {{placeholders}} بتتملى (مثال ?text={{message}})، وإلا بنضيف الحقول تلقائيًا كـ query.": "GET: if the URL contains {{placeholders}} they are filled in (e.g. ?text={{message}}), otherwise the fields are added automatically as a query string.",
  "POST: بنبعت JSON موقّع (فيه الحقل message جاهز للقراءة). تقدر تستخدم {{placeholders}} في الرابط كمان.": "POST: we send signed JSON (with a ready-to-read message field). You can also use {{placeholders}} in the URL.",
  "نص الرسالة (اختياري)": "Message text (optional)",
  "اتركه فاضي لاستخدام رسالة جاهزة لكل حدث (بلغة الوكالة)": "Leave empty to use a ready-made message per event (in the agency's language)",
  "بنبعت طلب (POST أو GET) لرابطك كل ما يحصل حدث. تقدر توصله بتليجرام أو Zapier أو Make أو n8n.": "We send a signed request to your URL whenever an event happens (POST or GET). Connect it to Telegram, Zapier, Make or n8n."
};
