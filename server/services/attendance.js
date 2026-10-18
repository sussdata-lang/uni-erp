// سجل دخول وخروج الطلاب من القاعات (حضور مادة أو فحص): يُسجَّل بمسح باركود الرقم الجامعي (Code 128).
// المسح الأول يسجّل الدخول، والمسح التالي لنفس المادة والقاعة يسجّل الخروج. الطالب لا يكون داخل قاعتين في آن واحد.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { STATUS_LABEL } from './students.js';

export const KINDS = { course: 'حضور مادة', exam: 'فحص' };
const bad = (m, f) => new HttpError(400, m, 'validation', f);
const CTRL = /[\u0000-\u001f\u007f<>]/;
const text = (v, label, { min = 1, max = 100 } = {}) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw bad(`«${label}» يجب أن يكون بين ${min} و${max} حرفاً.`);
  if (CTRL.test(s)) throw bad(`«${label}» يحوي رموزاً غير مسموحة.`);
  return s;
};
const ms = (v, label) => { const n = Number(v); if (!Number.isFinite(n) || n < 946684800000 || n > Date.now() + 86400000 * 2) throw bad(`«${label}» وقت غير صالح.`); return Math.trunc(n); };

function subjectOf(db, b) {
  const kind = b.kind;
  if (!KINDS[kind]) throw bad('اختر نوع التسجيل: حضور مادة أو فحص.', 'kind');
  const cid = Number(b.courseId) || null;
  if (cid) {
    const c = db.prepare('SELECT id, name FROM courses WHERE id = ?').get(cid);
    if (!c) throw bad('المادة غير موجودة.', 'courseId');
    const extra = b.subject ? String(b.subject).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return { kind, course_id: c.id, subject: kind === 'exam' && extra && extra !== c.name ? `${c.name} — ${extra}` : c.name };
  }
  return { kind, course_id: null, subject: text(b.subject, 'المادة / الفحص') };
}

const SEL = `SELECT l.*, u.student_no, sp.first_name, sp.father_name, sp.last_name, g.faculty, g.faculty_id fid, ru.display_name rec
  FROM hall_logs l JOIN users u ON u.id = l.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id LEFT JOIN users ru ON ru.id = l.recorded_by`;
const nameOf = (r) => [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ') || r.student_no;
const view = (r) => ({ id: r.id, studentId: r.student_id, studentNo: r.student_no, studentName: nameOf(r), faculty: r.faculty ?? '', kind: r.kind, kindLabel: KINDS[r.kind], courseId: r.course_id, subject: r.subject, hall: r.hall,
  enteredAt: r.entered_at, exitedAt: r.exited_at, minutes: r.exited_at ? Math.round((r.exited_at - r.entered_at) / 60000) : null, method: r.method, recordedBy: r.rec ?? '', note: r.note ?? '' });
const one = (db, id) => view(db.prepare(`${SEL} WHERE l.id = ?`).get(id));

export function findStudent(db, code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{3,30}$/.test(c)) throw bad('الباركود غير صالح.', 'code');
  const r = db.prepare(`SELECT u.id, u.student_no, sp.first_name, sp.father_name, sp.last_name, sp.status, g.faculty,
      (SELECT MAX(f.id) FROM student_files f WHERE f.student_id = u.id AND f.kind = 'photo') photo_id,
      (SELECT COUNT(*) FROM student_holds h WHERE h.student_id = u.id AND h.active = 1) holds
    FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id WHERE u.role = 'student' AND u.student_no = ? COLLATE NOCASE`).get(c);
  if (!r) throw new HttpError(404, `لا يوجد طالب بالرقم «${c}».`, 'not_found', 'code');
  return r;
}

