// استعادة نسخة احتياطية. أوقف الخادم أولاً.
//   node scripts/restore.js data/backups/backup-20261016-010000.zip [--force]
// النسخة المشفَّرة (.enc) تحتاج BACKUP_PASSPHRASE في البيئة. يُحفظ الوضع الحالي في data/pre-restore-* قبل أي كتابة.
import { loadConfig } from '../server/config.js';
import { restoreBackup } from '../server/services/backup.js';

const file = process.argv[2], force = process.argv.includes('--force');
if (!file) { console.error('الاستعمال: node scripts/restore.js <ملف النسخة> [--force]'); process.exit(1); }
try {
  const cfg = loadConfig(), r = restoreBackup(cfg, file, { force });
  console.log(`تمت الاستعادة (${r.restored} ملفاً) من نسخة بتاريخ ${r.createdAt}.\nنسخة الوضع السابق محفوظة في: ${r.safeCopy}`);
  if (r.signingKeyInBackup && process.env.SIGNING_KEY && process.env.SIGNING_KEY !== r.signingKeyInBackup) console.warn('تنبيه: SIGNING_KEY في البيئة يختلف عن مفتاح النسخة؛ اضبطه على قيمة النسخة وإلا فشل التحقق من الوثائق القديمة.');
  console.log('شغّل الخادم الآن.');
} catch (e) { console.error('فشلت الاستعادة:', e.message); process.exit(2); }
