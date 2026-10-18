import { tx } from '../db.js';
import { enqueueCertificate } from './enrollcert.js';
import { audit } from '../audit.js';
import { hashPassword, tempPassword } from '../security.js';
import { HttpError } from '../http.js';
import fs from 'node:fs';
import path from 'node:path';
import { certDir } from './enrollcert.js';
import { purgeStudentFiles } from './studentfiles.js';

/* ------------------------------------------------------------------
   تسجيل الطلاب: تعريف الحقول مصدر واحد للتحقق في الخادم ولرسم النموذج في الواجهة.
   قوائم الاختيار هنا قيم افتراضية معقولة؛ تعدَّل في الكود، أما البرامج فتُدار من الواجهة.
------------------------------------------------------------------- */
export const GOVERNORATES = ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة', 'خارج سوريا'];
export const STATUS_LABEL = { active: 'مقيَّد', suspended: 'موقوف القيد', withdrawn: 'منسحب', transferred: 'محوَّل', graduated: 'متخرج' };
const LEVELS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
export const levelLabel = (n) => `السنة ${LEVELS[n - 1] ?? n}`;

const HS_TYPES = ['الثانوية العامة - الفرع العلمي', 'الثانوية العامة - الفرع الأدبي', 'الثانوية المهنية - صناعي', 'الثانوية المهنية - تجاري', 'الثانوية المهنية - نسوي', 'الثانوية المهنية - زراعي',
  'معهد متوسط', 'شهادة ثانوية أجنبية / معادلة', 'أخرى'];
const ADMISSIONS = ['القبول العام (المفاضلة)', 'التعليم الموازي', 'التعليم المفتوح / الافتراضي', 'أبناء أعضاء الهيئة التدريسية', 'الطلاب الوافدون', 'نقل من جامعة أخرى', 'أخرى'];
const RELATIONS = ['الأب', 'الأم', 'الأخ', 'الأخت', 'الزوج/الزوجة', 'قريب آخر', 'وصي'];

// الجهة التي برنامجها الوحيد يحمل اسمها (كلية، معهد، مركز) تُعرض باسمها فقط
export const programLabel = (p) => (p.faculty === p.name ? p.faculty : `${p.faculty} — ${p.degree} ${p.name}`);

const opts = (a) => a.map((x) => (typeof x === 'object' ? x : { v: x, l: x }));
const F = (name, label, type, o = {}) => ({ name, label, type, ...o });

export function sections(db) {
  const year = new Date().getFullYear();
  const programs = db.prepare('SELECT id, faculty, name, degree, years FROM programs WHERE active = 1 ORDER BY faculty, name').all()
    .map((p) => ({ v: p.id, l: programLabel(p), years: p.years }));
  return [
    { id: 'identity', title: 'البيانات الشخصية', fields: [
      F('first_name', 'الاسم الأول', 'name', { required: true, max: 40 }),
      F('father_name', 'اسم الأب', 'name', { required: true, max: 40 }),
      F('last_name', 'الكنية', 'name', { required: true, max: 40 }),
      F('mother_name', 'اسم الأم', 'name', { required: true, max: 60, hint: 'الاسم الأول مع الكنية' }),
      F('name_en', 'الاسم بالإنكليزية', 'latin', { max: 100, hint: 'كما في جواز السفر (اختياري)' }),
      F('national_id', 'الرقم الوطني / رقم الهوية', 'nid', { required: true }),
      F('gender', 'الجنس', 'select', { required: true, options: opts(['ذكر', 'أنثى']) }),
      F('birth_date', 'تاريخ الميلاد', 'date', { required: true }),
      F('birth_place', 'مكان الولادة', 'text', { required: true, max: 60 }),
      F('nationality', 'الجنسية', 'text', { required: true, max: 40, default: 'سورية' }),
      F('marital_status', 'الحالة الاجتماعية', 'select', { options: opts(['عازب/عزباء', 'متزوج/ة', 'أخرى']) }),
    ] },
    { id: 'contact', title: 'الاتصال والسكن', fields: [
      F('phone', 'رقم الهاتف المحمول', 'tel', { required: true }),
      F('email', 'البريد الإلكتروني', 'email'),
      F('governorate', 'محافظة السكن', 'select', { required: true, options: opts(GOVERNORATES) }),
      F('city', 'المدينة / المنطقة', 'text', { required: true, max: 60 }),
      F('address', 'العنوان التفصيلي', 'text', { required: true, max: 200, wide: true }),
    ] },
    { id: 'certificate', title: 'الشهادة الثانوية', fields: [
      F('hs_type', 'نوع الشهادة', 'select', { required: true, options: opts(HS_TYPES) }),
      F('hs_year', 'سنة الحصول عليها', 'int', { required: true, min: 1970, max: year, default: year }),
      F('hs_school', 'المدرسة', 'text', { max: 100 }),
      F('hs_governorate', 'محافظة الشهادة', 'select', { options: opts(GOVERNORATES) }),
      F('hs_score', 'مجموع الطالب', 'num', { required: true, max: 100000 }),
    ] },
    { id: 'academic', title: 'القيد الأكاديمي', fields: [
      F('program_id', 'الكلية والبرنامج', 'program', { required: true, options: programs, wide: true }),
      F('admission_type', 'نوع القبول', 'select', { required: true, options: opts(ADMISSIONS) }),
      F('ministerial_no', 'الرقم الوزاري', 'text', { max: 20, hint: 'رقم القبول الوزاري إن وُجد' }),
      F('enroll_year', 'سنة القيد', 'int', { required: true, min: 1980, max: year + 1, default: year }),
      F('enroll_term', 'فصل القيد', 'select', { required: true, options: opts(['الفصل الأول', 'الفصل الثاني', 'الفصل الصيفي']), default: 'الفصل الأول' }),
      F('study_level', 'السنة الدراسية الحالية', 'select', { required: true, options: opts([1, 2, 3, 4].map((n) => ({ v: n, l: levelLabel(n) }))), default: 1 }),
      F('status', 'حالة القيد', 'select', { required: true, editOnly: true, default: 'active', options: opts(Object.entries(STATUS_LABEL).map(([v, l]) => ({ v, l }))) }),
    ] },
    { id: 'guardian', title: 'ولي الأمر وجهة الطوارئ', fields: [
      F('guardian_name', 'اسم ولي الأمر', 'name', { required: true, max: 80 }),
      F('guardian_relation', 'صلة القرابة', 'select', { required: true, options: opts(RELATIONS) }),
      F('guardian_phone', 'هاتف ولي الأمر', 'tel', { required: true }),
      F('emergency_phone', 'هاتف آخر للطوارئ', 'tel'),
      F('notes', 'ملاحظات الموظف (لا تظهر للطالب)', 'longtext', { max: 500, wide: true }),
    ] },
  ];
}
const allFields = (secs) => secs.flatMap((s) => s.fields);
export const COLUMNS = allFields(sections({ prepare: () => ({ all: () => [] }) })).map((f) => f.name);

