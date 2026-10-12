// تهيئة بيانات أولية (قاعدة فارغة فقط). الاستخدام:
//   npm run seed                       الحسابان الأساسيان admin وauditor1 بكلمة المرور 1572690
//   SEED_PASSWORD=... npm run seed     كلمة مرور أخرى
// الطلاب لا يُنشؤون هنا: يسجِّلهم المدير أو موظف شؤون الطلاب من شاشة «تسجيل الطلاب».
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ensureCoreAccounts, DEFAULT_SEED_PASSWORD } from '../server/services/bootstrap.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) { console.log('قاعدة البيانات تحوي مستخدمين مسبقاً؛ لا شيء يُضاف. (لإعادة ضبط الحسابين الأساسيين: npm run accounts)'); process.exit(0); }

const password = process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD;
const res = await ensureCoreAccounts({ db, cfg }, password);
console.log('\nالحسابات الأساسية المُنشأة:');
for (const r of res) console.log(`  ${r.username.padEnd(10)} ${r.role.padEnd(8)} كلمة المرور: ${password}`);
if (password === DEFAULT_SEED_PASSWORD) console.log('\nتنبيه: كلمة المرور قصيرة (7 أرقام). غيّرها بعد أول دخول، أو مرّر SEED_PASSWORD قوية في النشر.');