// مسح باركود: يسجّل دخولاً أو خروجاً تلقائياً (action: auto | in | out)
export function scan({ db }, actor, b, ip) {
  const st = findStudent(db, b.code), s = subjectOf(db, b), hall = text(b.hall, 'القاعة', { max: 60 }), act = ['auto', 'in', 'out'].includes(b.action) ? b.action : 'auto', now = Date.now();
  const warnings = [];
  if (st.status && st.status !== 'active') warnings.push(`حالة القيد: ${STATUS_LABEL[st.status] ?? st.status}`);
  if (st.holds) warnings.push(`لدى الطالب ${st.holds} عقوبة قائمة`);
  return tx(db, () => {
    const open = db.prepare('SELECT * FROM hall_logs WHERE student_id = ? AND exited_at IS NULL ORDER BY id DESC LIMIT 1').get(st.id);
    const same = open && open.kind === s.kind && open.subject === s.subject && open.hall === hall;
    let action;
    if (act === 'out') { if (!open) throw new HttpError(409, 'لا يوجد دخول مفتوح لهذا الطالب ليُسجَّل خروجه.', 'conflict'); if (!same) throw new HttpError(409, `الطالب داخل «${open.hall}» (${open.subject})؛ اختر المادة والقاعة نفسيهما لتسجيل الخروج.`, 'conflict'); action = 'out'; }
    else if (open && !same) throw new HttpError(409, `الطالب مسجَّل داخل القاعة «${open.hall}» (${open.subject}) ؛ سجّل خروجه منها أولاً.`, 'conflict');
    else if (act === 'in' && same) throw new HttpError(409, 'الطالب مسجَّل داخل هذه القاعة أصلاً.', 'conflict');
    else action = same ? 'out' : 'in';
    let id;
    if (action === 'out') { db.prepare('UPDATE hall_logs SET exited_at = ? WHERE id = ?').run(Math.max(now, open.entered_at), open.id); id = open.id; }
    else id = Number(db.prepare('INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, method, recorded_by) VALUES (?,?,?,?,?,?,?,?)').run(st.id, s.kind, s.course_id, s.subject, hall, now, 'barcode', actor.id).lastInsertRowid);
    audit(db, actor, action === 'in' ? 'تسجيل دخول قاعة' : 'تسجيل خروج قاعة', `${st.student_no} · ${hall}`, ip);
    return { action, log: one(db, id), student: { id: st.id, studentNo: st.student_no, name: [st.first_name, st.father_name, st.last_name].filter(Boolean).join(' ') || st.student_no, faculty: st.faculty ?? '', photoId: st.photo_id ?? null }, warnings };
  });
}

// إدخال يدوي (تصحيح أو تسجيل لاحق)
export function addManual({ db }, actor, b, ip) {
  const st = findStudent(db, b.studentNo ?? b.code), s = subjectOf(db, b), hall = text(b.hall, 'القاعة', { max: 60 });
  const inT = ms(b.enteredAt, 'وقت الدخول'), outT = b.exitedAt ? ms(b.exitedAt, 'وقت الخروج') : null;
  if (outT !== null && outT < inT) throw bad('وقت الخروج قبل وقت الدخول.', 'exitedAt');
  const note = b.note ? text(b.note, 'الملاحظة', { max: 200 }) : null;
  return tx(db, () => {
    if (outT === null && db.prepare('SELECT 1 FROM hall_logs WHERE student_id = ? AND exited_at IS NULL').get(st.id)) throw new HttpError(409, 'للطالب دخول مفتوح؛ أغلقه أولاً.', 'conflict');
    const id = Number(db.prepare('INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, exited_at, method, recorded_by, note) VALUES (?,?,?,?,?,?,?,?,?,?)').run(st.id, s.kind, s.course_id, s.subject, hall, inT, outT, 'manual', actor.id, note).lastInsertRowid);
    audit(db, actor, 'إضافة سجل قاعة يدوياً', `${st.student_no} · ${hall}`, ip);
    return one(db, id);
  });
}

