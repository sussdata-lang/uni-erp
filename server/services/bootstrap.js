import { tx } from '../db.js';
import { audit } from '../audit.js';
import { hashPassword } from '../security.js';

// كلمة المرور الابتدائية المطلوبة للحسابين الأساسيين. تُغيَّر بالمتغير SEED_PASSWORD دون تعديل الكود.
export const DEFAULT_SEED_PASSWORD = '1572690';

// قراءة كلمة المرور من البيئة: تُنظَّف من المسافات وعلامات الاقتباس التي تُلصق أحياناً عند نسخ قيمة المتغير
export function seedPassword(env = process.env) {
  let v = String(env.SEED_PASSWORD ?? '').trim();
  if (/^(["'`]).*\1$/.test(v)) v = v.slice(1, -1).trim();
  return v || DEFAULT_SEED_PASSWORD;
}

export const CORE_ACCOUNTS = [
  { username: 'admin',    name: 'مدير النظام',  role: 'admin' },
  { username: 'auditor1', name: 'مدقق الجودة',  role: 'auditor' },
];

// ينشئ الحسابين الأساسيين أو يُعيد ضبطهما (الدور، التفعيل، فك القفل، كلمة المرور) دون المساس ببقية الحسابات.
// لا تُطبَّق سياسة طول كلمة المرور هنا عمداً: الكلمة المطلوبة 7 أرقام، ويُنصح بتغييرها بعد أول دخول.
export async function ensureCoreAccounts({ db, cfg }, password = DEFAULT_SEED_PASSWORD) {
  const hash = await hashPassword(password, cfg.scryptN);
  const out = [];
  for (const a of CORE_ACCOUNTS) {
    tx(db, () => {
      const u = db.prepare('SELECT id, role FROM users WHERE username = ?').get(a.username);
      if (u && u.role === 'student') throw new Error(`اسم المستخدم ${a.username} محجوز لحساب طالب.`);
      if (u) {
        db.prepare('UPDATE users SET display_name = ?, role = ?, role_key = NULL, unit_id = NULL, password_hash = ?, active = 1, must_change_password = 0, failed_logins = 0, locked_until = 0 WHERE id = ?')
          .run(a.name, a.role, hash, u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        audit(db, null, 'إعادة ضبط حساب أساسي', a.username);
      } else {
        db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(a.username, a.name, hash, a.role, Date.now());
        audit(db, null, 'إنشاء حساب أساسي', a.username);
      }
      out.push({ username: a.username, role: a.role, action: u ? 'أُعيد ضبطه' : 'أُنشئ' });
    });
  }
  return out;
}