/* ---------------- التحقق ---------------- */
const CTRL = /[\u0000-\u001f\u007f]/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}'’. -]*$/u;
const LATIN_RE = /^[A-Za-z][A-Za-z'’. -]*$/;
const fail = (f, msg) => { throw new HttpError(400, msg, 'validation', f.name ?? f); };

function parse(db, f, raw) {
  const s = typeof raw === 'string' ? raw : String(raw);
  const max = f.max ?? 100;
  switch (f.type) {
    case 'name': case 'latin': case 'text': {
      if (s.length > max) fail(f, `«${f.label}» يجب ألا يتجاوز ${max} حرفاً.`);
      if (CTRL.test(s)) fail(f, `«${f.label}» يحوي رموزاً غير مسموحة.`);
      if (f.type === 'name' && !NAME_RE.test(s)) fail(f, `«${f.label}» يجب أن يحوي حروفاً فقط.`);
      if (f.type === 'latin' && !LATIN_RE.test(s)) fail(f, `«${f.label}» يُكتب بأحرف لاتينية فقط.`);
      return s;
    }
    case 'longtext': if (s.length > max) fail(f, `«${f.label}» يجب ألا يتجاوز ${max} حرفاً.`); return s;
    case 'nid': {
      const v = s.replace(/\s/g, '').toUpperCase();
      if (!/^[0-9A-Z]{6,20}$/.test(v)) fail(f, `«${f.label}» غير صالح (6-20 خانة من الأرقام أو الأحرف اللاتينية).`);
      return v;
    }
    case 'tel': {
      const v = s.replace(/[\s()-]/g, '');
      if (!/^\+?[0-9]{7,15}$/.test(v)) fail(f, `«${f.label}» غير صالح (7-15 رقماً، ويجوز أن يبدأ بـ +).`);
      return v;
    }
    case 'email': {
      const v = s.toLowerCase();
      if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fail(f, `«${f.label}» غير صالح.`);
      return v;
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail(f, `«${f.label}» تاريخ غير صالح.`);
      return s;
    }
    case 'int': {
      const n = Number(s);
      if (!Number.isInteger(n) || n < f.min || n > f.max) fail(f, `«${f.label}» يجب أن يكون عدداً صحيحاً بين ${f.min} و${f.max}.`);
      return n;
    }
    case 'num': {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || n > f.max) fail(f, `«${f.label}» قيمة غير صالحة.`);
      return n;
    }
    case 'select': {
      const o = f.options.find((x) => String(x.v) === s);
      if (!o) fail(f, `قيمة غير صالحة في «${f.label}».`);
      return o.v;
    }
    case 'program': {
      const id = Number(s);
      if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM programs WHERE id = ?').get(id)) fail(f, 'البرنامج الأكاديمي غير موجود.');
      return id;
    }
    default: throw new Error('نوع حقل غير معروف: ' + f.type);
  }
}

export function validateProfile(db, input, { current = null } = {}) {
  const isUpdate = !!current, out = {};
  for (const f of allFields(sections(db))) {
    if (f.editOnly && !isUpdate) { out[f.name] = 'active'; continue; }
    let raw = input?.[f.name];
    if (typeof raw === 'string' && f.type !== 'longtext') raw = raw.replace(/\s+/g, ' ').trim();
    if (typeof raw === 'string' && f.type === 'longtext') raw = raw.trim();
    if ((raw === undefined || raw === null || raw === '') && f.name === 'status' && isUpdate) raw = current.status;
    if (raw === undefined || raw === null || raw === '') raw = f.default;
    if (raw === undefined || raw === null || raw === '') {
      if (f.required) fail(f, `الحقل «${f.label}» مطلوب.`);
      out[f.name] = null; continue;
    }
    // البرنامج المعطَّل لا يُقبل لتسجيل جديد، لكن يبقى مقبولاً لتعديل طالب مقيَّد فيه أصلاً
    if (f.type === 'program' && isUpdate && Number(raw) === current.program_id) { out[f.name] = current.program_id; continue; }
    if (f.type === 'program') {
      const p = db.prepare('SELECT active FROM programs WHERE id = ?').get(Number(raw));
      if (p && !p.active) fail(f, 'هذا البرنامج غير متاح للتسجيل حالياً.');
    }
    out[f.name] = parse(db, f, raw);
  }

  // قيود متقاطعة بين الحقول
  const now = new Date(), y = now.getFullYear();
  if (out.birth_date) {
    const age = y - Number(out.birth_date.slice(0, 4));
    if (out.birth_date > now.toISOString().slice(0, 10) || age < 14 || age > 90) fail('birth_date', 'تاريخ الميلاد غير منطقي (العمر بين 14 و90 سنة).');
  }
  if (out.hs_year > out.enroll_year) fail('hs_year', 'سنة الشهادة لا تتجاوز سنة القيد.');
  if (out.hs_year < Number(out.birth_date.slice(0, 4)) + 12) fail('hs_year', 'سنة الشهادة لا تتسق مع تاريخ الميلاد.');
  const prog = db.prepare('SELECT years FROM programs WHERE id = ?').get(out.program_id);
  if (out.study_level > prog.years) fail('study_level', `مدة هذا البرنامج ${prog.years} سنوات؛ السنة الدراسية أعلى من ذلك.`);
  return out;
}

