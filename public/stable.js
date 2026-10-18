/* جدول الطلاب: بنمط جدول المواد والعلامات (بحث وفلاتر وترتيب وصفحات من الخادم) بكل معلومات التسجيل. */
(function () {
  const UA = window.UA, { S, api, esc } = UA;
  const T = { q: '', faculty: '', program: '', level: '', status: '', gender: '', governorate: '', enrollYear: '', admission: '', files: '', holds: '', sort: 'createdAt', dir: 'desc', page: 1, size: 25, full: true, data: null, err: '' };
  const DEF = { ...T };
  UA.studentsTableReset = () => { Object.assign(T, DEF, { data: null }); };

  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const pill = (st, label) => `<span class="pill ${{ active: 'p-approved', suspended: 'p-review', withdrawn: 'p-rejected', transferred: 'p-rejected', graduated: 'p-review' }[st] || ''}">${esc(label)}</span>`;
  const sortTh = (k, label) => `<th aria-sort="${T.sort === k ? (T.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-act="sttsort" data-k="${k}">${label}<span class="arr">${T.sort === k ? (T.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const plain = (label) => `<th>${label}</th>`;
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

  async function load() {
    const q = new URLSearchParams();
    for (const k of ['q', 'faculty', 'program', 'level', 'status', 'gender', 'governorate', 'enrollYear', 'admission', 'files', 'holds', 'sort', 'dir', 'page', 'size']) if (T[k]) q.set(k, T[k]);
    try { T.data = await api('GET', '/api/students-table?' + q); T.err = ''; T.page = T.data.page; } catch (e) { if (!e.status) throw e; T.err = e.message; }
  }

  function cols() {
    const f = T.full;
    return [
      ['studentNo', 'الرقم الجامعي', (r) => `<span class="mono nowrap">${esc(r.studentNo)}</span>`, 1, 1],
      ['name', 'الاسم', (r) => `<span class="st-who">${r.photoId ? `<img class="st-ph" alt="" src="/api/student-files/${r.photoId}">` : `<i class="st-ph st-ph0">${esc(r.name[0] || '؟')}</i>`}<button class="link" data-act="sttopen" data-id="${r.id}" title="فتح ملف الطالب"><b>${esc(r.name)}</b></button></span>`, 1, 1],
      ['', 'اسم الأم', (r) => dash(r.motherName), 0, 0],
      ['gender', 'الجنس', (r) => dash(r.gender), 0, 1],
      ['', 'الرقم الوطني', (r) => `<span class="mono">${dash(r.nationalId)}</span>`, 0, 0],
      ['birthDate', 'الولادة', (r) => `<span class="nowrap">${dash(r.birthDate)}</span><div class="small">${dash(r.birthPlace)}</div>`, 0, 0],
      ['', 'الجنسية / الحالة الاجتماعية', (r) => `${dash(r.nationality)}<div class="small">${dash(r.maritalStatus)}</div>`, 0, 0],
      ['', 'الهاتف / البريد', (r) => `<span class="mono">${dash(r.phone)}</span><div class="small" dir="ltr">${dash(r.email)}</div>`, 0, 1],
      ['governorate', 'المحافظة / المدينة / العنوان', (r) => `${dash(r.governorate)} · ${dash(r.city)}<div class="small">${dash(r.address)}</div>`, 0, 0],
      ['hsScore', 'الشهادة الثانوية', (r) => `${dash(r.hsType)}<div class="small">${dash(r.hsYear)} · ${dash(r.hsSchool)} · ${dash(r.hsGovernorate)} · المجموع ${dash(r.hsScore)}</div>`, 0, 0],
      ['faculty', 'الكلية / المعهد', (r) => `<b>${esc(r.faculty)}</b>`, 1, 1],
      ['program', 'البرنامج', (r) => dash(r.program ? `${r.degree ? r.degree + ' — ' : ''}${r.program}` : r.degree), 0, 1],
      ['admission', 'نوع القبول', (r) => `${dash(r.admission)}<div class="small">رقم وزاري: ${dash(r.ministerialNo)}</div>`, 0, 0],
      ['enrollYear', 'القيد', (r) => `${dash(r.enrollYear)}<div class="small">${dash(r.enrollTerm)}</div>`, 0, 0],
      ['level', 'السنة الدراسية', (r) => `<span class="nowrap">${esc(r.levelLabel)}</span>`, 1, 1],
      ['status', 'الحالة', (r) => pill(r.status, r.statusLabel) + (r.holds ? ` <span class="pill p-rejected">${r.holds} عقوبة</span>` : ''), 1, 1],
      ['', 'ولي الأمر', (r) => `${dash(r.guardianName)}<div class="small">${dash(r.guardianRelation)} · <span class="mono">${dash(r.guardianPhone)}</span></div><div class="small">طوارئ: <span class="mono">${dash(r.emergencyPhone)}</span></div>`, 0, 0],
      ['', 'المرفقات', (r) => (r.files ? `<span class="pill p-approved">${r.files} ملف</span>` : '<span class="small">لا مرفقات</span>'), 0, 1],
    ].filter((c) => f || c[3]).map((c) => ({ k: c[0], label: c[1], cell: c[2], compact: !!c[3], mobile: !!c[4] }));
  }
  function table() {
    const d = T.data; if (!d) return `<div class="empty">${esc(T.err || 'جارٍ التحميل…')}</div>`;
    const C = cols(), s = d.summary;
    const head = C.map((c) => (c.k ? sortTh(c.k, c.label) : plain(c.label))).join('') + '<th></th>';
    const rows = d.rows.map((r) => `<tr class="${S.stSel && S.stSel.id === r.id ? 'sel' : ''}">${C.map((c) => `<td>${c.cell(r)}</td>`).join('')}<td class="nowrap"><button class="btn sm" data-act="sttedit" data-id="${r.id}">تعديل</button></td></tr>`).join('')
      || `<tr><td colspan="${C.length + 1}" class="empty">لا طلاب مطابقون. غيّر الفلاتر أو سجّل طالباً جديداً.</td></tr>`;
    const pg = `<div class="pager no-print"><span class="small">${d.total} نتيجة</span><span class="pg-ctl"><button class="btn sm" data-act="sttpage" data-p="${d.page - 1}"${d.page <= 1 ? ' disabled' : ''}>‹ السابق</button><span>صفحة ${d.page} من ${d.pages}</span><button class="btn sm" data-act="sttpage" data-p="${d.page + 1}"${d.page >= d.pages ? ' disabled' : ''}>التالي ›</button></span>
      <label class="small">الصفوف <select data-stt="size">${[25, 50, 100].map((n) => `<option${n === d.size ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
    return `<div class="imp-sum gt-sum"><div class="stat"><small>الطلاب</small><b>${s.count}</b></div><div class="stat"><small>مقيَّدون</small><b>${s.active}</b></div><div class="stat"><small>ذكور</small><b>${s.male}</b></div><div class="stat"><small>إناث</small><b>${s.female}</b></div></div>
      <div class="tbl-wrap st-wrap"><table class="grid-tbl st-tbl${T.full ? ' st-full' : ''}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${pg}`;
  }
  function view(detailHtml) {
    const d = T.data, o = (d && d.options) || { faculties: [], programs: [], governorates: [], admissions: [], enrollYears: [], statuses: {}, levels: 4 };
    const progs = o.programs.filter((p) => !T.faculty || String(p.facultyId) === T.faculty);
    const any = T.q || T.faculty || T.program || T.level || T.status || T.gender || T.governorate || T.enrollYear || T.admission || T.files || T.holds;
    const lv = Array.from({ length: o.levels }, (_, i) => [i + 1, 'السنة ' + ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'][i]]);
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">سجل الطلاب${d ? ` <span class="small">(${d.total})</span>` : ''}</h2>
        <span class="no-print"><button class="btn sm" data-act="sttfull">${T.full ? 'عرض مختصر' : 'عرض كل المعلومات'}</button> ${UA.can('data:export') ? '<button class="btn sm" data-act="sttexport">تصدير…</button>' : ''} ${UA.can('student:register') ? '<button class="btn pri" data-act="sttnew">＋ تسجيل طالب جديد</button>' : ''}</span></div>
      <div class="filters no-print"><label class="grow">بحث<input data-stt="q" id="stt-q" value="${esc(T.q)}" placeholder="الاسم، الرقم الجامعي، الرقم الوطني، الهاتف، الأم، ولي الأمر…" maxlength="60" autocomplete="off"></label>
        <label>الكلية / المعهد<select data-stt="faculty">${opts(o.faculties.map((x) => [x.id, x.name]), T.faculty, 'الكل')}</select></label>
        <label>البرنامج<select data-stt="program">${opts(progs.map((p) => [p.id, p.degree ? `${p.name} (${p.degree})` : p.name]), T.program, 'الكل')}</select></label>
        <label>السنة<select data-stt="level">${opts(lv, T.level, 'الكل')}</select></label>
        <label>الحالة<select data-stt="status">${opts(Object.entries(o.statuses), T.status, 'الكل')}</select></label>
        <label>الجنس<select data-stt="gender">${opts([['ذكر', 'ذكر'], ['أنثى', 'أنثى']], T.gender, 'الكل')}</select></label>
        <label>المحافظة<select data-stt="governorate">${opts(o.governorates.map((g) => [g, g]), T.governorate, 'الكل')}</select></label>
        <label>سنة القيد<select data-stt="enrollYear">${opts(o.enrollYears.map((y) => [y, y]), T.enrollYear, 'الكل')}</select></label>
        <label>نوع القبول<select data-stt="admission">${opts(o.admissions.map((a) => [a, a]), T.admission, 'الكل')}</select></label>
        <label>المرفقات<select data-stt="files">${opts([['some', 'لديه مرفقات'], ['none', 'بلا مرفقات']], T.files, 'الكل')}</select></label>
        <label>العقوبات<select data-stt="holds">${opts([['1', 'عليه عقوبة قائمة']], T.holds, 'الكل')}</select></label>
        ${any ? '<button class="btn sm" data-act="sttclear">مسح الفلاتر</button>' : ''}</div>
      <div id="stt-table">${table()}</div></section>`;
  }
  const refresh = () => { const el = document.getElementById('stt-table'); if (el) el.innerHTML = table(); };

  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t || !t.dataset || t.dataset.stt !== 'q') return;
    T.q = t.value; T.page = 1; clearTimeout(timer); timer = setTimeout(async () => { await load(); refresh(); }, 280);
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset || !t.dataset.stt || t.dataset.stt === 'q') return;
    if (t.dataset.stt === 'size') T.size = Number(t.value); else { T[t.dataset.stt] = t.value; if (t.dataset.stt === 'faculty') T.program = ''; }
    T.page = 1; await load(); UA.render();
  });
  Object.assign(UA.actions, {
    sttsort: async (el, d) => { T.dir = T.sort === d.k && T.dir === 'asc' ? 'desc' : 'asc'; T.sort = d.k; T.page = 1; await load(); UA.render(); },
    sttpage: async (el, d) => { T.page = Number(d.p); await load(); UA.render(); },
    sttclear: async () => { Object.assign(T, DEF, { sort: T.sort, dir: T.dir, size: T.size, full: T.full }); await load(); UA.render(); },
    sttfull: async () => { T.full = !T.full; UA.render(); },
    sttnew: async () => { S.stTab = 'new'; S.cred = null; UA.render(); window.scrollTo(0, 0); },
    stsel: async (el, d) => { const r = await api('GET', '/api/students/' + d.id); S.stSel = r.student; S.stCert = r.certificate; S.stFiles = (await api('GET', `/api/students/${d.id}/files`)).files; UA.render(); },
    sttopen: async (el, d) => { await UA.actions.stsel(el, d); openModal(); },
    sttedit: async (el, d) => { const r = await api('GET', '/api/students/' + d.id); S.stSel = r.student; S.stCert = r.certificate; S.stFiles = (await api('GET', `/api/students/${d.id}/files`)).files; S.stEdit = r.student; S.stTab = 'edit'; S.err = ''; S.fieldErr = null; UA.render(); window.scrollTo(0, 0); },
    sttexport: async () => { UA.go ? UA.go('export') : null; },
  });
  /* ملف الطالب في نافذة مستقلة: يُعاد رسمها بعد أي إجراء داخلها (حذف مرفق، إعادة تعيين…) */
  let detailFn = null, modalOn = false;
  function paintModal() {
    const layer = document.getElementById('layer'); if (!layer || !S.stSel || !detailFn) return;
    const keep = layer.querySelector('.sheet')?.scrollTop ?? 0;
    layer.innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet stu-sheet" role="dialog" aria-modal="true" aria-label="ملف الطالب"><div class="sheet-bar no-print"><button class="btn" data-act="close">إغلاق</button><b>ملف الطالب</b><button class="btn" data-act="strecord" data-id="${S.stSel.id}">السجل الموحّد 360°</button></div><div class="stu-body">${detailFn(S.stSel)}</div></div></div>`;
    const sh = layer.querySelector('.sheet'); if (sh) sh.scrollTop = keep;
  }
  function openModal() { modalOn = true; paintModal(); }
  document.addEventListener('click', (e) => {
    if (!modalOn) return;
    const layer = document.getElementById('layer');
    if (!layer || !layer.querySelector('.stu-sheet')) { modalOn = false; return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a || !e.target.closest('.stu-sheet')) { if (a === 'close') modalOn = false; return; }
    if (a === 'close') { modalOn = false; return; }
    if (['stedit', 'stdel', 'strecord'].includes(a)) { modalOn = false; setTimeout(() => { const l = document.getElementById('layer'); if (l && l.querySelector('.stu-sheet')) l.innerHTML = ''; }, 0); return; }
    setTimeout(() => { if (modalOn && document.getElementById('layer')?.querySelector('.stu-sheet')) paintModal(); }, 600);
  });
  UA.studentsTable = { view: (fn) => { detailFn = fn; return view(fn); }, load, refresh, paint: () => { if (modalOn) paintModal(); } };
})();
