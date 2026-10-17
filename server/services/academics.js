import { mediaFor, addLink, removeFiles } from './media.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { tx } from '../db.js';

export const PASS_MARK = 60;
export const WORKFLOW_LABEL = { draft: 'مدخلة (قيد المراجعة)', reviewed: 'مراجَعة', approved: 'معتمدة نهائياً' };
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
  if (user.role === 'student') {
    const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(user.id);
    if (!p) return { courses: [], level: null, programId: null };
    const level = Number(q.level) || p.study_level, sem = q.semester === '1' || q.semester === '2' ? ' AND semester = ' + Number(q.semester) : '';
    const rows = db.prepare(`SELECT * FROM courses WHERE program_id = ? AND active = 1 AND level = ?${sem} ORDER BY level, semester, name LIMIT 500`).all(p.program_id, level);
    return { courses: rows.map(courseView), level };
  }
  const where = [], args = [];
  if (q.program) { where.push('c.program_id = ?'); args.push(Number(q.program) || 0); }
  if (!user.can('course:manage')) where.push('c.active = 1');
  if (q.level) { where.push('c.level = ?'); args.push(Number(q.level) || 0); }
  if (q.semester === '1' || q.semester === '2') { where.push('c.semester = ?'); args.push(Number(q.semester)); }
  const rows = db.prepare(`SELECT c.*, g.name pname, g.faculty fname, g.faculty_id fid, g.years pyears, f.code fcode, (SELECT COUNT(*) FROM grades x WHERE x.course_id = c.id) gcount
    FROM courses c JOIN programs g ON g.id = c.program_id LEFT JOIN faculties f ON f.id = g.faculty_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.faculty_id, c.level, c.semester, c.name LIMIT 5000`).all(...args);
  return { courses: rows.map((r) => ({ ...courseView(r), program: r.pname, faculty: r.fname, facultyId: r.fid, facultyCode: r.fcode ?? null, years: r.pyears, grades: r.gcount })), level: q.level ? Number(q.level) : null };
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

/* ---------------- العلامات واعتمادها بمراحل ---------------- */
const gview = (g) => ({
  id: g.id, course: g.course, courseId: g.course_id, level: g.level, semester: g.semester, academicYear: g.academic_year,
  hours: g.hours, theory: g.theory_mark, practical: g.practical_mark, total: g.mark, passed: g.mark >= PASS_MARK,
  workflowStatus: g.workflow_status || 'draft', workflowLabel: WORKFLOW_LABEL[g.workflow_status || 'draft'] || 'مدخلة',
  instructor: g.instructor ?? null,
});

export function gradesFor(db, studentId, level) {
  const rows = db.prepare(`SELECT g.*, c.instructor FROM grades g LEFT JOIN courses c ON c.id = g.course_id
    WHERE g.student_id = ? ${level ? 'AND g.level = ?' : ''} ORDER BY g.semester, g.course, g.academic_year DESC`).all(...(level ? [studentId, Number(level)] : [studentId]));
  const byCourse = new Map();
  for (const g of rows) { const k = g.course_id ?? `x${g.id}`; if (!byCourse.has(k)) byCourse.set(k, { ...gview(g), previous: [] }); else byCourse.get(k).previous.push(gview(g)); }
  const list = [...byCourse.values()];
  const hrs = list.reduce((s, g) => s + g.hours, 0);
  const failed = list.filter((g) => !g.passed).length;
  const average = hrs ? Math.round(list.reduce((s, g) => s + g.hours * g.total, 0) / hrs * 10) / 10 : null;
  let warning = null;
  if (average !== null) {
    if (average < PASS_MARK || failed >= 4) warning = { level: 2, label: 'إنذار أكاديمي', message: `معدلك (${average}%) دون حد النجاح أو لديك ${failed} مقررات راسبة.` };
    else if (average < PASS_MARK + 5 || failed === 3) warning = { level: 1, label: 'يقترب من الإنذار الأكاديمي', message: `تنبيه: معدلك (${average}%) قريب من حد الإنذار الأكاديمي (${PASS_MARK}%).` };
  }
  return { grades: list, summary: { count: list.length, passed: list.filter((g) => g.passed).length, failed, average, warning }, passMark: PASS_MARK };
}

export function myGrades({ db }, user, q) {
  const p = db.prepare('SELECT study_level FROM student_profiles WHERE user_id = ?').get(user.id);
  if (!p) return { grades: [], summary: { count: 0, passed: 0, failed: 0, average: null }, passMark: PASS_MARK, level: null };
  const level = Number(q.level) || p.study_level;
  return { ...gradesFor(db, user.id, level), level };
}

