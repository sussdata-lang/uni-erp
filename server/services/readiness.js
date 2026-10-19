// فحص جاهزية النشر: يُرجع قائمة {id, level: ok|warn|fail, msg}. fail = لا تنشر قبل الإصلاح، warn = خطر مقبول مؤقتاً. يُشغَّل عبر `npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import { verifyAuditChain } from '../audit.js';
import { listBackups, backupDirOf } from './backup.js';

const DAY = 864e5;

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `.rw-${process.pid}`); fs.writeFileSync(f, 'x'); fs.unlinkSync(f); return null; }
  catch (e) { return `${dir}: ${e.code || e.message}`; }
}

export function checkReadiness({ cfg, db }) {
  const out = [], add = (id, level, msg) => out.push({ id, level, msg });
  add('https', ...(cfg.cookieSecure ? ['ok', 'COOKIE_SECURE=1 (الكوكي لا يُرسل إلا عبر HTTPS؛ الكاميرا تتطلب HTTPS).'] : ['warn', 'COOKIE_SECURE=0: فعّله (=1) خلف HTTPS؛ الكاميرا وإشعارات الجوال لا تعمل بدون HTTPS.']));
  add('public-url', ...(/^https:\/\//.test(cfg.publicUrl || '') ? ['ok', `PUBLIC_URL=${cfg.publicUrl} (روابط التحقق وQR صحيحة).`] : ['warn', 'PUBLIC_URL ليس عنوان https عاماً: روابط التحقق ورمز QR في الوثائق ستشير إلى عنوان غير صالح للجمهور.']));
  add('proxy', ...(cfg.cookieSecure && !cfg.trustProxy ? ['warn', 'خلف وكيل عكسي اضبط TRUST_PROXY=1 وإلا سُجّل عنوان الوكيل بدل عنوان المستخدم في التدقيق وتحديد المعدّل.'] : ['ok', 'إعداد الوكيل متسق.']));
  add('university', ...(/[؀-ۿ]/.test(cfg.universityName) ? ['ok', `اسم الجامعة: ${cfg.universityName}`] : ['warn', `UNIVERSITY_NAME="${cfg.universityName}" بلا حروف عربية: صحّحه ليظهر الاسم الرسمي في الوثائق.`]));
  const bad = [cfg.dbPath && path.dirname(cfg.dbPath), cfg.uploadDir, cfg.logDir].filter(Boolean).map(writable).filter(Boolean);
  add('dirs', ...(bad.length ? ['fail', 'مجلد غير قابل للكتابة: ' + bad.join(' | ')] : ['ok', 'مجلدات البيانات والرفع والسجلات قابلة للكتابة.']));
  try {
    const ic = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    add('db', ...(ic.length === 1 && ic[0] === 'ok' ? ['ok', 'سلامة قاعدة البيانات: ok.'] : ['fail', 'فحص سلامة SQLite فشل: ' + ic.slice(0, 3).join('; ')]));
  } catch (e) { add('db', 'fail', 'تعذّر فحص قاعدة البيانات: ' + e.message); }
  try { const v = verifyAuditChain(db); add('audit-chain', ...(v.ok ? ['ok', `سلسلة التدقيق سليمة (${v.checked} سجلاً).`] : ['fail', `سلسلة التدقيق مكسورة عند السجل ${v.brokenAtId}.`])); }
  catch (e) { add('audit-chain', 'fail', 'تعذّر فحص سلسلة التدقيق: ' + e.message); }
  const bk = listBackups(cfg).sort((a, b) => b.createdAt - a.createdAt)[0];
  add('backup', ...(!bk ? ['warn', `لا توجد نسخة احتياطية في ${backupDirOf(cfg)} بعد (تأكد أن BACKUP_AUTO ليس 0).`]
    : Date.now() - bk.createdAt > 2 * DAY ? ['warn', `آخر نسخة احتياطية عمرها أكثر من يومين (${bk.name}).`] : ['ok', `آخر نسخة حديثة: ${bk.name}.`]));
  add('offsite', ...(cfg.backupPutUrl ? ['ok', 'نسخة خارجية مفعّلة (BACKUP_PUT_URL).'] : ['warn', 'لا نسخة خارجية: النسخ على القرص نفسه تضيع مع فقدانه. اضبط BACKUP_PUT_URL أو انسخ مجلد النسخ دورياً.']));
  add('tsa', ...(cfg.tsaUrl ? ['ok', `ختم زمني موثوق: ${cfg.tsaUrl}`] : ['warn', 'TSA_URL غير مضبوط: الشهادات تُختم بوقت محلي غير موثّق من طرف ثالث (اختياري).']));
  return out;
}