/* ---------------- تعريف العرض ---------------- */
const fullName = (p) => [p.first_name, p.father_name, p.last_name].filter(Boolean).join(' ');
const shortName = (p) => [p.first_name, p.father_name, p.last_name].join(' ');
const maskId = (s) => (s.length <= 4 ? s : '•'.repeat(s.length - 4) + s.slice(-4));

const SELECT = `SELECT p.*, u.student_no, u.username, u.display_name, u.must_change_password,
                       g.faculty, g.name AS program_name, g.degree, g.years
                FROM student_profiles p JOIN users u ON u.id = p.user_id JOIN programs g ON g.id = p.program_id`;

function view(db, r, { full = true, own = false } = {}) {
  const base = {
    id: r.user_id, studentNo: r.student_no, name: fullName(r), status: r.status, statusLabel: STATUS_LABEL[r.status],
    program: { id: r.program_id, faculty: r.faculty, name: r.program_name, degree: r.degree, years: r.years, label: programLabel({ faculty: r.faculty, name: r.program_name, degree: r.degree }) }, level: r.study_level, levelLabel: levelLabel(r.study_level),
    enrollYear: r.enroll_year, phone: r.phone, nationalId: full ? r.national_id : maskId(r.national_id),
  };
  if (!full) return base;
  const profile = {}; for (const c of COLUMNS) profile[c] = r[c];
  if (own) delete profile.notes;
  return { ...base, profile, username: r.username, mustChangePassword: !!r.must_change_password,
    createdAt: r.created_at, updatedAt: r.updated_at,
    activeHolds: db.prepare('SELECT COUNT(*) c FROM student_holds WHERE student_id = ? AND active = 1').get(r.user_id).c };
}

export function registrationOptions(db, canManage) {
  return { sections: sections(db), levels: 4, statuses: STATUS_LABEL, canManagePrograms: canManage };
}

/* ---------------- العمليات ---------------- */
export function duplicateCheck(db, p, selfId = 0) {
  const byId = db.prepare('SELECT u.student_no FROM student_profiles s JOIN users u ON u.id = s.user_id WHERE s.national_id = ? AND s.user_id != ?').get(p.national_id, selfId);
  if (byId) throw new HttpError(409, `الرقم الوطني مسجَّل مسبقاً للطالب ذي الرقم الجامعي ${byId.student_no}.`, 'duplicate', 'national_id');
  const same = db.prepare(`SELECT u.student_no FROM student_profiles s JOIN users u ON u.id = s.user_id
    WHERE s.first_name = ? AND s.father_name = ? AND s.last_name = ? AND s.mother_name = ? AND s.birth_date = ? AND s.user_id != ?`)
    .get(p.first_name, p.father_name, p.last_name, p.mother_name, p.birth_date, selfId);
  if (same) throw new HttpError(409, `يوجد طالب بنفس الاسم واسم الأم وتاريخ الميلاد (الرقم الجامعي ${same.student_no})؛ تحقق من عدم تكرار التسجيل.`, 'duplicate', 'first_name');
}

export function composeUser(db, p) {
  const g = db.prepare('SELECT faculty, name, degree FROM programs WHERE id = ?').get(p.program_id);
  return { display: shortName(p), program: `${g.faculty === g.name ? g.name : `${g.degree} ${g.name}`} - ${levelLabel(p.study_level)}` };
}

export async function registerStudent({ db, cfg }, actor, input, ip) {
  const p = validateProfile(db, input);
  duplicateCheck(db, p);
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  const { id, studentNo } = tx(db, () => {
    duplicateCheck(db, p);                                    // إعادة فحص داخل المعاملة ضد السباق
    // الترميز: <أحرف الكلية بالإنكليزية>-<سنة القيد>-<تسلسل من 4 خانات>، والتسلسل مستقل لكل كلية وسنة
    const fac = db.prepare('SELECT f.code FROM programs g JOIN faculties f ON f.id = g.faculty_id WHERE g.id = ?').get(p.program_id);
    if (!fac) throw new HttpError(400, 'هذا البرنامج غير مرتبط بكلية؛ عدّله من شاشة الكليات والبرامج أولاً.', 'validation', 'program_id');
    const prefix = `${fac.code}-${p.enroll_year}-`;
    const last = db.prepare('SELECT MAX(CAST(substr(student_no, ?) AS INTEGER)) n FROM users WHERE student_no LIKE ?').get(prefix.length + 1, `${prefix}%`).n ?? 0;
    const no = `${prefix}${String(last + 1).padStart(4, '0')}`;
    const u = composeUser(db, p), now = Date.now();
    const uid = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, program, must_change_password, created_at) VALUES (?,?,?,?,?,?,1,?)')
      .run(no, u.display, hash, 'student', no, u.program, now).lastInsertRowid);
    const cols = COLUMNS;
    db.prepare(`INSERT INTO student_profiles (user_id, ${cols.join(', ')}, created_by, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`)
      .run(uid, ...cols.map((c) => p[c]), actor.id, now, now);
    audit(db, actor, 'تسجيل طالب جديد', no, ip);
    return { id: uid, studentNo: no };
  });
  enqueueCertificate({ db, cfg }, id);                       // شهادة التسجيل الموقَّعة + الختم الزمني: في الخلفية، دون تأخير الاستجابة أو إفشالها
  return { student: getStudent({ db }, id), credentials: { username: studentNo, tempPassword: pw } };
}