// إدخال أو تعديل علامة (البند 9: يمنع تعديل العلامة المعتمدة دون تبرير مسجَّل)
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
  const justification = String(b?.justification ?? '').trim();

  return tx(db, () => {
    const ex = db.prepare('SELECT * FROM grades WHERE student_id = ? AND course_id = ? AND academic_year = ?').get(Number(studentId), c.id, ay);
    if (ex) {
      if (ex.workflow_status === 'approved' && justification.length < 5) {
        throw new HttpError(403, 'هذه العلامة معتمدة نهائياً؛ يُمنع تعديلها دون إدخال تبرير رسمي مسجَّل (5 أحرف على الأقل).', 'justification_required');
      }
      db.prepare('UPDATE grades SET theory_mark = ?, practical_mark = ?, mark = ?, entered_by = ?, entered_at = ? WHERE id = ?').run(theory, practical, total, actor.id, now, ex.id);
      if (ex.workflow_status === 'approved') {
        try {
          db.prepare(`INSERT INTO grade_modification_logs (grade_id, student_id, course_id, old_theory, new_theory, old_practical, new_practical, old_mark, new_mark, justification, modified_by, modified_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(ex.id, Number(studentId), c.id, ex.theory_mark, theory, ex.practical_mark, practical, ex.mark, total, justification, actor.id, now);
        } catch { /* إن لم يُنشأ الجدول بعد */ }
        audit(db, actor, `تعديل علامة معتمدة بتبرير: ${justification}`.slice(0, 250), `${st.student_no} / ${c.name}`.slice(0, 100), ip);
      } else {
        audit(db, actor, 'تعديل علامة', `${st.student_no} / ${c.name}`.slice(0, 100), ip);
      }
    } else {
      db.prepare(`INSERT INTO grades (student_id, term, course, hours, mark, course_id, level, semester, academic_year, theory_mark, practical_mark, entered_by, entered_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(Number(studentId), term, c.name, c.hours, total, c.id, c.level, c.semester, ay, theory, practical, actor.id, now);
      audit(db, actor, 'إدخال علامة', `${st.student_no} / ${c.name}`.slice(0, 100), ip);
    }
    return gradesFor(db, Number(studentId), null);
  });
}

// البند 9: انتقال مراحل اعتماد العلامات (مدخل draft -> مراجع reviewed -> معتمد approved)
export function transitionGrades({ db }, actor, b, ip) {
  const ids = Array.isArray(b?.gradeIds) ? b.gradeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const stage = String(b?.stage ?? '');
  if (!ids.length) throw new HttpError(400, 'حدد علامة واحدة على الأقل.', 'validation');
  if (!['reviewed', 'approved'].includes(stage)) throw new HttpError(400, 'مرحلة الاعتماد غير صالحة.', 'validation');
  const now = Date.now();
  let count = 0;
  tx(db, () => {
    for (const id of ids) {
      const g = db.prepare('SELECT id, course, workflow_status FROM grades WHERE id = ?').get(id);
      if (!g) continue;
      const cur = g.workflow_status || 'draft';
      if (stage === 'reviewed' && cur === 'draft') {
        db.prepare("UPDATE grades SET workflow_status = 'reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(actor.id, now, id);
        count++;
      } else if (stage === 'approved' && (cur === 'reviewed' || cur === 'draft')) {
        db.prepare("UPDATE grades SET workflow_status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(actor.id, now, id);
        count++;
      }
    }
    audit(db, actor, stage === 'approved' ? `اعتماد نهائي لـ ${count} علامة` : `مراجعة وتدقيق ${count} علامة`, String(count), ip);
  });
  return { updated: count, stage };
}

/* ---------------- الأخبار ---------------- */
export function listNews({ db }, limit = 30) {
  const rows = db.prepare('SELECT id, title, body, pinned, published_at FROM news ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?').all(limit);
  const media = mediaFor(db, rows.map((n) => n.id));
  return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, pinned: !!n.pinned, publishedAt: n.published_at, media: media.get(n.id) ?? [] }));
}
export function createNews({ db }, actor, b, ip) {
  const title = text(b?.title, 3, 150, 'العنوان'), body = text(b?.body, 3, 4000, 'النص');
  const links = Array.isArray(b?.links) ? b.links.map((l) => String(l).trim()).filter(Boolean) : [];
  if (links.length > 8) throw new HttpError(400, 'الحد الأقصى 8 روابط للخبر الواحد.', 'validation');
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO news (title, body, pinned, published_at, created_by) VALUES (?,?,?,?,?)').run(title, body, b?.pinned ? 1 : 0, Date.now(), actor.id).lastInsertRowid);
    for (const l of links) addLink({ db }, actor, id, l, null, ip);
    audit(db, actor, 'نشر خبر', title.slice(0, 100), ip);
    return { id };
  });
}
export function deleteNews({ db, cfg }, actor, id, ip) {
  const n = db.prepare('SELECT title FROM news WHERE id = ?').get(Number(id));
  if (!n) throw new HttpError(404, 'الخبر غير موجود.', 'not_found');
  removeFiles(db, cfg, Number(id));
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

/* ---------------- تعديل المواد وحذفها ---------------- */
export function updateCourse({ db }, actor, id, b, ip) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'المقرر غير موجود.', 'not_found');
  const prog = db.prepare('SELECT years FROM programs WHERE id = ?').get(c.program_id);
  const level = intIn(b?.level ?? c.level, 1, prog.years, 'السنة الدراسية'), semester = intIn(b?.semester ?? c.semester, 1, 2, 'الفصل');
  const name = text(b?.name ?? c.name, 2, 100, 'اسم المقرر'), hours = intIn(b?.hours ?? c.hours, 0, 12, 'الساعات');
  const code = b?.code ? text(b.code, 1, 20, 'رمز المقرر') : null, instructor = b?.instructor ? text(b.instructor, 2, 80, 'المدرّس') : null;
  if (db.prepare('SELECT 1 FROM courses WHERE program_id = ? AND level = ? AND semester = ? AND name = ? AND id != ?').get(c.program_id, level, semester, name, c.id)) throw new HttpError(409, 'يوجد مقرر بالاسم نفسه في هذه السنة والفصل.', 'conflict');
  tx(db, () => {
    db.prepare('UPDATE courses SET level = ?, semester = ?, name = ?, hours = ?, code = ?, instructor = ? WHERE id = ?').run(level, semester, name, hours, code, instructor, c.id);
    db.prepare('UPDATE grades SET course = ?, hours = ?, level = ?, semester = ? WHERE course_id = ?').run(name, hours, level, semester, c.id);
    audit(db, actor, 'تعديل مقرر', name.slice(0, 100), ip);
  });
  return { course: courseView(db.prepare('SELECT * FROM courses WHERE id = ?').get(c.id)) };
}

