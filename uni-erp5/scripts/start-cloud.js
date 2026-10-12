// تشغيل الاستضافة السحابية: عند أول تشغيل (قاعدة فارغة) تُنشأ حسابات الإدارة بكلمات مرور عشوائية
// تُطبع مرة واحدة في سجلات النشر (Deploy Logs)، ثم يبدأ الخادم. في التشغيلات اللاحقة لا يُضاف شيء.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const seed = fileURLToPath(new URL('./seed.js', import.meta.url));
const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', seed], { stdio: 'inherit' });
if (r.status !== 0) { console.error('فشلت تهيئة البيانات الأولية.'); process.exit(r.status ?? 1); }
await import('../server/index.js');
