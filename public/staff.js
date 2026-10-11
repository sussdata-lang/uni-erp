/* واجهة الموظف: المواد والعلامات، والأخبار والشكاوى (تُضاف إلى نواة app.js عبر UA) */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
  const lvl = (n) => 'السنة ' + (LV[n - 1] || n);
  const sem = (n) => (n === 1 ? 'الفصل الأول' : 'الفصل الثاني');
  const defYear = () => { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${y + 1}`; };

  const A = { tab: 'courses', programs: [], program: '', level: '', courses: [], gq: '', gres: null, gs: null, gdata: null, gcourses: [], gerr: '', news: [], cmps: [], cfilter: 'open', csel: null };
  UA.reset = () => Object.assign(A, { tab: 'courses', program: '', level: '', courses: [], gres: null, gs: null, gdata: null, news: [], cmps: [], csel: null });

  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const progOpts = (sel) => A.programs.map((p) => `<option value="${p.id}"${String(p.id) === String(sel) ? ' selected' : ''}>${esc(p.faculty)} — ${esc(p.degree)} ${esc(p.name)}</option>`).join('');
  const lvlOpts = (sel, all) => (all ? '<option value="">كل السنوات</option>' : '') + [1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}"${String(n) === String(sel) ? ' selected' : ''}>${lvl(n)}</option>`).join('');

  /* ---------- المواد والعلامات ---------- */
  async function loadCourses() {
    const q = new URLSearchParams(); if (A.program) q.set('program', A.program); if (A.level) q.set('level', A.level);
    A.courses = A.program ? (await api('GET', '/api/courses?' + q)).courses : [];
  }
  UA.loaders.academics = async () => {
    if (!A.programs.length) { A.programs = (await api('GET', '/api/programs')).programs; if (!A.program && A.programs.length) A.program = String(A.programs[0].id); }
    await loadCourses();
  };
  function coursesTab() {
    const rows = A.courses.map((c) => `<tr><td>${lvl(c.level)}</td><td>${sem(c.semester)}</td><td>${esc(c.name)}${c.code ? ` <span class="mono small">${esc(c.code)}</span>` : ''}</td><td>${c.hours}</td><td>${esc(c.instructor || '—')}</td>
      <td>${c.active ? '<span class="pill p-approved">فعّال</span>' : '<span class="pill p-rejected">معطَّل</span>'}</td><td><button class="btn sm" data-act="actoggle" data-id="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('');
    return `<div class="grid2"><section class="card"><h2>دليل المواد</h2>
      <form class="inline-form" id="acfilter"><label>البرنامج<select id="ac-prog">${progOpts(A.program)}</select></label><label>السنة<select id="ac-lvl">${lvlOpts(A.level, true)}</select></label><button class="btn pri" type="submit">عرض</button></form>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>السنة</th><th>الفصل</th><th>المقرر</th><th>ساعات</th><th>المدرّس</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">لا مقررات بعد لهذا البرنامج. أضف أول مقرر من النموذج المجاور.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>إضافة مقرر</h2><form class="form" id="acadd" style="border:0;margin:0;padding:0">
        <label>البرنامج<select id="ac-nprog">${progOpts(A.program)}</select></label>
        <div class="two"><label>السنة الدراسية<select id="ac-nlvl">${lvlOpts(A.level || 1)}</select></label><label>الفصل<select id="ac-nsem"><option value="1">الأول</option><option value="2">الثاني</option></select></label></div>
        <label>اسم المقرر<input id="ac-nname" maxlength="100" required></label>
        <div class="two"><label>الساعات<input id="ac-nhours" type="number" min="0" max="12" value="3"></label><label>الرمز (اختياري)<input id="ac-ncode" maxlength="20" dir="ltr"></label></div>
        <label>المدرّس (اختياري)<input id="ac-ninst" maxlength="80"></label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">إضافة المقرر</button></div></form></section></div>`;
  }
  function gradesTab() {
    const found = A.gres ? `<ul class="mini-list">${A.gres.length ? A.gres.map((s) => `<li><button class="link" data-act="acpick" data-id="${s.id}">${esc(s.name)} · <span class="mono">${esc(s.studentNo)}</span></button> <span class="small">${esc(s.program.name)} · ${esc(s.levelLabel)}</span></li>`).join('') : '<li class="empty">لا نتائج.</li>'}</ul>` : '';
    let right = '<div class="empty">ابحث عن طالب ثم اخترْه لإدخال علاماته.</div>';
    if (A.gs) {
      const g = A.gdata;
      const rows = g.grades.map((x) => `<tr><td>${esc(x.course)}</td><td>${lvl(x.level)} · ${sem(x.semester)}</td><td>${esc(x.academicYear || '')}</td><td>${x.theory ?? '—'}</td><td>${x.practical ?? '—'}</td><td><b>${x.total}</b></td><td><span class="pill ${x.passed ? 'p-approved' : 'p-rejected'}">${x.passed ? 'ناجح' : 'راسب'}</span>${x.previous.length ? ` <span class="small">(+${x.previous.length} سابقة)</span>` : ''}</td></tr>`).join('');
      right = `<div class="me"><div class="avatar">${esc(A.gs.name[0])}</div><div><b>${esc(A.gs.name)}</b><small class="mono">${esc(A.gs.studentNo)} · ${esc(A.gs.program.name)} · ${esc(A.gs.levelLabel)}</small></div></div>
        ${A.gerr ? `<div class="err" role="alert" style="margin-top:12px">${esc(A.gerr)}</div>` : ''}
        <form class="form" id="acgrade"><label>المقرر<select id="gr-course" required><option value="">— اختر —</option>${A.gcourses.map((c) => `<option value="${c.id}">${lvl(c.level)} · ${sem(c.semester)} — ${esc(c.name)}</option>`).join('')}</select></label>
          <div class="two"><label>العام الدراسي<input id="gr-year" value="${defYear()}" dir="ltr" pattern="\\d{4}/\\d{4}" required></label><span></span></div>
          <div class="two"><label>العلامة النظرية<input id="gr-th" type="number" min="0" max="100" required></label><label>العلامة العملية<input id="gr-pr" type="number" min="0" max="100"></label></div>
          <div class="small">مجموع العلامتين لا يتجاوز 100، والنجاح من ${g.passMark}. إعادة إدخال العلامة لنفس المقرر والعام تعدّلها (ويُسجَّل ذلك).</div>
          <div class="actions" style="margin:0"><button class="btn pri" type="submit">حفظ العلامة</button></div></form>
        <div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>المقرر</th><th>السنة/الفصل</th><th>العام</th><th>نظري</th><th>عملي</th><th>المجموع</th><th>الحالة</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">لا علامات مسجَّلة.</td></tr>'}</tbody></table></div>`;
    }
    return `<div class="grid2"><section class="card"><h2>اختيار الطالب</h2><form class="inline-form" id="acsearch"><label>بحث<input id="ac-q" value="${esc(A.gq)}" placeholder="اسم أو رقم جامعي" maxlength="60"></label><button class="btn pri" type="submit">بحث</button></form>${found}</section>
      <section class="card"><h2>إدخال العلامات</h2>${right}</section></div>`;
  }
  UA.views.academics = () => bar([['courses', 'دليل المواد'], ['grades', 'إدخال العلامات']], A.tab, 'actab') + (A.tab === 'courses' ? coursesTab() : gradesTab());

  async function pickStudent(id) {
    A.gs = (await api('GET', '/api/students/' + id)).student; A.gerr = '';
    [A.gdata, A.gcourses] = await Promise.all([api('GET', `/api/students/${id}/grades`), api('GET', '/api/courses?program=' + A.gs.program.id).then((r) => r.courses.filter((c) => c.active))]);
  }
  Object.assign(UA.actions, {
    actab: async (el, d) => { A.tab = d.t; UA.render(); },
    actoggle: async (el, d) => { await api('POST', `/api/courses/${d.id}/toggle`, { enabled: d.on === '1' }); await loadCourses(); UA.render(); },
    acpick: async (el, d) => { await pickStudent(d.id); UA.render(); },
  });
  Object.assign(UA.forms, {
    acfilter: async () => { A.program = val('ac-prog'); A.level = val('ac-lvl'); await loadCourses(); UA.render(); },
    acadd: async () => {
      const programId = Number(val('ac-nprog'));
      try {
        await api('POST', '/api/courses', { programId, level: Number(val('ac-nlvl')), semester: Number(val('ac-nsem')), name: val('ac-nname'), hours: Number(val('ac-nhours')), code: val('ac-ncode'), instructor: val('ac-ninst') });
        A.program = String(programId); await loadCourses(); UA.render(); toast('أُضيف المقرر');
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    acsearch: async () => { A.gq = val('ac-q').trim(); A.gres = (await api('GET', '/api/students?' + new URLSearchParams({ q: A.gq }))).students.slice(0, 10); UA.render(); },
    acgrade: async () => {
      try {
        A.gdata = await api('POST', `/api/students/${A.gs.id}/grades`, { courseId: Number(val('gr-course')), academicYear: val('gr-year'), theory: val('gr-th'), practical: val('gr-pr') });
        A.gerr = ''; UA.render(); toast('حُفظت العلامة');
      } catch (e) { if (!e.status) throw e; A.gerr = e.message; UA.render(); }
    },
  });

  /* ---------- الأخبار والشكاوى ---------- */
  const CST = { open: ['p-review', 'قيد المعالجة'], answered: ['p-approved', 'تم الرد'], closed: ['p-approved', 'مغلقة'] };
  UA.loaders.comms = async () => {
    const q = A.cfilter === 'all' ? '' : '?status=' + A.cfilter;
    [A.news, A.cmps] = await Promise.all([api('GET', '/api/news').then((r) => r.news), api('GET', '/api/complaints' + q).then((r) => r.complaints)]);
  };
  function newsTab() {
    return `<div class="grid2"><section class="card"><h2>نشر خبر</h2><form class="form" id="newsadd" style="border:0;margin:0;padding:0"><label>العنوان<input id="nw-title" maxlength="150" required></label>
        <label>النص<textarea id="nw-body" rows="5" maxlength="4000" required></textarea></label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input id="nw-pin" type="checkbox" style="width:auto"> تثبيت في أعلى القائمة</label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">نشر</button></div></form></section>
      <section class="card"><h2>الأخبار المنشورة <span class="small">(${A.news.length})</span></h2>${A.news.length ? A.news.map((n) => `<article class="req"><div class="req-h"><b>${n.pinned ? '📌 ' : ''}${esc(n.title)}</b><button class="btn sm bad" data-act="newsdel" data-id="${n.id}">حذف</button></div><div class="no">${fmt(n.publishedAt)}</div><div class="hint" style="white-space:pre-wrap">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div></article>`).join('') : '<div class="empty">لا أخبار بعد. ما تنشره يظهر لكل الطلاب في تطبيقهم.</div>'}</section></div>`;
  }
  function complaintsTab() {
    const fl = [['open', 'قيد المعالجة'], ['answered', 'تم الرد'], ['closed', 'مغلقة'], ['all', 'الكل']];
    const sel = A.cmps.find((c) => c.id === A.csel);
    const rows = A.cmps.map((c) => `<tr class="row" tabindex="0" data-act="cmpsel" data-id="${c.id}" aria-selected="${A.csel === c.id}"><td>${esc(c.subject)}</td><td>${esc(c.student.name)}</td><td><span class="pill ${CST[c.status][0]}">${CST[c.status][1]}</span></td><td class="hint" style="white-space:nowrap">${fmt(c.createdAt)}</td></tr>`).join('');
    const det = sel ? `<dl class="kv"><dt>الرقم</dt><dd class="mono">${esc(sel.no)}</dd><dt>الطالب</dt><dd>${esc(sel.student.name)} · ${esc(sel.student.studentNo)}</dd><dt>الموضوع</dt><dd>${esc(sel.subject)}</dd><dt>النص</dt><dd style="white-space:pre-wrap">${esc(sel.body)}</dd>${sel.response ? `<dt>الرد</dt><dd style="white-space:pre-wrap">${esc(sel.response)}</dd>` : ''}</dl>
      ${sel.status !== 'closed' ? `<form class="form" id="cmpresp"><label>${sel.response ? 'رد إضافي' : 'الرد على الطالب'}<textarea id="cm-resp" rows="3" maxlength="1000" required></textarea></label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input id="cm-close" type="checkbox" style="width:auto"> إغلاق الشكوى بعد الرد</label><div class="actions" style="margin:0"><button class="btn pri" type="submit">إرسال الرد</button></div></form>` : ''}` : '<div class="empty">اختر شكوى من القائمة.</div>';
    return `<div class="grid2"><section class="card"><h2>الشكاوى</h2><div class="chips">${fl.map((f) => `<button class="chip" data-act="cmpflt" data-f="${f[0]}" aria-pressed="${A.cfilter === f[0]}">${f[1]}</button>`).join('')}</div>
      <div class="tbl-wrap"><table><thead><tr><th>الموضوع</th><th>الطالب</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا شكاوى في هذا التصنيف.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>تفاصيل الشكوى</h2>${det}</section></div>`;
  }
  UA.views.comms = () => bar([['news', 'الأخبار'], ['complaints', 'الشكاوى']], A.ctab || 'news', 'cmtab') + ((A.ctab || 'news') === 'news' ? newsTab() : complaintsTab());
  Object.assign(UA.actions, {
    cmtab: async (el, d) => { A.ctab = d.t; UA.render(); },
    cmpflt: async (el, d) => { A.cfilter = d.f; A.csel = null; await UA.loaders.comms(); UA.render(); },
    cmpsel: async (el, d) => { A.csel = Number(d.id); UA.render(); },
    newsdel: async (el, d) => { if (!confirm('حذف هذا الخبر نهائياً؟')) return; await api('DELETE', '/api/news/' + d.id); await UA.loaders.comms(); UA.render(); toast('حُذف الخبر'); },
  });
  Object.assign(UA.forms, {
    newsadd: async () => {
      try { await api('POST', '/api/news', { title: val('nw-title'), body: val('nw-body'), pinned: document.getElementById('nw-pin').checked }); await UA.loaders.comms(); UA.render(); toast('نُشر الخبر'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    cmpresp: async () => {
      try { await api('POST', `/api/complaints/${A.csel}/respond`, { response: val('cm-resp'), close: document.getElementById('cm-close').checked }); await UA.loaders.comms(); UA.render(); toast('أُرسل الرد'); }
      catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
})();