export function getStudent({ db }, id, { own = false } = {}) {
  const r = db.prepare(`${SELECT} WHERE p.user_id = ?`).get(Number(id));
  if (!r) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  return view(db, r, { own });
}

export function myProfile({ db }, user) {
  const r = db.prepare(`${SELECT} WHERE p.user_id = ?`).get(user.id);
  return r ? view(db, r, { own: true }) : null;                 // حسابات قديمة بلا ملف
}

const like = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
export function listStudents({ db }, query) {
  const where = [], args = [];
  const q = String(query.q ?? '').trim().slice(0, 60);
  if (q) {
    where.push(`(u.student_no LIKE ? ESCAPE '\\' OR p.national_id LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\'
      OR (p.first_name || ' ' || p.father_name || ' ' || p.last_name) LIKE ? ESCAPE '\\')`);
    args.push(like(q), like(q.toUpperCase()), like(q), like(q));
  }
  if (query.program && Number.isInteger(Number(query.program))) { where.push('p.program_id = ?'); args.push(Number(query.program)); }
  if (STATUS_LABEL[query.status]) { where.push('p.status = ?'); args.push(query.status); }
  if (Number.isInteger(Number(query.year)) && Number(query.year) > 0) { where.push('p.enroll_year = ?'); args.push(Number(query.year)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200), offset = Math.max(Number(query.offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) c FROM student_profiles p JOIN users u ON u.id = p.user_id ${w}`).get(...args).c;
  const rows = db.prepare(`${SELECT} ${w} ORDER BY p.created_at DESC, p.user_id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, students: rows.map((r) => view(db, r, { full: false })) };
}

export function updateStudent({ db }, actor, id, input, ip) {
  const cur = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(Number(id));
  if (!cur) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const p = validateProfile(db, input, { current: cur });
  duplicateCheck(db, p, cur.user_id);
  const changed = COLUMNS.filter((c) => (cur[c] ?? null) !== (p[c] ?? null));
  tx(db, () => {
    if (changed.length) {
      const now = Date.now(), u = composeUser(db, p);
      db.prepare(`UPDATE student_profiles SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`).run(...COLUMNS.map((c) => p[c]), now, cur.user_id);
      db.prepare('UPDATE users SET display_name = ?, program = ? WHERE id = ?').run(u.display, u.program, cur.user_id);
    }
    const no = db.prepare('SELECT student_no FROM users WHERE id = ?').get(cur.user_id).student_no;
    const labels = Object.fromEntries(allFields(sections(db)).map((f) => [f.name, f.label]));
    if (changed.includes('status')) audit(db, actor, `تغيير حالة القيد: ${STATUS_LABEL[cur.status]} ← ${STATUS_LABEL[p.status]}`, no, ip);
    const rest = changed.filter((c) => c !== 'status');
    if (rest.length) audit(db, actor, `تعديل ملف طالب (${rest.map((c) => labels[c]).join('، ')})`.slice(0, 300), no, ip);   // أسماء الحقول فقط، لا القيم
  });
  return getStudent({ db }, cur.user_id);
}

export async function resetStudentPassword({ db, cfg }, actor, id, ip) {
  const u = db.prepare("SELECT id, username, student_no FROM users WHERE id = ? AND role = 'student'").get(Number(id));
  if (!u) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const pw = tempPassword(), hash = await hashPassword(pw, cfg.scryptN);
  tx(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = 0 WHERE id = ?').run(hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, actor, 'إعادة تعيين كلمة مرور طالب', u.student_no, ip);
  });
  return { credentials: { username: u.username, tempPassword: pw } };
}

/* ---------------- الكليات والمعاهد والمراكز ---------------- */
const KIND_LABEL = { college: 'كلية', institute: 'معهد', center: 'مركز' };
export const listFaculties = (db) => db.prepare('SELECT * FROM faculties ORDER BY id').all().map((f) => ({
  id: f.id, name: f.name, nameEn: f.name_en, code: f.code, kind: f.kind, kindLabel: KIND_LABEL[f.kind], active: !!f.active,
  programs: db.prepare('SELECT COUNT(*) c FROM programs WHERE faculty_id = ?').get(f.id).c,
  students: db.prepare('SELECT COUNT(*) c FROM student_profiles sp JOIN programs g ON g.id = sp.program_id WHERE g.faculty_id = ?').get(f.id).c,
}));

// رمز الكلية: الأحرف الأولى من كلمات اسمها الإنكليزي (بلا أدوات الربط)
const STOP = new Set(['of', 'for', 'and', 'the', 'in', 'on', 'at', 'to', '&']);
export const deriveCode = (en) => String(en).split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase())).map((w) => w[0].toUpperCase()).join('');

