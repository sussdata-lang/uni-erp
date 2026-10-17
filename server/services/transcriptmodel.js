// نموذج عرض كشف العلامات: يحوّل لقطة الوثيقة (payload) إلى بنية جاهزة للرسم في الواجهة وفي ملف PDF، فيتطابق الشكلان.
// قواعد العرض:
//  - تُدرج كل السنوات من الأولى حتى سنة الطالب الحالية (أو أعلى سنة فيها علامات) فلا تغيب سنة سابقة؛
//  - المقررات المنهجية التي لم تُرصد علامتها بعد تظهر بحالة «لم تُرصد» ولا تدخل في المعدل؛
//  - وثائق قديمة بلا سنة/فصل: تُستنتج السنة من العام الدراسي، وإلا تُجمع بالعام الدراسي نفسه.
export const PASS = 60;
const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
export const levelName = (n) => `السنة ${LV[n - 1] || n}`;
export const SEMESTER = { 1: 'الفصل الأول', 2: 'الفصل الثاني' };
export const STATUS = { active: 'مقيَّد', suspended: 'موقوف القيد', withdrawn: 'منسحب', transferred: 'محوَّل', graduated: 'متخرج' };
export const ratingOf = (m) => (m === null || m === undefined ? null : m >= 90 ? 'ممتاز' : m >= 80 ? 'جيد جداً' : m >= 70 ? 'جيد' : m >= PASS ? 'مقبول' : 'راسب');
const r1 = (n) => Math.round(n * 10) / 10;
const wavg = (rows) => { const g = rows.filter((r) => r.mark !== null && !r.prev); const h = g.reduce((s, r) => s + r.hours, 0); return h ? r1(g.reduce((s, r) => s + r.hours * r.mark, 0) / h) : null; };
const ayStart = (ay) => { const m = /^(\d{4})/.exec(ay || ''); return m ? Number(m[1]) : null; };

export function buildView(payload) {
  const st = payload.student || {}, tr = payload.transcript || { grades: [] };
  const rows = (tr.grades || []).map((g) => ({
    course: g.course, code: g.code || '', hours: Number(g.hours) || 0, theory: g.theory ?? null, practical: g.practical ?? null,
    mark: g.pending || g.mark === null || g.mark === undefined ? null : Number(g.mark), pending: !!g.pending, prev: !!g.previous,
    level: g.level || 0, semester: g.semester || 0, ay: g.academicYear || (/^(\d{4}\/\d{4})/.exec(g.term || '') || [])[1] || '',
  }));
  // وثائق قديمة: السنة من العام الدراسي بالنسبة لسنة القيد (إن أمكن)
  const known = rows.some((r) => r.level);
  if (!known) for (const r of rows) { const s = ayStart(r.ay); if (s && st.enrollYear) { const lv = s - st.enrollYear + 1; if (lv >= 1 && lv <= (st.years || 7)) r.level = lv; } }
  const sem = (r) => r.semester || Number((/-([12])$/.exec(r.term || '') || [])[1]) || 0;
  const maxLvl = Math.max(0, ...rows.map((r) => r.level));
  const upTo = Math.min(st.years || 7, Math.max(st.level || 0, maxLvl));
  const groups = new Map();
  const put = (key, meta, r) => { if (!groups.has(key)) groups.set(key, { ...meta, rows: [] }); if (r) groups.get(key).rows.push(r); };
  for (let l = 1; l <= upTo; l++) put(`L${l}`, { level: l, label: levelName(l) });
  for (const r of rows) {
    if (r.level) put(`L${r.level}`, { level: r.level, label: levelName(r.level) }, r);
    else put(`A${r.ay || '-'}`, { level: 0, label: r.ay ? `العام الدراسي ${r.ay}` : 'سجل إضافي' }, r);
  }
  const years = [...groups.values()].sort((a, b) => (a.level || 99) - (b.level || 99) || String(a.label).localeCompare(String(b.label))).map((g) => {
    const bySem = new Map();
    for (const r of g.rows) { const k = sem(r) || 0; if (!bySem.has(k)) bySem.set(k, []); bySem.get(k).push(r); }
    const terms = [...bySem.entries()].sort((a, b) => a[0] - b[0]).map(([k, rs]) => ({ label: SEMESTER[k] || 'المقررات', rows: rs.sort((a, b) => a.course.localeCompare(b.course, 'ar') || Number(a.prev) - Number(b.prev)), hours: rs.filter((r) => r.mark !== null && !r.prev).reduce((s, r) => s + r.hours, 0), avg: wavg(rs) }));
    const cur = g.rows.filter((r) => r.mark !== null && !r.prev);
    const ays = cur.map((r) => r.ay).filter(Boolean), ay = ays.sort((a, b) => ays.filter((x) => x === b).length - ays.filter((x) => x === a).length)[0] || '';
    return { level: g.level, label: g.label, ay, terms, empty: !g.rows.length, courses: cur.length, passed: cur.filter((r) => r.mark >= PASS).length, failed: cur.filter((r) => r.mark < PASS).length,
      pending: g.rows.filter((r) => r.pending).length, hours: cur.reduce((s, r) => s + r.hours, 0), earned: cur.filter((r) => r.mark >= PASS).reduce((s, r) => s + r.hours, 0), avg: wavg(g.rows) };
  });
  const cur = rows.filter((r) => r.mark !== null && !r.prev), avg = tr.average ?? wavg(rows);
  const prog = st.programName ? `${st.degree ? st.degree + ' ' : ''}${st.programName === st.faculty ? '' : st.programName}`.trim() || st.programName : st.program;
  const info = [['الرقم الجامعي', st.studentNo], ['الكلية / المعهد', st.faculty], ['البرنامج', prog], ['السنة الدراسية الحالية', st.level ? levelName(st.level) : ''], ['سنة القيد', st.enrollYear], ['حالة القيد', STATUS[st.status] || '']]
    .filter((x) => x[1] !== '' && x[1] !== null && x[1] !== undefined);
  return { university: payload.university, name: st.name, studentNo: st.studentNo, faculty: st.faculty || '', program: prog || '', info, years,
    summary: { courses: cur.length, passed: cur.filter((r) => r.mark >= PASS).length, failed: cur.filter((r) => r.mark < PASS).length, pending: rows.filter((r) => r.pending).length,
      hours: cur.reduce((s, r) => s + r.hours, 0), earned: cur.filter((r) => r.mark >= PASS).reduce((s, r) => s + r.hours, 0), avg, rating: ratingOf(avg) || '—' } };
}
