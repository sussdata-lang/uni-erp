// تشغيل الاستضافة السحابية.
// 1) قاعدة فارغة: تُنشأ الحسابات الأساسية admin وauditor1 (كلمة المرور 1572690 أو SEED_PASSWORD).
// 2) قاعدة قائمة وقد ضاعت كلمة المرور أو قُفل الحساب: ضع المتغير RESET_ACCOUNTS=1 ثم أعد النشر،
//    فيُعاد ضبط admin وauditor1 (كلمة المرور + فك القفل). احذف المتغير بعد نجاح الدخول كي لا يتكرر.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const run = (file) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit' });
const seed = run('./seed.js');
if (seed.status !== 0) { console.error('فشلت تهيئة البيانات الأولية.'); process.exit(seed.status ?? 1); }
if (process.env.RESET_ACCOUNTS === '1') {
  console.log('RESET_ACCOUNTS=1: إعادة ضبط الحسابين الأساسيين…');
  const r = run('./accounts.js');
  if (r.status !== 0) { console.error('فشلت إعادة ضبط الحسابات.'); process.exit(r.status ?? 1); }
  console.log('تنبيه: احذف المتغير RESET_ACCOUNTS بعد نجاح الدخول كي لا تُعاد كلمة المرور في كل نشر.');
}
// الهيكل التنظيمي (إضافي وآمن للتكرار): الإدارات والوحدات والأدوار وحسابات المسؤولين (معطّلة ما لم يُضبط STRUCTURE_ACTIVATE=1)
{
  const st = run('./structure.js');
  if (st.status !== 0) console.error('تعذّرت تهيئة الهيكل التنظيمي؛ يُكمل الخادم بدونها.');
}
await import('../server/index.js');
