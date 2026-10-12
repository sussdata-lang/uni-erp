import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { hashPassword, tempPassword, validatePasswordPolicy } from '../security.js';
import { PERMISSIONS, BUILTIN_ROLES, ASSIGNABLE, effective, roleLabel } from '../permissions.js';

// حسابات العاملين فقط؛ حسابات الطلاب تُدار من شاشة «شؤون الطلاب»
const bad = (m, code = 'validation') => new HttpError(400, m, code);
const activeAdmins = (db) => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND role_key IS NULL AND active = 1").get().n;
const covers = (actor, perms) => perms.every((p) => actor.can(p));

// يحوّل مفتاح الدور المختار إلى (role, role_key) مع منع رفع الصلاحيات
function resolveRole(db, actor, key) {
  key = String(key ?? '');
  if (BUILTIN_ROLES.includes(key)) {
    if (!covers(actor, PERMISSIONS[key])) throw new HttpError(403, 'لا يجوز منح دور أوسع من صلاحياتك.', 'forbidden');
    return { role: key, role_key: null };
  }
  const r = db.prepare('SELECT key, permissions_json, active FROM roles WHERE key = ?').get(key);
  if (!r) throw bad('دور غير موجود.');
  if (!r.active) throw bad('هذا الدور معطَّل.');
  if (!covers(actor, JSON.parse(r.permissions_json))) throw new HttpError(403, 'لا يجوز منح دور أوسع من صلاحياتك.', 'forbidden');
  return { role: 'staff', role_key: r.key };      // الصنف 'staff' للحسابات ذات الأدوار المخصّصة
}

function resolveUnit(db, unitId) {
  if (unitId === undefined || unitId === null || unitId === '') return null;
  const u = db.prepare('SELECT id, active FROM org_units WHERE id = ?').get(Number(unitId));
  if (!u) throw bad('الوحدة غير موجودة.');
  if (!u.active) throw bad('الوحدة معطَّلة.');
  return u.id;
}

function target(db, actor, id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) throw new HttpError(404, 'المستخدم غير موجود.', 'not_found');
  if (u.role === 'student') throw bad('حسابات الطلاب تُدار من شاشة «شؤون الطلاب».', 'bad_request');
  // لا يجوز لمن صلاحياته أضيق أن يعدّل حساب من صلاحياته أوسع (مثلاً مدير الحسابات لا يعدّل المدير)
  if (u.id !== actor.id && !covers(actor, effective(db, u))) throw new HttpError(403, 'لا تملك صلاحية التصرف بحساب أوسع من صلاحياتك.', 'forbidden');
  return u;
}

const view = (db, u) => ({
  id: u.id, username: u.username, name: u.display_name, role: u.role, roleKey: u.role_key ?? u.role, roleLabel: roleLabel(db, u),
  unit: u.unit_id ? db.prepare('SELECT id, name FROM org_units WHERE id = ?').get(u.unit_id) : null,
  active: !!u.active, mustChange: !!u.must_change_password, locked: u.locked_until > Date.now(),
});

export const listStaff = (db) => db.prepare("SELECT * FROM users WHERE role != 'student' ORDER BY id").all().map((u) => view(db, u));

export async function createUser({ db, cfg }, actor, input, ip) {
  const username = String(input?.username ?? '').trim();
  const name = String(input?.displayName ?? '').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,39}$/.test(username)) throw bad('اسم المستخدم: 3-40 حرفاً لاتينياً أو أرقاماً أو . _ - ويبدأ بحرف.');
  if (name.length < 2 || name.length > 100) throw bad('الاسم يجب أن يكون بين 2 و100 حرف.');
  if (input?.role === 'student') throw bad('يُسجَّل الطلاب من شاشة «تسجيل الطلاب» كي يكتمل ملفهم.', 'bad_request');
  const pwBad = validatePasswordPolicy(input?.password);
  if (pwBad) throw new HttpError(400, pwBad, 'weak_password');
  const rk = resolveRole(db, actor, input?.role), unit = resolveUnit(db, input?.unitId);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'اسم المستخدم مستخدم مسبقاً.', 'conflict');
  const hash = await hashPassword(input.password, cfg.scryptN);
  const id = tx(db, () => {
    const r = db.prepare('INSERT INTO users (username, display_name, password_hash, role, role_key, unit_id, must_change_password, created_at) VALUES (?,?,?,?,?,?,1,?)')
      .run(username, name, hash, rk.role, rk.role_key, unit, Date.now());
    audit(db, actor, `إنشاء حساب إداري (${rk.role_key ?? rk.role})`, username, ip);
    return Number(r.lastInsertRowid);
  });
  return { id };
}

export function updateUser({ db }, actor, id, input, ip) {
  const u = target(db, actor, id);
  const name = input?.displayName !== undefined ? String(input.displayName).replace(/\s+/g, ' ').trim() : u.display_name;
  if (name.length < 2 || name.length > 100) throw bad('الاسم يجب أن يكون بين 2 و100 حرف.');
  const cur = u.role_key ?? u.role;
  let rk = { role: u.role, role_key: u.role_key };
  if (input?.role !== undefined && input.role !== cur) {
    if (u.id === actor.id) throw bad('لا يمكنك تغيير دورك بنفسك.', 'bad_request');
    if (u.role === 'admin' && !u.role_key && u.active && activeAdmins(db) <= 1) throw bad('لا يمكن إزالة آخر مدير فعّال.', 'bad_request');
    rk = resolveRole(db, actor, input.role);
  }
  const unit = input?.unitId !== undefined ? resolveUnit(db, input.unitId) : u.unit_id;
  const roleChanged = (rk.role_key ?? rk.role) !== cur;
  tx(db, () => {
    db.prepare('UPDATE users SET display_name = ?, role = ?, role_key = ?, unit_id = ? WHERE id = ?').run(name, rk.role, rk.role_key, unit, u.id);
    if (roleChanged || unit !== u.unit_id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);   // الصلاحيات الجديدة من جلسة جديدة
    audit(db, actor, roleChanged ? `تعديل حساب (الدور ${cur}←${rk.role_key ?? rk.role})` : 'تعديل حساب إداري', u.username, ip);
  });
  return { ok: true };
}

export function setUserActive({ db }, actor, id, active, ip) {
  const u = target(db, actor, id), on = !!active;
  if (!on) {
    if (u.id === actor.id) throw bad('لا يمكنك تعطيل حسابك بنفسك.', 'bad_request');
    if (u.role === 'admin' && !u.role_key && u.active && activeAdmins(db) <= 1) throw bad('لا يمكن تعطيل آخر مدير فعّال.', 'bad_request');
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
  const u = target(db, actor, id);
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  tx(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = 0 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, 'إعادة تعيين كلمة مرور مستخدم', u.username, ip);
  });
  return { credentials: { username: u.username, tempPassword: pw } };
}
export { ASSIGNABLE };
