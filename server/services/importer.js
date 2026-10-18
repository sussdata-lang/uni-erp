// استيراد الطلاب والمقررات والعلامات من Excel (xlsx) أو CSV أو SQL (جمل INSERT فقط، لا يُنفَّذ أي SQL).
// الخطوتان: فحص (commit=false: لا يُكتب شيء) ثم اعتماد (commit=true: يُحفظ الصحيح ويُبلَّغ عن المرفوض بالصف).
import { readXlsx, writeXlsx } from '../lib/xlsx.js';
import { parseSql, parseCsv } from '../lib/sqlparse.js';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { sections, validateProfile, duplicateCheck, registerStudent } from './students.js';
import { enterGrade } from './academics.js';
import { importLogRow } from './attendance.js';
import { notify } from './push.js';

export const MAX_BYTES = 10 * 1024 * 1024, MAX_STUDENTS = 1500;
const bad = (m) => new HttpError(400, m, 'validation');

const norm = (s) => String(s ?? '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\*/g, '').replace(/[\s_\-./()،:]+/g, '').toLowerCase();
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
function normDate(v) {
  v = latinDigits(v).trim(); let m;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(v))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return v;
}

/* ---------- تعريف الأعمدة لكل نوع ---------- */
const A = (...names) => names.map(norm);
function columnMap(db, kind) {
  if (kind === 'students') {
    const m = { faculty: A('الكلية', 'الكلية/المعهد', 'الجهة', 'faculty', 'college', 'facultycode', 'رمز الكلية'), program: A('البرنامج', 'program', 'programname'), program_id: A('program_id', 'programid') };
    for (const s of sections(db)) for (const f of s.fields) if (f.type !== 'program' && f.name !== 'status') m[f.name] = A(f.name, f.label, f.label.replace(/\(.*\)/, ''));
    return m;
  }
  if (kind === 'courses') return {
    faculty: A('الكلية', 'الكلية/المعهد', 'الجهة', 'faculty', 'college', 'facultycode'), program: A('البرنامج', 'program'),
    level: A('السنة الدراسية', 'السنة', 'المستوى', 'level', 'year'), semester: A('الفصل', 'الفصل الدراسي', 'semester', 'term'),
    name: A('اسم المقرر', 'المقرر', 'name', 'course', 'coursename', 'title'), code: A('رمز المقرر', 'الرمز', 'code', 'coursecode'),
    hours: A('الساعات', 'عدد الساعات', 'hours', 'credits'), instructor: A('المدرس', 'مدرس المقرر', 'اسم المدرس', 'instructor', 'teacher'),
  };
  if (kind === 'attendance') return {
    student_no: A('الرقم الجامعي', 'رقم الطالب', 'student_no', 'studentno', 'barcode', 'الباركود'),
    kind: A('النوع', 'نوع التسجيل', 'kind', 'type'), subject: A('المادة', 'المادة / الفحص', 'المادة أو الفحص', 'الفحص', 'subject', 'course', 'exam'),
    hall: A('القاعة', 'hall', 'room'), entered_at: A('وقت الدخول', 'الدخول', 'entered_at', 'enteredat', 'in', 'timein', 'تاريخ ووقت الدخول'), exited_at: A('وقت الخروج', 'الخروج', 'exited_at', 'exitedat', 'out', 'timeout', 'تاريخ ووقت الخروج'),
  };
  return {
    student_no: A('الرقم الجامعي', 'رقم الطالب', 'اسم المستخدم', 'student_no', 'studentno', 'username', 'studentid'),
    course: A('اسم المقرر', 'المقرر', 'course', 'coursename'), course_code: A('رمز المقرر', 'course_code', 'coursecode', 'code'),
    academic_year: A('العام الدراسي', 'العام', 'academic_year', 'academicyear', 'year'), semester: A('الفصل', 'semester'),
    level: A('السنة الدراسية للمقرر', 'مستوى المقرر', 'level'),
    theory: A('العلامة النظرية', 'النظري', 'theory', 'theory_mark', 'theorymark'), practical: A('العلامة العملية', 'العملي', 'practical', 'practical_mark', 'practicalmark'),
  };
}
const NEED = {
  students: [['first_name', 'الاسم الأول'], ['father_name', 'اسم الأب'], ['last_name', 'الكنية'], ['national_id', 'الرقم الوطني']],
  courses: [['name', 'اسم المقرر'], ['level', 'السنة الدراسية'], ['semester', 'الفصل']],
  grades: [['student_no', 'الرقم الجامعي'], ['academic_year', 'العام الدراسي'], ['theory', 'العلامة النظرية']],
  attendance: [['student_no', 'الرقم الجامعي'], ['subject', 'المادة / الفحص'], ['hall', 'القاعة'], ['entered_at', 'وقت الدخول']],
};
const KIND_TABLE = { students: /student|طالب|users?$/i, courses: /course|subject|مقرر|مواد|مادة/i, grades: /grade|mark|result|علام|درج/i, attendance: /attend|hall|حضور|قاع|دخول/i };

