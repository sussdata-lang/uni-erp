// لوحة الإحصاءات: مؤشرات ومجموعات بيانات للمخططات (تُرسم في المتصفح) وللتصدير (Excel / Word / PDF).
// مصدر واحد للأرقام: الواجهة والتصدير يستهلكان نفس الجداول، فلا تختلف الأرقام بين الشاشة والملف.
import { PASS_MARK } from './academics.js';
import { STATUS_LABEL, levelLabel } from './students.js';

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

function lastMonths(n = 12, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, from: d.getTime(), to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) }); }
  return out;
}

export function filterOptions(db) {
  return { faculties: db.prepare('SELECT id, name, code FROM faculties WHERE active = 1 ORDER BY id').all(),
    years: db.prepare('SELECT DISTINCT enroll_year y FROM student_profiles ORDER BY y DESC').all().map((r) => r.y) };
}

export function analytics(db, { faculty, year } = {}, now = new Date()) {
  const f = Number(faculty) > 0 ? Number(faculty) : null, y = Number(year) > 0 ? Number(year) : null;
  const S = `FROM student_profiles sp JOIN users u ON u.id = sp.user_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id
             WHERE (? IS NULL OR fa.id = ?) AND (? IS NULL OR sp.enroll_year = ?)`, SP = [f, f, y, y];
  const all = (sql, ...p) => db.prepare(sql).all(...p), one = (sql, ...p) => db.prepare(sql).get(...p);
  const months = lastMonths(12, now);

  /* --- الطلاب --- */
  const students = one(`SELECT COUNT(*) c, SUM(sp.status = 'active') a ${S}`, ...SP);
  const byFaculty = all(`SELECT COALESCE(fa.name, 'غير محدد') n, COALESCE(fa.code, '—') code, fa.id id, COUNT(*) c FROM student_profiles sp JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id
                         WHERE (? IS NULL OR sp.enroll_year = ?) GROUP BY fa.id ORDER BY c DESC, n`, y, y);
  const groupBy = (col, label = (v) => v, limit = 0) => {
    let rows = all(`SELECT ${col} k, COUNT(*) c ${S} GROUP BY ${col} ORDER BY c DESC`, ...SP).map((r) => [label(r.k) ?? 'غير محدد', r.c]);
    if (limit && rows.length > limit) rows = [...rows.slice(0, limit), ['أخرى', rows.slice(limit).reduce((s, r) => s + r[1], 0)]];
    return rows;
  };
  const byYear = all(`SELECT sp.enroll_year k, COUNT(*) c ${S} GROUP BY sp.enroll_year ORDER BY k`, ...SP).map((r) => [String(r.k), r.c]);
  const byLevel = all(`SELECT sp.study_level k, COUNT(*) c ${S} GROUP BY sp.study_level ORDER BY k`, ...SP).map((r) => [levelLabel(r.k), r.c]);
  const regByMonth = months.map((m) => [m.label, one(`SELECT COUNT(*) c ${S} AND sp.created_at >= ? AND sp.created_at < ?`, ...SP, m.from, m.to).c]);

  /* --- الطلبات --- */
  const R = `FROM requests r JOIN service_types st ON st.code = r.service_code JOIN student_profiles sp ON sp.user_id = r.student_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id
             WHERE (? IS NULL OR fa.id = ?) AND (? IS NULL OR sp.enroll_year = ?)`;
  const rq = one(`SELECT COUNT(*) c, SUM(r.status = 'review') rv, SUM(r.status = 'approved') ap, SUM(r.status = 'rejected') rj, AVG(CASE WHEN r.status = 'approved' THEN r.decided_at - r.created_at END) avg ${R}`, ...SP);
  const late = one(`SELECT COUNT(*) c ${R} AND r.status = 'review' AND ? - r.created_at > st.sla_hours * 3600000`, ...SP, now.getTime()).c;
  const byService = all(`SELECT st.label k, SUM(r.status = 'review') rv, SUM(r.status = 'approved') ap, SUM(r.status = 'rejected') rj, COUNT(*) c ${R} GROUP BY st.code ORDER BY c DESC`, ...SP).map((r) => [r.k, r.rv, r.ap, r.rj]);
  const reqByMonth = months.map((m) => { const x = one(`SELECT COUNT(*) c, SUM(r.status = 'approved') ap ${R} AND r.created_at >= ? AND r.created_at < ?`, ...SP, m.from, m.to); return [m.label, x.c, x.ap ?? 0]; });
  const byUnit = all(`SELECT COALESCE(o.name, 'غير محال') k, COUNT(*) c ${R.replace('LEFT JOIN faculties fa', 'LEFT JOIN org_units o ON o.id = r.assigned_unit_id LEFT JOIN faculties fa')} AND r.status = 'review' GROUP BY o.id ORDER BY c DESC`, ...SP).map((r) => [r.k, r.c]);
  const docs = one(`SELECT COUNT(*) c FROM documents d JOIN requests r ON r.id = d.request_id JOIN student_profiles sp ON sp.user_id = r.student_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id WHERE (? IS NULL OR fa.id = ?) AND (? IS NULL OR sp.enroll_year = ?)`, ...SP).c;

  /* --- الأكاديمي --- */
  const G = `FROM grades gr JOIN student_profiles sp ON sp.user_id = gr.student_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id
             WHERE gr.workflow_status = 'approved' AND (? IS NULL OR fa.id = ?) AND (? IS NULL OR sp.enroll_year = ?)`;
  const gs = one(`SELECT COUNT(*) c, AVG(gr.mark) a, SUM(gr.mark >= ${PASS_MARK}) p ${G}`, ...SP);
  const buckets = [['أقل من 50', 0, 49], ['50 – 59', 50, 59], ['60 – 69', 60, 69], ['70 – 79', 70, 79], ['80 – 89', 80, 89], ['90 – 100', 90, 100]];
  const dist = buckets.map(([l, a, b]) => [l, one(`SELECT COUNT(*) c ${G} AND gr.mark BETWEEN ? AND ?`, ...SP, a, b).c]);
  const gradeByFaculty = all(`SELECT COALESCE(fa.name, 'غير محدد') k, COUNT(*) c, AVG(gr.mark) a, SUM(gr.mark >= ${PASS_MARK}) p ${G} GROUP BY fa.id ORDER BY a DESC`, ...SP).map((r) => [r.k, round1(r.a), pct(r.p, r.c)]);
  const courses = all(`SELECT COALESCE(fa.name, 'غير محدد') k, COUNT(*) c FROM courses c JOIN programs g ON g.id = c.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id WHERE c.active = 1 AND (? IS NULL OR fa.id = ?) GROUP BY fa.id ORDER BY c DESC`, f, f).map((r) => [r.k, r.c]);

  /* --- الشكاوى والأخبار --- */
  const C = `FROM complaints cm JOIN student_profiles sp ON sp.user_id = cm.student_id JOIN programs g ON g.id = sp.program_id LEFT JOIN faculties fa ON fa.id = g.faculty_id WHERE (? IS NULL OR fa.id = ?) AND (? IS NULL OR sp.enroll_year = ?)`;
  const CL = { open: 'قيد المعالجة', answered: 'تم الرد', closed: 'مغلقة' };
  const cmp = all(`SELECT cm.status k, COUNT(*) c ${C} GROUP BY cm.status`, ...SP).map((r) => [CL[r.k] ?? r.k, r.c]);
  const news = one('SELECT COUNT(*) c FROM news').c;

  const k = (id, label, value, o = {}) => ({ id, label, value, ...o });
  const kpis = [
    k('students', 'الطلاب المقيَّدون', students.c ?? 0, { hint: `${students.a ?? 0} على رأس الدراسة` }),
    k('faculties', 'الكليات والمعاهد', f ? 1 : byFaculty.filter((x) => x.id).length),
    k('courses', 'المقررات', courses.reduce((s, r) => s + r[1], 0)),
    k('requests', 'الطلبات', rq.c ?? 0, { hint: `${rq.rv ?? 0} قيد المراجعة`, spark: reqByMonth.map((r) => r[1]) }),
    k('sla', 'طلبات متأخرة عن المدة', late, { tone: late ? 'bad' : 'ok' }),
    k('avgApproval', 'متوسط زمن الاعتماد', rq.avg ? round1(rq.avg / 3600000) : null, { unit: 'ساعة' }),
    k('passRate', 'نسبة النجاح', gs.c ? pct(gs.p, gs.c) : null, { unit: '%', hint: `${gs.c} علامة` }),
    k('avgMark', 'متوسط العلامات', gs.c ? round1(gs.a) : null),
    k('complaints', 'شكاوى مفتوحة', (cmp.find((r) => r[0] === CL.open) ?? [0, 0])[1], { tone: 'warn' }),
    k('documents', 'وثائق صادرة موقَّعة', docs),
    k('news', 'الأخبار المنشورة', news),
  ];
  const T = (id, title, type, headers, rows, extra = {}) => ({ id, title, type, headers, rows, ...extra });
  const tables = [
    T('byFaculty', 'الطلاب حسب الكلية / المعهد', 'bar', ['الجهة', 'الطلاب'], byFaculty.map((r) => [r.n, r.c]), { ids: byFaculty.map((r) => r.id), codes: byFaculty.map((r) => r.code), selectable: true }),
    T('byStatus', 'حالة القيد', 'donut', ['الحالة', 'الطلاب'], groupBy('sp.status', (v) => STATUS_LABEL[v] ?? v)),
    T('byGender', 'التوزيع حسب الجنس', 'donut', ['الجنس', 'الطلاب'], groupBy('sp.gender')),
    T('byYear', 'الطلاب حسب سنة القيد', 'bar', ['سنة القيد', 'الطلاب'], byYear, { selectable: 'year' }),
    T('byLevel', 'الطلاب حسب السنة الدراسية', 'bar', ['السنة الدراسية', 'الطلاب'], byLevel),
    T('byGovernorate', 'الطلاب حسب محافظة السكن', 'hbar', ['المحافظة', 'الطلاب'], groupBy('sp.governorate', (v) => v, 8)),
    T('byAdmission', 'الطلاب حسب نوع القبول', 'hbar', ['نوع القبول', 'الطلاب'], groupBy('sp.admission_type', (v) => v, 6)),
    T('regByMonth', 'التسجيل الجديد (آخر 12 شهراً)', 'line', ['الشهر', 'طلاب جدد'], regByMonth),
    T('reqByMonth', 'الطلبات حسب الشهر (آخر 12 شهراً)', 'line', ['الشهر', 'الطلبات المقدَّمة', 'المعتمدة'], reqByMonth),
    T('reqByService', 'الطلبات حسب نوع الخدمة والحالة', 'stack', ['الخدمة', 'قيد المراجعة', 'معتمدة', 'مرفوضة'], byService),
    T('reqByUnit', 'الطلبات قيد المراجعة حسب الوحدة الحالية', 'hbar', ['الوحدة', 'الطلبات'], byUnit),
    T('gradeDist', 'توزيع العلامات', 'bar', ['الفئة', 'عدد العلامات'], dist),
    T('gradeByFaculty', 'متوسط العلامات ونسبة النجاح حسب الجهة', 'hbar', ['الجهة', 'متوسط العلامات', 'نسبة النجاح %'], gradeByFaculty),
    T('courseByFaculty', 'المقررات حسب الجهة', 'hbar', ['الجهة', 'المقررات'], courses),
    T('complaints', 'الشكاوى حسب الحالة', 'donut', ['الحالة', 'الشكاوى'], cmp),
  ];
  return { generatedAt: now.getTime(), filter: { faculty: f, year: y }, kpis, tables };
}