export function addFaculty({ db }, actor, b, ip) {
  const name = String(b?.name ?? '').replace(/\s+/g, ' ').trim(), nameEn = String(b?.nameEn ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 80 || CTRL.test(name)) throw new HttpError(400, 'اسم الجهة بالعربية: 3 إلى 80 حرفاً.', 'validation');
  if (!/^[A-Za-z][A-Za-z '&-]{2,99}$/.test(nameEn)) throw new HttpError(400, 'الاسم بالإنكليزية بأحرف لاتينية (3 إلى 100 حرف).', 'validation');
  const kind = b?.kind ?? 'college';
  if (!KIND_LABEL[kind]) throw new HttpError(400, 'نوع الجهة غير صالح.', 'validation');
  const code = String(b?.code ?? '').trim().toUpperCase() || deriveCode(nameEn);
  if (!/^[A-Z]{2,8}$/.test(code)) throw new HttpError(400, 'رمز الجهة: من 2 إلى 8 أحرف لاتينية كبيرة.', 'validation');
  if (db.prepare('SELECT 1 FROM faculties WHERE name = ?').get(name)) throw new HttpError(409, 'يوجد جهة بهذا الاسم.', 'conflict');
  if (db.prepare('SELECT 1 FROM faculties WHERE code = ?').get(code)) throw new HttpError(409, `الرمز ${code} مستخدم لجهة أخرى؛ اختر رمزاً مختلفاً.`, 'conflict');
  const years = Number(b?.years ?? (kind === 'college' ? 4 : 2)), degree = String(b?.degree ?? '').trim() || (kind === 'college' ? 'بكالوريوس' : 'دبلوم');
  if (!Number.isInteger(years) || years < 1 || years > 4) throw new HttpError(400, 'مدة البرنامج بين 1 و4 سنوات.', 'validation');
  const id = tx(db, () => {
    const fid = Number(db.prepare('INSERT INTO faculties (name, name_en, code, kind) VALUES (?,?,?,?)').run(name, nameEn, code, kind).lastInsertRowid);
    db.prepare('INSERT INTO programs (faculty, name, degree, years, faculty_id) VALUES (?,?,?,?,?)').run(name, name, degree, years, fid);
    audit(db, actor, `إضافة ${KIND_LABEL[kind]}: ${name} (${code})`, String(fid), ip);
    return fid;
  });
  return { id, code };
}

export function toggleFaculty({ db }, actor, id, active, ip) {
  const f = db.prepare('SELECT * FROM faculties WHERE id = ?').get(Number(id));
  if (!f) throw new HttpError(404, 'الجهة غير موجودة.', 'not_found');
  tx(db, () => {
    db.prepare('UPDATE faculties SET active = ? WHERE id = ?').run(active ? 1 : 0, f.id);
    db.prepare('UPDATE programs SET active = ? WHERE faculty_id = ?').run(active ? 1 : 0, f.id);
    audit(db, actor, `${active ? 'تفعيل' : 'تعطيل'} ${KIND_LABEL[f.kind]}: ${f.name}`, String(f.id), ip);
  });
}

/* ---------------- البرامج الأكاديمية ---------------- */
export const listPrograms = (db) => db.prepare('SELECT g.id, g.faculty, g.name, g.degree, g.years, g.active, g.faculty_id, f.code FROM programs g LEFT JOIN faculties f ON f.id = g.faculty_id ORDER BY g.active DESC, g.faculty_id, g.name').all()
  .map((p) => ({ id: p.id, faculty: p.faculty, facultyId: p.faculty_id, facultyCode: p.code, name: p.name, degree: p.degree, years: p.years, active: !!p.active, label: programLabel(p),
    students: db.prepare('SELECT COUNT(*) c FROM student_profiles WHERE program_id = ?').get(p.id).c }));

export function addProgram({ db }, actor, b, ip) {
  const t = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); if (!s || s.length > n || CTRL.test(s)) throw new HttpError(400, 'بيانات البرنامج غير صالحة.', 'validation'); return s; };
  const name = t(b?.name, 80), degree = t(b?.degree || 'بكالوريوس', 30), years = Number(b?.years);
  // الكلية تُختار من قائمة الجهات المعتمدة (facultyId) كي يرتبط البرنامج برمز الترميز
  const fac = db.prepare('SELECT id, name, active FROM faculties WHERE id = ?').get(Number(b?.facultyId));
  if (!fac) throw new HttpError(400, 'اختر الكلية أو المعهد من القائمة.', 'validation');
  if (!fac.active) throw new HttpError(400, 'هذه الجهة معطَّلة.', 'validation');
  if (!Number.isInteger(years) || years < 1 || years > 4) throw new HttpError(400, 'مدة البرنامج بين 1 و4 سنوات.', 'validation');
  if (db.prepare('SELECT 1 FROM programs WHERE faculty = ? AND name = ? AND degree = ?').get(fac.name, name, degree)) throw new HttpError(409, 'البرنامج موجود مسبقاً.', 'conflict');
  const id = Number(db.prepare('INSERT INTO programs (faculty, name, degree, years, faculty_id) VALUES (?,?,?,?,?)').run(fac.name, name, degree, years, fac.id).lastInsertRowid);
  audit(db, actor, 'إضافة برنامج أكاديمي', `${fac.name} / ${name}`.slice(0, 100), ip);
  return { id };
}

export function toggleProgram({ db }, actor, id, active, ip) {
  const r = db.prepare('UPDATE programs SET active = ? WHERE id = ?').run(active ? 1 : 0, Number(id));
  if (!r.changes) throw new HttpError(404, 'البرنامج غير موجود.', 'not_found');
  audit(db, actor, `${active ? 'تفعيل' : 'تعطيل'} برنامج أكاديمي`, String(id), ip);
}