/* ---------- قراءة الملف إلى صفوف كائنات ---------- */
function toObjects(db, kind, grid) {            // grid: string[][]
  const cmap = columnMap(db, kind), rev = new Map();
  for (const [k, names] of Object.entries(cmap)) for (const n of names) if (!rev.has(n)) rev.set(n, k);
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) if (grid[i].filter((c) => rev.has(norm(c))).length >= 2) { h = i; break; }
  if (h < 0) throw bad('لم أجد صف العناوين: استخدم قالب الاستيراد وأبقِ صف العناوين كما هو.');
  const cols = grid[h].map((c) => rev.get(norm(c)) ?? null), seen = new Set(), unused = grid[h].filter((c, i) => !cols[i] && String(c).trim());
  const miss = NEED[kind].filter(([k]) => !cols.includes(k)).map(([, l]) => l);
  if (kind === 'students' && !cols.includes('faculty') && !cols.includes('program') && !cols.includes('program_id')) miss.push('الكلية / المعهد');
  if (kind === 'courses' && !cols.includes('faculty') && !cols.includes('program')) miss.push('الكلية / المعهد');
  if (kind === 'grades' && !cols.includes('course') && !cols.includes('course_code')) miss.push('اسم المقرر أو رمزه');
  if (miss.length) throw bad(`أعمدة مطلوبة غير موجودة في الملف: ${miss.join('، ')}.`);
  const rows = [];
  for (let i = h + 1; i < grid.length; i++) {
    const g = grid[i]; if (!g.some((c) => String(c ?? '').trim())) continue;
    const o = { __line: i + 1 }; cols.forEach((k, ci) => { if (k && !seen.has(`${i}:${k}`)) { o[k] = String(g[ci] ?? '').trim(); seen.add(`${i}:${k}`); } });
    rows.push(o);
  }
  return { rows, unused };
}

function sqlRowsToGrid(kind, parsed) {
  const names = Object.keys(parsed.tables);
  if (!names.length) throw bad('لم أجد جمل INSERT في ملف SQL.');
  let pick = names.find((n) => KIND_TABLE[kind].test(n)) ?? (names.length === 1 ? names[0] : null);
  if (!pick) throw bad(`الملف يحوي عدة جداول (${names.join('، ')}) ولا يطابق أحدها نوع الاستيراد؛ سمِّ الجدول باسم واضح.`);
  const t = parsed.tables[pick];
  return [t.columns, ...t.rows.map((r) => t.columns.map((c) => r[c] ?? ''))];
}

export function readUpload(db, kind, filename, buf) {
  const name = String(filename ?? '').toLowerCase();
  let grid;
  if (buf.length > MAX_BYTES) throw bad('حجم الملف يتجاوز 10 ميغابايت.');
  if (/\.sql$/.test(name)) { try { grid = sqlRowsToGrid(kind, parseSql(buf.toString('utf8'))); } catch (e) { if (e instanceof HttpError) throw e; throw bad(`تعذّر قراءة SQL: ${e.message}`); } }
  else if (/\.csv$|\.txt$/.test(name)) { try { grid = parseCsv(buf.toString('utf8')); } catch (e) { throw bad(e.message); } }
  else if (/\.xlsx$|\.xlsm$/.test(name) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    let wb; try { wb = readXlsx(buf); } catch (e) { throw bad(e.message); }
    const ok = wb.sheets.find((s) => { try { toObjects(db, kind, s.rows); return true; } catch { return false; } });
    grid = (ok ?? wb.sheets[0] ?? { rows: [] }).rows;
  } else if (/\.xls$/.test(name)) throw bad('صيغة xls القديمة غير مدعومة؛ احفظ الملف بصيغة xlsx من Excel.');
  else throw bad('الصيغ المدعومة: xlsx وcsv وsql.');
  if (!grid.length) throw bad('الملف فارغ.');
  return toObjects(db, kind, grid);
}

