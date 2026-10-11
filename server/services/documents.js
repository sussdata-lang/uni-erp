import { sha256, hmac, safeEqual, newDocCode } from '../security.js';
import { HttpError } from '../http.js';
import { getSite } from './site.js';

// تمثيل قانوني ثابت (مفاتيح مرتبة) كي تكون البصمة مستقرة
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const sign = (cfg, hash, code) => hmac(cfg.signingKey, `${hash}|${code}`);

// إصدار وثيقة: لقطة ثابتة من بيانات الطالب والطلب وقت الاعتماد.
// التوقيع هنا HMAC بمفتاح الخادم (يثبت أن الجامعة أصدرتها ولم تُعدَّل). الانتقال إلى توقيع PKI/PAdES مُدرج في خارطة الطريق.
export function issueDocument({ db, cfg }, request, issuer, now) {
  const student = db.prepare('SELECT display_name, student_no, program FROM users WHERE id = ?').get(request.student_id);
  const svc = db.prepare('SELECT code, label, fields_json FROM service_types WHERE code = ?').get(request.service_code);
  const fieldLabels = Object.fromEntries(JSON.parse(svc.fields_json).map((f) => [f.name, f.label]));
  delete svc.fields_json;
  let code;
  do { code = newDocCode(); } while (db.prepare('SELECT 1 FROM documents WHERE code = ?').get(code));
  const payload = {
    university: getSite({ db, cfg }).university, code, requestNo: request.no, service: svc,
    student: { name: student.display_name, studentNo: student.student_no, program: student.program },
    details: JSON.parse(request.details_json), fieldLabels, issuedAt: now,
  };
  if (svc.code === 'transcript') {
    const grades = db.prepare('SELECT term, course, hours, mark FROM grades WHERE student_id = ? ORDER BY id').all(request.student_id);
    const hrs = grades.reduce((s, g) => s + g.hours, 0);
    payload.transcript = { grades, average: hrs ? Math.round((grades.reduce((s, g) => s + g.hours * g.mark, 0) / hrs) * 10) / 10 : null };
  }
  const json = canonical(payload), hash = sha256(json);
  db.prepare('INSERT INTO documents (request_id, code, issued_at, issued_by, payload_json, content_hash, signature) VALUES (?,?,?,?,?,?,?)')
    .run(request.id, code, now, issuer.id, json, hash, sign(cfg, hash, code));
  return { code, hash };
}

export function getDocument({ db }, user, code) {
  const d = db.prepare(`SELECT d.*, r.student_id FROM documents d JOIN requests r ON r.id = d.request_id WHERE d.code = ?`).get(String(code).toUpperCase());
  if (!d || (!user.can('document:read_all') && d.student_id !== user.id)) throw new HttpError(404, 'الوثيقة غير موجودة.', 'not_found');
  return { code: d.code, issuedAt: d.issued_at, hash: d.content_hash, payload: JSON.parse(d.payload_json) };
}

const maskName = (n) => { const p = n.split(' '); return p[0] + (p[1] ? ` ${p[1][0]}.` : ''); };

// التحقق العام: يُعيد حساب البصمة والتوقيع من الصف المخزَّن، ولا يكشف إلا الحد الأدنى من البيانات
export function verifyPublic({ db, cfg }, rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!/^UV-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { valid: false, reason: 'malformed' };
  const d = db.prepare('SELECT * FROM documents WHERE code = ?').get(code);
  if (!d) return { valid: false, reason: 'not_found' };
  const hash = sha256(d.payload_json);
  const intact = safeEqual(hash, d.content_hash) && safeEqual(sign(cfg, hash, code), d.signature);
  if (!intact) return { valid: false, reason: 'tampered' };
  const p = JSON.parse(d.payload_json);
  return { valid: true, code, service: p.service.label, student: maskName(p.student.name), issuedAt: d.issued_at, hashPrefix: d.content_hash.slice(0, 16), university: p.university };
}
