// مرفقات الطالب عند التسجيل: الثبوتيات الشخصية، الصورة الشخصية، مرفقات أخرى.
// النوع يُحدَّد من توقيع الملف (لا من امتداده)، والملفات تُحفظ بأسماء عشوائية خارج المسار العام وتُقدَّم عبر واجهة تتحقق من الصلاحية.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { sniff } from './media.js';

export const KINDS = { identity: 'الثبوتيات الشخصية', photo: 'الصورة الشخصية', other: 'مرفقات أخرى' };
export const FILE_LIMITS = { photo: { max: 1, bytes: 3 * 1024 * 1024, pdf: false }, identity: { max: 5, bytes: 8 * 1024 * 1024, pdf: true }, other: { max: 10, bytes: 8 * 1024 * 1024, pdf: true } };
const bad = (m) => new HttpError(400, m, 'validation');
export const filesDir = (cfg) => path.join(cfg.uploadDir, 'students');

function sniffFile(b) {
  if (b.length > 8 && b.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  const t = sniff(b);
  return t && t.kind === 'image' ? t : null;                      // لا فيديو ولا SVG
}
const cleanName = (n) => String(n ?? 'ملف').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ملف';

const view = (r) => ({ id: r.id, kind: r.kind, kindLabel: KINDS[r.kind], name: r.orig_name, mime: r.mime, size: r.size, createdAt: r.created_at, url: `/api/student-files/${r.id}` });

export function listStudentFiles(db, studentId) {
  return db.prepare('SELECT * FROM student_files WHERE student_id = ? ORDER BY kind, id').all(Number(studentId)).map(view);
}
export function filesCount(db) {          // عدد المرفقات لكل طالب (لجدول الطلاب)
  const m = new Map();
  for (const r of db.prepare('SELECT student_id, COUNT(*) c, MAX(CASE WHEN kind = \'photo\' THEN id END) photo FROM student_files GROUP BY student_id').all()) m.set(r.student_id, { count: r.c, photoId: r.photo ?? null });
  return m;
}

export function addStudentFile({ db, cfg }, actor, studentId, kind, origName, buf, ip) {
  const lim = FILE_LIMITS[kind];
  if (!lim) throw bad('نوع المرفق غير معروف.');
  const st = db.prepare("SELECT u.id, u.student_no FROM users u WHERE u.id = ? AND u.role = 'student'").get(Number(studentId));
  if (!st) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('الملف فارغ.');
  const t = sniffFile(buf);
  if (!t || (t.kind === 'pdf' && !lim.pdf)) throw bad(kind === 'photo' ? 'الصورة الشخصية: jpg أو png أو webp فقط.' : 'نوع الملف غير مدعوم: صور (jpg/png/webp/gif) أو PDF فقط.');
  if (buf.length > lim.bytes) throw new HttpError(413, `حجم الملف يتجاوز ${lim.bytes / 1048576} ميغابايت.`, 'too_large');
  const have = db.prepare('SELECT id, file FROM student_files WHERE student_id = ? AND kind = ? ORDER BY id').all(st.id, kind);
  if (kind === 'photo') {                                          // صورة واحدة: الجديدة تحلّ محل القديمة
    for (const o of have) { removeOne(cfg, o.file); db.prepare('DELETE FROM student_files WHERE id = ?').run(o.id); }
  } else if (have.length >= lim.max) throw bad(`الحد الأقصى ${lim.max} ملفات في «${KINDS[kind]}».`);
  fs.mkdirSync(filesDir(cfg), { recursive: true });
  const file = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(filesDir(cfg), file), buf, { mode: 0o600 });
  const id = Number(db.prepare('INSERT INTO student_files (student_id, kind, file, orig_name, mime, size, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(st.id, kind, file, cleanName(origName), t.mime, buf.length, actor.id, Date.now()).lastInsertRowid);
  audit(db, actor, `إرفاق «${KINDS[kind]}» بملف طالب`, st.student_no, ip);
  return view(db.prepare('SELECT * FROM student_files WHERE id = ?').get(id));
}

function removeOne(cfg, file) { try { fs.unlinkSync(path.join(filesDir(cfg), file)); } catch { /* غير موجود */ } }

export function deleteStudentFile({ db, cfg }, actor, id, ip) {
  const r = db.prepare('SELECT f.*, u.student_no FROM student_files f JOIN users u ON u.id = f.student_id WHERE f.id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'المرفق غير موجود.', 'not_found');
  db.prepare('DELETE FROM student_files WHERE id = ?').run(r.id); removeOne(cfg, r.file);
  audit(db, actor, `حذف «${KINDS[r.kind]}» من ملف طالب`, r.student_no, ip);
}
export function purgeStudentFiles(db, cfg, studentId) {          // عند حذف الطالب نهائياً
  for (const r of db.prepare('SELECT file FROM student_files WHERE student_id = ?').all(Number(studentId))) removeOne(cfg, r.file);
  db.prepare('DELETE FROM student_files WHERE student_id = ?').run(Number(studentId));
}

// بث الملف: لموظف يملك student:read أو للطالب صاحب الملف فقط
export function streamStudentFile({ db, cfg }, user, res, id, headers) {
  const r = db.prepare('SELECT * FROM student_files WHERE id = ?').get(Number(id));
  if (!r || (!user.can('student:read') && r.student_id !== user.id)) throw new HttpError(404, 'غير موجود.', 'not_found');
  const file = path.join(filesDir(cfg), r.file);
  if (!fs.existsSync(file)) throw new HttpError(404, 'غير موجود.', 'not_found');
  res.writeHead(200, { ...headers, 'Content-Type': r.mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=600',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.orig_name)}`, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}