/* ---------- حلّ الكلية والبرنامج ---------- */
function programResolver(db) {
  const all = db.prepare(`SELECT g.id, g.name, g.faculty, g.years, f.code, f.name_en, f.id fid FROM programs g JOIN faculties f ON f.id = g.faculty_id WHERE g.active = 1 AND f.active = 1`).all();
  return (faculty, program) => {
    let c = all;
    if (faculty) { const n = norm(faculty); c = all.filter((p) => [p.faculty, p.code, p.name_en].some((x) => norm(x) === n)); if (!c.length) throw bad(`الكلية «${faculty}» غير معروفة أو معطَّلة.`); }
    if (program) { const n = norm(program); const f = c.filter((p) => norm(p.name) === n); if (!f.length) throw bad(`البرنامج «${program}» غير موجود${faculty ? ' في هذه الكلية' : ''}.`); c = f; }
    else if (c.length > 1) throw bad('هذه الكلية فيها عدة برامج؛ حدّد البرنامج في عمود «البرنامج».');
    if (c.length > 1) throw bad('اسم البرنامج يتكرر؛ حدّد الكلية أيضاً.');
    return c[0];
  };
}

/* ---------- الطلاب ---------- */
function studentInput(db, r, resolve) {
  const input = {};
  for (const s of sections(db)) for (const f of s.fields) {
    if (f.type === 'program' || r[f.name] === undefined || r[f.name] === '') continue;
    let v = r[f.name];
    if (['date'].includes(f.type)) v = normDate(v);
    else if (['int', 'num', 'tel', 'nid'].includes(f.type)) v = latinDigits(v);
    if (f.type === 'select' && f.options) { const o = f.options.find((x) => norm(x.v) === norm(v) || norm(x.l) === norm(v)); if (o) v = o.v; }
    if (['int', 'num'].includes(f.type) && /^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
    if (f.type === 'tel' && /^\d{9}$/.test(v)) v = `0${v}`;                       // Excel يحذف الصفر الأول
    if (f.type === 'nid' && /^\d{10}$/.test(v)) v = `0${v}`;
    input[f.name] = v;
  }
  const p = r.program_id && /^\d+$/.test(r.program_id) ? { id: Number(r.program_id) } : resolve(r.faculty, r.program);
  input.program_id = p.id;
  return input;
}

async function importStudents({ db, cfg }, actor, rows, commit, ip) {
  if (rows.length > MAX_STUDENTS) throw bad(`الحد الأقصى ${MAX_STUDENTS} طالب في الملف الواحد؛ قسّم الملف.`);
  const resolve = programResolver(db), errors = [], seenNid = new Map(), ok = [], creds = [];
  for (const r of rows) {
    try {
      const input = studentInput(db, r, resolve), p = validateProfile(db, input);
      if (seenNid.has(p.national_id)) throw new HttpError(409, `الرقم الوطني مكرَّر في الملف نفسه (الصف ${seenNid.get(p.national_id)}).`, 'duplicate');
      duplicateCheck(db, p); seenNid.set(p.national_id, r.__line); ok.push({ r, input, p });
    } catch (e) { if (!(e instanceof HttpError)) throw e; errors.push({ row: r.__line, message: e.message }); }
  }
  let created = 0;
  if (commit) {
    for (const { r, input } of ok) {
      try {
        const res = await registerStudent({ db, cfg }, actor, input, ip); created++;
        creds.push([res.credentials.username, res.student.name, res.student.program.label, res.credentials.tempPassword]);
      } catch (e) { if (!(e instanceof HttpError)) throw e; errors.push({ row: r.__line, message: e.message }); }
    }
  }
  const preview = ok.slice(0, 8).map(({ p }) => `${p.first_name} ${p.father_name} ${p.last_name}`);
  const out = { total: rows.length, valid: ok.length, created, preview, errors };
  if (commit && creds.length) out.credentialsXlsx = writeXlsx([{ name: 'بيانات الدخول', rows: [['اسم المستخدم (الرقم الجامعي)', 'الاسم', 'الكلية', 'كلمة المرور المؤقتة'], ...creds], widths: [28, 30, 34, 22], textCols: [0, 3] }], { title: 'بيانات دخول الطلاب' }).toString('base64');
  return out;
}

/* ---------- المقررات والعلامات (يعملان داخل معاملة واحدة تُلغى في الفحص وتُعتمد عند الاستيراد) ---------- */
const semesterOf = (v) => { v = norm(latinDigits(v)); return /^(1|الاول|اول)$/.test(v) || v.includes('الاول') ? 1 : /^(2|الثاني|ثاني)$/.test(v) || v.includes('الثاني') ? 2 : null; };
class Rollback extends Error {}
function inTx(db, commit, fn) {                    // متزامنة بالكامل: لا يتداخل معها طلب آخر؛ الفحص يُلغي كل ما كتبته
  let r;
  try { tx(db, () => { r = fn(); if (!commit) throw new Rollback(); }); } catch (e) { if (!(e instanceof Rollback)) throw e; }
  return r;
}
function perRow(rows, errors, fn) {
  let done = 0, updated = 0;
  for (const r of rows) { try { const u = fn(r); done++; if (u === 'updated') updated++; } catch (e) { if (!(e instanceof HttpError)) throw e; errors.push({ row: r.__line, message: e.message }); } }
  return { done, updated };
}
const int = (v, lo, hi, label) => { v = latinDigits(String(v ?? '')).replace(/\.0+$/, ''); if (!/^\d+$/.test(v) || Number(v) < lo || Number(v) > hi) throw bad(`«${label}» يجب أن يكون رقماً بين ${lo} و${hi}.`); return Number(v); };

function importCourses({ db }, actor, rows, commit, ip) {
  const resolve = programResolver(db), errors = [];
  const res = inTx(db, commit, () => perRow(rows, errors, (r) => {
    const p = resolve(r.faculty, r.program), level = int(r.level, 1, p.years, `السنة الدراسية (البرنامج ${p.years} سنوات)`);
    const sem = semesterOf(r.semester); if (!sem) throw bad('الفصل يجب أن يكون 1 أو 2 (أو الأول/الثاني).');
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim(); if (name.length < 2 || name.length > 100) throw bad('اسم المقرر: 2 إلى 100 حرف.');
    const hours = r.hours === undefined || r.hours === '' ? 3 : int(r.hours, 0, 12, 'الساعات');
    const code = r.code ? String(r.code).trim().slice(0, 20) : null, instr = r.instructor ? String(r.instructor).trim().slice(0, 80) : null;
    const ex = db.prepare('SELECT id FROM courses WHERE program_id = ? AND level = ? AND semester = ? AND name = ?').get(p.id, level, sem, name);
    if (ex) { db.prepare('UPDATE courses SET hours = ?, code = COALESCE(?, code), instructor = COALESCE(?, instructor), active = 1 WHERE id = ?').run(hours, code, instr, ex.id); return 'updated'; }
    db.prepare('INSERT INTO courses (program_id, level, semester, name, code, hours, instructor) VALUES (?,?,?,?,?,?,?)').run(p.id, level, sem, name, code, hours, instr);
  }));
  if (commit) audit(db, actor, `استيراد مقررات: ${res.done - res.updated} جديد / ${res.updated} محدَّث`, '', ip);
  return { total: rows.length, valid: res.done, created: commit ? res.done - res.updated : 0, updated: commit ? res.updated : 0, preview: rows.slice(0, 8).map((r) => r.name), errors };
}

function importGrades(deps, actor, rows, commit, ip) {
  const { db } = deps, errors = [], touched = new Set();
  const res = inTx(db, commit, () => perRow(rows, errors, (r) => {
    const st = db.prepare("SELECT u.id, p.program_id FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.student_no = ? COLLATE NOCASE").get(String(r.student_no ?? '').trim());
    if (!st) throw bad(`لا يوجد طالب بالرقم الجامعي «${r.student_no}».`);
    let cs = db.prepare('SELECT id, name, code, level, semester FROM courses WHERE program_id = ?').all(st.program_id);
    if (r.course_code) cs = cs.filter((c) => c.code && norm(c.code) === norm(r.course_code)); else cs = cs.filter((c) => norm(c.name) === norm(r.course));
    if (r.level) cs = cs.filter((c) => c.level === Number(latinDigits(r.level)));
    if (r.semester) { const s = semesterOf(r.semester); if (s) cs = cs.filter((c) => c.semester === s); }
    if (!cs.length) throw bad(`المقرر «${r.course_code || r.course}» غير موجود في برنامج هذا الطالب.`);
    if (cs.length > 1) throw bad(`المقرر «${r.course}» يتكرر في أكثر من سنة/فصل؛ أضف عمود السنة الدراسية للمقرر والفصل.`);
    const ay = latinDigits(r.academic_year).replace(/[-–]/g, '/').replace(/\s/g, '');
    const ex = db.prepare('SELECT 1 FROM grades WHERE student_id = ? AND course_id = ? AND academic_year = ?').get(st.id, cs[0].id, ay);
    enterGrade({ db }, actor, st.id, { courseId: cs[0].id, academicYear: ay, theory: latinDigits(r.theory).replace(/\.0+$/, ''), practical: latinDigits(r.practical ?? '').replace(/\.0+$/, '') }, ip);
    touched.add(st.id);
    return ex ? 'updated' : 'created';
  }));
  if (commit && touched.size) notify(deps, [...touched], { title: 'علامات جديدة', body: 'رُصدت علامات جديدة في ملفك.', url: '/', tag: 'grades' });
  if (commit) audit(db, actor, `استيراد علامات: ${res.done - res.updated} جديدة / ${res.updated} محدَّثة`, '', ip);
  return { total: rows.length, valid: res.done, created: commit ? res.done - res.updated : 0, updated: commit ? res.updated : 0, preview: rows.slice(0, 8).map((r) => `${r.student_no} — ${r.course || r.course_code}`), errors };
}

// أوقات الدخول والخروج: «2026-10-15 09:30» أو «15/10/2026 09:30» (بتوقيت المنطقة tz بالدقائق كما يعيدها المتصفح)
export function parseDateTime(v, tz = -180) {
  v = latinDigits(String(v ?? '')).trim().replace('T', ' ');
  if (/^\d{4,6}(\.\d+)?$/.test(v)) { const n = Number(v); if (n > 20000 && n < 80000) return Math.round((n - 25569) * 86400000) + tz * 60000; }   // رقم تسلسلي من Excel
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(v);
  if (!m) { const k = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(v); if (k) m = [k[0], k[3], k[2], k[1], k[4], k[5]]; }
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) + tz * 60000;
  return Number.isNaN(t) ? null : t;
}
const kindOf = (v) => { const n = norm(v); return !n ? 'course' : /^(exam|فحص|امتحان|اختبار)/.test(n) || n.includes('فحص') || n.includes('امتحان') ? 'exam' : /^(course|حضور|مادة|محاضره)/.test(n) || n.includes('حضور') || n.includes('ماد') ? 'course' : null; };

