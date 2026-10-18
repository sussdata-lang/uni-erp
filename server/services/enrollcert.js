// شهادة تسجيل الطالب: PDF/A-2b موقَّعة رقمياً (CMS/X.509، SHA-256)، برمز QR إلى بوابة التحقق، وبختم زمني. تُنشأ تلقائياً عند إنشاء حساب الطالب.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { makeQr } from '../qr.js';
import { buildPdf, prepareSigning } from '../lib/pdf.js';
import { loadIdentity, signDetached, withTimestamp, requestTimestamp, verifyPdf, sha256 } from './pki.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
const maskName = (n) => { const p = n.split(' '); return p[0] + (p[1] ? ` ${p[1][0]}.` : ''); };
const TERMS = (t) => t;
const identities = new WeakMap(), jobs = new WeakMap();
export const identityOf = (cfg) => { let id = identities.get(cfg); if (!id) identities.set(cfg, (id = loadIdentity(cfg))); return id; };
export const certDir = (cfg) => path.join(cfg.uploadDir, 'certs');
export const publicBase = (cfg) => (cfg.publicUrl ?? `http://localhost:${cfg.port ?? 3000}`).replace(/\/$/, '');

export function payloadFor(db, cfg, studentId) {
  const r = db.prepare(`SELECT u.id, u.student_no, u.created_at, sp.first_name, sp.father_name, sp.last_name, sp.enroll_year, sp.enroll_term, sp.study_level, g.name pname, g.faculty fname, fa.code fcode
    FROM users u JOIN student_profiles sp ON sp.user_id = u.id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id WHERE u.id = ? AND u.role = 'student'`).get(Number(studentId));
  if (!r) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  return { v: 1, type: 'student_enrollment', university: cfg.universityName, student: { name: `${r.first_name} ${r.father_name} ${r.last_name}`, studentNo: r.student_no },
    faculty: r.fname, facultyCode: r.fcode ?? null, program: r.pname, enrollYear: r.enroll_year, term: r.enroll_term, level: r.study_level, accountCreatedAt: r.created_at };
}

const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
function paint(d, p, code, url, qr, signAt, ident, payloadHash) {
  const G = '#054239', GOLD = '#C9A24B';
  d.fill(G); d.rect(0, 742, 595.28, 100); d.fill(GOLD); d.rect(0, 738, 595.28, 4);
  d.image(478, 752, 68, 82);
  d.text(p.university, { x: 465, y: 800, size: 21, font: 'bold', color: '#FFFFFF' });
  d.text('وزارة الداخلية — قسم شؤون الطلاب', { x: 465, y: 774, size: 12, color: '#E6CB84' });
  d.text('شهادة تسجيل طالب', { x: 297.6, y: 690, size: 26, font: 'bold', color: G, align: 'center' });
  d.stroke(GOLD); d.line(180, 676, 415, 676, 1.5);
  const rows = [['اسم الطالب', p.student.name], ['الرقم الجامعي (اسم المستخدم)', p.student.studentNo], ['الكلية / المعهد', p.faculty], ...(p.program !== p.faculty ? [['البرنامج', p.program]] : []),
    ['سنة القيد', String(p.enrollYear)], ['فصل القيد', p.term], ['تاريخ ووقت إنشاء الحساب', utc(p.accountCreatedAt)]];
  let y = 640;
  rows.forEach(([k, v], i) => {
    if (i % 2 === 0) { d.fill('#F2F5F2'); d.rect(40, y - 12, 515.28, 34); }
    d.text(k, { x: 545, y, size: 12, color: '#566660' }); d.text(v, { x: 360, y, size: 14, font: 'bold' }); y -= 36;
  });
  y -= 10; d.fill(G); d.rect(40, y, 515.28, 26); d.text('التحقق والتوقيع الرقمي', { x: 545, y: y + 7, size: 13, font: 'bold', color: '#FFFFFF' });
  const top = y - 14; d.qr(qr, 48, top - 128, 122);
  d.text('امسح الرمز للتحقق من صحة الوثيقة', { x: 109, y: top - 146, size: 9, color: '#566660', align: 'center' });
  const kv = (k, v, yy, o = {}) => { d.text(k, { x: 545, y: yy, size: 11, color: '#566660' }); d.text(v, { x: 545, y: yy - 16, size: o.size ?? 12, font: o.font ?? 'bold' }); };
  kv('رمز التحقق', code, top - 16, { size: 15 });
  kv('بصمة SHA-256 لبيانات الشهادة', payloadHash.slice(0, 32), top - 54, { size: 9.5, font: 'regular' }); d.text(payloadHash.slice(32), { x: 545, y: top - 86, size: 9.5 });
  kv('وقت التوقيع', utc(signAt), top - 112);
  kv('الموقِّع (X.509)', ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? ident.leaf.subject, top - 150, { size: 11 });
  d.text('رابط التحقق', { x: 545, y: top - 184, size: 10, color: '#566660' }); d.text(url, { x: 545, y: top - 198, size: 9, color: '#10211D' });
  d.stroke(GOLD); d.line(40, 120, 555, 120, 1);
  d.text('وثيقة إلكترونية موقَّعة رقمياً بصيغة PDF/A-2b (توقيع CMS، شهادة X.509، بصمة SHA-256). أي تعديل على الملف يُبطل توقيعه.', { x: 555, y: 100, size: 9.5, color: '#566660' });
  d.text('للتحقق: أدخل رمز التحقق أو افتح الرابط أعلاه في بوابة التحقق، أو افحص بصمة الملف نفسه فيها.', { x: 555, y: 84, size: 9.5, color: '#566660' });
}

