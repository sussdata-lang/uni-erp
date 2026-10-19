# PROJECT_MAP — uni-erp (الجامعة السورية للعلوم الأمنية)
آخر تحديث: 2026-10-19 · الخريطة تُحدَّث مع كل تعديل؛ أي ميزة غير مربوطة تُسجَّل فوراً في [ORPHANS & PENDING] وتُحذف عند اكتمالها.

## [TECH_STACK]
- Runtime: Node ≥ 22.5 (مُختبَر على v22.22.0) — `node:sqlite` المدمج، `node:http`، `node:test`. **صفر اعتماديات npm للإنتاج** (لا `node_modules` مطلوب للتشغيل).
- DB: SQLite ملف واحد (`data/uni-erp.db`) + ترحيلات تسلسلية `server/migrations/NNN_*.sql` (آخرها 012).
- Front: Vanilla JS (IIFE تُلحق بـ `window.UA`)، CSS واحد `public/style.css`، RTL، خط Cairo محلي، CSP صارم (`script-src 'self'`)، PWA (`sw.js`).
- مكتبات مكتوبة داخلياً: PDF/A + توقيع CMS (`lib/pdf.js`, `pki.js`)، XLSX/DOCX/ZIP، QR، Code128، Web Push (VAPID).
- اختبارات: `npm test` ← 119 اختباراً (خادم/API، منها 2 لفحص أصل الطلب ورؤوس الأمان) + `test/ui.test.js` (Playwright اختياري، يُتخطّى تلقائياً إن غاب؛ مسار بديل `PLAYWRIGHT_MODULE`).
- الإصدارات: لا اعتماديات تحتاج توثيق/تحديث؛ Playwright أداة اختبار فقط ولا يدخل `package.json`.
- Env: `PORT HOST DB_PATH UPLOAD_DIR LOG_DIR LOG_LEVEL(error|warn|info) UNIVERSITY_NAME PUBLIC_URL COOKIE_SECURE TRUST_PROXY TSA_URL BACKUP_* VAPID_* SIGNING_KEY`.

## [SYSTEM_FLOW]
1. دخول → (كلمة مرور مؤقتة؟ ← تغيير إجباري) → واجهة حسب الدور: موظف = شريط جانبي + لوحة تحكم؛ طالب = بوابة الطالب.
2. تسجيل طالب: نموذج (+بيانات إضافية +مرفقات/كاميرا) → `POST /api/students` → رقم جامعي + كلمة مرور مؤقتة → **بطاقة التسجيل** (بيانات الشهادة + باركود + بيانات الدخول + رمز التحقق/QR) → طباعة A4 عمودية.
   - الخلفية: طابور واحد يُصدر «شهادة تسجيل» PDF/A موقَّعة (ختم زمني اختياري).
3. شؤون الطلاب: سجل الطلاب (فلاتر خادم + فلتر أعمدة بقوائم منسدلة) ← ملف الطالب ← السجل الموحّد 360° (مقررات، علامات، طلبات، عقوبات، حضور، تعارض جداول).
4. طلبات الطالب: تقديم → فحص آلي (rules) → مراجعة موظف → اعتماد/رفض → وثيقة موقَّعة (PDF + QR) → تحقق عام `/?verify=CODE`.
5. العلامات: إدخال → مراجعة → اعتماد (workflow) → كشف علامات (4 قوالب).
6. استيراد/تصدير: بوابة واحدة (`exchange`) بتبويبين.
7. أخطاء التشغيل: `log.*` → ملف JSON يومي + ذاكرة حلقية → «التدقيق ▸ سجل النظام» للمدير.

## [ARCHITECTURE]
```
public/*.js  ── fetch ──►  server/http.js (CSP، حدود، جلسات) ─► routes.js (RBAC: need(c,perm)) ─► services/* (منطق الميزة)
                                                                         │                     └─ lib/* (pdf, xlsx, logger…)
                                                                  SQLite (db.js, tx) + audit_log (سلسلة بصمات) + data/uploads + data/logs
```
- **حدود الميزات (Domain):** `students`, `studentfiles`, `enrollcert`, `record360`, `academics`/`workflow`/`schedule`, `requests`/`rules`/`documents`, `attendance`, `importer`/`dataexport`, `backup`, `push`, `access`/`useradmin`, `analytics`.
- **Shared/Core فقط للمكرَّر فعلاً:** `lib/logger.js` (تسجيل)، `lib/pdf.js`، `db.js:tx`، `audit.js`، `http.js:HttpError`. لا طبقات إضافية.
- **الواجهة:** `UA.actions[data-act]` ثم سلسلة if في `app.js`؛ `shell.js` يبني الشريط الجانبي ويستخرج `.sub-tabs` من أي صفحة إلى قائمة فرعية؛ `tablefilter.js` يضيف فلترة الأعمدة لكل جدول؛ `idcard.js` البطاقة/الكاميرا/الطباعة (`UA.printHtml` + `#printroot`); `theme.js` المظهر (auto/light/dark).
- **Logging:** `server/lib/logger.js` — `log.error|warn|info(msg, meta)`؛ كتابة غير حظرية (WriteStream)، ذاكرة 300 حدث، تدوير 14 يوماً، لا يرمي أبداً، لا يسجّل أجسام الطلبات. القراءة: `GET /api/admin/logs?level=&limit=` (صلاحية `audit:read`). ملاحظة: الذاكرة تفرغ عند إعادة التشغيل (الملفات تبقى).
- **المظهر:** `data-theme` على `<html>`: غيابه = حسب الجهاز؛ قواعد `data-theme=dark/light` مولَّدة في نهاية `style.css` من القواعد المقابلة.

