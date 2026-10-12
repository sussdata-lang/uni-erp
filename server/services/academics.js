import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { tx } from '../db.js';

export const PASS_MARK = 60;
const CTRL = /[\u0000-\u001f\u007f]/;
const text = (v, min, max, label) => {
  const s = String(v ?? '').replace(/[ \t]+/g, ' ').trim();
  if (s.length < min || s.length > max || (CTRL.test(s.replace(/\n/g, '')))) throw new HttpError(400, `«${label}» يجب أن يكون بين ${min} و${max} حرفاً.`, 'validation');
  return s;
};
const intIn = (v, lo, hi, label) => { const n = Number(v); if (v === '' || v === null || v === undefined || !Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `«${label}» يجب أن يكون عدداً صحيحاً بين ${lo} و${hi}.`, 'validation'); return n; };

/* ---------------- دليل المواد ---------------- */
const courseView = (c) => ({ id: c.id, programId: c.program_id, level: c.level, semester: c.semester, name: c.name, code: c.code, hours: c.hours, instructor: c.instructor, active: !!c.active });

export function listCourses({ db }, user, q) {
  const where = [], args = [];
  if (user.role === 'student') {
    const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(user.id);
    if (!p) return { courses: [], level: null, programId: null };
    where.push('program_id = ?', 'active = 1'); args.push(p.program_id);
    if (!q.level) q = { ...q, level: p.study_level };
  } else {
    if (q.program) { where.push('program_id = ?'); args.push(Number(q.program) || 0); }
    if (!user.can('course:manage')) where.push('active = 1');
  }
  if (q.level) { where.push('level = ?'); args.push(Number(q.level) || 0); }
  if (q.semester === '1' || q.semester === '2') { where.push('semester = ?'); args.push(Number(q.semester)); }
  const rows = db.prepare(`SELECT * FROM courses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY level, semester, name LIMIT 500`).all(...args);
  return { courses: rows.map(courseView), level: q.level ? Number(q.level) : null };
}

export function createCourse({ db }, actor, b, ip) {
  const prog = db.prepare('SELECT id, years FROM programs WHERE id = ?').get(Number(b?.programId));
  if (!prog) throw new HttpError(400, 'البرنامج غير موجود.', 'validation');
  const level = intIn(b.level, 1, prog.years, 'السنة الدراسية'), semester = intIn(b.semester, 1, 2, 'الفصل');
  const name = text(b.name, 2, 100, 'اسم المقرر'), hours = intIn(b.hours ?? 3, 0, 12, 'الساعات');
  const code = b.code ? text(b.code, 1, 20, 'رمز المقرر') : null, instructor = b.instructor ? text(b.instructor, 2, 80, 'المدرّس') : null;
  if (db.prepare('SELECT 1 FROM courses WHERE program_id = ? AND level = ? AND semester = ? AND name = ?').get(prog.id, level, semester, name)) throw new HttpError(409, 'المقرر موجود مسبقاً في هذه السنة والفصل.', 'conflict');
  const id = Number(db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours, instructor) VALUES (?,?,?,?,?,?,?)').run(prog.id, level, semester, name, code, hours, instructor).lastInsertRowid);
  audit(db, actor, 'إضافة مقرر', name.slice(0, 100), ip);
  return { course: courseView(db.prepare('SELECT * FROM courses WHERE id = ?').get(id)) };
}

export function toggleCourse({ db }, actor, id, active, ip) {
  const r = db.prepare('UPDATE courses SET active = ? WHERE id = ?').run(active ? 1 : 0, Number(id));
  if (!r.changes) throw new HttpError(404, 'المقرر غير موجود.', 'not_found');
  audit(db, actor, `${active ? 'تفعيل' : 'تعطيل'} مقرر`, String(id), ip);
}

/* ---------------- العلامات ---------------- */
const gview = (g) => ({ id: g.id, course: g.course, courseId: g.course_id, level: g.level, semester: g.semester, academicYear: g.academic_year,
  hours: g.hours, theory: g.theory_mark, practical: g.practical_mark, total: g.mark, passed: g.mark >= PASS_MARK, instructor: g.instructor ?? null });

// العلامات مجمّعة بالمقرر: أحدث محاولة تظهر، وما قبلها «علامات سابقة»
export function gradesFor(db, studentId, level) {
  const rows = db.prepare(`SELECT g.*, c.instructor FROM grades g LEFT JOIN courses c ON c.id = g.course_id
    WHERE g.student_id = ? ${level ? 'AND g.level = ?' : ''} ORDER BY g.semester, g.course, g.academic_year DESC`).all(...(level ? [studentId, Number(level)] : [studentId]));
  const byCourse = new Map();
  for (const g of rows) { const k = g.course_id ?? `x${g.id}`; if (!byCourse.has(k)) byCourse.set(k, { ...gview(g), previous: [] }); else byCourse.get(k).previous.push(gview(g)); }
  const list = [...byCourse.values()];
  const hrs = list.reduce((s, g) => s + g.hours, 0);
  return { grades: list, summary: { count: list.length, passed: list.filter((g) => g.passed).length, failed: list.filter((g) => !g.passed).length,
    average: hrs ? Math.round(list.reduce((s, g) => s + g.hours * g.total, 0) / hrs * 10) / 10 : null }, passMark: PASS_MARK };
}

export function myGrades({ db }, user, q) {
  const p = db.prepare('SELECT study_level FROM student_profiles WHERE user_id = ?').get(user.id);
  if (!p) return { grades: [], summary: { count: 0, passed: 0, failed: 0, average: null }, passMark: PASS_MARK, level: null };
  const level = Number(q.level) || p.study_level;
  return { ...gradesFor(db, user.id, level), level };
}