// ينشئ الشهادة إن لم توجد (idempotent). now لتثبيت الوقت في الاختبارات.
export async function issueEnrollmentCertificate({ db, cfg }, studentId, { now = new Date(), fetchImpl = fetch } = {}) {
  const have = db.prepare('SELECT * FROM student_certs WHERE student_id = ?').get(Number(studentId)); if (have) return have;
  const payload = payloadFor(db, cfg, studentId), json = JSON.stringify(payload), payloadHash = sha256(Buffer.from(json)).toString('hex');
  let code; do code = `SC-${rnd(4)}-${rnd(4)}`; while (db.prepare('SELECT 1 FROM student_certs WHERE code = ?').get(code));
  const ident = identityOf(cfg), url = `${publicBase(cfg)}/?verify=${code}`, qr = makeQr(url);
  const raw = buildPdf({ title: `شهادة تسجيل الطالب ${payload.student.name}`, author: payload.university, subject: `شهادة تسجيل — ${payload.student.studentNo}`, producer: 'Uni ERP Core — SUSS', created: now,
    signer: { name: ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? 'signer', reason: 'Student enrollment certificate', location: 'SY' } },
    (d) => paint(d, payload, code, url, qr, now, ident, payloadHash));
  const prep = prepareSigning(raw), first = signDetached(ident, prep.digest, { signingTime: now });
  let cms = first.cms, tsa = { status: 'local', url: null, time: now.getTime() };
  if (cfg.tsaUrl) {
    try { const t = await requestTimestamp(cfg.tsaUrl, sha256(first.signature), { fetchImpl }); cms = withTimestamp(ident, prep.digest, { signingTime: now }, t.token).cms; tsa = { status: 'rfc3161', url: cfg.tsaUrl, time: t.time.getTime() }; }
    catch (e) { tsa = { status: 'failed', url: cfg.tsaUrl, time: now.getTime(), error: e.message }; }       // يبقى التوقيع صحيحاً بوقت محلي
  }
  const pdf = prep.finish(cms), file = `${code}.pdf`;
  fs.mkdirSync(certDir(cfg), { recursive: true }); fs.writeFileSync(path.join(certDir(cfg), file), pdf);
  const row = { student_id: Number(studentId), code, payload_json: json, payload_sha256: payloadHash, pdf_sha256: sha256(pdf).toString('hex'), file, created_at: payload.accountCreatedAt, signed_at: now.getTime(),
    tsa_status: tsa.status, tsa_url: tsa.url, tsa_time: tsa.time, cert_subject: ident.leaf.subject, cert_fingerprint: ident.leaf.fingerprint, cert_self_signed: ident.leaf.selfSigned ? 1 : 0 };
  db.prepare(`INSERT INTO student_certs (student_id, code, payload_json, payload_sha256, pdf_sha256, file, created_at, signed_at, tsa_status, tsa_url, tsa_time, cert_subject, cert_fingerprint, cert_self_signed)
              VALUES (@student_id, @code, @payload_json, @payload_sha256, @pdf_sha256, @file, @created_at, @signed_at, @tsa_status, @tsa_url, @tsa_time, @cert_subject, @cert_fingerprint, @cert_self_signed)`).run(row);
  audit(db, null, `إصدار شهادة تسجيل موقَّعة (${tsa.status === 'rfc3161' ? 'ختم زمني موثوق' : tsa.status === 'failed' ? 'تعذّر الختم الموثوق' : 'ختم محلي'})`, payload.student.studentNo);
  return row;
}