## [ORPHANS & PENDING]
- **أُنجز (2026-10-19): تحصين أمني** بعد مراجعة الكود:
  1. **فحص أصل الطلب (CSRF)** — `originAllowed` في `http.js`: أي POST/PUT/DELETE يحمل ترويسة Origin مختلف عن Host أو PUBLIC_URL يُرفض 403 قبل قراءة الحمولة؛ قيمة 'null' تُرفض؛ الغياب مسموح (curl/تطبيق جوال). اختبارات في `api.test.js` (نطاق غريب، منفذ غريب، null، المنشأ نفسه، بلا ترويسة، وبجلسة سليمة ومنشأ غريب).
  2. **رؤوس جديدة**: `Strict-Transport-Security` (يأخذ أثره فور تفعيل HTTPS) و`Cross-Origin-Resource-Policy: same-origin` في `SECURITY_HEADERS`.
  3. **تنزيل النسخة الاحتياطية صار بثّاً** (`sendStream` في `http.js` والمسار في `routes.js`) بدل `readFileSync` الذي يحمّل الملف كاملاً في الذاكرة.
  4. **`.env.example`** بكل المتغيرات موثّقة، و**`.gitignore`** يحمي `.env` و`data/` (قاعدة البيانات، مفتاح التوقيع، المرفقات، النسخ). لم يكن هناك `.gitignore` أصلاً — كان رفع `.env` أو `data/` ممكناً بلا قصد.
  5. **style-src يبقى 'unsafe-inline' عمداً** (69+ موضعاً `style=` في القوالب) — موثّق بتعليق في `http.js`؛ إزالته يتطلب إعادة كتابة القوالب.
- **رُبطت (2026-10-19)**: محرر الخدمات وهوية الموقع صارا تبويبين في «الإدارة» (`public/adminconfig.js` ← `/api/admin/services`، `/api/admin/settings`، صلاحية `rules:manage`). اسم الجامعة المحفوظ يسري على `/api/me` والشهادات والوثائق الجديدة. الخدمات المخصصة تُصدر وثيقة عامة بحقولها. حُذف `public/admin.js` القديم (تبويب المستخدمين مكرر مع «الحسابات والصلاحيات»). لا ORPHAN معروف حالياً.
- **PENDING** الفلترة على جدول مقسَّم تغطي حتى 500 صف محمّل؛ فوق ذلك يظهر تنبيه صريح («إجمالي N — ضيّق بفلاتر البحث»). فلترة أعمدة من الخادم غير مبنية (تُبنى إن لزم).
- **PENDING** السبب الجذري لتحذير «تعارض الجداول» في السجل 360 على بيانات الإنتاج: لم يُعاد إنتاجه محلياً؛ يُسجَّل الآن بتفاصيله (سجل النظام ← `record360: تعذّر قسم`). ينتظر نص الخطأ من الإنتاج.
- **PENDING (بيئة النشر)** يُنفَّذ على الخادم الفعلي: `npm run check` ثم معالجة التحذيرات (HTTPS، PUBLIC_URL، TRUST_PROXY، نسخة خارجية BACKUP_PUT_URL، TSA_URL). الكاميرا والمسح المباشر وWeb Push لا تُختبر إلا على جهاز حقيقي عبر HTTPS. راجع `.env.example` — كل المتغيرات موثّقة هناك.
- **PENDING** بلا تغطية آلية: الجوال 390px، الوضع الليلي بصرياً، ملفات PDF المطبوعة (تُفحص يدوياً).

## [OPS]
- `npm run check` (`scripts/check.js` ← `services/readiness.js`): HTTPS/PUBLIC_URL/TRUST_PROXY/اسم الجامعة/صلاحية المجلدات/سلامة SQLite/سلسلة التدقيق/النسخ الاحتياطي (حداثة + خارجي)/TSA. رمز الخروج 1 عند أي fail.
