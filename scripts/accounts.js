// إعادة ضبط الحسابين الأساسيين admin وauditor1 في قاعدة قائمة (ينشئهما إن لم يوجدا).
//   npm run accounts                     كلمة المرور 1572690
//   SEED_PASSWORD=... npm run accounts   كلمة مرور أخرى
// لا يمسّ أي حساب آخر. ويطبع الحسابات الإدارية الأخرى الموجودة لتراجعها.
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ensureCoreAccounts, seedPassword, DEFAULT_SEED_PASSWORD, CORE_ACCOUNTS } from '../server/services/bootstrap.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const password = seedPassword();
for (const r of await ensureCoreAccounts({ db, cfg }, password)) console.log(`  ${r.username.padEnd(10)} ${r.role.padEnd(8)} ${r.action}`);
console.log(`كلمة المرور: ${JSON.stringify(password)} (${password.length} أحرف)`);
const core = CORE_ACCOUNTS.map((a) => a.username);
const others = db.prepare("SELECT username, role, role_key, active FROM users WHERE role != 'student'").all().filter((u) => !core.includes(u.username));
if (others.length) {
  console.log('\nحسابات إدارية أخرى موجودة (لم تُمسّ):');
  for (const u of others) console.log(`  ${u.username.padEnd(12)} ${(u.role_key ?? u.role).padEnd(14)} ${u.active ? 'فعّال' : 'معطّل'}`);
}
