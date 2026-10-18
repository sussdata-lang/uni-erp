// تصدير البيانات: الطلاب وسجلاتهم، المواد، العلامات (حسب السنة والفصل)، الطلبات، الذمم، الشكاوى.
// مجموعات البيانات تُبنى مرة واحدة ثم تُحوَّل إلى xlsx / csv / json / docx حسب الصيغة المطلوبة.
import { HttpError } from '../http.js';
import { writeXlsx } from '../lib/xlsx.js';
import { writeDocx } from '../lib/docx.js';
import { writeZip } from '../lib/zip.js';
import { PASS_MARK } from './academics.js';
import { logsForExport, KINDS as HALL_KINDS } from './attendance.js';
import { sections, STATUS_LABEL, levelLabel, programLabel } from './students.js';

const MAX_ROWS = 100_000;
const REQ_LABEL = { review: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض' };
const CMP_LABEL = { open: 'قيد المعالجة', answered: 'تم الرد', closed: 'مغلقة' };
const HOLD_LABEL = { financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' };
const semLabel = (n) => (n === 1 ? 'الفصل الأول' : n === 2 ? 'الفصل الثاني' : '');
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

export const DATASETS = [
  { id: 'students', label: 'الطلاب وسجلاتهم الكاملة', hint: 'كل بيانات الملف الشخصي والقيد وعدد الذمم' },
  { id: 'grades', label: 'العلامات', hint: 'حسب العام الدراسي والسنة والفصل' },
  { id: 'courses', label: 'المواد', hint: 'دليل المواد لكل برنامج وسنة وفصل' },
  { id: 'requests', label: 'طلبات الطلاب', hint: 'الخدمات وحالاتها وأزمنة المعالجة' },
  { id: 'holds', label: 'العقوبات', hint: 'القائمة والمسوّاة' },
  { id: 'complaints', label: 'الشكاوى', hint: 'مع الردود وحالتها' },
  { id: 'attendance', label: 'سجل دخول وخروج القاعات', hint: 'الحضور والفحوص بالباركود: المادة والقاعة والدخول والخروج' },
  { id: 'all', label: 'كل البيانات معاً', hint: 'مصنّف واحد بكل ما سبق' },
];
export const FORMATS = ['xlsx', 'csv', 'json', 'docx'];

const int = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
export function parseFilters(q = {}) {
  const f = { faculty: int(q.faculty), program: int(q.program), level: int(q.level), semester: [1, 2].includes(Number(q.semester)) ? Number(q.semester) : null,
    academicYear: /^\d{4}\/\d{4}$/.test(String(q.academicYear ?? '')) ? String(q.academicYear) : null, status: STATUS_LABEL[q.status] ? q.status : null, enrollYear: int(q.enrollYear),
    akind: HALL_KINDS[q.akind] ? q.akind : null, ahall: q.ahall ? String(q.ahall).slice(0, 60) : null, acourse: int(q.acourse), astate: ['open', 'closed'].includes(q.astate) ? q.astate : null,
    afrom: /^\d{4}-\d{2}-\d{2}$/.test(String(q.afrom ?? '')) ? q.afrom : null, ato: /^\d{4}-\d{2}-\d{2}$/.test(String(q.ato ?? '')) ? q.ato : null, tz: Number.isFinite(Number(q.tz)) ? Number(q.tz) : -180 };
  if (f.level && f.level > 4) f.level = null;
  return f;
}

// يبني شرط WHERE للطالب (sp = student_profiles، g = programs) حسب المرشحات المنطبقة
function studentWhere(f, { level = 'sp.study_level' } = {}) {
  const w = [], a = [];
  if (f.faculty) { w.push('g.faculty_id = ?'); a.push(f.faculty); }
  if (f.program) { w.push('g.id = ?'); a.push(f.program); }
  if (f.status) { w.push('sp.status = ?'); a.push(f.status); }
  if (f.enrollYear) { w.push('sp.enroll_year = ?'); a.push(f.enrollYear); }
  if (f.level && level) { w.push(`${level} = ?`); a.push(f.level); }
  return { w, a };
}
const where = (w) => (w.length ? 'WHERE ' + w.join(' AND ') : '');
const fullName = (r) => [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ');
const PROG = `FROM student_profiles sp JOIN users u ON u.id = sp.user_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id`;

function studentsSet(db, f) {
  const secs = sections(db).flatMap((s) => s.fields), { w, a } = studentWhere(f);
  const rows = db.prepare(`SELECT sp.*, u.student_no, g.faculty, g.name pname, g.degree, (SELECT COUNT(*) FROM student_holds h WHERE h.student_id = sp.user_id AND h.active = 1) holds ${PROG} ${where(w)} ORDER BY u.student_no`).all(...a);
  const headers = ['الرقم الجامعي', ...secs.map((s) => s.label), 'عقوبات قائمة', 'تاريخ التسجيل'];
  const cell = (f2, r) => {
    const v = r[f2.name];
    if (v === null || v === undefined) return '';
    if (f2.name === 'status') return STATUS_LABEL[v] ?? v;
    if (f2.name === 'study_level') return levelLabel(v);
    if (f2.type === 'program') return programLabel({ faculty: r.faculty, name: r.pname, degree: r.degree });
    return v;
  };
  return { id: 'students', title: 'الطلاب', headers, textCols: [0, ...secs.map((s, i) => (['nid', 'tel'].includes(s.type) || s.name === 'ministerial_no' ? i + 1 : -1)).filter((i) => i > 0)],
    rows: rows.map((r) => [r.student_no, ...secs.map((s) => cell(s, r)), r.holds, day(r.created_at)]) };
}

function gradesSet(db, f) {
  const { w, a } = studentWhere(f, { level: null });
  if (f.level) { w.push('gr.level = ?'); a.push(f.level); }
  if (f.semester) { w.push('gr.semester = ?'); a.push(f.semester); }
  if (f.academicYear) { w.push('gr.academic_year = ?'); a.push(f.academicYear); }
  const rows = db.prepare(`SELECT gr.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.faculty, g.name pname, c.code ccode
    FROM grades gr JOIN users u ON u.id = gr.student_id JOIN student_profiles sp ON sp.user_id = gr.student_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id LEFT JOIN courses c ON c.id = gr.course_id
    ${where(w)} ORDER BY gr.academic_year, gr.level, gr.semester, u.student_no, gr.course`).all(...a);
  return { id: 'grades', title: 'العلامات', textCols: [0],
    headers: ['الرقم الجامعي', 'اسم الطالب', 'الكلية / المعهد', 'البرنامج', 'العام الدراسي', 'السنة الدراسية', 'الفصل', 'المقرر', 'رمز المقرر', 'الساعات', 'العلامة النظرية', 'العلامة العملية', 'المجموع', 'النتيجة'],
    meta: rows.map((r) => ({ level: r.level, semester: r.semester })),
    rows: rows.map((r) => [r.student_no, fullName(r), r.faculty, r.pname, r.academic_year ?? '', r.level ? levelLabel(r.level) : '', semLabel(r.semester), r.course, r.ccode ?? '', r.hours, r.theory_mark ?? '', r.practical_mark ?? '', r.mark, r.mark >= PASS_MARK ? 'ناجح' : 'راسب']) };
}

function coursesSet(db, f) {
  const { w, a } = { w: [], a: [] };
  if (f.faculty) { w.push('g.faculty_id = ?'); a.push(f.faculty); }
  if (f.program) { w.push('g.id = ?'); a.push(f.program); }
  if (f.level) { w.push('c.level = ?'); a.push(f.level); }
  if (f.semester) { w.push('c.semester = ?'); a.push(f.semester); }
  const rows = db.prepare(`SELECT c.*, g.faculty, g.name pname, g.degree, (SELECT COUNT(*) FROM grades gr WHERE gr.course_id = c.id) gc
    FROM courses c JOIN programs g ON g.id = c.program_id ${where(w)} ORDER BY g.faculty, g.name, c.level, c.semester, c.name`).all(...a);
  return { id: 'courses', title: 'المواد', headers: ['الكلية / المعهد', 'البرنامج', 'السنة الدراسية', 'الفصل', 'المقرر', 'الرمز', 'الساعات', 'المدرّس', 'الحالة', 'عدد العلامات المسجَّلة'],
    rows: rows.map((r) => [r.faculty, r.pname, levelLabel(r.level), semLabel(r.semester), r.name, r.code ?? '', r.hours, r.instructor ?? '', r.active ? 'فعّال' : 'معطَّل', r.gc]) };
}

function requestsSet(db, f) {
  const { w, a } = studentWhere(f);
  const rows = db.prepare(`SELECT r.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.faculty, st.label slabel, o.name unit
    FROM requests r JOIN users u ON u.id = r.student_id JOIN service_types st ON st.code = r.service_code LEFT JOIN org_units o ON o.id = r.assigned_unit_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id ${where(w)} ORDER BY r.id`).all(...a);
  return { id: 'requests', title: 'الطلبات', textCols: [1, 0], headers: ['رقم الطلب', 'الرقم الجامعي', 'اسم الطالب', 'الكلية / المعهد', 'الخدمة', 'الحالة', 'سبب الرفض', 'الجهة الحالية', 'تاريخ التقديم', 'تاريخ القرار', 'ساعات المعالجة'],
    rows: rows.map((r) => [r.no, r.student_no ?? '', fullName(r), r.faculty ?? '', r.slabel, REQ_LABEL[r.status] ?? r.status, r.reject_reason ?? '', r.unit ?? '', day(r.created_at), day(r.decided_at), r.decided_at ? Math.round(((r.decided_at - r.created_at) / 3600000) * 10) / 10 : '']) };
}

function holdsSet(db, f) {
  const { w, a } = studentWhere(f);
  const rows = db.prepare(`SELECT h.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.faculty
    FROM student_holds h JOIN users u ON u.id = h.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id ${where(w)} ORDER BY h.id`).all(...a);
  return { id: 'holds', title: 'العقوبات', textCols: [0], headers: ['الرقم الجامعي', 'اسم الطالب', 'الكلية / المعهد', 'النوع', 'الملاحظة', 'الحالة', 'تاريخ التسجيل', 'تاريخ التسوية'],
    rows: rows.map((r) => [r.student_no, fullName(r), r.faculty ?? '', HOLD_LABEL[r.hold_type] ?? r.hold_type, r.note ?? '', r.active ? 'قائمة' : 'مسددة', day(r.created_at), day(r.cleared_at)]) };
}

function complaintsSet(db, f) {
  const { w, a } = studentWhere(f);
  const rows = db.prepare(`SELECT c.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.faculty
    FROM complaints c JOIN users u ON u.id = c.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id ${where(w)} ORDER BY c.id`).all(...a);
  return { id: 'complaints', title: 'الشكاوى', textCols: [0, 1], headers: ['رقم الشكوى', 'الرقم الجامعي', 'اسم الطالب', 'الموضوع', 'النص', 'الحالة', 'الرد', 'تاريخ التقديم', 'تاريخ الرد'],
    rows: rows.map((r) => [r.no, r.student_no, fullName(r), r.subject, r.body, CMP_LABEL[r.status] ?? r.status, r.response ?? '', day(r.created_at), day(r.responded_at)]) };
}

const fmtTime = (ms, tz) => (ms ? new Date(ms - tz * 60000).toISOString().replace('T', ' ').slice(0, 16) : '');
function attendanceSet(db, f) {
  const rows = logsForExport(db, { kind: f.akind, hall: f.ahall, course: f.acourse, state: f.astate, from: f.afrom, to: f.ato, faculty: f.faculty, tz: f.tz });
  if (rows.length > MAX_ROWS) throw new HttpError(413, `«سجل القاعات» أكبر من ${MAX_ROWS} صف؛ ضيّق المرشحات.`, 'too_large');
  return { id: 'attendance', title: 'سجل القاعات', textCols: [0], headers: ['الرقم الجامعي', 'اسم الطالب', 'الكلية / المعهد', 'النوع', 'المادة / الفحص', 'القاعة', 'وقت الدخول', 'وقت الخروج', 'المدة (دقيقة)', 'الطريقة', 'سجَّله', 'ملاحظة'],
    rows: rows.map((r) => [r.studentNo, r.studentName, r.faculty, r.kindLabel, r.subject, r.hall, fmtTime(r.enteredAt, f.tz), fmtTime(r.exitedAt, f.tz), r.minutes ?? '', { barcode: 'باركود', manual: 'يدوي', import: 'استيراد' }[r.method] ?? r.method, r.recordedBy, r.note]) };
}

const BUILD = { students: studentsSet, grades: gradesSet, courses: coursesSet, requests: requestsSet, holds: holdsSet, complaints: complaintsSet, attendance: attendanceSet };

export function buildSets(db, dataset, filters) {
  const ids = dataset === 'all' ? Object.keys(BUILD) : [dataset];
  if (!ids.every((i) => BUILD[i])) throw new HttpError(400, 'مجموعة بيانات غير معروفة.', 'validation');
  const sets = ids.map((i) => BUILD[i](db, filters));
  for (const s of sets) if (s.rows.length > MAX_ROWS) throw new HttpError(413, `«${s.title}» أكبر من ${MAX_ROWS} صف؛ ضيّق المرشحات.`, 'too_large');
  return sets;
}

export function exportOptions(db) {
  return {
    datasets: DATASETS, formats: FORMATS,
    faculties: db.prepare('SELECT id, name FROM faculties ORDER BY id').all(),
    programs: db.prepare('SELECT id, faculty, name, degree, faculty_id facultyId FROM programs ORDER BY faculty, name').all().map((p) => ({ id: p.id, facultyId: p.facultyId, label: programLabel(p) })),
    academicYears: db.prepare("SELECT DISTINCT academic_year y FROM grades WHERE academic_year IS NOT NULL ORDER BY y DESC").all().map((r) => r.y),
    enrollYears: db.prepare('SELECT DISTINCT enroll_year y FROM student_profiles ORDER BY y DESC').all().map((r) => r.y),
    statuses: STATUS_LABEL,
    halls: db.prepare('SELECT DISTINCT hall FROM hall_logs ORDER BY hall').all().map((r) => r.hall),
    courses: db.prepare('SELECT id, name FROM courses ORDER BY name').all(),
    hallKinds: HALL_KINDS,
  };
}

export function preview(db, dataset, q) {
  const sets = buildSets(db, dataset, parseFilters(q)), limit = Math.min(Math.max(Number(q.limit) || 500, 1), 5000);
  return { sets: sets.map((s) => ({ id: s.id, title: s.title, headers: s.headers, total: s.rows.length, rows: s.rows.slice(0, limit) })) };
}

/* ---------------- التحويل إلى الصيغ ---------------- */
// ملفات CSV تُفتح في Excel: BOM لليونيكود، وتحييد الصيغ (=+-@) كي لا تُنفَّذ كأوامر عند الفتح
const csvCell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (s) => Buffer.from('﻿' + [s.headers, ...s.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
const safeSheet = (name, used) => { let n = String(name).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'ورقة'; let k = 2; const base = n; while (used.has(n)) n = `${base.slice(0, 25)} ${k++}`; used.add(n); return n; };
const widths = (s) => s.headers.map((h, i) => Math.min(40, Math.max(10, String(h).length + 4, ...s.rows.slice(0, 50).map((r) => String(r[i] ?? '').length + 2))));

function xlsxSheets(sets, layout) {
  const used = new Set(), out = [];
  for (const s of sets) {
    if (s.id === 'grades' && layout === 'terms') {                     // ورقة لكل (سنة دراسية، فصل)
      const groups = new Map();
      s.rows.forEach((r, i) => { const m = s.meta[i], k = `${m.level ?? 0}-${m.semester ?? 0}`; if (!groups.has(k)) groups.set(k, { name: `${m.level ? levelLabel(m.level) : 'بلا سنة'} - ${semLabel(m.semester) || 'بلا فصل'}`, rows: [] }); groups.get(k).rows.push(r); });
      for (const [, g] of [...groups].sort()) out.push({ name: safeSheet(`علامات ${g.name}`, used), rows: [s.headers, ...g.rows], widths: widths({ headers: s.headers, rows: g.rows }), textCols: s.textCols });
      if (!groups.size) out.push({ name: safeSheet('العلامات', used), rows: [s.headers], widths: widths(s) });
    } else out.push({ name: safeSheet(s.title, used), rows: [s.headers, ...s.rows], widths: widths(s), textCols: s.textCols });
  }
  return out;
}

export function renderExport(db, { dataset, format, layout }, q) {
  if (!FORMATS.includes(format)) throw new HttpError(400, 'صيغة تصدير غير مدعومة.', 'validation');
  const f = parseFilters(q), sets = buildSets(db, dataset, f), stamp = new Date().toISOString().slice(0, 10), base = `export-${dataset}-${stamp}`;
  const total = sets.reduce((n, s) => n + s.rows.length, 0);
  if (format === 'xlsx') return { total, name: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: writeXlsx(xlsxSheets(sets, layout), { title: 'تصدير البيانات' }) };
  if (format === 'json') {
    const obj = Object.fromEntries(sets.map((s) => [s.id, s.rows.map((r) => Object.fromEntries(s.headers.map((h, i) => [h, r[i]])))]));
    return { total, name: `${base}.json`, mime: 'application/json; charset=utf-8', buf: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), filters: f, data: dataset === 'all' ? obj : obj[dataset] }, null, 2), 'utf8') };
  }
  if (format === 'csv') {
    if (sets.length === 1) return { total, name: `${base}.csv`, mime: 'text/csv; charset=utf-8', buf: toCsv(sets[0]) };
    return { total, name: `${base}.zip`, mime: 'application/zip', buf: writeZip(sets.map((s) => ({ name: `${s.id}.csv`, data: toCsv(s) }))) };
  }
  const blocks = [{ t: 'title', text: 'تصدير البيانات' }, { t: 'note', text: `الجامعة السورية للعلوم الأمنية — ${stamp}` }];
  for (const s of sets) blocks.push({ t: 'h1', text: `${s.title} (${s.rows.length})` }, { t: 'table', headers: s.headers, rows: s.rows.length ? s.rows : [['لا بيانات', ...s.headers.slice(1).map(() => '—')]] });
  return { total, name: `${base}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf: writeDocx(blocks, { title: 'تصدير البيانات' }) };
}