// طابور خلفي: لا يبطئ تسجيل الطالب ولا يفشله. التسلسل (واحد في كل مرة) يحمي من ضغط جهة الختم الزمني عند الاستيراد الجماعي.
export function enqueueCertificate(deps, studentId, opts) {
  if (!deps.cfg?.uploadDir || !deps.cfg?.dbPath || deps.cfg.dbPath === ':memory:') return Promise.resolve();            // بلا مجلد رفع (مثل بناء العرض التجريبي) لا شهادات
  const prev = jobs.get(deps.db) ?? Promise.resolve();
  const next = prev.then(() => issueEnrollmentCertificate(deps, studentId, opts)).catch((e) => { console.error(`[cert] تعذّر إصدار الشهادة للطالب ${studentId}: ${e.message}`); });
  jobs.set(deps.db, next); return next;
}
export const drainCertificates = (db) => jobs.get(db) ?? Promise.resolve();

export function certFor(db, studentId) { return db.prepare('SELECT * FROM student_certs WHERE student_id = ?').get(Number(studentId)) ?? null; }
export function readCertPdf(cfg, row) { return fs.readFileSync(path.join(certDir(cfg), row.file)); }

export const certSummary = (r) => r && ({ code: r.code, signedAt: r.signed_at, tsaStatus: r.tsa_status, tsaTime: r.tsa_time, pdfSha256: r.pdf_sha256, payloadSha256: r.payload_sha256, signer: r.cert_subject, selfSigned: !!r.cert_self_signed });

// تحقق عام: يعيد فحص الملف المخزَّن (بصمته + توقيعه) ولا يكشف إلا الحد الأدنى
export function verifyEnrollment({ db, cfg }, rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!/^SC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return null;
  const r = db.prepare('SELECT * FROM student_certs WHERE code = ?').get(code);
  if (!r) return { valid: false, reason: 'not_found' };
  let pdf; try { pdf = readCertPdf(cfg, r); } catch { return { valid: false, reason: 'file_missing' }; }
  const v = verifyPdf(pdf), same = sha256(pdf).toString('hex') === r.pdf_sha256;
  if (!same || !v.intact) return { valid: false, reason: 'tampered' };
  const p = JSON.parse(r.payload_json);
  return { valid: true, kind: 'enrollment', code, service: 'شهادة تسجيل طالب', student: maskName(p.student.name), faculty: p.faculty, issuedAt: r.signed_at, hashPrefix: r.pdf_sha256.slice(0, 16), university: p.university,
    signature: { intact: true, signer: v.subject, selfSigned: v.selfSigned, signingTime: v.signingTime, algorithm: 'SHA-256 / RSA (CMS, X.509)', timestamp: { status: r.tsa_status, time: r.tsa_time, embedded: !!(v.timestamp && v.timestamp.present), imprintOk: v.timestamp ? v.timestamp.imprintOk : null } } };
}
export function verifyByHash({ db, cfg }, sha) {
  const h = String(sha ?? '').trim().toLowerCase(); if (!/^[0-9a-f]{64}$/.test(h)) return { valid: false, reason: 'malformed' };
  const r = db.prepare('SELECT code FROM student_certs WHERE pdf_sha256 = ?').get(h);
  return r ? verifyEnrollment({ db, cfg }, r.code) : { valid: false, reason: 'not_found' };
}
