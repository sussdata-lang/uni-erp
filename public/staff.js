/* واجهة الموظف: المواد والعلامات، والأخبار والشكاوى (تُضاف إلى نواة app.js عبر UA) */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
  const lvl = (n) => 'السنة ' + (LV[n - 1] || n);
  const sem = (n) => (n === 1 ? 'الفصل الأول' : 'الفصل الثاني');
  const defYear = () => { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${y + 1}`; };

  const A = { tab: 'courses', programs: [], courses: [], cf: null, gt: null, modal: null, news: [], cmps: [], cfilter: 'open', csel: null, nedit: null };
  const DAYN = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  const cfDef = () => ({ q: '', faculty: '', program: '', level: '', semester: '', status: '', sort: 'faculty', dir: 'asc', page: 1, size: 25 });
  const gtDef = () => ({ q: '', faculty: '', level: '', semester: '', year: '', status: '', workflow: '', sort: 'enteredAt', dir: 'desc', page: 1, size: 25, data: null, err: '' });
  A.cf = cfDef(); A.gt = gtDef();
  UA.reset = () => { Object.assign(A, { tab: 'courses', courses: [], modal: null, news: [], cmps: [], csel: null, nedit: null }); A.cf = cfDef(); A.gt = gtDef(); };

  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const prog = (id) => A.programs.find((p) => String(p.id) === String(id));
  const yrs = (pid) => (prog(pid) || {}).years || 4;
  const facs = () => { const m = new Map(); for (const p of A.programs) if (p.facultyId) m.set(p.facultyId, p.faculty); return [...m].map(([id, name]) => ({ id, name })); };
  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const lvlList = (n) => Array.from({ length: n }, (_, i) => [i + 1, lvl(i + 1)]);
  const pill = (ok, a, b) => `<span class="pill ${ok ? 'p-approved' : 'p-rejected'}">${ok ? a : b}</span>`;
  const sortTh = (st, k, label, act) => `<th aria-sort="${st.sort === k ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-act="${act}" data-k="${k}">${label}<span class="arr">${st.sort === k ? (st.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const pager = (page, pages, total, size, act, sizeAttr) => `<div class="pager no-print"><span class="small">${total} نتيجة</span><span class="pg-ctl"><button class="btn sm" data-act="${act}" data-p="${page - 1}"${page <= 1 ? ' disabled' : ''}>‹ السابق</button><span>صفحة ${page} من ${pages}</span><button class="btn sm" data-act="${act}" data-p="${page + 1}"${page >= pages ? ' disabled' : ''}>التالي ›</button></span>
    <label class="small">الصفوف <select ${sizeAttr}>${[25, 50, 100].map((n) => `<option${n === size ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;

  /* ---------- دليل المواد: جدول متكامل بفلترة وترتيب ---------- */
  async function loadCourses() { A.courses = (await api('GET', '/api/courses')).courses; }
  UA.loaders.academics = async () => {
    if (!A.programs.length) A.programs = (await api('GET', '/api/programs')).programs.filter((p) => p.active);
    await loadCourses();
    if (A.tab === 'grades') await loadGrades();
  };
  const CSORT = { faculty: (c) => c.faculty || '', program: (c) => c.program || '', level: (c) => c.level, semester: (c) => c.semester, name: (c) => c.name, code: (c) => c.code || '', hours: (c) => c.hours, instructor: (c) => c.instructor || '', active: (c) => (c.active ? 1 : 0), grades: (c) => c.grades };
  function viewCourses() {
    const f = A.cf, term = f.q.trim().toLowerCase();
    let rows = A.courses.filter((c) => (!f.faculty || String(c.facultyId) === f.faculty) && (!f.program || String(c.programId) === f.program) && (!f.level || String(c.level) === f.level) && (!f.semester || String(c.semester) === f.semester)
      && (!f.status || (f.status === 'on' ? c.active : !c.active)) && (!term || [c.name, c.code, c.instructor, c.faculty, c.program].some((x) => String(x || '').toLowerCase().includes(term))));
    const key = CSORT[f.sort] || CSORT.faculty, d = f.dir === 'asc' ? 1 : -1;
    rows = rows.map((c, i) => [c, i]).sort((a, b) => { const x = key(a[0]), y = key(b[0]); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * d || a[1] - b[1]; }).map((r) => r[0]);
    const pages = Math.max(1, Math.ceil(rows.length / f.size)), page = Math.min(f.page, pages), shown = rows.slice((page - 1) * f.size, page * f.size);
    return { rows, shown, pages, page };
  }
  function courseRows(v) {
    return v.shown.map((c) => `<tr${c.active ? '' : ' class="off"'}><td class="nm">${esc(c.faculty || '—')}</td><td>${esc(c.program === c.faculty ? '—' : c.program || '—')}</td><td class="nowrap">${LV[c.level - 1] || c.level}</td><td class="nowrap">${c.semester === 1 ? 'الأول' : 'الثاني'}</td><td class="nm"><b>${esc(c.name)}</b></td><td class="mono">${esc(c.code || '—')}</td><td>${c.hours}</td><td>${esc(c.instructor || '—')}</td><td>${c.grades}</td>
      <td>${pill(c.active, 'فعّال', 'معطَّل')}</td><td class="nowrap"><button class="btn sm" data-act="acedit" data-id="${c.id}">تعديل</button> <button class="btn sm" data-act="actoggle" data-id="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm bad" data-act="acdel" data-id="${c.id}">حذف</button></td></tr>`).join('')
      || '<tr><td colspan="12" class="empty">لا مقررات مطابقة. غيّر الفلاتر أو أضف مقرراً.</td></tr>';
  }
  function courseTable() {
    const v = viewCourses(), f = A.cf;
    return `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh(f, 'faculty', 'الكلية / المعهد', 'crsort')}${sortTh(f, 'program', 'البرنامج', 'crsort')}${sortTh(f, 'level', 'السنة', 'crsort')}${sortTh(f, 'semester', 'الفصل', 'crsort')}${sortTh(f, 'name', 'المقرر', 'crsort')}${sortTh(f, 'code', 'الرمز', 'crsort')}${sortTh(f, 'hours', 'الساعات', 'crsort')}${sortTh(f, 'instructor', 'المدرّس', 'crsort')}${sortTh(f, 'grades', 'العلامات', 'crsort')}${sortTh(f, 'active', 'الحالة', 'crsort')}<th></th></tr></thead>
      <tbody id="cr-body">${courseRows(v)}</tbody></table></div>${pager(v.page, v.pages, v.rows.length, f.size, 'crpage', 'data-cf="size"')}`;
  }
  function coursesTab() {
    const f = A.cf, progs = A.programs.filter((p) => !f.faculty || String(p.facultyId) === f.faculty);
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">دليل المواد <span class="small">(${A.courses.length} مقرر)</span></h2><button class="btn pri" data-act="acnew">＋ إضافة مقرر</button></div>
      <div class="filters no-print"><label class="grow">بحث<input data-cf="q" id="cf-q" value="${esc(f.q)}" placeholder="اسم المقرر، الرمز، المدرّس، الكلية…" maxlength="60"></label>
        <label>الكلية / المعهد<select data-cf="faculty">${opts(facs().map((x) => [x.id, x.name]), f.faculty, 'الكل')}</select></label>
        <label>البرنامج<select data-cf="program">${opts(progs.map((p) => [p.id, p.label || p.name]), f.program, 'الكل')}</select></label>
        <label>السنة<select data-cf="level">${opts(lvlList(4), f.level, 'الكل')}</select></label>
        <label>الفصل<select data-cf="semester">${opts([[1, 'الأول'], [2, 'الثاني']], f.semester, 'الكل')}</select></label>
        <label>الحالة<select data-cf="status">${opts([['on', 'فعّال'], ['off', 'معطَّل']], f.status, 'الكل')}</select></label>
        ${f.q || f.faculty || f.program || f.level || f.semester || f.status ? '<button class="btn sm" data-act="crclear">مسح الفلاتر</button>' : ''}</div>
      <div id="cr-table">${courseTable()}</div></section>`;
  }
  const refreshCourses = () => { const el = document.getElementById('cr-table'); if (el) el.innerHTML = courseTable(); };

  /* ---------- جدول العلامات: بحث وفلاتر وترتيب وصفحات من الخادم ---------- */
  async function loadGrades() {
    const g = A.gt, q = new URLSearchParams(); for (const k of ['q', 'faculty', 'level', 'semester', 'year', 'status', 'workflow', 'sort', 'dir', 'page', 'size']) if (g[k]) q.set(k, g[k]);
    try { g.data = await api('GET', '/api/grades?' + q); g.err = ''; if (g.data.page !== g.page) g.page = g.data.page; } catch (e) { if (!e.status) throw e; g.err = e.message; }
  }
  const WF = { draft: ['p-review', 'مدخلة'], reviewed: ['p-review', 'مراجَعة'], approved: ['p-approved', 'معتمدة'] };
  function wfCell(x, wf) {
    const w = WF[x.workflowStatus] || WF.draft, on = wf && wf.enabled, ap = UA.can('grade:approve');
    let btn = '';
    if (on && UA.can('grade:manage')) {
      if (x.workflowStatus === 'draft') btn = `<button class="btn sm" data-act="gtwf" data-id="${x.id}" data-stage="reviewed">مراجعة ✓</button>`;
      else if (x.workflowStatus === 'reviewed') btn = (ap ? `<button class="btn sm ok" data-act="gtwf" data-id="${x.id}" data-stage="approved">اعتماد 🔒</button> ` : '') + `<button class="btn sm" data-act="gtwf" data-id="${x.id}" data-stage="draft">إعادة</button>`;
      else if (ap) btn = `<button class="btn sm" data-act="gtwf" data-id="${x.id}" data-stage="reviewed">إعادة فتح</button>`;
    }
    return `<td class="nowrap"><span class="pill ${w[0]}">${w[1]}</span> ${btn}</td>`;
  }
  function gradeRows(d) {
    return d.rows.map((x) => `<tr><td class="mono nowrap">${esc(x.studentNo)}</td><td class="nm"><button class="link" data-act="strecord" data-id="${x.studentId}" title="السجل الموحّد 360°"><b>${esc(x.studentName)}</b></button></td>${wfCell(x, d.workflow)}<td class="nm">${esc(x.faculty)}</td><td class="nm"><b>${esc(x.course)}</b>${x.code ? ` <span class="mono small">${esc(x.code)}</span>` : ''}</td><td class="nowrap">${x.level ? (LV[x.level - 1] || x.level) : '—'} / ${x.semester === 1 ? 'الأول' : x.semester === 2 ? 'الثاني' : '—'}</td><td class="mono">${esc(x.academicYear || '—')}</td>
      <td>${x.theory ?? '—'}</td><td>${x.practical ?? '—'}</td><td><b>${x.total}</b></td><td>${pill(x.passed, 'ناجح', 'راسب')}</td><td class="nowrap"><button class="btn sm" data-act="gtedit" data-id="${x.id}">تعديل</button> <button class="btn sm bad" data-act="gtdel" data-id="${x.id}">حذف</button></td></tr>`).join('')
      || '<tr><td colspan="11" class="empty">لا علامات مطابقة للبحث.</td></tr>';
  }
  function gradeTable() {
    const g = A.gt, d = g.data; if (!d) return `<div class="empty">${esc(g.err || 'جارٍ التحميل…')}</div>`;
    const s = d.summary;
    return `<div class="imp-sum gt-sum"><div class="stat"><small>العلامات</small><b>${s.count}</b></div><div class="stat"><small>الطلاب</small><b>${s.students}</b></div><div class="stat"><small>المتوسط</small><b>${s.average ?? '—'}</b></div><div class="stat"><small>نسبة النجاح</small><b>${s.passRate === null ? '—' : s.passRate + '%'}</b></div></div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh(g, 'studentNo', 'الرقم الجامعي', 'gtsort')}${sortTh(g, 'studentName', 'الطالب', 'gtsort')}<th>الاعتماد</th>${sortTh(g, 'faculty', 'الكلية / المعهد', 'gtsort')}${sortTh(g, 'course', 'المقرر', 'gtsort')}${sortTh(g, 'level', 'السنة / الفصل', 'gtsort')}${sortTh(g, 'academicYear', 'العام', 'gtsort')}${sortTh(g, 'theory', 'نظري', 'gtsort')}${sortTh(g, 'practical', 'عملي', 'gtsort')}${sortTh(g, 'total', 'المجموع', 'gtsort')}${sortTh(g, 'status', 'الحالة', 'gtsort')}<th></th></tr></thead>
      <tbody>${gradeRows(d)}</tbody></table></div>${pager(d.page, d.pages, d.total, d.size, 'gtpage', 'data-gt="size"')}`;
  }
  function wfBar() {
    const d = A.gt.data, wf = d && d.workflow; if (!wf) return '';
    const n = (k) => wf[k] || 0;
    return `<div class="wf-bar no-print"><span class="small">مدخلة <b>${n('draft')}</b> · مراجَعة <b>${n('reviewed')}</b> · معتمدة <b>${n('approved')}</b></span>
      ${wf.enabled && UA.can('grade:manage') ? '<button class="btn sm" data-act="gtwfall" data-stage="reviewed">مراجعة كل المدخلة في هذه الصفحة</button>' : ''}${wf.enabled && UA.can('grade:approve') ? '<button class="btn sm ok" data-act="gtwfall" data-stage="approved">اعتماد كل المراجَعة في هذه الصفحة</button>' : ''}
      ${UA.can('grade:approve') ? `<label title="عند الإيقاف تُعدّ العلامات الجديدة معتمدة فوراً"><input type="checkbox" data-act="gtwfset"${wf.enabled ? ' checked' : ''}> تفعيل مراحل الاعتماد</label>` : ''}</div>`;
  }
  function gradesTab() {
    const g = A.gt, o = (g.data && g.data.options) || { faculties: [], years: [] };
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">جدول العلامات</h2>${UA.can('grade:manage') ? '<button class="btn pri" data-act="gtnew">＋ إدخال علامات جديدة</button>' : ''}</div>
      <div class="filters no-print"><label class="grow">بحث<input data-gt="q" id="gt-q" value="${esc(g.q)}" placeholder="اسم الطالب، الرقم الجامعي، الكلية أو المعهد، المادة…" maxlength="80" autocomplete="off"></label>
        <label>الكلية / المعهد<select data-gt="faculty">${opts(o.faculties.map((x) => [x.id, x.name]), g.faculty, 'الكل')}</select></label>
        <label>السنة<select data-gt="level">${opts(lvlList(4), g.level, 'الكل')}</select></label>
        <label>الفصل<select data-gt="semester">${opts([[1, 'الأول'], [2, 'الثاني']], g.semester, 'الكل')}</select></label>
        <label>العام الدراسي<select data-gt="year">${opts(o.years.map((y) => [y, y]), g.year, 'الكل')}</select></label>
        <label>النتيجة<select data-gt="status">${opts([['pass', 'ناجح'], ['fail', 'راسب']], g.status, 'الكل')}</select></label>
        <label>الاعتماد<select data-gt="workflow">${opts([['draft', 'مدخلة'], ['reviewed', 'مراجَعة'], ['approved', 'معتمدة']], g.workflow, 'الكل')}</select></label>
        ${g.q || g.faculty || g.level || g.semester || g.year || g.status || g.workflow ? '<button class="btn sm" data-act="gtclear">مسح الفلاتر</button>' : ''}</div>
      ${wfBar()}
      <div id="gt-table">${gradeTable()}</div></section>`;
  }
  const refreshGrades = () => { const el = document.getElementById('gt-table'); if (el) el.innerHTML = gradeTable(); };

  /* ---------- النوافذ: إضافة/تعديل مقرر، إدخال/تعديل علامة ---------- */
  function courseModal(m) {
    const ce = m.edit ? A.courses.find((c) => c.id === m.edit) : null, fl = facs(), dr = m.d || {};
    const fid = ce ? ce.facultyId : (m.faculty || (fl[0] && fl[0].id) || ''), plist = A.programs.filter((p) => String(p.facultyId) === String(fid)), pid = ce ? ce.programId : (m.program && plist.some((p) => String(p.id) === String(m.program)) ? m.program : (plist[0] && plist[0].id));
    return `<h2 id="mttl">${ce ? 'تعديل مقرر' : 'إضافة مقرر'}</h2><form class="form" id="acadd" style="border:0;margin:0;padding:0">
      <div class="two"><label>الكلية / المعهد<select id="ac-nfac"${ce ? ' disabled' : ''} data-mc="fac">${opts(fl.map((x) => [x.id, x.name]), fid)}</select></label>
        <label>البرنامج<select id="ac-nprog"${ce ? ' disabled' : ''} data-mc="prog">${opts(plist.map((p) => [p.id, p.label || p.name]), pid)}</select></label></div>
      <div class="two"><label>السنة الدراسية<select id="ac-nlvl">${opts(lvlList(yrs(pid)), ce ? ce.level : (dr.lvl || 1))}</select></label><label>الفصل<select id="ac-nsem">${opts([[1, 'الأول'], [2, 'الثاني']], ce ? ce.semester : (dr.sem || 1))}</select></label></div>
      <label>اسم المقرر<input id="ac-nname" maxlength="100" required value="${ce ? esc(ce.name) : esc(dr.name || '')}"></label>
      <div class="two"><label>الساعات<input id="ac-nhours" type="number" min="0" max="12" value="${ce ? ce.hours : (dr.hours || 3)}"></label><label>الرمز (اختياري)<input id="ac-ncode" maxlength="20" dir="ltr" value="${ce ? esc(ce.code || '') : esc(dr.code || '')}"></label></div>
      <label>المدرّس (اختياري)<input id="ac-ninst" maxlength="80" value="${ce ? esc(ce.instructor || '') : esc(dr.inst || '')}"></label>
      ${ce ? `<fieldset class="slots"><legend>مواعيد المحاضرات (لكشف تعارض جدول الطالب)</legend>${(m.slots || []).map((sl, i) => `<div class="slot-row"><label>اليوم<select data-slot="day">${opts(DAYN.map((n, k) => [k, n]), sl.day)}</select></label><label>من<input type="time" data-slot="start" value="${esc(sl.start)}"></label><label>إلى<input type="time" data-slot="end" value="${esc(sl.end)}"></label><label>القاعة<input data-slot="hall" maxlength="60" value="${esc(sl.hall || '')}"></label><button class="btn sm bad" type="button" data-act="slotdel" data-i="${i}">حذف</button></div>`).join('') || '<p class="small">لا مواعيد بعد.</p>'}<button class="btn sm" type="button" data-act="slotadd">＋ موعد</button></fieldset>` : '<p class="small">يمكن إضافة مواعيد المحاضرات بعد إنشاء المقرر (تعديل المقرر).</p>'}
      <div class="actions"><button class="btn pri" type="submit">${ce ? 'حفظ التعديل' : 'إضافة المقرر'}</button><button class="btn" type="button" data-act="mclose">إلغاء</button></div></form>`;
  }
  function gradeModal(m) {
    const st = m.student, edit = !!m.edit;
    let body;
    if (!st) {
      const found = m.found ? `<ul class="mini-list">${m.found.length ? m.found.map((s) => `<li><button class="link" data-act="gmpick" data-id="${s.id}">${esc(s.name)} · <span class="mono">${esc(s.studentNo)}</span></button> <span class="small">${esc(s.program.label || s.program.name)} · ${esc(s.levelLabel)}</span></li>`).join('') : '<li class="empty">لا نتائج.</li>'}</ul>` : '';
      body = `<form class="inline-form" id="gmsearch"><label class="grow">ابحث عن الطالب (الاسم أو الرقم الجامعي)<input id="gm-q" value="${esc(m.q || '')}" maxlength="60" autocomplete="off" autofocus></label><button class="btn pri" type="submit">بحث</button></form>${found}`;
    } else {
      body = `<div class="me"><div class="avatar">${esc(st.name[0])}</div><div><b>${esc(st.name)}</b><small class="mono">${esc(st.studentNo)} · ${esc(st.program.label || st.program.name)} · ${esc(st.levelLabel)}</small></div>${edit ? '' : '<button class="btn sm" type="button" data-act="gmchange">تغيير الطالب</button>'}</div>
        ${m.msg ? `<div class="okbox" role="status">${esc(m.msg)}</div>` : ''}${m.err ? `<div class="err" role="alert" style="margin-top:12px">${esc(m.err)}</div>` : ''}
        <form class="form" id="acgrade" style="border:0;padding:0;margin-top:10px"><label>المقرر<select id="gr-course" required${edit ? ' disabled' : ''}><option value="">— اختر —</option>${m.courses.map((c) => `<option value="${c.id}"${String(c.id) === String(m.courseId || '') ? ' selected' : ''}>${lvl(c.level)} · ${sem(c.semester)} — ${esc(c.name)}</option>`).join('')}</select></label>
          <div class="two"><label>العام الدراسي<input id="gr-year" value="${esc(m.year || defYear())}" dir="ltr" pattern="\\d{4}/\\d{4}" required${edit ? ' readonly' : ''}></label><span></span></div>
          <div class="two"><label>العلامة النظرية<input id="gr-th" type="number" min="0" max="100" required value="${m.th ?? ''}"></label><label>العلامة العملية<input id="gr-pr" type="number" min="0" max="100" value="${m.pr ?? ''}"></label></div>
          ${m.locked ? '<label>تبرير تعديل علامة معتمدة (يُسجَّل في سجل التغييرات)<textarea id="gr-just" rows="2" required minlength="5" maxlength="300"></textarea></label>' : ''}
          <div class="small">مجموع العلامتين لا يتجاوز 100، والنجاح من 60. إعادة إدخال علامة لنفس المقرر والعام تعدّلها${m.locked ? '، وهذه العلامة معتمدة ومقفلة' : '، وتعديل علامة غير معتمدة يعيدها إلى «مدخلة»'}.</div>
          <div class="actions"><button class="btn pri" type="submit">${edit ? 'حفظ التعديل' : 'حفظ العلامة'}</button><button class="btn" type="button" data-act="mclose">${edit ? 'إلغاء' : 'إنهاء'}</button></div></form>`;
    }
    return `<h2 id="mttl">${edit ? 'تعديل علامة' : 'إدخال علامات جديدة'}</h2>${body}`;
  }
  function modalHtml() {
    const m = A.modal; if (!m) return '';
    return `<div class="modal-back" data-act="mclose"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mttl">${m.type === 'course' ? courseModal(m) : gradeModal(m)}</div></div>`;
  }
  UA.views.academics = () => bar([['courses', 'دليل المواد'], ['grades', 'جدول العلامات']], A.tab, 'actab') + (A.tab === 'courses' ? coursesTab() : gradesTab()) + modalHtml();

  /* ---------- الأحداث ---------- */
  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.cf === 'q') { A.cf.q = t.value; A.cf.page = 1; refreshCourses(); }
    else if (t.dataset.gt === 'q') { A.gt.q = t.value; A.gt.page = 1; clearTimeout(timer); timer = setTimeout(async () => { await loadGrades(); refreshGrades(); }, 280); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.cf && t.dataset.cf !== 'q') {
      if (t.dataset.cf === 'size') A.cf.size = Number(t.value); else { A.cf[t.dataset.cf] = t.value; if (t.dataset.cf === 'faculty') A.cf.program = ''; }
      A.cf.page = 1; UA.render();
    } else if (t.dataset.gt && t.dataset.gt !== 'q') {
      if (t.dataset.gt === 'size') A.gt.size = Number(t.value); else A.gt[t.dataset.gt] = t.value;
      A.gt.page = 1; await loadGrades(); UA.render();
    } else if (t.dataset.mc && A.modal && A.modal.type === 'course') {     // اعتماد القوائم في نافذة المقرر: كلية ← برنامج ← السنوات
      if (t.dataset.mc === 'fac') { A.modal.faculty = t.value; A.modal.program = ''; }
      else A.modal.program = t.value;
      keepCourseDraft(); UA.render();
    }
  });
  const keepSlots = () => { if (!A.modal || !A.modal.slots) return; A.modal.slots = [...document.querySelectorAll('.slot-row')].map((r) => { const g = (k) => r.querySelector(`[data-slot=${k}]`).value; return { day: Number(g('day')), start: g('start'), end: g('end'), hall: g('hall') }; }); };
  const keepCourseDraft = () => { const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; }; A.modal.d = { name: g('ac-nname'), hours: g('ac-nhours'), code: g('ac-ncode'), inst: g('ac-ninst'), lvl: g('ac-nlvl'), sem: g('ac-nsem') }; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && A.modal) { A.modal = null; UA.render(); } });

  async function pickStudent(id) {
    const m = A.modal; m.student = (await api('GET', '/api/students/' + id)).student; m.err = ''; m.msg = '';
    m.courses = (await api('GET', '/api/courses?program=' + m.student.program.id)).courses.filter((c) => c.active);
  }
  UA.acTab = () => A.tab;
  Object.assign(UA.actions, {
    actab: async (el, d) => { A.tab = d.t; A.modal = null; if (d.t === 'grades' && !A.gt.data) await loadGrades(); UA.render(); },
    mclose: async (el, d, e) => { if (e && e.target.closest('.modal') && el.classList.contains('modal-back')) return; A.modal = null; UA.render(); },
    // --- المواد ---
    crsort: async (el, d) => { A.cf.dir = A.cf.sort === d.k && A.cf.dir === 'asc' ? 'desc' : 'asc'; A.cf.sort = d.k; UA.render(); },
    crpage: async (el, d) => { A.cf.page = Number(d.p); UA.render(); },
    crclear: async () => { A.cf = Object.assign(cfDef(), { sort: A.cf.sort, dir: A.cf.dir, size: A.cf.size }); UA.render(); },
    acnew: async () => { A.modal = { type: 'course', edit: null, faculty: A.cf.faculty, program: A.cf.program }; UA.render(); },
    acedit: async (el, d) => { A.modal = { type: 'course', edit: Number(d.id), slots: [] }; try { A.modal.slots = (await api('GET', `/api/courses/${d.id}/schedule`)).slots; } catch (e) { if (!e.status) throw e; } UA.render(); },
    actoggle: async (el, d) => { try { await api('POST', `/api/courses/${d.id}/toggle`, { enabled: d.on === '1' }); await loadCourses(); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    acdel: async (el, d) => {
      const c = A.courses.find((x) => x.id === Number(d.id)); if (!c || !confirm(`حذف المقرر «${c.name}» نهائياً؟${c.grades ? `\nله ${c.grades} علامة مسجَّلة وسيُرفض الحذف؛ عطّله بدلاً من ذلك.` : ''}`)) return;
      try { await api('DELETE', '/api/courses/' + d.id); await loadCourses(); UA.render(); toast('حُذف المقرر'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    // --- العلامات ---
    gtsort: async (el, d) => { A.gt.dir = A.gt.sort === d.k && A.gt.dir === 'desc' ? 'asc' : (A.gt.sort === d.k ? 'desc' : (['total', 'enteredAt', 'theory', 'practical'].includes(d.k) ? 'desc' : 'asc')); A.gt.sort = d.k; A.gt.page = 1; await loadGrades(); UA.render(); },
    gtpage: async (el, d) => { A.gt.page = Number(d.p); await loadGrades(); UA.render(); },
    gtclear: async () => { A.gt = Object.assign(gtDef(), { sort: A.gt.sort, dir: A.gt.dir, size: A.gt.size }); await loadGrades(); UA.render(); },
    gtnew: async () => { A.modal = { type: 'grade', student: null, found: null, q: '' }; UA.render(); },
    gtedit: async (el, d) => {
      const x = A.gt.data.rows.find((r) => r.id === Number(d.id)); if (!x) return;
      if (!x.courseId) { toast('علامة قديمة غير مرتبطة بمقرر؛ يمكن حذفها فقط'); return; }
      A.modal = { type: 'grade', edit: x.id, student: null, courseId: x.courseId, year: x.academicYear, th: x.theory, pr: x.practical, locked: x.workflowStatus === 'approved' && !!(A.gt.data.workflow && A.gt.data.workflow.enabled) }; await pickStudent(x.studentId); UA.render();
    },
    gtdel: async (el, d) => {
      const x = A.gt.data.rows.find((r) => r.id === Number(d.id)); if (!x || !confirm(`حذف علامة «${x.course}» للطالب ${x.studentName} نهائياً؟`)) return;
      let j = ''; if (x.workflowStatus === 'approved' && A.gt.data.workflow && A.gt.data.workflow.enabled) { j = prompt('العلامة معتمدة. اكتب تبرير الحذف (5 أحرف على الأقل):') || ''; if (!j) return; }
      try { await api('DELETE', `/api/students/${x.studentId}/grades/${x.id}` + (j ? '?justification=' + encodeURIComponent(j) : '')); await loadGrades(); UA.render(); toast('حُذفت العلامة'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gtwf: async (el, d) => {
      let justification; if (d.stage === 'reviewed' && (A.gt.data.rows.find((r) => r.id === Number(d.id)) || {}).workflowStatus === 'approved') { justification = prompt('إعادة فتح علامة معتمدة: اكتب التبرير (5 أحرف على الأقل):') || ''; if (!justification) return; }
      try { const r = await api('POST', '/api/grades/workflow', { gradeIds: [Number(d.id)], stage: d.stage, justification }); await loadGrades(); UA.render(); toast(r.updated ? 'تم التحديث' : (r.skipped[0] && r.skipped[0].reason) || 'لم يتغير شيء'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gtwfall: async (el, d) => {
      const from = d.stage === 'reviewed' ? 'draft' : 'reviewed', ids = A.gt.data.rows.filter((r) => r.workflowStatus === from).map((r) => r.id);
      if (!ids.length) { toast('لا علامات مناسبة في هذه الصفحة'); return; }
      if (!confirm(`${d.stage === 'approved' ? 'اعتماد' : 'مراجعة'} ${ids.length} علامة؟${d.stage === 'approved' ? '\nستظهر للطلاب وتُقفل.' : ''}`)) return;
      try { const r = await api('POST', '/api/grades/workflow', { gradeIds: ids, stage: d.stage }); await loadGrades(); UA.render(); toast(`تم تحديث ${r.updated} علامة`); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gtwfset: async (el) => { try { await api('POST', '/api/grades/workflow-setting', { enabled: el.checked }); await loadGrades(); UA.render(); toast(el.checked ? 'فُعّلت مراحل الاعتماد' : 'أُوقفت مراحل الاعتماد'); } catch (e) { if (!e.status) throw e; el.checked = !el.checked; toast(e.message); } },
    slotadd: async () => { keepSlots(); A.modal.slots.push({ day: 0, start: '08:00', end: '10:00', hall: '' }); keepCourseDraft(); UA.render(); },
    slotdel: async (el, d) => { keepSlots(); A.modal.slots.splice(Number(d.i), 1); keepCourseDraft(); UA.render(); },
    gmpick: async (el, d) => { await pickStudent(d.id); UA.render(); },
    gmchange: async () => { Object.assign(A.modal, { student: null, found: null, msg: '', err: '' }); UA.render(); },
  });
  Object.assign(UA.forms, {
    acadd: async () => {
      const m = A.modal, body = { level: Number(val('ac-nlvl')), semester: Number(val('ac-nsem')), name: val('ac-nname'), hours: Number(val('ac-nhours')), code: val('ac-ncode'), instructor: val('ac-ninst') };
      try {
        if (m.edit) { await api('PUT', '/api/courses/' + m.edit, body); keepSlots(); await api('PUT', `/api/courses/${m.edit}/schedule`, { slots: m.slots || [] }); toast('حُفظ تعديل المقرر'); }
        else { await api('POST', '/api/courses', { programId: Number(val('ac-nprog')), ...body }); toast('أُضيف المقرر'); }
        A.modal = null; await loadCourses(); UA.render();
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gmsearch: async () => { const q = val('gm-q').trim(); A.modal.q = q; A.modal.found = (await api('GET', '/api/students?' + new URLSearchParams({ q }))).students.slice(0, 10); UA.render(); },
    acgrade: async () => {
      const m = A.modal, courseId = m.edit ? m.courseId : Number(val('gr-course'));
      try {
        await api('POST', `/api/students/${m.student.id}/grades`, { courseId, academicYear: val('gr-year'), theory: val('gr-th'), practical: val('gr-pr'), ...(m.locked ? { justification: val('gr-just') } : {}) });
        await loadGrades();
        if (m.edit) { A.modal = null; toast('حُفظ تعديل العلامة'); } else { const cname = (m.courses.find((c) => c.id === courseId) || {}).name || ''; Object.assign(m, { msg: `حُفظت علامة «${cname}» للطالب ${m.student.name}. يمكنك إدخال مقرر آخر.`, err: '', courseId: '', th: '', pr: '', year: val('gr-year') }); }
        UA.render();
      } catch (e) { if (!e.status) throw e; Object.assign(m, { err: e.message, msg: '', courseId, year: val('gr-year'), th: val('gr-th'), pr: val('gr-pr') }); UA.render(); }
    },
  });

  /* ---------- الأخبار والشكاوى ---------- */
  const CST = { open: ['p-review', 'قيد المعالجة'], answered: ['p-approved', 'تم الرد'], closed: ['p-approved', 'مغلقة'] };
  UA.loaders.comms = async () => {
    const q = A.cfilter === 'all' ? '' : '?status=' + A.cfilter;
    [A.news, A.cmps] = await Promise.all([api('GET', '/api/news').then((r) => r.news), api('GET', '/api/complaints' + q).then((r) => r.complaints)]);
  };
  function newsTab() {
    const ne = A.nedit ? A.news.find((n) => n.id === A.nedit) : null;
    return `<div class="grid2"><section class="card"><h2>${ne ? 'تعديل خبر' : 'نشر خبر'}</h2><form class="form" id="newsadd" style="border:0;margin:0;padding:0"><label>العنوان<input id="nw-title" maxlength="150" required value="${ne ? esc(ne.title) : ''}"></label>
        <label>النص<textarea id="nw-body" rows="5" maxlength="4000" required>${ne ? esc(ne.body) : ''}</textarea></label>${ne ? '<p class="small">لإضافة صور أو روابط أو حذفها استخدم الخبر في القائمة المجاورة.</p>' : `<label>صور أو فيديو (رفع مباشر)<input id="nw-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"></label>
        <label>روابط (رابط في كل سطر)<textarea id="nw-links" rows="3" dir="ltr" placeholder="https://youtu.be/...&#10;https://example.com/photo.jpg"></textarea></label>
        <p class="small">الرفع: صور حتى 5 ميغابايت (jpg/png/webp/gif) وفيديو حتى 50 ميغابايت (mp4/webm). الروابط: صورة أو فيديو مباشر (https) أو يوتيوب أو فيميو. حتى 8 وسائط للخبر.</p>
        `}<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input id="nw-pin" type="checkbox" style="width:auto"${ne && ne.pinned ? ' checked' : ''}> تثبيت في أعلى القائمة</label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">${ne ? 'حفظ التعديل' : 'نشر'}</button>${ne ? '<button class="btn" type="button" data-act="newscancel">إلغاء</button>' : ''}</div></form></section>
      <section class="card"><h2>الأخبار المنشورة <span class="small">(${A.news.length})</span></h2>${A.news.length ? A.news.map((n) => `<article class="req"><div class="req-h"><b>${n.pinned ? UA.icon('pin', 16) + ' ' : ''}${esc(n.title)}</b><span style="white-space:nowrap"><button class="btn sm" data-act="newsedit" data-id="${n.id}">تعديل</button> <button class="btn sm bad" data-act="newsdel" data-id="${n.id}">حذف</button></span></div><div class="no">${fmt(n.publishedAt)}</div><div class="hint" style="white-space:pre-wrap">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div>
        ${n.media.length ? `<div class="news-media compact">${n.media.map((m) => `<figure>${UA.mediaHtml([m], { compact: true }).replace(/^<div[^>]*>|<\/div>$/g, '')}<button class="btn sm bad" data-act="nmdel" data-id="${m.id}">حذف</button></figure>`).join('')}</div>` : ''}
        <div class="inline-form" style="margin-top:8px"><label>إضافة ملف<input type="file" id="nm-f-${n.id}" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"></label><button class="btn sm" data-act="nmup" data-id="${n.id}">رفع</button><button class="btn sm" data-act="nmlink" data-id="${n.id}">إضافة رابط</button></div></article>`).join('') : '<div class="empty">لا أخبار بعد. ما تنشره يظهر لكل الطلاب في تطبيقهم.</div>'}</section></div>`;
  }
  function complaintsTab() {
    const fl = [['open', 'قيد المعالجة'], ['answered', 'تم الرد'], ['closed', 'مغلقة'], ['all', 'الكل']];
    const sel = A.cmps.find((c) => c.id === A.csel);
    const rows = A.cmps.map((c) => `<tr class="row" tabindex="0" data-act="cmpsel" data-id="${c.id}" aria-selected="${A.csel === c.id}"><td>${esc(c.subject)}</td><td>${esc(c.student.name)}</td><td><span class="pill ${CST[c.status][0]}">${CST[c.status][1]}</span></td><td class="hint" style="white-space:nowrap">${fmt(c.createdAt)}</td></tr>`).join('');
    const det = sel ? `<dl class="kv"><dt>الرقم</dt><dd class="mono">${esc(sel.no)}</dd><dt>الطالب</dt><dd>${esc(sel.student.name)} · ${esc(sel.student.studentNo)}</dd><dt>الموضوع</dt><dd>${esc(sel.subject)}</dd><dt>النص</dt><dd style="white-space:pre-wrap">${esc(sel.body)}</dd>${sel.response ? `<dt>الرد</dt><dd style="white-space:pre-wrap">${esc(sel.response)}</dd>` : ''}</dl>
      ${sel.status !== 'closed' ? `<form class="form" id="cmpresp"><label>${sel.response ? 'رد إضافي' : 'الرد على الطالب'}<textarea id="cm-resp" rows="3" maxlength="1000" required></textarea></label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input id="cm-close" type="checkbox" style="width:auto"> إغلاق الشكوى بعد الرد</label><div class="actions" style="margin:0"><button class="btn pri" type="submit">إرسال الرد</button></div></form>` : ''}` : '<div class="empty">اختر شكوى من القائمة.</div>';
    return `<div class="grid2"><section class="card"><h2>الشكاوى</h2><div class="chips">${fl.map((f) => `<button class="chip" data-act="cmpflt" data-f="${f[0]}" aria-pressed="${A.cfilter === f[0]}">${f[1]}</button>`).join('')}</div>
      <div class="tbl-wrap"><table><thead><tr><th>الموضوع</th><th>الطالب</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا شكاوى في هذا التصنيف.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>تفاصيل الشكوى</h2>${det}${sel ? `<div class="actions no-print"><button class="btn bad" data-act="cmpdel" data-id="${sel.id}">حذف الشكوى</button></div>` : ''}</section></div>`;
  }
  UA.views.comms = () => bar([['news', 'الأخبار'], ['complaints', 'الشكاوى']], A.ctab || 'news', 'cmtab') + ((A.ctab || 'news') === 'news' ? newsTab() : complaintsTab());
  Object.assign(UA.actions, {
    cmtab: async (el, d) => { A.ctab = d.t; UA.render(); },
    cmpflt: async (el, d) => { A.cfilter = d.f; A.csel = null; await UA.loaders.comms(); UA.render(); },
    cmpsel: async (el, d) => { A.csel = Number(d.id); UA.render(); },
    nmdel: async (el, d) => { if (!confirm('حذف هذا الوسيط؟')) return; try { await api('DELETE', '/api/news/media/' + d.id); await UA.loaders.comms(); UA.render(); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    nmup: async (el, d) => { const fl = document.getElementById('nm-f-' + d.id).files[0]; if (!fl) { toast('اختر ملفاً'); return; } try { await UA.upload(`/api/news/${d.id}/media`, fl); await UA.loaders.comms(); UA.render(); toast('أُضيف الملف'); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    nmlink: async (el, d) => { const u = prompt('الصق الرابط (صورة/فيديو مباشر، يوتيوب، فيميو)'); if (!u) return; try { await api('POST', `/api/news/${d.id}/links`, { url: u }); await UA.loaders.comms(); UA.render(); toast('أُضيف الرابط'); } catch (e) { if (!e.status) throw e; toast(e.message); } },
    newsedit: async (el, d) => { A.nedit = Number(d.id); UA.render(); window.scrollTo(0, 0); },
    newscancel: async () => { A.nedit = null; UA.render(); },
    cmpdel: async (el, d) => {
      const c = A.cmps.find((x) => x.id === Number(d.id)); if (!c || !confirm(`حذف الشكوى ${c.no} نهائياً؟`)) return;
      try { await api('DELETE', '/api/complaints/' + d.id); A.csel = null; await UA.loaders.comms(); UA.render(); toast('حُذفت الشكوى'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    newsdel: async (el, d) => { if (!confirm('حذف هذا الخبر نهائياً؟')) return; await api('DELETE', '/api/news/' + d.id); await UA.loaders.comms(); UA.render(); toast('حُذف الخبر'); },
  });
  Object.assign(UA.forms, {
    newsadd: async () => {
      try {
        if (A.nedit) { await api('PUT', '/api/news/' + A.nedit, { title: val('nw-title'), body: val('nw-body'), pinned: document.getElementById('nw-pin').checked }); A.nedit = null; await UA.loaders.comms(); UA.render(); toast('حُفظ تعديل الخبر'); return; }
        const files = [...document.getElementById('nw-files').files], links = val('nw-links').split(/\n/).map((x) => x.trim()).filter(Boolean);
        for (const fl of files) if (fl.size > (fl.type.startsWith('video/') ? 50 : 5) * 1048576) { toast(`الملف «${fl.name}» أكبر من الحد المسموح`); return; }
        const r = await api('POST', '/api/news', { title: val('nw-title'), body: val('nw-body'), pinned: document.getElementById('nw-pin').checked, links });
        const failed = [];
        for (const fl of files) { try { await UA.upload(`/api/news/${r.id}/media`, fl); } catch (e) { if (!e.status) throw e; failed.push(`${fl.name}: ${e.message}`); } }
        await UA.loaders.comms(); UA.render();
        toast(failed.length ? `نُشر الخبر، وتعذّر رفع: ${failed.join(' | ')}` : 'نُشر الخبر');
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    cmpresp: async () => {
      try { await api('POST', `/api/complaints/${A.csel}/respond`, { response: val('cm-resp'), close: document.getElementById('cm-close').checked }); await UA.loaders.comms(); UA.render(); toast('أُرسل الرد'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
})();
