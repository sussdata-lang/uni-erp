import { sha256, hmac, safeEqual, newDocCode } from '../security.js';
import { BUILTIN } from './catalog.js';
import { universityName } from './site.js';
import { HttpError } from '../http.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildView } from './transcriptmodel.js';

const PASS = 60;
const r1 = (n) => Math.round(n * 10) / 10;
// شعار الكلية الاختياري يوضع في public/brand/faculties/<الرمز>.svg أو .png؛ وإلا يُستعمل شعار الجامعة
export function facultyLogo(cfg, code) {
  if (!code || !/^[A-Z]{2,8}$/.test(code)) return null;
  for (const ext of ['svg', 'png']) if (fs.existsSync(path.join(cfg?.publicDir || '', 'brand', 'faculties', `${code}.${ext}`))) return `/brand/faculties/${code}.${ext}`;
  return null;
}

// تمثيل قانوني ثابت (مفاتيح مرتبة) كي تكون البصمة مستقرة
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const sign = (cfg, hash, code) => hmac(cfg.signingKey, `${hash}|${code}`);

// بيانات كشف العلامات: كل محاولة بسنتها وفصلها وعلاماتها؛ أحدث محاولة لكل مقرر تُحتسب في المعدل وما قبلها يُعلَّم «سابقة»
// (نفس منطق شاشة «علاماتي»). تبقى الحقول القديمة (term, course, hours, mark, average) كما هي لتوافق الوثائق السابقة.
export function transcriptData(db, studentId) {
  const rows = db.prepare(`SELECT g.id, g.term, g.course, g.hours, g.mark, g.course_id, g.level, g.semester, g.academic_year, g.theory_mark, g.practical_mark, c.code ccode
    FROM grades g LEFT JOIN courses c ON c.id = g.course_id WHERE g.student_id = ? AND g.workflow_status = 'approved'
    ORDER BY COALESCE(g.level, 99), COALESCE(g.semester, 9), g.course, g.academic_year DESC, g.id DESC`).all(studentId);
  const seen = new Set();
  const grades = rows.map((g) => {
    const key = g.course_id ?? `x${g.id}`, previous = seen.has(key); seen.add(key);
    return { term: g.term, course: g.course, hours: g.hours, mark: g.mark, code: g.ccode ?? null, level: g.level ?? null, semester: g.semester ?? null,
      academicYear: g.academic_year ?? null, theory: g.theory_mark ?? null, practical: g.practical_mark ?? null, previous };
  }).sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || (a.semester ?? 9) - (b.semester ?? 9) || a.course.localeCompare(b.course, 'ar') || Number(a.previous) - Number(b.previous));
  const cur = grades.filter((g) => !g.previous), hrs = cur.reduce((s, g) => s + g.hours, 0);
  const average = hrs ? r1(cur.reduce((s, g) => s + g.hours * g.mark, 0) / hrs) : null;
  const summary = { courses: cur.length, passed: cur.filter((g) => g.mark >= PASS).length, failed: cur.filter((g) => g.mark < PASS).length,
    hours: hrs, earnedHours: cur.filter((g) => g.mark >= PASS).reduce((s, g) => s + g.hours, 0) };
  // مقررات برنامج الطالب حتى سنته الحالية التي لم تُرصد علامتها: تُدرج «لم تُرصد» (لا تدخل في المعدل ولا في الملخص)
  const prof = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(studentId);
  if (prof?.program_id && prof.study_level) {
    const done = new Set(rows.map((g) => g.course_id).filter((x) => x !== null && x !== undefined));
    for (const c of db.prepare('SELECT id, name, code, hours, level, semester FROM courses WHERE program_id = ? AND active = 1 AND level <= ? ORDER BY level, semester, name').all(prof.program_id, prof.study_level))
      if (!done.has(c.id)) grades.push({ term: '', course: c.name, hours: c.hours, mark: null, code: c.code ?? null, level: c.level, semester: c.semester, academicYear: null, theory: null, practical: null, previous: false, pending: true });
  }
  return { grades, average, summary };
}

// إصدار وثيقة: لقطة ثابتة من بيانات الطالب والطلب وقت الاعتماد.
// التوقيع هنا HMAC بمفتاح الخادم (يثبت أن الجامعة أصدرتها ولم تُعدَّل). الانتقال إلى توقيع PKI/PAdES مُدرج في خارطة الطريق.
export function issueDocument({ db, cfg }, request, issuer, now) {
  const student = db.prepare('SELECT display_name, student_no, program FROM users WHERE id = ?').get(request.student_id);
  const prof = db.prepare(`SELECT sp.study_level, sp.enroll_year, sp.status, g.name pname, g.degree, g.years, fa.name fname, fa.code fcode
    FROM student_profiles sp JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id WHERE sp.user_id = ?`).get(request.student_id);
  const svc = db.prepare('SELECT code, label FROM service_types WHERE code = ?').get(request.service_code);
  let code;
  do { code = newDocCode(); } while (db.prepare('SELECT 1 FROM documents WHERE code = ?').get(code));
  const payload = {
    university: universityName(db, cfg), code, requestNo: request.no, service: svc,
    student: { name: student.display_name, studentNo: student.student_no, program: student.program,
      faculty: prof?.fname ?? null, facultyCode: prof?.fcode ?? null, programName: prof?.pname ?? null, degree: prof?.degree ?? null, years: prof?.years ?? null,
      level: prof?.study_level ?? null, enrollYear: prof?.enroll_year ?? null, status: prof?.status ?? null },
    details: JSON.parse(request.details_json), issuedAt: now,
  };
  if (!BUILTIN.has(svc.code)) {   // خدمة مخصصة: نثبّت تسميات الحقول داخل الوثيقة الموقَّعة لتُعرض دون الرجوع للكتالوج
    const row = db.prepare('SELECT fields_json FROM service_types WHERE code = ?').get(svc.code);
    payload.fields = JSON.parse(row?.fields_json || '[]').map((f) => ({ name: f.name, label: f.label }));
  }
  if (svc.code === 'transcript') payload.transcript = transcriptData(db, request.student_id);
  const json = canonical(payload), hash = sha256(json);
  db.prepare('INSERT INTO documents (request_id, code, issued_at, issued_by, payload_json, content_hash, signature) VALUES (?,?,?,?,?,?,?)')
    .run(request.id, code, now, issuer.id, json, hash, sign(cfg, hash, code));
  return { code, hash };
}

export function getDocument({ db, cfg }, user, code) {
  const d = db.prepare(`SELECT d.*, r.student_id FROM documents d JOIN requests r ON r.id = d.request_id WHERE d.code = ?`).get(String(code).toUpperCase());
  if (!d || (!user.can('document:read_all') && d.student_id !== user.id)) throw new HttpError(404, 'الوثيقة غير موجودة.', 'not_found');
  const payload = JSON.parse(d.payload_json);
  return { code: d.code, issuedAt: d.issued_at, hash: d.content_hash, payload, logo: facultyLogo(cfg, payload.student?.facultyCode), view: payload.transcript ? buildView(payload) : undefined };
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
