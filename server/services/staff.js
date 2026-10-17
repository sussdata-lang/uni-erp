/* واجهة الموظف: المواد، العلامات (بمراحل الاعتماد)، جدول أسماء الطلاب الشامل وسجل الطالب الموحد، والأخبار والشكاوى */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
  const defYear = () => { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${y + 1}`; };
  const WF_BADGE = { draft: ['p-review', 'مدخلة'], reviewed: ['p-review', 'مراجَعة'], approved: ['p-approved', 'معتمدة'] };

  const A = { tab: 'courses', programs: [], courses: [], cf: null, gt: null, st: null, modal: null, news: [], cmps: [], cfilter: 'open', csel: null, nedit: null };
  const cfDef = () => ({ q: '', faculty: '', program: '', level: '', semester: '', status: '', sort: 'faculty', dir: 'asc', page: 1, size: 25 });
  const gtDef = () => ({ q: '', faculty: '', level: '', semester: '', year: '', status: '', workflow: '', sort: 'enteredAt', dir: 'desc', page: 1, size: 25, data: null, err: '' });
  const stDef = () => ({ q: '', faculty: '', program: '', level: '', year: '', status: '', sort: 'createdAt', dir: 'desc', page: 1, size: 25, data: null, err: '' });
  A.cf = cfDef(); A.gt = gtDef(); A.st = stDef();
  UA.reset = () => { Object.assign(A, { tab: 'courses', courses: [], modal: null, news: [], cmps: [], csel: null, nedit: null }); A.cf = cfDef(); A.gt = gtDef(); A.st = stDef(); };

  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const prog = (id) => A.programs.find((p) => String(p.id) === String(id));
  const yrs = (pid) => (prog(pid) || {}).years || 4;
  const facs = () => { const m = new Map(); for (const p of A.programs) if (p.facultyId) m.set(p.facultyId, p.faculty); return [...m].map(([id, name]) => ({ id, name })); };
  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const lvlList = (n) => Array.from({ length: n }, (_, i) => [i + 1, 'السنة ' + (LV[i] || (i + 1))]);
  const pill = (ok, a, b) => `<span class="pill ${ok ? 'p-approved' : 'p-rejected'}">${ok ? a : b}</span>`;
  const sortTh = (st, k, label, act) => `<th aria-sort="${st.sort === k ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-act="${act}" data-k="${k}">${label}<span class="arr">${st.sort === k ? (st.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const pager = (page, pages, total, size, act, sizeAttr) => `<div class="pager no-print"><span class="small">${total} نتيجة</span><span class="pg-ctl"><button class="btn sm" data-act="${act}" data-p="${page - 1}"${page <= 1 ? ' disabled' : ''}>‹ السابق</button><span>صفحة ${page} من ${pages}</span><button class="btn sm" data-act="${act}" data-p="${page + 1}"${page >= pages ? ' disabled' : ''}>التالي ›</button></span>
    <label class="small">الصفوف <select ${sizeAttr}>${[25, 50, 100].map((n) => `<option${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;

  async function loadCourses() { A.courses = (await api('GET', '/api/courses')).courses; }
  UA.loaders.academics = async () => {
    if (!A.programs.length) A.programs = (await api('GET', '/api/programs')).programs.filter((p) => p.active);
    await loadCourses();
    if (A.tab === 'grades') await loadGrades();
    if (A.tab === 'students') await loadStudentsTable();
  };

  function viewCourses() {
    const f = A.cf, term = f.q.trim().toLowerCase();
    let rows = A.courses.filter((c) => (!f.faculty || String(c.facultyId) === f.faculty) && (!f.program || String(c.programId) === f.program) && (!f.level || String(c.level) === f.level) && (!f.semester || String(c.semester) === f.semester)
      && (!f.status || (f.status === 'on' ? c.active : !c.active)) && (!term || [c.name, c.code, c.instructor, c.faculty, c.program].some((x) => String(x || '').toLowerCase().includes(term))));
    const pages = Math.max(1, Math.ceil(rows.length / f.size)), page = Math.min(f.page, pages), shown = rows.slice((page - 1) * f.size, page * f.size);
    return { rows, shown, pages, page };
  }
  function courseRows(v) {
    return v.shown.map((c) => `<tr${c.active ? '' : ' class="off"'}><td class="nm">${esc(c.faculty || '—')}</td><td>${esc(c.program === c.faculty ? '—' : c.program || '—')}</td><td class="nowrap">${LV[c.level - 1] || c.level}</td><td class="nowrap">${c.semester === 1 ? 'الأول' : 'الثاني'}</td><td class="nm"><b>${esc(c.name)}</b></td><td class="mono">${esc(c.code || '—')}</td><td>${c.hours}</td><td>${esc(c.instructor || '—')}</td><td>${c.grades}</td>
      <td>${pill(c.active, 'فعّال', 'معطَّل')}</td><td class="nowrap"><button class="btn sm" data-act="acedit" data-id="${c.id}">تعديل</button> <button class="btn sm" data-act="actoggle" data-id="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm bad" data-act="acdel" data-id="${c.id}">حذف</button></td></tr>`).join('')
      || '<tr><td colspan="11" class="empty">لا مقررات مطابقة.</td></tr>';
  }
  function courseTable() {
    const v = viewCourses(), f = A.cf;
    return `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh(f, 'faculty', 'الكلية', 'crsort')}${sortTh(f, 'program', 'البرنامج', 'crsort')}${sortTh(f, 'level', 'السنة', 'crsort')}${sortTh(f, 'semester', 'الفصل', 'crsort')}${sortTh(f, 'name', 'المقرر', 'crsort')}${sortTh(f, 'code', 'الرمز', 'crsort')}${sortTh(f, 'hours', 'الساعات', 'crsort')}${sortTh(f, 'instructor', 'المدرّس', 'crsort')}${sortTh(f, 'grades', 'العلامات', 'crsort')}${sortTh(f, 'active', 'الحالة', 'crsort')}<th></th></tr></thead>
      <tbody id="cr-body">${courseRows(v)}</tbody></table></div>${pager(v.page, v.pages, v.rows.length, f.size, 'crpage', 'data-cf="size"')}`;
  }
  function coursesTab() {
    const f = A.cf, progs = A.programs.filter((p) => !f.faculty || String(p.facultyId) === f.faculty);
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">دليل المواد <span class="small">(${A.courses.length} مقرر)</span></h2><button class="btn pri" data-act="acnew">＋ إضافة مقرر</button></div>
      <div class="filters no-print"><label class="grow">بحث<input data-cf="q" id="cf-q" value="${esc(f.q)}" placeholder="اسم المقرر، الرمز…" maxlength="60"></label>
        <label>الكلية<select data-cf="faculty">${opts(facs().map((x) => [x.id, x.name]), f.faculty, 'الكل')}</select></label>
        <label>البرنامج<select data-cf="program">${opts(progs.map((p) => [p.id, p.label || p.name]), f.program, 'الكل')}</select></label>
        <label>السنة<select data-cf="level">${opts(lvlList(4), f.level, 'الكل')}</select></label>
        <label>الفصل<select data-cf="semester">${opts([[1, 'الأول'], [2, 'الثاني']], f.semester, 'الكل')}</select></label>
        <label>الحالة<select data-cf="status">${opts([['on', 'فعّال'], ['off', 'معطَّل']], f.status, 'الكل')}</select></label></div>
      <div id="cr-table">${courseTable()}</div></section>`;
  }
  const refreshCourses = () => { const el = document.getElementById('cr-table'); if (el) el.innerHTML = courseTable(); };

  async function loadGrades() {
    const g = A.gt, q = new URLSearchParams(); for (const k of ['q', 'faculty', 'level', 'semester', 'year', 'status', 'workflow', 'sort', 'dir', 'page', 'size']) if (g[k]) q.set(k, g[k]);
    try { g.data = await api('GET', '/api/grades?' + q); g.err = ''; if (g.data.page !== g.page) g.page = g.data.page; } catch (e) { if (!e.status) throw e; g.err = e.message; }
  }
  function gradeRows(d) {
    return d.rows.map((x) => {
      const wf = WF_BADGE[x.workflowStatus || 'draft'] || WF_BADGE.draft;
      const nextBtn = x.workflowStatus === 'draft'
        ? `<button class="btn sm" data-act="gtwf" data-id="${x.id}" data-stage="reviewed">مراجعة ✓</button>`
        : x.workflowStatus === 'reviewed'
        ? `<button class="btn sm ok" data-act="gtwf" data-id="${x.id}" data-stage="approved">اعتماد 🔒</button>`
        : '';
      return `<tr><td class="mono nowrap">${esc(x.studentNo)}</td><td class="nm"><button class="link" data-act="strecord" data-id="${x.studentId}">${esc(x.studentName)}</button></td><td class="nm">${esc(x.faculty)}</td><td class="nm"><b>${esc(x.course)}</b></td><td class="nowrap">${x.level ? (LV[x.level - 1] || x.level) : '—'}</td><td class="mono">${esc(x.academicYear || '—')}</td>
        <td>${x.theory ?? '—'}</td><td>${x.practical ?? '—'}</td><td><b>${x.total}</b></td><td>${pill(x.passed, 'ناجح', 'راسب')}</td><td><span class="pill ${wf[0]}">${wf[1]}</span></td>
        <td class="nowrap">${nextBtn} <button class="btn sm" data-act="gtedit" data-id="${x.id}">تعديل</button> <button class="btn sm bad" data-act="gtdel" data-id="${x.id}">حذف</button></td></tr>`;
    }).join('') || '<tr><td colspan="12" class="empty">لا علامات مطابقة.</td></tr>';
  }
  function gradeTable() {
    const g = A.gt, d = g.data; if (!d) return `<div class="empty">${esc(g.err || 'جارٍ التحميل…')}</div>`;
    const s = d.summary;
    return `<div class="imp-sum gt-sum"><div class="stat"><small>العلامات</small><b>${s.count}</b></div><div class="stat"><small>الطلاب</small><b>${s.students}</b></div><div class="stat"><small>المتوسط</small><b>${s.average ?? '—'}</b></div><div class="stat"><small>النجاح</small><b>${s.passRate === null ? '—' : s.passRate + '%'}</b></div></div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh(g, 'studentNo', 'الرقم', 'gtsort')}${sortTh(g, 'studentName', 'الطالب', 'gtsort')}${sortTh(g, 'faculty', 'الكلية', 'gtsort')}${sortTh(g, 'course', 'المقرر', 'gtsort')}${sortTh(g, 'level', 'السنة', 'gtsort')}${sortTh(g, 'academicYear', 'العام', 'gtsort')}<th>نظري</th><th>عملي</th>${sortTh(g, 'total', 'المجموع', 'gtsort')}${sortTh(g, 'status', 'النتيجة', 'gtsort')}<th>الاعتماد</th><th></th></tr></thead>
      <tbody>${gradeRows(d)}</tbody></table></div>${pager(d.page, d.pages, d.total, d.size, 'gtpage', 'data-gt="size"')}`;
  }
  function gradesTab() {
    const g = A.gt, o = (g.data && g.data.options) || { faculties: [], years: [] };
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">جدول العلامات واعتمادها</h2><div class="actions" style="margin:0"><button class="btn sm" data-act="gtwfall" data-stage="reviewed">مراجعة الصفحة</button> <button class="btn sm ok" data-act="gtwfall" data-stage="approved">اعتماد الصفحة 🔒</button> <button class="btn pri" data-act="gtnew">＋ إدخال علامات</button></div></div>
      <div class="filters no-print"><label class="grow">بحث<input data-gt="q" id="gt-q" value="${esc(g.q)}" placeholder="اسم الطالب، الرقم، المادة…" maxlength="80"></label>
        <label>الكلية<select data-gt="faculty">${opts(o.faculties.map((x) => [x.id, x.name]), g.faculty, 'الكل')}</select></label>
        <label>السنة<select data-gt="level">${opts(lvlList(4), g.level, 'الكل')}</select></label>
        <label>العام<select data-gt="year">${opts(o.years.map((y) => [y, y]), g.year, 'الكل')}</select></label>
        <label>الاعتماد<select data-gt="workflow">${opts([['draft', 'مدخلة'], ['reviewed', 'مراجَعة'], ['approved', 'معتمدة']], g.workflow, 'الكل')}</select></label></div>
      <div id="gt-table">${gradeTable()}</div></section>`;
  }
  const refreshGrades = () => { const el = document.getElementById('gt-table'); if (el) el.innerHTML = gradeTable(); };

  async function loadStudentsTable() {
    const s = A.st, q = new URLSearchParams({ full: '1' });
    for (const k of ['q', 'faculty', 'program', 'level', 'year', 'status', 'sort', 'dir', 'page', 'size']) if (s[k]) q.set(k, s[k]);
    try { s.data = await api('GET', '/api/students?' + q); s.err = ''; } catch (e) { if (!e.status) throw e; s.err = e.message; }
  }
  function studentRows(d) {
    return (d.students || []).map((s) => {
      const p = s.profile || {}, at = s.attachments || {};
      const attHtml = [
        at.personalId ? `<a class="btn sm" href="${esc(at.personalId)}" target="_blank" title="الهوية">🪪</a>` : '',
        at.photo ? `<a class="btn sm" href="${esc(at.photo)}" target="_blank" title="الصورة">🖼️</a>` : '',
        at.other ? `<a class="btn sm" href="${esc(at.other)}" target="_blank" title="مرفقات">📎</a>` : '',
      ].filter(Boolean).join(' ') || '—';
      return `<tr><td class="mono nowrap">${esc(s.studentNo)}</td><td class="nm"><button class="link" data-act="strecord" data-id="${s.id}"><b>${esc(s.name)}</b></button></td><td>${esc(p.mother_name || '—')}</td><td class="mono">${esc(s.nationalId || '—')}</td><td class="nm">${esc(s.program?.faculty || '—')}</td><td class="nowrap">${esc(s.levelLabel)}</td><td class="mono">${esc(s.phone || '—')}</td><td>${attHtml}</td><td><span class="pill ${s.status === 'active' ? 'p-approved' : 'p-review'}">${esc(s.statusLabel)}</span></td><td class="nowrap"><button class="btn sm pri" data-act="strecord" data-id="${s.id}">السجل 360°</button></td></tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">لا يوجد طلاب.</td></tr>';
  }
  function studentsTableHtml() {
    const s = A.st, d = s.data; if (!d) return `<div class="empty">${esc(s.err || 'جارٍ التحميل…')}</div>`;
    const pages = d.pages || Math.max(1, Math.ceil((d.total || 0) / s.size)), page = d.page || s.page;
    return `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh(s, 'studentNo', 'الرقم', 'stsort')}${sortTh(s, 'name', 'اسم الطالب', 'stsort')}<th>الأم</th><th>الوطني</th>${sortTh(s, 'faculty', 'الكلية', 'stsort')}${sortTh(s, 'level', 'السنة', 'stsort')}<th>الهاتف</th><th>المرفقات</th>${sortTh(s, 'status', 'الحالة', 'stsort')}<th></th></tr></thead><tbody>${studentRows(d)}</tbody></table></div>${pager(page, pages, d.total || 0, s.size, 'stpage', 'data-st="size"')}`;
  }
  function studentsTab() {
    const s = A.st, o = (s.data && s.data.options) || { faculties: facs(), years: [], statuses: {} };
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">سجل الطلاب الكامل <span class="small">(${(s.data && s.data.total) || 0})</span></h2><a class="btn sm" href="/api/export/students?format=xlsx" download>تصدير Excel</a></div>
      <div class="filters no-print"><label class="grow">بحث<input data-st="q" id="st-q" value="${esc(s.q)}" placeholder="الاسم، الرقم، الهاتف…" maxlength="80"></label></div>
      <div id="st-table">${studentsTableHtml()}</div></section>`;
  }
  const refreshStudents = () => { const el = document.getElementById('st-table'); if (el) el.innerHTML = studentsTableHtml(); };

  function courseModal(m) {
    const ce = m.edit ? A.courses.find((c) => c.id === m.edit) : null, fl = facs(), dr = m.d || {};
    const fid = ce ? ce.facultyId : (m.faculty || (fl[0] && fl[0].id) || ''), plist = A.programs.filter((p) => String(p.facultyId) === String(fid)), pid = ce ? ce.programId : (m.program && plist.some((p) => String(p.id) === String(m.program)) ? m.program : (plist[0] && plist[0].id));
    return `<h2 id="mttl">${ce ? 'تعديل مقرر' : 'إضافة مقرر'}</h2><form class="form" id="acadd" style="border:0;margin:0;padding:0">
      <div class="two"><label>الكلية<select id="ac-nfac"${ce ? ' disabled' : ''} data-mc="fac">${opts(fl.map((x) => [x.id, x.name]), fid)}</select></label>
        <label>البرنامج<select id="ac-nprog"${ce ? ' disabled' : ''} data-mc="prog">${opts(plist.map((p) => [p.id, p.label || p.name]), pid)}</select></label></div>
      <div class="two"><label>السنة<select id="ac-nlvl">${opts(lvlList(yrs(pid)), ce ? ce.level : (dr.lvl || 1))}</select></label><label>الفصل<select id="ac-nsem">${opts([[1, 'الأول'], [2, 'الثاني']], ce ? ce.semester : (dr.sem || 1))}</select></label></div>
      <label>اسم المقرر<input id="ac-nname" maxlength="100" required value="${ce ? esc(ce.name) : esc(dr.name || '')}"></label>
      <div class="two"><label>الساعات<input id="ac-nhours" type="number" min="0" max="12" value="${ce ? ce.hours : (dr.hours || 3)}"></label><label>الرمز<input id="ac-ncode" maxlength="20" dir="ltr" value="${ce ? esc(ce.code || '') : esc(dr.code || '')}"></label></div>
      <div class="actions"><button class="btn pri" type="submit">${ce ? 'حفظ' : 'إضافة'}</button><button class="btn" type="button" data-act="mclose">إلغاء</button></div></form>`;
  }
  function gradeModal(m) {
    const st = m.student, edit = !!m.edit;
    let body;
    if (!st) {
      const found = m.found ? `<ul class="mini-list">${m.found.length ? m.found.map((s) => `<li><button class="link" data-act="gmpick" data-id="${s.id}">${esc(s.name)} · <span class="mono">${esc(s.studentNo)}</span></button></li>`).join('') : '<li class="empty">لا نتائج.</li>'}</ul>` : '';
      body = `<form class="inline-form" id="gmsearch"><label class="grow">بحث عن طالب<input id="gm-q" value="${esc(m.q || '')}" maxlength="60" autofocus></label><button class="btn pri" type="submit">بحث</button></form>${found}`;
    } else {
      body = `<div class="me"><div class="avatar">${esc(st.name[0])}</div><div><b>${esc(st.name)}</b><small class="mono">${esc(st.studentNo)}</small></div>${edit ? '' : '<button class="btn sm" type="button" data-act="gmchange">تغيير</button>'}</div>
        <form class="form" id="acgrade" style="border:0;padding:0;margin-top:10px"><label>المقرر<select id="gr-course" required${edit ? ' disabled' : ''}><option value="">— اختر —</option>${m.courses.map((c) => `<option value="${c.id}"${String(c.id) === String(m.courseId \vert{}\vert{} '') ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <div class="two"><label>العام<input id="gr-year" value="${esc(m.year || defYear())}" dir="ltr" required${edit ? ' readonly' : ''}></label><span></span></div>
          <div class="two"><label>نظري<input id="gr-th" type="number" min="0" max="100" required value="${m.th ?? ''}"></label><label>عملي<input id="gr-pr" type="number" min="0" max="100" value="${m.pr ?? ''}"></label></div>
          ${edit && m.workflowStatus === 'approved' ? `<label>تبرير تعديل علامة معتمدة<textarea id="gr-just" rows="2" required minlength="5">${esc(m.just || '')}</textarea></label>` : ''}
          <div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="mclose">إلغاء</button></div></form>`;
    }
    return `<h2 id="mttl">${edit ? 'تعديل علامة' : 'إدخال علامات'}</h2>${body}`;
  }

  function unifiedRecordModal(m) {
    const r = m.record;
    if (!r) return `<h2 id="mttl">سجل الطالب</h2><div class="empty">جارٍ التحميل…</div>`;
    const st = r.student, sm = r.academicSummary || {}, al = sm.academicAlert;
    return `<div class="tool-row"><h2 id="mttl">سجل الطالب 360° — ${esc(st.name)} (<span class="mono">${esc(st.studentNo)}</span>)</h2><button class="btn sm" data-act="mclose">✕</button></div>
      ${al && al.message ? `<div class="reason" style="margin-block:10px">⚠️ <b>${esc(al.label)}:</b>${esc(al.message)}</div>` : ''}
      <div class="stats" style="margin-block:12px">
        <div class="stat"><small>المعدل</small><b>${sm.gpa ?? '—'}%</b></div>
        <div class="stat"><small>الترتيب</small><b>${sm.cohortRank ? `${sm.cohortRank} /${sm.cohortTotal}` : '—'}</b></div>
        <div class="stat"><small>الساعات</small><b>${sm.earnedHours || 0} / ${sm.totalHours || 0}</b></div>
      </div>`;
  }

  function modalHtml() {
    const m = A.modal; if (!m) return '';
    const inner = m.type === 'course' ? courseModal(m) : m.type === 'strecord' ? unifiedRecordModal(m) : gradeModal(m);
    return `<div class="modal-back" data-act="mclose"><div class="modal" role="dialog" aria-modal="true" style="${m.type === 'strecord' ? 'max-width:860px;width:95%' : ''}">${inner}</div></div>`;
  }

  UA.views.academics = () => bar([['courses', 'دليل المواد'], ['grades', 'جدول العلامات'], ['students', 'الطلاب']], A.tab, 'actab')
    + (A.tab === 'courses' ? coursesTab() : A.tab === 'grades' ? gradesTab() : studentsTab()) + modalHtml();

  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.cf === 'q') { A.cf.q = t.value; A.cf.page = 1; refreshCourses(); }
    else if (t.dataset.gt === 'q') { A.gt.q = t.value; A.gt.page = 1; clearTimeout(timer); timer = setTimeout(async () => { await loadGrades(); refreshGrades(); }, 280); }
    else if (t.dataset.st === 'q') { A.st.q = t.value; A.st.page = 1; clearTimeout(timer); timer = setTimeout(async () => { await loadStudentsTable(); refreshStudents(); }, 280); }
  });

  async function pickStudent(id) {
    const m = A.modal; m.student = (await api('GET', '/api/students/' + id)).student; m.err = ''; m.msg = '';
    m.courses = (await api('GET', '/api/courses?program=' + m.student.program.id)).courses.filter((c) => c.active);
  }

  Object.assign(UA.actions, {
    actab: async (el, d) => { A.tab = d.t; A.modal = null; if (d.t === 'grades' && !A.gt.data) await loadGrades(); if (d.t === 'students' && !A.st.data) await loadStudentsTable(); UA.render(); },
    mclose: async (el, d, e) => { if (e && e.target.closest('.modal') && el.classList.contains('modal-back')) return; A.modal = null; UA.render(); },
    stsort: async (el, d) => { A.st.dir = A.st.sort === d.k && A.st.dir === 'asc' ? 'desc' : 'asc'; A.st.sort = d.k; A.st.page = 1; await loadStudentsTable(); UA.render(); },
    stpage: async (el, d) => { A.st.page = Number(d.p); await loadStudentsTable(); UA.render(); },
    strecord: async (el, d) => {
      A.modal = { type: 'strecord', record: null }; UA.render();
      try { A.modal.record = await api('GET', `/api/students/${d.id}/unified-record`); UA.render(); }
      catch (e) { A.modal = null; toast(e.message || 'تعذّر جلب السجل'); UA.render(); }
    },
    crsort: async (el, d) => { A.cf.dir = A.cf.sort === d.k && A.cf.dir === 'asc' ? 'desc' : 'asc'; A.cf.sort = d.k; UA.render(); },
    crpage: async (el, d) => { A.cf.page = Number(d.p); UA.render(); },
    acnew: async () => { A.modal = { type: 'course', edit: null, faculty: A.cf.faculty, program: A.cf.program }; UA.render(); },
    gtsort: async (el, d) => { A.gt.dir = A.gt.sort === d.k ? (A.gt.dir === 'asc' ? 'desc' : 'asc') : 'desc'; A.gt.sort = d.k; A.gt.page = 1; await loadGrades(); UA.render(); },
    gtpage: async (el, d) => { A.gt.page = Number(d.p); await loadGrades(); UA.render(); },
    gtnew: async () => { A.modal = { type: 'grade', student: null, found: null, q: '' }; UA.render(); },
    gtedit: async (el, d) => {
      const x = A.gt.data.rows.find((r) => r.id === Number(d.id)); if (!x) return;
      A.modal = { type: 'grade', edit: x.id, student: null, courseId: x.courseId, year: x.academicYear, th: x.theory, pr: x.practical, workflowStatus: x.workflowStatus }; await pickStudent(x.studentId); UA.render();
    },
    gtdel: async (el, d) => {
      const x = A.gt.data.rows.find((r) => r.id === Number(d.id)); if (!x) return;
      let just = '';
      if (x.workflowStatus === 'approved') {
        just = prompt(`العلامة معتمدة نهائياً. أدخل تبرير الحذف:`) || '';
        if (just.trim().length < 5) { toast('يُمنع الحذف بدون تبرير'); return; }
      } else if (!confirm('حذف العلامة؟')) return;
      try { await api('DELETE', `/api/students/${x.studentId}/grades/${x.id}?justification=${encodeURIComponent(just)}`); await loadGrades(); UA.render(); toast('حُذفت'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gtwf: async (el, d) => {
      try { await api('POST', '/api/grades/workflow', { gradeIds: [Number(d.id)], stage: d.stage }); await loadGrades(); UA.render(); toast('تم التحديث'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gmpick: async (el, d) => { await pickStudent(d.id); UA.render(); },
  });

  Object.assign(UA.forms, {
    acadd: async () => {
      const m = A.modal, body = { level: Number(val('ac-nlvl')), semester: Number(val('ac-nsem')), name: val('ac-nname'), hours: Number(val('ac-nhours')), code: val('ac-ncode') };
      try {
        if (m.edit) { await api('PUT', '/api/courses/' + m.edit, body); toast('حُفظ'); }
        else { await api('POST', '/api/courses', { programId: Number(val('ac-nprog')), ...body }); toast('أُضيف'); }
        A.modal = null; await loadCourses(); UA.render();
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gmsearch: async () => { const q = val('gm-q').trim(); A.modal.q = q; A.modal.found = (await api('GET', '/api/students?' + new URLSearchParams({ q }))).students.slice(0, 10); UA.render(); },
    acgrade: async () => {
      const m = A.modal, courseId = m.edit ? m.courseId : Number(val('gr-course'));
      const justEl = document.getElementById('gr-just'), justification = justEl ? justEl.value : '';
      try {
        await api('POST', `/api/students/${m.student.id}/grades`, { courseId, academicYear: val('gr-year'), theory: val('gr-th'), practical: val('gr-pr'), justification });
        await loadGrades(); A.modal = null; UA.render(); toast('حُفظت العلامة');
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
})();