/* ---------------- تعديل الطالب لبيانات الاتصال الخاصة به ---------------- */
const CONTACT_FIELDS = ['phone', 'email', 'governorate', 'city', 'address', 'emergency_phone'];
export function updateOwnContact({ db }, user, input, ip) {
  const cur = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);
  if (!cur) throw new HttpError(404, 'لا يوجد ملف شخصي لحسابك؛ راجع قسم شؤون الطلاب.', 'not_found');
  const defs = allFields(sections(db)).filter((f) => CONTACT_FIELDS.includes(f.name)), out = {};
  for (const f of defs) {
    let raw = input?.[f.name];
    if (typeof raw === 'string') raw = raw.replace(/\s+/g, ' ').trim();
    if (raw === undefined || raw === null || raw === '') { if (f.required) fail(f, `الحقل «${f.label}» مطلوب.`); out[f.name] = null; continue; }
    out[f.name] = parse(db, f, raw);
  }
  const changed = CONTACT_FIELDS.filter((c) => (cur[c] ?? null) !== (out[c] ?? null));
  if (changed.length) {
    db.prepare(`UPDATE student_profiles SET ${CONTACT_FIELDS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`).run(...CONTACT_FIELDS.map((c) => out[c]), Date.now(), user.id);
    audit(db, user, 'تعديل بيانات الاتصال (من الطالب)', user.student_no ?? String(user.id), ip);
  }
  return myProfile({ db }, user);
}

/* ---------------- تعديل الكليات والبرامج وحذفها ---------------- */
// أسماء الطلاب المركّبة (users.program) نسخة من بيانات البرنامج: تُجدَّد عند تعديل البرنامج أو الجهة
function refreshStudentLabels(db, programIds) {
  for (const pid of programIds) {
    const rows = db.prepare('SELECT user_id, study_level FROM student_profiles WHERE program_id = ?').all(pid);
    for (const r of rows) db.prepare('UPDATE users SET program = ? WHERE id = ?').run(composeUser(db, { program_id: pid, study_level: r.study_level }).program, r.user_id);
  }
}

export function updateFaculty({ db }, actor, id, b, ip) {
  const f = db.prepare('SELECT * FROM faculties WHERE id = ?').get(Number(id));
  if (!f) throw new HttpError(404, 'الجهة غير موجودة.', 'not_found');
  const name = String(b?.name ?? f.name).replace(/\s+/g, ' ').trim(), nameEn = String(b?.nameEn ?? f.name_en).replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 80 || CTRL.test(name)) throw new HttpError(400, 'اسم الجهة بالعربية: 3 إلى 80 حرفاً.', 'validation');
  if (!/^[A-Za-z][A-Za-z '&-]{2,99}$/.test(nameEn)) throw new HttpError(400, 'الاسم بالإنكليزية بأحرف لاتينية (3 إلى 100 حرف).', 'validation');
  const kind = b?.kind ?? f.kind;
  if (!KIND_LABEL[kind]) throw new HttpError(400, 'نوع الجهة غير صالح.', 'validation');
  const code = String(b?.code ?? f.code).trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(code)) throw new HttpError(400, 'رمز الجهة: من 2 إلى 8 أحرف لاتينية كبيرة.', 'validation');
  if (db.prepare('SELECT 1 FROM faculties WHERE name = ? AND id != ?').get(name, f.id)) throw new HttpError(409, 'يوجد جهة بهذا الاسم.', 'conflict');
  if (db.prepare('SELECT 1 FROM faculties WHERE code = ? AND id != ?').get(code, f.id)) throw new HttpError(409, `الرمز ${code} مستخدم لجهة أخرى.`, 'conflict');
  const students = db.prepare('SELECT COUNT(*) c FROM student_profiles sp JOIN programs g ON g.id = sp.program_id WHERE g.faculty_id = ?').get(f.id).c;
  if (code !== f.code && students) throw new HttpError(409, 'لا يمكن تغيير رمز جهة فيها طلاب لأن أرقامهم الجامعية صدرت به.', 'conflict');
  tx(db, () => {
    db.prepare('UPDATE faculties SET name = ?, name_en = ?, code = ?, kind = ? WHERE id = ?').run(name, nameEn, code, kind, f.id);
    if (name !== f.name) {
      db.prepare('UPDATE programs SET name = ? WHERE faculty_id = ? AND name = ?').run(name, f.id, f.name);   // البرنامج الأساسي يحمل اسم الجهة
      db.prepare('UPDATE programs SET faculty = ? WHERE faculty_id = ?').run(name, f.id);
      refreshStudentLabels(db, db.prepare('SELECT id FROM programs WHERE faculty_id = ?').all(f.id).map((p) => p.id));
    }
    audit(db, actor, `تعديل ${KIND_LABEL[kind]}: ${name}`, String(f.id), ip);
  });
}

