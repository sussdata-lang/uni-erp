/* واجهة الموظف: المواد والعلامات، والأخبار والشكاوى (تُضاف إلى نواة app.js عبر UA) */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
  const lvl = (n) => 'السنة ' + (LV[n - 1] || n);
  const sem = (n) => (n === 1 ? 'الفصل الأول' : 'الفصل الثاني');
  const defYear = () => { const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}/${y + 1}`; };

  const A = { tab: 'courses', programs: [], program: '', level: '', courses: [], gq: '', gres: null, gs: null, gdata: null, gcourses: [], gerr: '', news: [], cmps: [], cfilter: 'open', csel: null, cedit: null, nedit: null };
  UA.reset = () => Object.assign(A, { tab: 'courses', program: '', level: '', courses: [], gres: null, gs: null, gdata: null, news: [], cmps: [], csel: null, cedit: null, nedit: null });

  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const progOpts = (sel) => A.programs.map((p) => `<option value="${p.id}"${String(p.id) === String(sel) ? ' selected' : ''}>${esc(p.label || p.name)}</option>`).join('');
  const lvlOpts = (sel, all) => (all ? '<option value="">كل السنوات</option>' : '') + [1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}"${String(n) === String(sel) ? ' selected' : ''}>${lvl(n)}</option>`).join('');

  /* ---------- المواد والعلامات ---------- */
  async function loadCourses() {
    const q = new URLSearchParams(); if (A.program) q.set('program', A.program); if (A.level) q.set('level', A.level);
    A.courses = A.program ? (await api('GET', '/api/courses?' + q)).courses : [];
  }
  UA.loaders.academics = async () => {
    if (!A.programs.length) { A.programs = (await api('GET', '/api/programs')).programs.filter((p) => p.active); if (!A.program && A.programs.length) A.program = String(A.programs[0].id); }
    await loadCourses();
  };
  function coursesTab() {
    const rows = A.courses.map((c) => `<tr><td>${lvl(c.level)}</td><td>${sem(c.semester)}</td><td>${esc(c.name)}${c.code ? ` <span class="mono small">${esc(c.code)}</span>` : ''}</td><td>${c.hours}</td><td>${esc(c.instructor || '—')}</td>
      <td>${c.active ? '<span class="pill p-approved">فعّال</span>' : '<span class="pill p-rejected">معطَّل</span>'}</td><td><button class="btn sm" data-act="actoggle" data-id="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="acedit" data-id="${c.id}">تعديل</button> <button class="btn sm bad" data-act="acdel" data-id="${c.id}">حذف</button></td></tr>`).join('');
    const ce = A.cedit ? A.courses.find((c) => c.id === A.cedit) : null;
    return `<div class="grid2"><section class="card"><h2>دليل المواد</h2>
      <form class="inline-form" id="acfilter"><label>البرنامج<select id="ac-prog">${progOpts(A.program)}</select></label><label>السنة<select id="ac-lvl">${lvlOpts(A.level, true)}</select></label><button class="btn pri" type="submit">عرض</button></form>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>السنة</th><th>الفصل</th><th>المقرر</th><th>ساعات</th><th>المدرّس</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">لا مقررات بعد لهذا البرنامج. أضف أول مقرر من النموذج المجاور.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>${ce ? 'تعديل مقرر' : 'إضافة مقرر'}</h2><form class="form" id="acadd" style="border:0;margin:0;padding:0">
        <label>البرنامج<select id="ac-nprog"${ce ? ' disabled' : ''}>${progOpts(ce ? ce.programId : A.program)}</select></label>
        <div class="two"><label>السنة الدراسية<select id="ac-nlvl">${lvlOpts(ce ? ce.level : (A.level || 1))}</select></label><label>الفصل<select id="ac-nsem"><option value="1"${ce && ce.semester === 1 ? ' selected' : ''}>الأول</option><option value="2"${ce && ce.semester === 2 ? ' selected' : ''}>الثاني</option></select></label></div>
        <label>اسم المقرر<input id="ac-nname" maxlength="100" required value="${ce ? esc(ce.name) : ''}"></label>
        <div class="two"><label>الساعات<input id="ac-nhours" type="number" min="0" max="12" value="${ce ? ce.hours : 3}"></label><label>الرمز (اختياري)<input id="ac-ncode" maxlength="20" dir="ltr" value="${ce ? esc(ce.code || '') : ''}"></label></div>
        <label>المدرّس (اختياري)<input id="ac-ninst" maxlength="80" value="${ce ? esc(ce.instructor || '') : ''}"></label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">${ce ? 'حفظ التعديل' : 'إضافة المقرر'}</button>${ce ? '<button class="btn" type="button" data-act="acecancel">إلغاء</button>' : ''}</div></form></section></div>`;
  }
  function gradesTab() {
    const found = A.gres ? `<ul class="mini-list">${A.gres.length ? A.gres.map((s) => `<li><button class="link" data-act="acpick" data-id="${s.id}">${esc(s.name)} · <span class="mono">${esc(s.studentNo)}</span></button> <span class="small">${esc(s.program.name)} · ${esc(s.levelLabel)}</span></li>`).join('') : '<li class="empty">لا نتائج.</li>'}</ul>` : '';
    let right = '<div class="empty">ابحث عن طالب ثم اخترْه لإدخال علاماته.</div>';
    if (A.gs) {
      const g = A.gdata;
      const rows = g.grades.map((x) => `<tr><td>${esc(x.course)}</td><td>${lvl(x.level)} · ${sem(x.semester)}</td><td>${esc(x.academicYear || '')}</td><td>${x.theory ?? '—'}</td><td>${x.practical ?? '—'}</td><td><b>${x.total}</b></td><td><span class="pill ${x.passed ? 'p-approved' : 'p-rejected'}">${x.passed ? 'ناجح' : 'راسب'}</span>${x.previous.length ? ` <span class="small">(+${x.previous.length} سابقة)</span>` : ''}</td><td style="white-space:nowrap"><button class="btn sm" data-act="gredit" data-cid="${x.courseId ?? ''}" data-y="${esc(x.academicYear || '')}" data-th="${x.theory ?? ''}" data-pr="${x.practical ?? ''}">تعديل</button> <button class="btn sm bad" data-act="grdel" data-id="${x.id}">حذف</button></td></tr>`).join('');
      right = `<div class="me"><div class="avatar">${esc(A.gs.name[0])}</div><div><b>${esc(A.gs.name)}</b><small class="mono">${esc(A.gs.studentNo)} · ${esc(A.gs.program.name)} · ${esc(A.gs.levelLabel)}</small></div></div>
        ${A.gerr ? `<div class="err" role="alert" style="margin-top:12px">${esc(A.gerr)}</div>` : ''}
        <form class="form" id="acgrade"><label>المقرر<select id="gr-course" required><option value="">— اختر —</option>${A.gcourses.map((c) => `<option value="${c.id}">${lvl(c.level)} · ${sem(c.semester)} — ${esc(c.name)}</option>`).join('')}</select></label>
          <div class="two"><label>العام الدراسي<input id="gr-year" value="${defYear()}" dir="ltr" pattern="\\d{4}/\\d{4}" required></label><span></span></div>
          <div class="two"><label>العلامة النظرية<input id="gr-th" type="number" min="0" max="100" required></label><label>العلامة العملية<input id="gr-pr" type="number" min="0" max="100"></label></div>
          <div class="small">مجموع العلامتين لا يتجاوز 100، والنجاح من ${g.passMark}. إعادة إدخال العلامة لنفس المقرر والعام تعدّلها (ويُسجَّل ذلك).</div>
          <div class="actions" style="margin:0"><button class="btn pri" type="submit">حفظ العلامة</button></div></form>
        <div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>المقرر</th><th>السنة/الفصل</th><th>العام</th><th>نظري</th><th>عملي</th><th>المجموع</th><th>الحالة</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty">لا علامات مسجَّلة.</td></tr>'}</tbody></table></div>`;
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
    acedit: async (el, d) => { A.cedit = Number(d.id); UA.render(); window.scrollTo(0, 0); },
    acecancel: async () => { A.cedit = null; UA.render(); },
    acdel: async (el, d) => {
      const c = A.courses.find((x) => x.id === Number(d.id)); if (!c || !confirm(`حذف المقرر «${c.name}» نهائياً؟ (لا يُقبل الحذف إن كانت له علامات مسجَّلة)`)) return;
      try { await api('DELETE', '/api/courses/' + d.id); if (A.cedit === c.id) A.cedit = null; await loadCourses(); UA.render(); toast('حُذف المقرر'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    gredit: async (el, d) => {                      // يملأ نموذج الإدخال: الحفظ لنفس المقرر والعام يعدّل العلامة
      if (!d.cid) { toast('علامة قديمة غير مرتبطة بمقرر؛ يمكن حذفها فقط'); return; }
      document.getElementById('gr-course').value = d.cid; document.getElementById('gr-year').value = d.y; document.getElementById('gr-th').value = d.th; document.getElementById('gr-pr').value = d.pr;
      document.getElementById('acgrade').scrollIntoView({ block: 'center' }); document.getElementById('gr-th').focus();
    },
    grdel: async (el, d) => {
      if (!confirm('حذف هذه العلامة نهائياً؟')) return;
      try { A.gdata = await api('DELETE', `/api/students/${A.gs.id}/grades/${d.id}`); A.gerr = ''; UA.render(); toast('حُذفت العلامة'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
  Object.assign(UA.forms, {
    acfilter: async () => { A.program = val('ac-prog'); A.level = val('ac-lvl'); await loadCourses(); UA.render(); },
    acadd: async () => {
      const programId = Number(val('ac-nprog'));
      try {
        const body = { level: Number(val('ac-nlvl')), semester: Number(val('ac-nsem')), name: val('ac-nname'), hours: Number(val('ac-nhours')), code: val('ac-ncode'), instructor: val('ac-ninst') };
        if (A.cedit) { await api('PUT', '/api/courses/' + A.cedit, body); A.cedit = null; await loadCourses(); UA.render(); toast('حُفظ تعديل المقرر'); return; }
        await api('POST', '/api/courses', { programId, ...body });
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
    const ne = A.nedit ? A.news.find((n) => n.id === A.nedit) : null;
    return `<div class="grid2"><section class="card"><h2>${ne ? 'تعديل خبر' : 'نشر خبر'}</h2><form class="form" id="newsadd" style="border:0;margin:0;padding:0"><label>العنوان<input id="nw-title" maxlength="150" required value="${ne ? esc(ne.title) : ''}"></label>
        <label>النص<textarea id="nw-body" rows="5" maxlength="4000" required>${ne ? esc(ne.body) : ''}</textarea></label>${ne ? '<p class="small">لإضافة صور أو روابط أو حذفها استخدم الخبر في القائمة المجاورة.</p>' : `<label>صور أو فيديو (رفع مباشر)<input id="nw-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"></label>
        <label>روابط (رابط في كل سطر)<textarea id="nw-links" rows="3" dir="ltr" placeholder="https://youtu.be/...&#10;https://example.com/photo.jpg"></textarea></label>
        <p class="small">الرفع: صور حتى 5 ميغابايت (jpg/png/webp/gif) وفيديو حتى 50 ميغابايت (mp4/webm). الروابط: صورة أو فيديو مباشر (https) أو يوتيوب أو فيميو. حتى 8 وسائط للخبر.</p>
        `}<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input id="nw-pin" type="checkbox" style="width:auto"${ne && ne.pinned ? ' checked' : ''}> تثبيت في أعلى القائمة</label>
        <div class="actions" style="margin:0"><button class="btn pri" type="submit">${ne ? 'حفظ التعديل' : 'نشر'}</button>${ne ? '<button class="btn" type="button" data-act="newscancel">إلغاء</button>' : ''}</div></form></section>
      <section class="card"><h2>الأخبار المنشورة <span class="small">(${A.news.length})</span></h2>${A.news.length ? A.news.map((n) => `<article class="req"><div class="req-h"><b>${n.pinned ? '📌 ' : ''}${esc(n.title)}</b><span style="white-space:nowrap"><button class="btn sm" data-act="newsedit" data-id="${n.id}">تعديل</button> <button class="btn sm bad" data-act="newsdel" data-id="${n.id}">حذف</button></span></div><div class="no">${fmt(n.publishedAt)}</div><div class="hint" style="white-space:pre-wrap">${esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body)}</div>
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