export function updateLog({ db }, actor, id, b, ip) {
  const cur = db.prepare('SELECT * FROM hall_logs WHERE id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'السجل غير موجود.', 'not_found');
  const hall = b.hall !== undefined ? text(b.hall, 'القاعة', { max: 60 }) : cur.hall;
  const subj = b.subject !== undefined || b.courseId !== undefined || b.kind !== undefined ? subjectOf(db, { kind: b.kind ?? cur.kind, courseId: b.courseId, subject: b.subject ?? (b.courseId ? undefined : cur.subject) }) : { kind: cur.kind, course_id: cur.course_id, subject: cur.subject };
  const inT = b.enteredAt !== undefined ? ms(b.enteredAt, 'وقت الدخول') : cur.entered_at;
  const outT = b.exitedAt === null || b.exitedAt === '' ? null : b.exitedAt !== undefined ? ms(b.exitedAt, 'وقت الخروج') : cur.exited_at;
  if (outT !== null && outT < inT) throw bad('وقت الخروج قبل وقت الدخول.', 'exitedAt');
  const note = b.note !== undefined ? (b.note ? text(b.note, 'الملاحظة', { max: 200 }) : null) : cur.note;
  db.prepare('UPDATE hall_logs SET kind = ?, course_id = ?, subject = ?, hall = ?, entered_at = ?, exited_at = ?, note = ? WHERE id = ?').run(subj.kind, subj.course_id, subj.subject, hall, inT, outT, note, cur.id);
  audit(db, actor, 'تعديل سجل قاعة', `#${cur.id}`, ip);
  return one(db, cur.id);
}
export function deleteLog({ db }, actor, id, ip) {
  const r = db.prepare('SELECT l.id, u.student_no FROM hall_logs l JOIN users u ON u.id = l.student_id WHERE l.id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'السجل غير موجود.', 'not_found');
  db.prepare('DELETE FROM hall_logs WHERE id = ?').run(r.id);
  audit(db, actor, 'حذف سجل قاعة', `${r.student_no} #${r.id}`, ip);
}

/* ---------- القائمة بالفلاتر (تُستعمل في الواجهة والتصدير) ---------- */
const SORTS = { enteredAt: 'l.entered_at', exitedAt: 'l.exited_at', studentNo: 'u.student_no', studentName: 'sp.first_name, sp.father_name', subject: 'l.subject', hall: 'l.hall', kind: 'l.kind', faculty: 'g.faculty', minutes: '(l.exited_at - l.entered_at)' };
const dayMs = (s, tz, end) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return null; const t = Date.parse(s + 'T00:00:00Z'); return Number.isNaN(t) ? null : t + tz * 60000 + (end ? 86400000 - 1 : 0); };
const likeEsc = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';

export function filterSql(q = {}) {
  const w = [], a = [], tzMin = Number.isFinite(Number(q.tz)) && Math.abs(Number(q.tz)) <= 840 ? Number(q.tz) : -180;      // تعويض المنطقة الزمنية (دقائق، getTimezoneOffset)
  const term = String(q.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (term) { const l = likeEsc(term), L = likeEsc(term.toUpperCase()); w.push(`(u.student_no LIKE ? ESCAPE '\\' OR (sp.first_name || ' ' || sp.father_name || ' ' || sp.last_name) LIKE ? ESCAPE '\\' OR l.subject LIKE ? ESCAPE '\\' OR l.hall LIKE ? ESCAPE '\\')`); a.push(L, l, l, l); }
  if (KINDS[q.kind]) { w.push('l.kind = ?'); a.push(q.kind); }
  if (Number(q.course) > 0) { w.push('l.course_id = ?'); a.push(Number(q.course)); }
  if (q.hall) { w.push('l.hall = ?'); a.push(String(q.hall).slice(0, 60)); }
  if (Number(q.faculty) > 0) { w.push('g.faculty_id = ?'); a.push(Number(q.faculty)); }
  if (Number(q.student) > 0) { w.push('l.student_id = ?'); a.push(Number(q.student)); }
  if (q.state === 'open') w.push('l.exited_at IS NULL'); else if (q.state === 'closed') w.push('l.exited_at IS NOT NULL');
  if (['barcode', 'manual', 'import'].includes(q.method)) { w.push('l.method = ?'); a.push(q.method); }
  const f = dayMs(q.from, tzMin, false), t = dayMs(q.to, tzMin, true);
  if (f !== null) { w.push('l.entered_at >= ?'); a.push(f); }
  if (t !== null) { w.push('l.entered_at <= ?'); a.push(t); }
  return { W: w.length ? 'WHERE ' + w.join(' AND ') : '', a };
}

export function listLogs({ db }, q) {
  const { W, a } = filterSql(q);
  const sum = db.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT l.student_id) s, SUM(l.exited_at IS NULL) o, AVG(CASE WHEN l.exited_at IS NOT NULL THEN (l.exited_at - l.entered_at) / 60000.0 END) d
    FROM hall_logs l JOIN users u ON u.id = l.student_id LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN programs g ON g.id = sp.program_id ${W}`).get(...a);
  const size = Math.min(100, Math.max(5, Number(q.size) || 25)), pages = Math.max(1, Math.ceil(sum.n / size)), page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const col = SORTS[q.sort] ?? SORTS.enteredAt, dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`${SEL} ${W} ORDER BY ${col.split(', ').map((c) => `${c} ${dir}`).join(', ')}, l.id DESC LIMIT ? OFFSET ?`).all(...a, size, (page - 1) * size);
  return { total: sum.n, page, pages, size, summary: { count: sum.n, students: sum.s, open: sum.o ?? 0, avgMinutes: sum.d === null ? null : Math.round(sum.d) }, rows: rows.map(view), options: logOptions(db) };
}
export function logOptions(db) {
  return { kinds: KINDS, halls: db.prepare('SELECT DISTINCT hall FROM hall_logs ORDER BY hall').all().map((r) => r.hall),
    courses: db.prepare('SELECT c.id, c.name, c.code, c.level, c.semester, g.faculty FROM courses c JOIN programs g ON g.id = c.program_id WHERE c.active = 1 ORDER BY g.faculty, c.level, c.semester, c.name').all(),
    faculties: db.prepare('SELECT id, name FROM faculties ORDER BY id').all() };
}
export function openLogs({ db }) {      // من هم داخل القاعات الآن
  return db.prepare(`${SEL} WHERE l.exited_at IS NULL ORDER BY l.hall, l.entered_at`).all().map(view);
}
export { view as viewLog };

// صف مستورد: يتحقق ويحفظ (الأوقات بالملّي ثانية). الدخول المفتوح (بلا خروج) يُسمح به لطالب بلا دخول مفتوح آخر.
export function importLogRow({ db }, actor, b) {
  const st = findStudent(db, b.studentNo), s = subjectOf(db, b), hall = text(b.hall, 'القاعة', { max: 60 });
  if (b.enteredAt > Date.now() + 86400000 * 2) throw bad('وقت الدخول في المستقبل.');
  if (b.exitedAt !== null && b.exitedAt < b.enteredAt) throw bad('وقت الخروج قبل وقت الدخول.');
  if (b.exitedAt === null && db.prepare('SELECT 1 FROM hall_logs WHERE student_id = ? AND exited_at IS NULL').get(st.id)) throw new HttpError(409, 'للطالب دخول مفتوح؛ أغلقه أولاً.', 'conflict');
  if (db.prepare('SELECT 1 FROM hall_logs WHERE student_id = ? AND kind = ? AND subject = ? AND hall = ? AND entered_at = ?').get(st.id, s.kind, s.subject, hall, b.enteredAt)) throw new HttpError(409, 'السجل مكرَّر (الطالب والمادة والقاعة ووقت الدخول).', 'duplicate');
  db.prepare('INSERT INTO hall_logs (student_id, kind, course_id, subject, hall, entered_at, exited_at, method, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)').run(st.id, s.kind, s.course_id, s.subject, hall, b.enteredAt, b.exitedAt, 'import', actor.id);
}

export function logsForExport(db, q, max = 100000) {
  const { W, a } = filterSql(q);
  return db.prepare(`${SEL} ${W} ORDER BY l.entered_at DESC, l.id DESC LIMIT ?`).all(...a, max + 1).map(view);
}