export function deleteFaculty({ db }, actor, id, ip) {
  const f = db.prepare('SELECT * FROM faculties WHERE id = ?').get(Number(id));
  if (!f) throw new HttpError(404, 'الجهة غير موجودة.', 'not_found');
  const progs = db.prepare('SELECT id FROM programs WHERE faculty_id = ?').all(f.id).map((p) => p.id);
  const students = progs.length ? db.prepare(`SELECT COUNT(*) c FROM student_profiles WHERE program_id IN (${progs.map(() => '?').join(',')})`).get(...progs).c : 0;
  if (students) throw new HttpError(409, `لا يمكن حذف جهة فيها ${students} طالباً؛ انقلهم إلى برنامج آخر أو عطّل الجهة.`, 'conflict');
  const courses = progs.length ? db.prepare(`SELECT COUNT(*) c FROM courses WHERE program_id IN (${progs.map(() => '?').join(',')})`).get(...progs).c : 0;
  if (courses) throw new HttpError(409, `لا يمكن حذف جهة لها ${courses} مقرراً في دليل المواد؛ احذف المقررات أولاً أو عطّل الجهة.`, 'conflict');
  tx(db, () => {
    db.prepare('DELETE FROM programs WHERE faculty_id = ?').run(f.id);
    db.prepare('DELETE FROM faculties WHERE id = ?').run(f.id);
    audit(db, actor, `حذف ${KIND_LABEL[f.kind]}: ${f.name}`, String(f.id), ip);
  });
}

export function updateProgram({ db }, actor, id, b, ip) {
  const p = db.prepare('SELECT * FROM programs WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'البرنامج غير موجود.', 'not_found');
  const t = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); if (!s || s.length > n || CTRL.test(s)) throw new HttpError(400, 'بيانات البرنامج غير صالحة.', 'validation'); return s; };
  const name = t(b?.name ?? p.name, 80), degree = t(b?.degree ?? p.degree, 30), years = Number(b?.years ?? p.years);
  if (!Number.isInteger(years) || years < 1 || years > 4) throw new HttpError(400, 'مدة البرنامج بين 1 و4 سنوات.', 'validation');
  const maxLevel = db.prepare('SELECT MAX(study_level) m FROM student_profiles WHERE program_id = ?').get(p.id).m ?? 0;
  const maxCourse = db.prepare('SELECT MAX(level) m FROM courses WHERE program_id = ?').get(p.id).m ?? 0;
  if (years < Math.max(maxLevel, maxCourse)) throw new HttpError(409, `لا يمكن تقليل المدة إلى ${years}: يوجد طلاب أو مقررات في السنة ${Math.max(maxLevel, maxCourse)}.`, 'conflict');
  if (db.prepare('SELECT 1 FROM programs WHERE faculty = ? AND name = ? AND degree = ? AND id != ?').get(p.faculty, name, degree, p.id)) throw new HttpError(409, 'البرنامج موجود مسبقاً.', 'conflict');
  tx(db, () => {
    db.prepare('UPDATE programs SET name = ?, degree = ?, years = ? WHERE id = ?').run(name, degree, years, p.id);
    refreshStudentLabels(db, [p.id]);
    audit(db, actor, 'تعديل برنامج أكاديمي', `${p.faculty} / ${name}`.slice(0, 100), ip);
  });
}