function importAttendance({ db }, actor, rows, commit, ip, tz) {
  const errors = [];
  const res = inTx(db, commit, () => perRow(rows, errors, (r) => {
    const kind = kindOf(r.kind); if (!kind) throw bad('النوع يجب أن يكون «حضور مادة» أو «فحص».');
    const inT = parseDateTime(r.entered_at, tz); if (inT === null) throw bad('وقت الدخول غير مفهوم (مثال: 2026-10-15 09:30).');
    const outT = r.exited_at ? parseDateTime(r.exited_at, tz) : null; if (r.exited_at && outT === null) throw bad('وقت الخروج غير مفهوم (مثال: 2026-10-15 11:30).');
    const course = db.prepare('SELECT id FROM courses WHERE name = ? OR code = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(String(r.subject ?? '').trim(), String(r.subject ?? '').trim());
    importLogRow({ db }, actor, { studentNo: r.student_no, kind, courseId: course ? course.id : null, subject: r.subject, hall: r.hall, enteredAt: inT, exitedAt: outT });
  }));
  if (commit) audit(db, actor, `استيراد سجل قاعات: ${res.done} صف`, '', ip);
  return { total: rows.length, valid: res.done, created: commit ? res.done : 0, updated: 0, preview: rows.slice(0, 8).map((r) => `${r.student_no} — ${r.hall}`), errors };
}

export const IMPORT_PERM = { students: 'student:register', courses: 'course:manage', grades: 'grade:manage', attendance: 'attendance:manage' };

export async function runImport(deps, actor, kind, { filename, data, commit, tz }, ip) {
  if (!IMPORT_PERM[kind]) throw new HttpError(404, 'نوع استيراد غير معروف.', 'not_found');
  if (typeof data !== 'string' || !data) throw bad('لم يصل ملف.');
  const buf = Buffer.from(data, 'base64'), { db } = deps;
  const { rows, unused } = readUpload(db, kind, filename, buf);
  if (!rows.length) throw bad('الملف لا يحوي صفوف بيانات تحت العناوين.');
  if (rows.length > 20000) throw bad('عدد الصفوف يتجاوز 20000.');
  const out = kind === 'students' ? await importStudents(deps, actor, rows, !!commit, ip) : kind === 'courses' ? importCourses(deps, actor, rows, !!commit, ip) : kind === 'attendance' ? importAttendance(deps, actor, rows, !!commit, ip, Number.isFinite(Number(tz)) ? Number(tz) : -180) : importGrades(deps, actor, rows, !!commit, ip);
  if (commit && kind === 'students') audit(db, actor, `استيراد طلاب: ${out.created} مسجَّل / ${out.errors.length} مرفوض`, String(filename).slice(0, 80), ip);
  return { kind, committed: !!commit, filename, unusedColumns: unused, ...out, errors: out.errors.sort((a, b) => a.row - b.row).slice(0, 300), errorCount: out.errors.length };
}
