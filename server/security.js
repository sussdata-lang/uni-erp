import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// كلمات المرور: scrypt مع ملح عشوائي. الصيغة: scrypt$N$r$p$salt$hash
export async function hashPassword(password, N = 2 ** 15) {
  const r = 8, p = 1, salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), 32, { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'base64'));
}

export function validatePasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'كلمة المرور يجب ألا تقل عن 10 أحرف.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'كلمة المرور يجب أن تحوي أحرفاً وأرقاماً.';
  return null;
}

// كلمة مرور مؤقتة يمكن إملاؤها: بلا أحرف ملتبسة، وتضمن حروفاً وأرقاماً (تحقق سياسة كلمات المرور)
export function tempPassword() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', ALL = L + D;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(L), pick(D), ...Array.from({ length: 10 }, () => pick(ALL))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');

// رمز التحقق من الوثيقة: أبجدية بلا حروف ملتبسة (0/O، 1/I)
export function newDocCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return `UV-${s.slice(0, 4)}-${s.slice(4)}`;
}

// محدِّد معدل بسيط في الذاكرة (نافذة ثابتة). في الإنتاج متعدد الخوادم يُنقل إلى مخزن مشترك.
export class RateLimiter {
  constructor() { this.hits = new Map(); }
  check(key, limit, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; this.hits.set(key, e); }
    e.count++;
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    return e.count <= limit;
  }
}