export function deleteProgram({ db }, actor, id, ip) {
  const p = db.prepare('SELECT * FROM programs WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'البرنامج غير موجود.', 'not_found');
  const students = db.prepare('SELECT COUNT(*) c FROM student_profiles WHERE program_id = ?').get(p.id).c;
  if (students) throw new HttpError(409, `لا يمكن حذف برنامج فيه ${students} طالباً؛ عطّله أو انقل الطلاب أولاً.`, 'conflict');
  const courses = db.prepare('SELECT COUNT(*) c FROM courses WHERE program_id = ?').get(p.id).c;
  if (courses) throw new HttpError(409, `لا يمكن حذف برنامج له ${courses} مقرراً؛ احذف المقررات أولاً أو عطّله.`, 'conflict');
  tx(db, () => { db.prepare('DELETE FROM programs WHERE id = ?').run(p.id); audit(db, actor, 'حذف برنامج أكاديمي', `${p.faculty} / ${p.name}`.slice(0, 100), ip); });
}

/* ---------------- حذف طالب ---------------- */
// الطلبات والوثائق الموقَّعة وسجل أحداث الطلب غير قابلة للحذف بتصميم النظام (مشغّلات SQLite تمنع ذلك)،
// فالطالب الذي قدّم طلبات يُغيَّر وضع قيده (منسحب/موقوف...) ولا يُحذف.
export function deleteStudent({ db, cfg }, actor, id, ip) {
  const u = db.prepare("SELECT id, student_no FROM users WHERE id = ? AND role = 'student'").get(Number(id));
  if (!u) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const reqs = db.prepare('SELECT COUNT(*) c FROM requests WHERE student_id = ?').get(u.id).c;
  if (reqs) throw new HttpError(409, `لا يمكن حذف طالب لديه ${reqs} طلباً؛ الطلبات والوثائق الموقَّعة سجلات دائمة. غيّر حالة قيده إلى «منسحب» أو «موقوف».`, 'conflict');
  const cert = db.prepare('SELECT file FROM student_certs WHERE student_id = ?').get(u.id);
  tx(db, () => {
    for (const t of ['grades', 'student_holds', 'complaints', 'sessions', 'student_certs', 'hall_logs', 'push_subscriptions']) db.prepare(`DELETE FROM ${t} WHERE ${t === 'sessions' || t === 'push_subscriptions' ? 'user_id' : 'student_id'} = ?`).run(u.id);
    purgeStudentFiles(db, cfg, u.id);
    db.prepare('DELETE FROM student_profiles WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    audit(db, actor, 'حذف طالب وكل بياناته', u.student_no, ip);
  });
  if (cert) { try { fs.unlinkSync(path.join(certDir(cfg), cert.file)); } catch { /* الملف غير موجود */ } }
}

/* ---------------- جدول الطلاب الكامل (بحث/فلاتر/ترتيب/صفحات من الخادم) ---------------- */
const TSORT = { studentNo: 'u.student_no', name: 'p.first_name, p.father_name, p.last_name', faculty: 'g.faculty', program: 'g.name', level: 'p.study_level', status: 'p.status', gender: 'p.gender',
  birthDate: 'p.birth_date', governorate: 'p.governorate', hsScore: 'p.hs_score', enrollYear: 'p.enroll_year', admission: 'p.admission_type', createdAt: 'p.created_at' };

export function listStudentsTable({ db }, q) {
  const where = [], args = [];
  const term = String(q.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (term) {
    const l = like(term), L = like(term.toUpperCase());
    where.push(`(u.student_no LIKE ? ESCAPE '\\' OR p.national_id LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\' OR p.mother_name LIKE ? ESCAPE '\\' OR p.guardian_name LIKE ? ESCAPE '\\'
      OR g.faculty LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\' OR (p.first_name || ' ' || p.father_name || ' ' || p.last_name) LIKE ? ESCAPE '\\')`);
    args.push(l, L, l, l, l, l, l, l, l);
  }
  const eq = (col, v) => { where.push(`${col} = ?`); args.push(v); };
  if (Number(q.faculty) > 0) eq('g.faculty_id', Number(q.faculty));
  if (Number(q.program) > 0) eq('p.program_id', Number(q.program));
  if (Number(q.level) > 0) eq('p.study_level', Number(q.level));
  if (STATUS_LABEL[q.status]) eq('p.status', q.status);
  if (q.gender === 'ذكر' || q.gender === 'أنثى') eq('p.gender', q.gender);
  if (GOVERNORATES.includes(q.governorate)) eq('p.governorate', q.governorate);
  if (Number(q.enrollYear) > 0) eq('p.enroll_year', Number(q.enrollYear));
  if (String(q.admission ?? '') && ADMISSIONS.includes(q.admission)) eq('p.admission_type', q.admission);
  if (q.files === 'none') where.push('NOT EXISTS (SELECT 1 FROM student_files f WHERE f.student_id = p.user_id)');
  else if (q.files === 'some') where.push('EXISTS (SELECT 1 FROM student_files f WHERE f.student_id = p.user_id)');
  if (q.holds === '1') where.push('EXISTS (SELECT 1 FROM student_holds h WHERE h.student_id = p.user_id AND h.active = 1)');
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const FROM = 'FROM student_profiles p JOIN users u ON u.id = p.user_id JOIN programs g ON g.id = p.program_id';
  const sum = db.prepare(`SELECT COUNT(*) n, SUM(p.status = 'active') active, SUM(p.gender = 'ذكر') male, SUM(p.gender = 'أنثى') female ${FROM} ${W}`).get(...args);
  const size = Math.min(100, Math.max(5, Number(q.size) || 25)), pages = Math.max(1, Math.ceil(sum.n / size)), page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const col = TSORT[q.sort] ?? TSORT.createdAt, dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const order = col.split(', ').map((c) => `${c} ${dir}`).join(', ');
  const rows = db.prepare(`SELECT p.*, u.student_no, u.username, g.faculty, g.name AS program_name, g.degree, g.years,
      (SELECT COUNT(*) FROM student_holds h WHERE h.student_id = p.user_id AND h.active = 1) holds,
      (SELECT COUNT(*) FROM student_files f WHERE f.student_id = p.user_id) files,
      (SELECT MAX(f.id) FROM student_files f WHERE f.student_id = p.user_id AND f.kind = 'photo') photo_id
    ${FROM} ${W} ORDER BY ${order}, p.user_id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  return {
    total: sum.n, page, pages, size,
    summary: { count: sum.n, active: sum.active ?? 0, male: sum.male ?? 0, female: sum.female ?? 0 },
    options: { faculties: db.prepare('SELECT id, name FROM faculties ORDER BY id').all(), programs: db.prepare('SELECT g.id, g.faculty_id facultyId, g.faculty, g.name, g.degree FROM programs g ORDER BY g.faculty, g.name').all().map((x) => ({ id: x.id, facultyId: x.facultyId, label: programLabel(x) })),
      governorates: GOVERNORATES, admissions: ADMISSIONS, enrollYears: db.prepare('SELECT DISTINCT enroll_year y FROM student_profiles ORDER BY y DESC').all().map((r) => r.y), statuses: STATUS_LABEL, levels: 4 },
    rows: rows.map((r) => ({ id: r.user_id, studentNo: r.student_no, name: fullName(r), nameEn: r.name_en, motherName: r.mother_name, nationalId: r.national_id, gender: r.gender, birthDate: r.birth_date, birthPlace: r.birth_place,
      nationality: r.nationality, maritalStatus: r.marital_status, phone: r.phone, email: r.email, governorate: r.governorate, city: r.city, address: r.address, hsType: r.hs_type, hsYear: r.hs_year, hsSchool: r.hs_school,
      hsGovernorate: r.hs_governorate, hsScore: r.hs_score, faculty: r.faculty, program: r.program_name === r.faculty ? '' : r.program_name, degree: r.degree, admission: r.admission_type, ministerialNo: r.ministerial_no,
      enrollYear: r.enroll_year, enrollTerm: r.enroll_term, level: r.study_level, levelLabel: levelLabel(r.study_level), status: r.status, statusLabel: STATUS_LABEL[r.status], guardianName: r.guardian_name,
      guardianRelation: r.guardian_relation, guardianPhone: r.guardian_phone, emergencyPhone: r.emergency_phone, notes: r.notes, holds: r.holds, files: r.files, photoId: r.photo_id ?? null, createdAt: r.created_at })),
  };
}
