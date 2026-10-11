// تهيئة بيانات أولية. الاستخدام:
//   npm run seed            كلمات مرور عشوائية تُطبع مرة واحدة
//   npm run seed -- --demo  كلمة مرور موحدة للتجربة المحلية فقط (Demo#2026pass)
import crypto from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { openDb, tx } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { audit } from '../server/audit.js';

const demo = process.argv.includes('--demo');
const cfg = loadConfig();
const db = openDb(cfg.dbPath);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) { console.log('قاعدة البيانات تحوي مستخدمين مسبقاً؛ لا شيء يُضاف.'); process.exit(0); }

const people = [
  { u: 'admin',    n: 'مدير النظام',      role: 'admin' },
  { u: 'staff1',   n: 'م. الأحمد',        role: 'staff' },
  { u: 'auditor1', n: 'مدقق الجودة',      role: 'auditor' },
];
const out = [];

// الطلاب لا يُنشؤون هنا: يسجِّلهم الموظف من شاشة «تسجيل الطلاب» كي يكتمل ملفهم. 
for (const p of people) {
  const pw = demo ? 'Demo#2026pass' : crypto.randomBytes(9).toString('base64url') + '7a';
  const hash = await hashPassword(pw, cfg.scryptN);
  tx(db, () => {
    db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, program, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(p.u, p.n, hash, p.role, p.no ?? null, p.program ?? null, Date.now());
  });
  out.push([p.u, p.role, pw]);
}
audit(db, null, 'تهيئة البيانات الأولية', demo ? 'demo' : 'random');
console.log('\nالحسابات المُنشأة (احفظ كلمات المرور الآن، لن تُعرض مرة أخرى):');
for (const [u, role, pw] of out) console.log(`  ${u.padEnd(10)} ${role.padEnd(8)} ${pw}`);
if (demo) console.log('\nتنبيه: وضع --demo للتجربة المحلية فقط. لا تستخدمه في بيئة حقيقية.');
