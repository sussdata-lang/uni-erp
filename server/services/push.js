// تنبيهات الجوال (Web Push, RFC 8030/8291/8292): أخبار جديدة، علامات جديدة، ردود على الطلبات والشكاوى.
// بلا اعتماديات: التشفير aes128gcm وتوقيع VAPID (ES256) بـ node:crypto. يعمل على Android وسطح المكتب، وعلى iOS بعد «إضافة إلى الشاشة الرئيسية».
import { log } from '../lib/logger.js';
import crypto from 'node:crypto';
import { HttpError } from '../http.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const bad = (m) => new HttpError(400, m, 'validation');

/* ---------- مفاتيح VAPID: من البيئة أو تُولَّد مرة وتُحفظ في site_settings ---------- */
export function vapidKeys({ db, cfg }) {
  const get = (k) => db.prepare('SELECT value FROM site_settings WHERE key = ?').get(k)?.value;
  let priv = cfg.vapidPrivate || get('vapid_private'), pub = cfg.vapidPublic || get('vapid_public');
  if (!priv || !pub) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
    priv = b64u(privateKey.export({ format: 'der', type: 'pkcs8' }));
    const up = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    up.run('vapid_private', priv); up.run('vapid_public', pub);
  }
  return { priv, pub };
}
const privObj = (priv) => crypto.createPrivateKey({ key: fromB64u(priv), format: 'der', type: 'pkcs8' });

export function vapidJwt(priv, audience, subject, now = Date.now()) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privObj(priv), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

/* ---------- تشفير الحمولة (RFC 8291) ---------- */
// salt وasKeys قابلتان للحقن لاختبار المتجه المرجعي في الـRFC
export function encryptPayload(plain, p256dh, auth, { salt = crypto.randomBytes(16), asEcdh = null } = {}) {
  const uaPub = fromB64u(p256dh), authSecret = fromB64u(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || authSecret.length !== 16) throw bad('مفاتيح الاشتراك غير صالحة.');
  const ecdh = asEcdh ?? (() => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return e; })();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = Buffer.concat([Buffer.from(plain), Buffer.from([2])]);          // 0x02: آخر سجل
  if (data.length > 4096 - 16) throw bad('الحمولة أكبر من المسموح.');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce), ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}
export function decryptPayload(body, uaEcdh, auth) {          // للاختبار فقط (يقوم به المتصفح عادة)
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const uaPub = uaEcdh.getPublicKey(), shared = uaEcdh.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, fromB64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return pt.subarray(0, pt.lastIndexOf(2));
}

/* ---------- حماية: لا نرسل إلا إلى خدمات الدفع المعروفة (لا SSRF عبر endpoint يختاره المستخدم) ---------- */
const ALLOW = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com', 'web.push.apple.com'];
export function endpointOk(cfg, raw) {
  let u; try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 600 || /^\d+(\.\d+){3}$|^\[/.test(u.hostname)) return false;
  const hosts = [...ALLOW, ...(cfg.pushAllowHosts ?? [])];
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}

/* ---------- الاشتراكات ---------- */
export function subscribe({ db, cfg }, user, b) {
  const ep = String(b?.endpoint ?? ''), p = String(b?.keys?.p256dh ?? ''), a = String(b?.keys?.auth ?? '');
  if (!endpointOk(cfg, ep)) throw bad('خدمة الإشعارات في متصفحك غير مدعومة.');
  if (fromB64u(p).length !== 65 || fromB64u(a).length !== 16) throw bad('مفاتيح الاشتراك غير صالحة.');
  const n = db.prepare('SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = ? AND endpoint != ?').get(user.id, ep).c;
  if (n >= 10) throw bad('الحد الأقصى 10 أجهزة للحساب الواحد.');
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua`).run(user.id, ep, p, a, String(b.ua ?? '').slice(0, 120), Date.now());
  return { ok: true };
}
export function unsubscribe({ db }, user, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, String(endpoint ?? ''));
  return { ok: true };
}
export const subscriptionCount = (db, userId) => db.prepare('SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = ?').get(userId).c;

/* ---------- الإرسال ---------- */
const pending = new Set();
export const drainPush = async () => { while (pending.size) await Promise.allSettled([...pending]); };

async function sendOne(deps, sub, json) {
  const { db, cfg } = deps, keys = vapidKeys(deps), f = cfg.pushFetch ?? fetch;
  const body = encryptPayload(json, sub.p256dh, sub.auth), aud = new URL(sub.endpoint).origin;
  const jwt = vapidJwt(keys.priv, aud, cfg.publicUrl && cfg.publicUrl.startsWith('https:') ? cfg.publicUrl : 'mailto:admin@example.com');
  try {
    const res = await f(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${jwt}, k=${keys.pub}` }, body, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);      // اشتراك منتهٍ
    return res.status;
  } catch (e) { log.warn('push: ' + e.message); return 0; }
}

// يرسل لمستخدمين (أو لكل الطلاب الفعّالين عند userIds = 'students') دون انتظار؛ لا يفشل الطلب الأصلي أبداً بسببه
export function notify(deps, userIds, payload) {
  const job = (async () => {
    const { db } = deps;
    const ids = userIds === 'students' ? db.prepare("SELECT u.id FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.role = 'student' AND sp.status = 'active'").all().map((r) => r.id) : [...new Set(userIds)];
    if (!ids.length) return;
    const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const json = JSON.stringify({ title: String(payload.title).slice(0, 80), body: String(payload.body ?? '').slice(0, 160), url: payload.url || '/', tag: payload.tag || undefined });
    for (let i = 0; i < subs.length; i += 20) await Promise.all(subs.slice(i, i + 20).map((s) => sendOne(deps, s, json)));
  })().catch((e) => log.warn('push: ' + e.message)).finally(() => pending.delete(job));
  pending.add(job);
  return job;
}

export const notifyNews = (deps, title) => notify(deps, 'students', { title: 'خبر جديد', body: title, url: '/', tag: 'news' });
export const notifyGrade = (deps, studentId, course) => notify(deps, [studentId], { title: 'علامة جديدة', body: course ? `رُصدت علامتك في مقرر «${course}».` : 'رُصدت علامات جديدة في ملفك.', url: '/', tag: 'grades' });
export function notifyRequest(deps, requestId) {
  const r = deps.db.prepare('SELECT r.student_id, r.status, r.no, st.label FROM requests r JOIN service_types st ON st.code = r.service_code WHERE r.id = ?').get(Number(requestId));
  if (!r || r.status === 'review') return;
  return notify(deps, [r.student_id], { title: 'رد على طلبك', body: `${r.label} (${r.no}): ${r.status === 'approved' ? 'تم الاعتماد' : 'تم الرفض'}.`, url: '/', tag: 'req-' + r.no });
}
export function notifyComplaint(deps, complaintId) {
  const c = deps.db.prepare('SELECT student_id, no FROM complaints WHERE id = ?').get(Number(complaintId));
  if (c) return notify(deps, [c.student_id], { title: 'رد على شكواك', body: `تم الرد على الشكوى ${c.no}.`, url: '/', tag: 'cmp-' + c.no });
}