export function deleteCourse({ db }, actor, id, ip) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'المقرر غير موجود.', 'not_found');
  const n = db.prepare('SELECT COUNT(*) n FROM grades WHERE course_id = ?').get(c.id).n;
  if (n) throw new HttpError(409, `لا يمكن حذف مقرر له ${n} علامة مسجَّلة؛ احذف علاماته أولاً أو عطّله بدلاً من حذفه.`, 'conflict');
  tx(db, () => { db.prepare('DELETE FROM courses WHERE id = ?').run(c.id); audit(db, actor, 'حذف مقرر', c.name.slice(0, 100), ip); });
}

export function deleteGrade({ db }, actor, studentId, gradeId, ip, justification = '') {
  const g = db.prepare('SELECT g.id, g.course, g.workflow_status, u.student_no FROM grades g JOIN users u ON u.id = g.student_id WHERE g.id = ? AND g.student_id = ?').get(Number(gradeId), Number(studentId));
  if (!g) throw new HttpError(404, 'العلامة غير موجودة.', 'not_found');
  if (g.workflow_status === 'approved' && String(justification).trim().length < 5) {
    throw new HttpError(403, 'لا يمكن حذف علامة معتمدة نهائياً دون تسجيل تبرير رسمي.', 'justification_required');
  }
  tx(db, () => {
    db.prepare('DELETE FROM grades WHERE id = ?').run(g.id);
    audit(db, actor, g.workflow_status === 'approved' ? `حذف علامة معتمدة (${justification})` : 'حذف علامة', `${g.student_no} / ${g.course}`.slice(0, 100), ip);
  });
  return gradesFor(db, Number(studentId), null);
}

/* ---------------- تعديل الأخبار والشكاوى وحذفها ---------------- */
export function updateNews({ db }, actor, id, b, ip) {
  const n = db.prepare('SELECT * FROM news WHERE id = ?').get(Number(id));
  if (!n) throw new HttpError(404, 'الخبر غير موجود.', 'not_found');
  const title = text(b?.title ?? n.title, 3, 150, 'العنوان'), body = text(b?.body ?? n.body, 3, 4000, 'النص'), pinned = b?.pinned === undefined ? n.pinned : (b.pinned ? 1 : 0);
  tx(db, () => { db.prepare('UPDATE news SET title = ?, body = ?, pinned = ? WHERE id = ?').run(title, body, pinned, n.id); audit(db, actor, 'تعديل خبر', title.slice(0, 100), ip); });
  return { ok: true };
}

