import { hashPassword, verifyPassword, newToken, sha256, validatePasswordPolicy } from '../security.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { effective, roleLabel } from '../permissions.js';

const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
// تجزئة وهمية تُستخدم عند غياب المستخدم كي يتساوى زمن الاستجابة (منع تعداد الحسابات)
let dummyHash;

export function publicUser(db, u) {
  const unit = u.unit_id ? db.prepare('SELECT id, name FROM org_units WHERE id = ?').get(u.unit_id) : null;
  return { id: u.id, username: u.username, name: u.display_name, role: u.role, roleKey: u.role_key ?? u.role, roleLabel: roleLabel(db, u), unit,
    studentNo: u.student_no, program: u.program, mustChange: !!u.must_change_password, permissions: effective(db, u) };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  const perms = new Set(effective(db, row));
  return { ...row, label: `${row.display_name}`, roleKey: row.role_key ?? row.role, can: (p) => perms.has(p) };
}

export async function login({ db, cfg, limiter }, { username, password, ip, ua }) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) throw new HttpError(400, 'أدخل اسم المستخدم وكلمة المرور.', 'bad_request');
  if (!limiter.check(`login:${ip}`, 20, 60_000) || !limiter.check(`login:${username.toLowerCase()}`, 8, 60_000))
    throw new HttpError(429, 'محاولات كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  dummyHash ??= await hashPassword('dummy-password-0', cfg.scryptN);
  if (u && u.locked_until > Date.now()) {
    audit(db, null, 'دخول مرفوض: حساب مقفل', username, ip);
    throw new HttpError(423, 'الحساب مقفل مؤقتاً بعد محاولات فاشلة. حاول لاحقاً أو راجع المسؤول.', 'locked');
  }
  const ok = await verifyPassword(password, u ? u.password_hash : dummyHash);
  if (!u || !ok || !u.active) {
    if (u) {
      const fails = u.failed_logins + 1;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0, u.id);
    }
    audit(db, null, 'دخول مرفوض', username, ip);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'bad_credentials');
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
  const token = newToken(), now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(sha256(token), u.id, now, now + cfg.sessionHours * 3600_000, ip, String(ua ?? '').slice(0, 200));
  audit(db, { id: u.id, label: u.display_name, role: u.role_key ?? u.role }, 'تسجيل دخول', '', ip);
  return { token, user: publicUser(db, u), maxAge: cfg.sessionHours * 3600 };
}

export function logout({ db }, token, user, ip) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  if (user) audit(db, user, 'تسجيل خروج', '', ip);
}

// تغيير كلمة المرور (إلزامي بعد كلمة مؤقتة). تُنهى بقية جلسات المستخدم، وتبقى الجلسة الحالية.
export async function changePassword({ db, cfg, limiter }, user, token, { current, next }, ip) {
  if (!limiter.check(`chpw:${user.id}`, 5, 60_000)) throw new HttpError(429, 'محاولات كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
  if (typeof current !== 'string' || typeof next !== 'string') throw new HttpError(400, 'أدخل كلمة المرور الحالية والجديدة.', 'bad_request');
  if (!(await verifyPassword(current, user.password_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة.', 'bad_credentials', 'current');
  const bad = validatePasswordPolicy(next);
  if (bad) throw new HttpError(400, bad, 'weak_password', 'next');
  if (next === current) throw new HttpError(400, 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.', 'weak_password', 'next');
  const hash = await hashPassword(next, cfg.scryptN);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(token));
  audit(db, user, 'تغيير كلمة المرور', '', ip);
}