export function enterGrade({ db }, actor, studentId, b, ip) {
  const st = db.prepare(`SELECT p.program_id, u.student_no FROM student_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`).get(Number(studentId));
  if (!st) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(b?.courseId));
  if (!c || c.program_id !== st.program_id) throw new HttpError(400, 'المقرر غير موجود في برنامج هذا الطالب.', 'validation');
  const ay = String(b?.academicYear ?? '');
  const m = /^(\d{4})\/(\d{4})$/.exec(ay);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new HttpError(400, 'العام الدراسي بصيغة 2025/2026.', 'validation');
  const theory = intIn(b.theory, 0, 100, 'العلامة النظرية');
  const practical = b.practical === '' || b.practical === null || b.practical === undefined ? null : intIn(b.practical, 0, 100, 'العلامة العملية');
  const total = theory + (practical ?? 0);
  if (total > 100) throw new HttpError(400, 'مجموع العلامتين لا يتجاوز 100.', 'validation');
  const term = `${ay}-${c.semester === 1 ? 'الفصل الأول' : 'الفصل الثاني'}`, now = Date.now();
  return tx(db, () => {
    const ex = db.prepare('SELECT id FROM grades WHERE student_id = ? AND course_id = ? AND academic_year = ?').get(Number(studentId), c.id, ay);
    if (ex) {
      db.prepare('UPDATE grades SET theory_mark = ?, practical_mark = ?, mark = ?, entered_by = ?, entered_at = ? WHERE id = ?').run(theory, practical, total, actor.id, now, ex.id);
      audit(db, actor, 'تعديل علامة', `${st.student_no} / ${c.name}`.slice(0, 100), ip);
    } else {
      db.prepare(`INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, practical_mark, entered_by, entered_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(Number(studentId), term, c.name, c.hours, total, c.id, c.level, c.semester, ay, theory, practical, actor.id, now);
      audit(db, actor, 'إدخال علامة', `${st.student_no} / ${c.name}`.slice(0, 100), ip);
    }
    return gradesFor(db, Number(studentId), null);
  });
}

/* ---------------- الأخبار ---------------- */
export function listNews({ db }, limit = 30) {
  return db.prepare('SELECT id, title, body, pinned, published_at FROM news ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?').all(limit)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, pinned: !!n.pinned, publishedAt: n.published_at }));
}
export function createNews({ db }, actor, b, ip) {
  const title = text(b?.title, 3, 150, 'العنوان'), body = text(b?.body, 3, 4000, 'النص');
  const id = Number(db.prepare('INSERT INTO news (title, body, pinned, published_at, created_by) VALUES (?,?,?,?,?)').run(title, body, b?.pinned ? 1 : 0, Date.now(), actor.id).lastInsertRowid);
  audit(db, actor, 'نشر خبر', title.slice(0, 100), ip);
  return { id };
}
export function deleteNews({ db }, actor, id, ip) {
  const n = db.prepare('SELECT title FROM news WHERE id = ?').get(Number(id));
  if (!n) throw new HttpError(404, 'الخبر غير موجود.', 'not_found');
  db.prepare('DELETE FROM news WHERE id = ?').run(Number(id));
  audit(db, actor, 'حذف خبر', n.title.slice(0, 100), ip);
}

/* ---------------- الشكاوى ---------------- */
const cview = (c, withStudent) => ({ id: c.id, no: c.no, subject: c.subject, body: c.body, status: c.status, response: c.response, createdAt: c.created_at, respondedAt: c.responded_at,
  ...(withStudent ? { student: { name: c.display_name, studentNo: c.student_no } } : {}) });
const CSEL = 'SELECT c.*, u.display_name, u.student_no FROM complaints c JOIN users u ON u.id = c.student_id';

export function createComplaint({ db }, user, b, ip) {
  const subject = text(b?.subject, 3, 120, 'الموضوع'), body = text(b?.body, 10, 2000, 'نص الشكوى');
  return tx(db, () => {
    if (db.prepare("SELECT COUNT(*) c FROM complaints WHERE student_id = ? AND status = 'open'").get(user.id).c >= 5) throw new HttpError(429, 'لديك 5 شكاوى قيد المعالجة؛ انتظر الرد قبل إضافة جديدة.', 'rate_limited');
    const id = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM complaints').get().n, no = `CMP-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
    db.prepare('INSERT INTO complaints (id, no, student_id, subject, body, created_at) VALUES (?,?,?,?,?,?)').run(id, no, user.id, subject, body, Date.now());
    audit(db, user, 'تقديم شكوى', no, ip);
    return { complaint: cview(db.prepare(`${CSEL} WHERE c.id = ?`).get(id), false) };
  });
}
export function listComplaints({ db }, user, q) {
  const all = user.can('complaint:manage'), where = [], args = [];
  if (!all) { where.push('c.student_id = ?'); args.push(user.id); }
  if (['open', 'answered', 'closed'].includes(q.status)) { where.push('c.status = ?'); args.push(q.status); }
  const rows = db.prepare(`${CSEL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.created_at DESC LIMIT 200`).all(...args);
  return { complaints: rows.map((r) => cview(r, all)) };
}
export function respondComplaint({ db }, actor, id, b, ip) {
  const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'الشكوى غير موجودة.', 'not_found');
  const response = text(b?.response, 3, 1000, 'الرد'), status = b?.close ? 'closed' : 'answered';
  db.prepare('UPDATE complaints SET response = ?, status = ?, responded_by = ?, responded_at = ? WHERE id = ?').run(response, status, actor.id, Date.now(), c.id);
  audit(db, actor, status === 'closed' ? 'الرد على شكوى وإغلاقها' : 'الرد على شكوى', c.no, ip);
  return { complaint: cview(db.prepare(`${CSEL} WHERE c.id = ?`).get(c.id), true) };
}