export function deleteComplaint({ db }, actor, id, ip) {
  const c = db.prepare('SELECT id, no FROM complaints WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'الشكوى غير موجودة.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM complaints WHERE id = ?').run(c.id); audit(db, actor, 'حذف شكوى', c.no, ip); });
}

/* ---------------- جدول العلامات الكامل ---------------- */
const normQ = (v) => String(v ?? '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const likeEsc = (v) => v.replace(/[\\%_]/g, (c) => '\\' + c);
const GSORT = { studentNo: 'u.student_no', studentName: "(sp.first_name || ' ' || sp.father_name || ' ' || sp.last_name)", faculty: 'g.faculty', course: 'gr.course', level: 'gr.level',
  academicYear: 'gr.academic_year', total: 'gr.mark', theory: 'gr.theory_mark', practical: 'gr.practical_mark', enteredAt: 'gr.entered_at', status: 'gr.mark' };

export function listGradesTable({ db }, q) {
  const where = [], args = [], term = normQ(q.q);
  if (term) {
    const like = `%${likeEsc(term)}%`;
    where.push(`(u.student_no LIKE ? ESCAPE '\\' OR (sp.first_name || ' ' || sp.father_name || ' ' || sp.last_name) LIKE ? ESCAPE '\\' OR g.faculty LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\' OR gr.course LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\')`);
    args.push(like, like, like, like, like, like);
  }
  if (Number(q.faculty) > 0) { where.push('g.faculty_id = ?'); args.push(Number(q.faculty)); }
  if (Number(q.program) > 0) { where.push('g.id = ?'); args.push(Number(q.program)); }
  if (Number(q.course) > 0) { where.push('gr.course_id = ?'); args.push(Number(q.course)); }
  if (Number(q.level) > 0) { where.push('gr.level = ?'); args.push(Number(q.level)); }
  if (q.semester === '1' || q.semester === '2') { where.push('gr.semester = ?'); args.push(Number(q.semester)); }
  if (/^\d{4}\/\d{4}$/.test(String(q.year ?? ''))) { where.push('gr.academic_year = ?'); args.push(q.year); }
  if (q.status === 'pass') { where.push('gr.mark >= ?'); args.push(PASS_MARK); } else if (q.status === 'fail') { where.push('gr.mark < ?'); args.push(PASS_MARK); }
  if (['draft', 'reviewed', 'approved'].includes(q.workflow)) { where.push('COALESCE(gr.workflow_status, \'draft\') = ?'); args.push(q.workflow); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const FROM = `FROM grades gr JOIN users u ON u.id = gr.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id LEFT JOIN courses c ON c.id = gr.course_id`;
  const sum = db.prepare(`SELECT COUNT(*) n, AVG(gr.mark) a, SUM(gr.mark >= ${PASS_MARK}) p, COUNT(DISTINCT gr.student_id) s ${FROM} ${W}`).get(...args);
  const size = Math.min(100, Math.max(5, Number(q.size) || 25)), pages = Math.max(1, Math.ceil(sum.n / size)), page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const col = GSORT[q.sort] ?? GSORT.enteredAt, dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT gr.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.id program_id, g.name pname, g.faculty fname, g.faculty_id fid, c.code
    ${FROM} ${W} ORDER BY ${col} ${dir}, gr.id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  const options = { faculties: db.prepare('SELECT id, name FROM faculties WHERE active = 1 ORDER BY id').all(), years: db.prepare('SELECT DISTINCT academic_year y FROM grades WHERE academic_year IS NOT NULL ORDER BY y DESC').all().map((r) => r.y) };
  return { total: sum.n, page, pages, size, options,
    summary: { count: sum.n, students: sum.s, average: sum.n ? Math.round(sum.a * 10) / 10 : null, passRate: sum.n ? Math.round((sum.p / sum.n) * 1000) / 10 : null },
    rows: rows.map((r) => ({
      id: r.id, studentId: r.student_id, studentNo: r.student_no, studentName: [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ') || r.student_no,
      faculty: r.fname ?? '—', facultyId: r.fid ?? null, programId: r.program_id ?? null, program: r.pname ?? '—',
      courseId: r.course_id, course: r.course, code: r.code ?? null, level: r.level, semester: r.semester, academicYear: r.academic_year,
      theory: r.theory_mark, practical: r.practical_mark, total: r.mark, passed: r.mark >= PASS_MARK,
      workflowStatus: r.workflow_status || 'draft', workflowLabel: WORKFLOW_LABEL[r.workflow_status || 'draft'] || 'مدخلة',
      enteredAt: r.entered_at,
    })) };
}
