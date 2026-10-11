import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { hashPassword, tempPassword } from '../security.js';

const STAFF_ROLES = ['staff', 'admin', 'auditor'];
const activeAdmins = (db) => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;

// حسابات الطلاب تُدار من شاشة «شؤون الطلاب»؛ هنا حسابات العاملين فقط
function target(db, id) {
  const u = db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(Number(id));
  if (!u) throw new HttpError(404, 'المستخدم غير موجود.', 'not_found');
  if (u.role === 'student') throw new HttpError(400, 'حسابات الطلاب تُدار من شاشة «شؤون الطلاب».', 'bad_request');
  return u;
}

export function updateUser({ db }, actor, id, input, ip) {
  const u = target(db, id);
  const name = input?.displayName !== undefined ? String(input.displayName).replace(/\s+/g, ' ').trim() : u.display_name;
  const role = input?.role ?? u.role;
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'الاسم يجب أن يكون بين 2 و100 حرف.', 'validation');
  if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'دور غير صالح.', 'validation');
  if (role !== u.role) {
    if (u.id === actor.id) throw new HttpError(400, 'لا يمكنك تغيير دورك بنفسك.', 'bad_request');
    if (u.role === 'admin' && u.active && activeAdmins(db) <= 1) throw new HttpError(400, 'لا يمكن إزالة آخر مدير فعّال.', 'bad_request');
  }
  tx(db, () => {
    db.prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?').run(name, role, u.id);
    if (role !== u.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);   // الصلاحيات الجديدة من جلسة جديدة
    audit(db, actor, role !== u.role ? `تعديل مستخدم (الدور ${u.role}←${role})` : 'تعديل اسم مستخدم', u.username, ip);
  });
  return { ok: true };
}

export function setUserActive({ db }, actor, id, active, ip) {
  const u = target(db, id);
  const on = !!active;
  if (!on) {
    if (u.id === actor.id) throw new HttpError(400, 'لا يمكنك تعطيل حسابك بنفسك.', 'bad_request');
    if (u.role === 'admin' && u.active && activeAdmins(db) <= 1) throw new HttpError(400, 'لا يمكن تعطيل آخر مدير فعّال.', 'bad_request');
  }
  tx(db, () => {
    db.prepare('UPDATE users SET active = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(on ? 1 : 0, u.id);
    if (!on) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, on ? 'تفعيل حساب' : 'تعطيل حساب', u.username, ip);
  });
  return { ok: true };
}

// كلمة مرور مؤقتة جديدة: تُنهي الجلسات وتفك القفل وتُلزم المستخدم بتغييرها عند أول دخول
export async function resetUserPassword({ db, cfg }, actor, id, ip) {
  const u = target(db, id);
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  tx(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = 0 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, 'إعادة تعيين كلمة مرور مستخدم', u.username, ip);
  });
  return { credentials: { username: u.username, tempPassword: pw } };
}
