'use strict';
window.UA = { views: {}, actions: {}, loaders: {}, forms: {}, reset() {}, studentShell: () => '' };
(function () {
  const UA = window.UA;
  /* ---------- أدوات ---------- */
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => { try { return new Date(t).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(t).toISOString(); } };
  const dur = (ms) => { const m = Math.round(ms / 60000); if (m < 60) return m + ' دقيقة'; const h = m / 60; return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' ساعة'; };
  const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  function toast(m) { const t = $('#toast'); t.firstChild.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600); }

  async function api(method, url, body) {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch { /* ليس JSON */ }
    if (!res.ok) {
      const e = new Error((j && j.message) || 'حدث خطأ غير متوقع.'); e.status = res.status; e.code = j && j.error;
      if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/me') { S.me = null; render(); }
      throw e;
    }
    return j;
  }

  // رفع ملف خام (صور/فيديو الأخبار): النوع يُحدَّد في الخادم من البايتات لا من الامتداد
  async function upload(url, file) {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    let j = null; try { j = await res.json(); } catch { /* */ }
    if (!res.ok) { const e = new Error((j && j.message) || 'فشل رفع الملف.'); e.status = res.status; throw e; }
    return j;
  }
  // عرض وسائط الخبر: صورة، فيديو مباشر/مرفوع، أو تضمين يوتيوب/فيميو (روابط https معتمدة فقط من الخادم)
  function mediaHtml(list, { compact = false } = {}) {
    if (!list || !list.length) return '';
    return `<div class="news-media${compact ? ' compact' : ''}">${list.map((m) => {
      const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '';
      if (m.source === 'embed') return `<figure><div class="vid"><iframe src="${esc(m.src)}" title="${esc(m.caption || 'فيديو')}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>${cap}</figure>`;
      if (m.kind === 'video') return `<figure><video src="${esc(m.src)}" controls preload="metadata" playsinline></video>${cap}</figure>`;
      return `<figure><img src="${esc(m.src)}" alt="${esc(m.caption || 'صورة الخبر')}" loading="lazy" referrerpolicy="no-referrer">${cap}</figure>`;
    }).join('')}</div>`;
  }

  /* ---------- الحالة ---------- */
  const S = { uni: 'الجامعة السورية للعلوم الأمنية', me: null, services: [], view: null, requests: [], stats: null, sel: null, filter: 'all', rej: null, svc: null, files: {},
    vtext: '', vres: null, adminTab: 'holds', admin: {}, audit: null, chain: null, err: '',
    reg: null, stTab: 'requests', stList: { q: '', program: '', status: '', students: [], total: 0 }, stSel: null, stEdit: null, cred: null, fieldErr: null, profile: null, programs: [] };
  const can = (p) => !!S.me && S.me.permissions.includes(p);
  const ROLE_LABEL = { student: 'طالب', staff: 'موظف', admin: 'مدير النظام', auditor: 'مدقق' };

  function viewsFor(role) {
    if (role === 'student') return [['home', 'الرئيسية'], ['guide', 'دليل المواد'], ['grades', 'علاماتي'], ['news', 'الأخبار'], ['tx', 'معاملاتي']];
    // قوائم العاملين تُبنى من الصلاحيات الفعلية لا من اسم الدور، فتصلح للأدوار المخصّصة
    const v = [];
    if (can('request:read_all') || can('request:read_unit') || can('student:read') || can('student:register')) v.push(['affairs', can('student:read') || can('student:register') ? 'شؤون الطلاب' : 'الطلبات']);
    if (can('stats:read')) v.push(['dashboard', 'الإحصاءات']);
    if (can('course:manage') || can('grade:manage')) v.push(['academics', 'المواد والعلامات']);
    if (can('news:manage') || can('complaint:manage')) v.push(['comms', 'الأخبار والشكاوى']);
    if (can('student:register') || can('course:manage') || can('grade:manage')) v.push(['import', 'الاستيراد']);
    if (can('holds:manage') || can('rules:manage') || can('program:manage')) v.push(['admin', 'الإدارة']);
    if (can('user:manage') || can('role:manage')) v.push(['access', 'الحسابات والصلاحيات']);
    if (can('audit:read')) v.push(['audit', 'التدقيق']);
    return [...v, ['verify', 'التحقق العام']];
  }

  /* ---------- مكوّنات ---------- */
  const pill = (r) => { const m = { review: ['p-review', 'قيد المراجعة'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'] }[r.status]; return `<span class="pill ${m[0]}">${m[1]}</span>`; };
  function steps(r) {
    const auto = r.rejectedBy === 'auto';
    const s = [['تقديم الطلب', 'done'], ['الفحص الآلي', auto ? 'fail' : 'done'], ['مراجعة الموظف', auto ? '' : (r.status === 'review' ? 'cur' : 'done')], ['القرار', r.status === 'approved' ? 'done' : (r.status === 'rejected' ? 'fail' : '')]];
    return '<ol class="steps">' + s.map((x) => `<li class="${x[1]}">${x[0]}</li>`).join('') + '</ol>';
  }
  function detailsText(r) {
    const svc = S.services.find((s) => s.code === r.service.code);
    const parts = (svc ? svc.fields : []).filter((f) => r.details[f.name] !== undefined).map((f) => `${f.label}: ${r.details[f.name]}`);
    if (r.attachment) parts.push(`المرفق: ${r.attachment.name}`);
    return parts.join(' · ');
  }
  const events = (r) => '<ul class="events">' + r.events.map((e) => `<li>${fmt(e.at)} · ${esc(e.actor)}: ${esc(e.text)}</li>`).join('') + '</ul>';
  function reqCard(r) {
    return `<article class="req"><div class="req-h"><b>${esc(r.service.label)}</b>${pill(r)}</div>
      <div class="no">${esc(r.no)} · ${fmt(r.createdAt)}</div><div class="hint">${esc(detailsText(r))}</div>${steps(r)}
      ${r.status === 'rejected' ? `<div class="reason">سبب الرفض: ${esc(r.rejectReason)}</div>` : ''}
      ${r.document ? `<div class="actions" style="margin:0"><button class="btn pri sm" data-act="doc" data-c="${esc(r.document.code)}">عرض الوثيقة</button><span class="hint" style="align-self:center">رمز التحقق: <span class="mono">${esc(r.document.code)}</span></span></div>` : ''}
      ${events(r)}</article>`;
  }

  /* ---------- الشاشات ---------- */
  function loginView() {
    return `<form class="login card" id="loginform"><div class="login-hero"><img class="crest" src="/brand/crest.svg" alt="شعار ${esc(S.uni)}"><h1>نظام إدارة وأتمتة البيانات في الجامعة السورية للعلوم الأمنية</h1><div class="hint">${esc(S.uni)} · قسم شؤون الطلاب</div></div>
      ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
      <label>اسم المستخدم<input id="lg-u" autocomplete="username" required></label>
      <label>كلمة المرور<input id="lg-p" type="password" autocomplete="current-password" required></label>
      <button class="btn pri" type="submit">دخول</button>
      <div class="actions" style="margin:0 22px 22px"><button class="btn sm" type="button" data-act="goverify">التحقق من وثيقة (بدون دخول)</button></div></form>`;
  }
  const siteFoot = () => `<footer class="site-foot"><div class="wrap"><div class="f-brand"><img class="crest sm" src="/brand/crest.svg" alt=""><div><b>${esc(S.uni)}</b><span class="gold">وزارة الداخلية · دمشق</span></div></div><div>جميع الحقوق محفوظة للجامعة السورية للعلوم الأمنية © 2026</div></div></footer>`;
  function header() {
    const tabs = viewsFor(S.me?.role ?? 'public').map((t) => `<button class="tab" role="tab" data-act="view" data-v="${t[0]}" aria-selected="${S.view === t[0]}">${t[1]}</button>`).join('');
    const who = S.me ? `<div class="who"><span><b>${esc(S.me.name)}</b> · ${esc(S.me.roleLabel || ROLE_LABEL[S.me.role])}${S.me.unit ? ` · ${esc(S.me.unit.name)}` : ''}</span><button class="btn sm" data-act="logout">خروج</button></div>`
      : '<div class="who"><button class="btn sm" data-act="tologin">تسجيل الدخول</button></div>';
    return `<header class="top"><div class="wrap"><div class="brand"><img class="crest" src="/brand/crest.svg" alt="" width="40" height="48"><div class="t"><b>نظام إدارة وأتمتة البيانات في الجامعة السورية للعلوم الأمنية</b><span>${esc(S.uni)} · قسم شؤون الطلاب</span></div></div>
      <div class="tabs" role="tablist">${tabs}</div>${who}</div></header><div class="wrap" style="padding-top:16px">`;
  }

  function editCard(a) {
    const e = S.edit; if (!e) return '';
    if (e.type === 'fac') {
      const f = (a.faculties || []).find((x) => x.id === e.id); if (!f) return '';
      const KINDS = { college: 'كلية', institute: 'معهد', center: 'مركز' };
      return `<section class="card" id="editcard"><h2>تعديل جهة: ${esc(f.name)}</h2><div class="inline-form">
        <label>الاسم بالعربية<input id="ed-name" maxlength="80" value="${esc(f.name)}"></label>
        <label>الاسم بالإنكليزية<input id="ed-en" maxlength="100" dir="ltr" value="${esc(f.nameEn)}"></label>
        <label>الرمز<input id="ed-code" maxlength="8" dir="ltr" value="${esc(f.code)}"${f.students ? ' disabled' : ''}></label>
        <label>النوع<select id="ed-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <button class="btn pri" data-act="facsave" data-id="${f.id}">حفظ</button><button class="btn" data-act="editcancel">إلغاء</button></div>
        ${f.students ? '<p class="small">الرمز مقفل لأن في هذه الجهة طلاباً صدرت أرقامهم الجامعية به.</p>' : ''}</section>`;
    }
    const p = (a.programs || []).find((x) => x.id === e.id); if (!p) return '';
    return `<section class="card" id="editcard"><h2>تعديل برنامج: ${esc(p.name)} <span class="small">(${esc(p.faculty)})</span></h2><div class="inline-form">
      <label>اسم البرنامج<input id="ed-name" maxlength="80" value="${esc(p.name)}"></label>
      <label>الدرجة<input id="ed-deg" maxlength="30" value="${esc(p.degree)}"></label>
      <label>المدة (سنوات)<input id="ed-years" type="number" min="1" max="4" value="${p.years}"></label>
      <button class="btn pri" data-act="progsave" data-id="${p.id}">حفظ</button><button class="btn" data-act="editcancel">إلغاء</button></div></section>`;
  }
  function affairsView() {
    const st = S.stats;
    const stats = st ? `<div class="stats"><div class="stat"><small>قيد المراجعة</small><b>${st.review}</b></div><div class="stat"><small>معتمدة</small><b>${st.approved}</b></div><div class="stat"><small>مرفوضة</small><b>${st.rejected}</b></div><div class="stat"><small>متوسط زمن الاعتماد</small><b style="font-size:20px">${st.avgApprovalMs ? dur(st.avgApprovalMs) : '-'}</b></div></div>
      ${st.slaBreaches ? `<p class="reason" style="margin-top:12px">${st.slaBreaches} طلب تجاوز مدة الخدمة المعتمدة (SLA).</p>` : ''}` : '';

    const tabs = [['requests', can('request:decide') ? 'سجل الطلبات' : 'الطلبات']];
    if (can('student:read')) tabs.push(['list', 'سجل الطلاب']);
    if (can('student:register')) tabs.push(['new', 'تسجيل طالب جديد']);
    const cur = S.stTab === 'edit' ? 'list' : S.stTab;
    const bar = `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="sttab" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}${t[0] === 'requests' && st && st.review ? ` <span class="badge-n">${st.review}</span>` : ''}</button>`).join('')}</div>`;
    return `${stats}<div style="margin-top:16px">${bar}</div>` + (S.stTab === 'requests' || !tabs.some((t) => t[0] === cur) ? requestsBody() : studentsView());
  }

  function requestsBody() {
    const canDecide = can('request:decide');
    const fl = [['all', 'الكل'], ['review', 'قيد المراجعة'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة']];
    const list = S.requests.filter((r) => S.filter === 'all' || r.status === S.filter);
    const sel = S.requests.find((r) => r.id === S.sel);
    const rows = list.map((r) => `<tr class="row" tabindex="0" data-act="sel" data-id="${r.id}" aria-selected="${S.sel === r.id}"><td>${esc(r.service.label)}${r.unit ? `<div class="small">عند: ${esc(r.unit.name)}</div>` : ''}</td><td>${esc(r.student.name)}</td><td>${pill(r)}</td><td class="hint" style="white-space:nowrap">${fmt(r.createdAt)}</td></tr>`).join('');
    return `<div class="grid2"><section class="card"><h2>سجل الطلبات</h2><div class="chips">${fl.map((f) => `<button class="chip" data-act="flt" data-f="${f[0]}" aria-pressed="${S.filter === f[0]}">${f[1]}</button>`).join('')}</div>
      <div class="tbl-wrap"><table><thead><tr><th>الخدمة</th><th>الطالب</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا طلبات في هذا التصنيف.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>تفاصيل الطلب</h2>${sel ? staffDetail(sel, canDecide) : '<div class="empty">اختر طلباً من السجلات.</div>'}</section></div>`;
  }
  function staffDetail(r, canDecide) {
    const auto = r.rejectedBy === 'auto';
    let act = '';
    if (r.status === 'review' && canDecide) {
      act = `<div class="actions"><button class="btn ok" data-act="approve" data-id="${r.id}">اعتماد وإصدار الوثيقة</button><button class="btn bad" data-act="rejform" data-id="${r.id}">رفض</button></div>` +
        (S.rej === r.id ? `<div class="form" style="margin-top:12px"><label>سبب الرفض (يظهر للطالب)<textarea id="rej-text" rows="2" maxlength="300"></textarea></label><div class="actions" style="margin:0"><button class="btn bad" data-act="reject" data-id="${r.id}">تأكيد الرفض</button></div></div>` : '');
    } else if (r.document) act = `<div class="actions"><button class="btn pri" data-act="doc" data-c="${esc(r.document.code)}">عرض الوثيقة</button></div>`;
    if (r.status === 'review' && can('request:forward') && (S.targets || []).length) {
      const opts = S.targets.filter((t) => !r.unit || t.id !== r.unit.id);
      if (opts.length) act += `<div class="form fwd-box" style="margin-top:12px"><b>إحالة الطلب إلى وحدة مرتبطة</b><label>الوحدة<select id="fw-unit">${opts.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <label>ملاحظة للجهة المستلمة (اختياري)<input id="fw-note" maxlength="300"></label><div class="actions" style="margin:0"><button class="btn" data-act="fwd" data-id="${r.id}">إحالة</button></div></div>`;
    }
    else if (r.status === 'rejected') act = `<div class="reason" style="margin-top:8px">${esc(r.rejectReason)}</div>`;
    const att = r.attachment ? `<dt>المرفق</dt><dd><a href="/api/attachments/${r.attachment.id}">${esc(r.attachment.name)}</a> <span class="small">(${Math.round(r.attachment.size / 1024)} ك.ب)</span></dd>` : '';
    return `<dl class="kv"><dt>الطلب</dt><dd>${esc(r.service.label)} <span class="no">${esc(r.no)}</span></dd><dt>الطالب</dt><dd>${esc(r.student.name)} · ${esc(r.student.studentNo)}${can('student:read') && r.student.id ? ` <button class="link" data-act="openstud" data-id="${r.student.id}">فتح ملف الطالب</button>` : ''}</dd><dt>التفاصيل</dt><dd>${esc(detailsText(r))}</dd><dt>الحالة</dt><dd>${pill(r)}</dd><dt>الجهة الحالية</dt><dd>${r.unit ? esc(r.unit.name) : '<span class="hint">غير محال</span>'}</dd>${r.decidedAt ? `<dt>زمن المعالجة</dt><dd>${dur(r.decidedAt - r.createdAt)}</dd>` : ''}${att}</dl>
      <b style="display:block;margin-top:12px;font-size:14px">الفحص الآلي</b><ul class="checks"><li class="${auto ? 'x' : ''}">${auto ? esc(r.rejectReason) : 'اجتاز كل القواعد المفعَّلة'}</li></ul>${act}<div style="margin-top:12px">${events(r)}</div>`;
  }

  function adminView() {
    const tabs = [['holds', 'اللجنة التأديبية', can('holds:manage')], ['rules', 'قواعد الفحص الآلي', can('rules:manage')], ['programs', 'الكليات والبرامج', can('program:manage')]].filter((t) => t[2]);
    if (!tabs.some((t) => t[0] === S.adminTab)) S.adminTab = tabs[0] ? tabs[0][0] : 'holds';
    const bar = `<div class="sub-tabs">${tabs.map((t) => `<button class="chip" data-act="atab" data-t="${t[0]}" aria-pressed="${S.adminTab === t[0]}">${t[1]}</button>`).join('')}</div>`;
    const a = S.admin;
    if (S.adminTab === 'holds') {
      return bar + `<section class="card"><h2>تسجيل عقوبة على طالب</h2><div class="inline-form"><label>الرقم الجامعي<input id="h-no" placeholder="CSS-2026-0001" dir="ltr"></label>
        <label>النوع<select id="h-type"><option value="financial">مالية</option><option value="disciplinary">تأديبية</option><option value="library">مكتبة</option></select></label><label>ملاحظة<input id="h-note" maxlength="200"></label><button class="btn pri" data-act="addhold">تسجيل</button></div></section>
        <section class="card" style="margin-top:16px"><h2>العقوبات</h2><div class="tbl-wrap"><table><thead><tr><th>الطالب</th><th>النوع</th><th>الملاحظة</th><th>الحالة</th><th></th></tr></thead><tbody>${(a.holds || []).map((h) => `<tr><td>${esc(h.student)} <span class="small">${esc(h.studentNo)}</span></td><td>${{ financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' }[h.holdType]}</td><td>${esc(h.note)}</td><td>${h.active ? '<span class="bad-t">قائمة</span>' : '<span class="ok-t">مسددة</span>'}</td><td style="white-space:nowrap">${h.active ? `<button class="btn sm" data-act="clearhold" data-id="${h.id}">تسوية</button> ` : ''}<button class="btn sm" data-act="edithold" data-id="${h.id}">تعديل</button> <button class="btn sm bad" data-act="delhold" data-id="${h.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">لا ذمم مسجلة.</td></tr>'}</tbody></table></div></section>`;
    }
    if (S.adminTab === 'rules') {
      return bar + `<section class="card"><h2>قواعد الفحص الآلي</h2><p class="hint">تُطبَّق على كل طلب قبل وصوله للموظف. التعطيل والتفعيل والتعديل والحذف تُسجَّل في سجل التدقيق.</p><div class="tbl-wrap"><table><thead><tr><th>القاعدة</th><th>الخدمة</th><th>رسالة الرفض</th><th></th></tr></thead><tbody>${(a.rules || []).map((r) => `<tr><td class="mono">${esc(r.kind)} ${esc(r.params)}</td><td>${esc(r.service ?? 'كل الخدمات')}</td><td>${esc(r.message)}</td><td style="white-space:nowrap"><button class="btn sm" data-act="rule" data-id="${r.id}" data-on="${r.enabled ? 0 : 1}">${r.enabled ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="editrule" data-id="${r.id}">تعديل</button> <button class="btn sm bad" data-act="delrule" data-id="${r.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
    }
    const KIND = { college: 'كلية', institute: 'معهد', center: 'مركز' };
    const facs = a.faculties || [];
    return bar + editCard(a) + `<section class="card"><h2>الكليات والمعاهد والمراكز</h2><p class="hint">الرمز اللاتيني (الأحرف الأولى من الاسم الإنكليزي) يبدأ به اسم المستخدم والرقم الجامعي للطلاب الجدد، مثل <span class="mono" dir="ltr">CSS-2026-0001</span>. الطلاب الحاليون يحتفظون بأرقامهم.</p>
      <div class="tbl-wrap"><table><thead><tr><th>الجهة</th><th>الاسم الإنكليزي</th><th>الرمز</th><th>البرامج</th><th>الطلاب</th><th></th></tr></thead><tbody>${facs.map((f) => `<tr><td>${esc(f.name)} <span class="small">(${KIND[f.kind]})</span></td><td dir="ltr" style="text-align:right">${esc(f.nameEn)}</td><td class="mono">${esc(f.code)}</td><td>${f.programs}</td><td>${f.students}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-act="factoggle" data-id="${f.id}" data-on="${f.active ? 0 : 1}">${f.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="facedit" data-id="${f.id}">تعديل</button> <button class="btn sm bad" data-act="facdel" data-id="${f.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card" style="margin-top:16px"><h2>إضافة جهة</h2><div class="inline-form"><label>الاسم بالعربية<input id="fc-name" maxlength="80"></label><label>الاسم بالإنكليزية<input id="fc-en" maxlength="100" dir="ltr" placeholder="College of ..."></label>
        <label>الرمز (اختياري)<input id="fc-code" maxlength="8" dir="ltr" placeholder="يُولَّد تلقائياً"></label><label>النوع<select id="fc-kind"><option value="college">كلية</option><option value="institute">معهد</option><option value="center">مركز</option></select></label><button class="btn pri" data-act="addfac">إضافة</button></div>
        <p class="small">تُنشأ للجهة الجديدة برنامج أساسي يحمل اسمها، ويمكن إضافة برامج أخرى تحتها.</p></section>
      <section class="card" style="margin-top:16px"><h2>برنامج أكاديمي جديد</h2><div class="inline-form"><label>الكلية / المعهد<select id="pg-fac">${facs.filter((f) => f.active).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label><label>البرنامج<input id="pg-name" maxlength="80"></label><label>الدرجة<input id="pg-deg" value="بكالوريوس" maxlength="30"></label>
        <label>المدة (سنوات)<input id="pg-years" type="number" min="1" max="4" value="4"></label><button class="btn pri" data-act="addprog">إضافة</button></div><p class="small">البرامج المعطَّلة تختفي من نموذج التسجيل، ويبقى الطلاب المسجَّلون فيها.</p></section>
      <section class="card" style="margin-top:16px"><h2>البرامج</h2><div class="tbl-wrap"><table><thead><tr><th>الجهة</th><th>البرنامج</th><th>المدة</th><th>الطلاب</th><th></th></tr></thead><tbody>${(a.programs || []).map((p) => `<tr${p.active ? '' : ' style="opacity:.55"'}><td>${esc(p.faculty)}${p.facultyCode ? ` <span class="mono small">${esc(p.facultyCode)}</span>` : ''}</td><td>${p.faculty === p.name ? esc(p.degree) : `${esc(p.degree)} ${esc(p.name)}`}</td><td>${p.years}</td><td>${p.students}</td><td style="white-space:nowrap"><button class="btn sm" data-act="progtoggle" data-id="${p.id}" data-on="${p.active ? 0 : 1}">${p.active ? 'تعطيل' : 'تفعيل'}</button> <button class="btn sm" data-act="progedit" data-id="${p.id}">تعديل</button> <button class="btn sm bad" data-act="progdel" data-id="${p.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }


  /* ---------- تغيير كلمة المرور الإلزامي ---------- */
  function mustChangeView() {
    return `<form class="login card" id="pwform"><h1>تغيير كلمة المرور</h1><div class="hint">سُجِّل دخولك بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك للمتابعة.</div>
      ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
      <label>كلمة المرور المؤقتة المعطى سابقا<input id="pw-cur" type="password" autocomplete="current-password" required></label>
      <label>كلمة المرور الجديدة<input id="pw-new" type="password" autocomplete="new-password" required minlength="10"></label>
      <label>تأكيد كلمة المرور الجديدة<input id="pw-new2" type="password" autocomplete="new-password" required minlength="10"></label>
      <div class="small">10 أحرف على الأقل، وتحوي حروفاً وأرقاماً.</div>
      <button class="btn pri" type="submit">حفظ ومتابعة</button><button class="btn sm" type="button" data-act="logout">خروج</button></form>`;
  }

  /* ---------- تسجيل الطلاب ---------- */
  const STATUS_CLS = { active: 'p-approved', suspended: 'p-review', withdrawn: 'p-rejected', transferred: 'p-rejected', graduated: 'p-review' };
  const spill = (st, label) => `<span class="pill ${STATUS_CLS[st] || ''}">${esc(label)}</span>`;
  const today = () => new Date().toISOString().slice(0, 10);

  function fieldHtml(f, v) {
    const id = 'sf-' + f.name, req = f.required ? ' required' : '', inv = S.fieldErr === f.name ? ' aria-invalid="true"' : '';
    const val0 = v === undefined || v === null ? (f.default ?? '') : v;
    let ctl;
    if (f.type === 'select' || f.type === 'program') {
      ctl = `<select id="${id}"${req}${inv}>${f.required && f.type === 'program' ? '<option value="">— اختر —</option>' : (f.required ? '' : '<option value="">—</option>')}${f.options.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(val0) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    } else if (f.type === 'longtext') ctl = `<textarea id="${id}" rows="2" maxlength="${f.max}"${inv}>${esc(val0)}</textarea>`;
    else if (f.type === 'date') ctl = `<input id="${id}" type="date" max="${today()}" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'int') ctl = `<input id="${id}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'num') ctl = `<input id="${id}" type="number" inputmode="decimal" min="0" max="${f.max}" step="any" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'tel') ctl = `<input id="${id}" type="tel" inputmode="tel" dir="ltr" pattern="\\+?[0-9][0-9 \\-]{6,19}" value="${esc(val0)}" placeholder="09xxxxxxxx"${req}${inv}>`;
    else if (f.type === 'email') ctl = `<input id="${id}" type="email" dir="ltr" maxlength="120" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'nid') ctl = `<input id="${id}" dir="ltr" inputmode="numeric" maxlength="20" pattern="[0-9A-Za-z ]{6,20}" autocomplete="off" value="${esc(val0)}"${req}${inv}>`;
    else if (f.type === 'latin') ctl = `<input id="${id}" dir="ltr" maxlength="${f.max}" value="${esc(val0)}"${req}${inv}>`;
    else ctl = `<input id="${id}" type="text" maxlength="${f.max ?? 100}" value="${esc(val0)}"${req}${inv}>`;
    return `<label class="${f.wide ? 'wide' : ''}"><span>${esc(f.label)}${f.required ? ' <i class="req-m" aria-hidden="true">*</i>' : ''}</span>${ctl}${f.hint ? `<span class="small">${esc(f.hint)}</span>` : ''}</label>`;
  }
  function studentForm(values, edit) {
    const secs = S.reg.sections.map((sec, i) => `<fieldset class="sec"><legend><span class="n">${i + 1}</span>${esc(sec.title)}</legend><div class="fgrid">${sec.fields.filter((f) => edit || !f.editOnly).map((f) => fieldHtml(f, values[f.name])).join('')}</div></fieldset>`).join('');
    return `<form id="regform" class="regform" novalidate-off>${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}${secs}
      <div class="actions sticky-actions"><button class="btn pri" type="submit">${edit ? 'حفظ التعديلات' : 'تسجيل الطالب'}</button><button class="btn" type="button" data-act="${edit ? 'stcancel' : 'stclear'}">${edit ? 'إلغاء' : 'تفريغ النموذج'}</button>
      <span class="small" style="align-self:center">الحقول المعلَّمة بـ <i class="req-m">*</i> إلزامية. يُولَّد الرقم الجامعي وكلمة المرور المؤقتة تلقائياً.</span></div></form>`;
  }
  function credCard() {
    const c = S.cred; if (!c) return '';
    return `<section class="card cred" id="credcard"><h2>تم تسجيل الطالب</h2><p class="hint" style="margin-top:0"><b>${esc(c.name)}</b> — سلِّم هذه البيانات للطالب الآن. كلمة المرور المؤقتة تُعرض مرة واحدة فقط، وسيُطلب منه تغييرها عند أول دخول.</p>
      <dl class="kv big"><dt>الرقم الجامعي (اسم المستخدم)</dt><dd class="mono" dir="ltr">${esc(c.username)}</dd><dt>كلمة المرور المؤقتة</dt><dd class="mono" dir="ltr">${esc(c.tempPassword)}</dd></dl>
      <div class="actions no-print"><button class="btn pri" data-act="credcopy">نسخ</button><button class="btn" data-act="credprint">طباعة</button><button class="btn" data-act="credopen">فتح ملف الطالب</button><button class="btn" data-act="crednew">تسجيل طالب آخر</button></div></section>`;
  }
  function studentsView() {
    if (!S.reg) return '<div class="empty">جارٍ التحميل…</div>';
    const bar = '';
    if (S.stTab === 'new') return bar + (S.cred ? credCard() : `<section class="card"><h2>تسجيل طالب جديد</h2>${studentForm(S.newVals || {}, false)}</section>`);
    if (S.stTab === 'edit' && S.stEdit) return bar + `<section class="card"><h2>تعديل ملف: ${esc(S.stEdit.name)} <span class="mono small">${esc(S.stEdit.studentNo)}</span></h2>${studentForm(S.stEdit.profile, true)}</section>`;
    const L = S.stList, progOpts = S.reg.sections.flatMap((x) => x.fields).find((f) => f.name === 'program_id').options;
    const rows = L.students.map((st) => `<tr class="row" tabindex="0" data-act="stsel" data-id="${st.id}" aria-selected="${S.stSel && S.stSel.id === st.id}"><td class="mono">${esc(st.studentNo)}</td><td>${esc(st.name)}</td><td class="hint">${esc(st.program.label || st.program.name)} · ${esc(st.levelLabel)}</td><td>${spill(st.status, st.statusLabel)}</td></tr>`).join('');
    return bar + `<div class="grid2"><section class="card"><h2>سجل الطلاب <span class="small">(${L.total})</span></h2>
      <form class="inline-form" id="stsearch"><label>بحث<input id="st-q" value="${esc(L.q)}" placeholder="اسم، رقم جامعي، رقم وطني، هاتف" maxlength="60"></label>
        <label>البرنامج<select id="st-prog"><option value="">الكل</option>${progOpts.map((o) => `<option value="${o.v}"${String(o.v) === String(L.program) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
        <label>الحالة<select id="st-status"><option value="">الكل</option>${Object.entries(S.reg.statuses).map(([k, v]) => `<option value="${k}"${k === L.status ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <button class="btn pri" type="submit">بحث</button></form>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>البرنامج</th><th>الحالة</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا طلاب مسجَّلون بعد. ابدأ بـ «تسجيل طالب جديد».</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>ملف الطالب</h2>${S.stSel ? studentDetail(S.stSel) : '<div class="empty">اختر طالباً من السجل لعرض ملفه.</div>'}</section></div>`;
  }
  const kvrow = (k, v) => (v === null || v === undefined || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`);
  function profileKv(st) {
    const p = st.profile, F = Object.fromEntries(S.reg ? S.reg.sections.flatMap((x) => x.fields).map((f) => [f.name, f]) : []);
    const lab = (n) => (F[n] ? F[n].label : n);
    return S.profSections.map((sec) => `<h3 class="sec-h">${esc(sec.title)}</h3><dl class="kv">${sec.fields.map((f) => {
      if (f.name === 'status') return kvrow(lab('status'), st.statusLabel);
      if (f.name === 'program_id') return kvrow('الكلية والبرنامج', st.program.label);
      if (f.name === 'study_level') return kvrow(lab('study_level'), st.levelLabel);
      return kvrow(lab(f.name), p[f.name]);
    }).join('')}${sec.id === 'certificate' && st.hsPercent !== null ? kvrow('النسبة المئوية', st.hsPercent + '%') : ''}</dl>`).join('');
  }
  function relatedRequests(st) {
    const rs = (S.requests || []).filter((r) => r.student && r.student.studentNo === st.studentNo);
    if (!rs.length) return '';
    return `<h3 class="sec-h">طلبات الطالب</h3><ul class="mini-list">${rs.map((r) => `<li><button class="link" data-act="reqopen" data-id="${r.id}">${esc(r.service.label)} · <span class="mono">${esc(r.no)}</span></button> ${pill(r)}</li>`).join('')}</ul>`;
  }
  function studentDetail(st) {
    return `<div class="me"><div class="avatar">${esc(st.name[0])}</div><div><b>${esc(st.name)}</b><small class="mono">${esc(st.studentNo)}</small></div></div>
      <div style="margin:8px 0">${spill(st.status, st.statusLabel)} ${st.activeHolds ? `<span class="pill p-rejected">${st.activeHolds} عقوبة قائمة</span>` : ''}</div>
      <div class="actions no-print"><button class="btn pri sm" data-act="stedit">تعديل</button><button class="btn sm" data-act="stpw">إعادة تعيين كلمة المرور</button><button class="btn sm" data-act="stcert">شهادة التسجيل الموقَّعة (PDF)</button>${can('student:delete') ? '<button class="btn sm bad" data-act="stdel">حذف الطالب</button>' : ''}</div>${S.stCert ? `<p class="small">رمز التحقق <span class="mono" dir="ltr">${esc(S.stCert.code)}</span> · ${S.stCert.tsaStatus === 'rfc3161' ? 'ختم زمني موثوق' : S.stCert.tsaStatus === 'failed' ? 'تعذّر الختم الموثوق' : 'ختم زمني محلي'} · بصمة <span class="mono" dir="ltr">${esc(S.stCert.pdfSha256.slice(0, 16))}…</span>${S.stCert.selfSigned ? ' · شهادة ذاتية' : ''}</p>` : ''}
      ${relatedRequests(st)}${profileKv(st)}<p class="small">سُجِّل ${fmt(st.createdAt)} · آخر تعديل ${fmt(st.updatedAt)}</p>`;
  }
  function auditView() {
    const c = S.chain;
    return `<section class="card"><h2>سجل التدقيق (إضافة فقط)</h2><div class="actions" style="margin-top:0"><button class="btn pri sm" data-act="chain">تحقق من سلامة السلسلة</button>
      ${c ? `<span class="${c.ok ? 'ok-t' : 'bad-t'}" style="align-self:center">${c.ok ? `السلسلة سليمة (${c.checked} سجلاً)` : `كُسرت السلسلة عند السجل ${c.brokenAtId}`}</span>` : ''}</div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>الوقت</th><th>المنفِّذ</th><th>الإجراء</th><th>المرجع</th><th>IP</th></tr></thead><tbody>${(S.audit || []).map((a) => `<tr><td>${a.id}</td><td style="white-space:nowrap">${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.ref)}</td><td class="mono">${esc(a.ip ?? '')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function verifyView() {
    const r = S.vres; let res = '';
    if (r) {
      if (r.valid && r.kind === 'enrollment') {
        const sg = r.signature, ts = sg.timestamp, tsTxt = ts.status === 'rfc3161' ? `ختم زمني موثوق (RFC 3161) بتاريخ ${fmt(ts.time)}${ts.embedded && ts.imprintOk ? ' — مطابق لبصمة التوقيع' : ''}` : ts.status === 'failed' ? 'تعذّر الحصول على ختم زمني موثوق وقت الإصدار؛ يُعتمد وقت الخادم' : 'وقت التوقيع من خادم الجامعة (دون جهة ختم خارجية)';
        res = `<div class="result good"><h3>الشهادة صحيحة وموقَّعة رقمياً</h3><dl class="kv"><dt>النوع</dt><dd>${esc(r.service)}</dd><dt>الطالب</dt><dd>${esc(r.student)}</dd><dt>الكلية / المعهد</dt><dd>${esc(r.faculty)}</dd><dt>وقت التوقيع</dt><dd>${fmt(sg.signingTime ? new Date(sg.signingTime).getTime() : r.issuedAt)}</dd>
          <dt>بصمة الملف SHA-256</dt><dd class="mono" dir="ltr">${esc(r.hashPrefix)}…</dd><dt>الموقِّع (X.509)</dt><dd dir="ltr" style="text-align:right">${esc(sg.signer)}</dd><dt>الختم الزمني</dt><dd>${esc(tsTxt)}</dd></dl>
          <p class="hint" style="margin-bottom:0">أُعيد فحص الملف المحفوظ لدى الجامعة: بصمته وتوقيعه سليمان.${sg.selfSigned ? ' <b>تنبيه:</b> شهادة التوقيع ذاتية الإصدار ولم تصدر عن جهة اعتماد علنية، لذا قد تعرضها قارئات PDF «موقِّع غير معروف» رغم سلامة البصمة.' : ''}</p></div>`;
      } else if (r.valid) res = `<div class="result good"><h3>الوثيقة صحيحة وصادرة عن الجامعة</h3><dl class="kv"><dt>النوع</dt><dd>${esc(r.service)}</dd><dt>الطالب</dt><dd>${esc(r.student)}</dd><dt>تاريخ الإصدار</dt><dd>${fmt(r.issuedAt)}</dd><dt>بصمة الوثيقة</dt><dd class="mono">${esc(r.hashPrefix)}…</dd></dl><p class="hint" style="margin-bottom:0">أُعيد حساب البصمة والتوقيع من سجل الجامعة وطابقا المخزَّنين وقت الإصدار.</p></div>`;
      else if (r.reason === 'tampered') res = '<div class="result badr"><h3>تحذير: بيانات الوثيقة لا تطابق السجل</h3>فشل التحقق من البصمة أو التوقيع، فقد تكون الوثيقة عُدِّلت.</div>';
      else if (r.reason === 'malformed') res = '<div class="result badr"><h3>صيغة الرمز غير صحيحة</h3>الصيغة المتوقعة: UV-XXXX-XXXX</div>';
      else res = '<div class="result badr"><h3>الوثيقة غير موجودة</h3>لا توجد وثيقة بهذا الرمز في سجلات الجامعة.</div>';
    }
    return `<div class="verify"><section class="card"><h2>التحقق من وثيقة صادرة</h2><p class="hint" style="margin-top:0">امسح رمز QR على الوثيقة أو اكتب الرمز المطبوع أسفلها. لا تُعرض بيانات الطالب الكاملة.</p>
      <form class="vform" id="vform"><input id="vcode" type="text" placeholder="UV-XXXX-XXXX" autocomplete="off" value="${esc(S.vtext)}" aria-label="رمز التحقق"><button class="btn pri" type="submit">تحقق</button></form>
      <div class="vfile"><label class="hint">أو افحص ملف PDF نفسه: يُحسب SHA-256 على جهازك ولا يُرفع الملف<input type="file" id="vfile" accept="application/pdf,.pdf"></label></div></section>${res}</div>`;
  }

  function docHtml(d) {
    const p = d.payload, st = p.student, who = `<b>${esc(st.name)}</b> (الرقم الجامعي ${esc(st.studentNo)})`;
    let body = '';
    if (p.service.code === 'attendance') body = `<p>تشهد ${esc(p.university)} بأن الطالب/ـة ${who} مقيَّد/ـة في برنامج «${esc(st.program)}»، وهو/هي على رأس دراسته/ا حتى تاريخ إصدار هذه الإفادة.</p><p>أُعطيت هذه الإفادة بناءً على طلبه/ا لتقديمها إلى: ${esc(p.details.purpose)}.</p>`;
    if (p.service.code === 'transcript') body = `<p>كشف علامات الطالب/ـة ${who}:</p><table><thead><tr><th>المقرر</th><th>الفصل</th><th>الساعات</th><th>العلامة</th></tr></thead><tbody>${p.transcript.grades.map((g) => `<tr><td>${esc(g.course)}</td><td>${esc(g.term)}</td><td>${g.hours}</td><td>${g.mark}</td></tr>`).join('')}</tbody></table><p style="margin-bottom:0">المعدل المرجَّح: ${p.transcript.average ?? '-'} من 100.</p>`;
    if (p.service.code === 'excellence_year') body = `<p>تشهد ${esc(p.university)} بأنه تقرر قبول تسجيل الطالب/ـة ${who}، المقيَّد/ـة في برنامج «${esc(st.program)}»، في سنة الامتياز للعام الدراسي ${esc(p.details.academic_year)}.</p>${p.details.notes ? `<p>ملاحظات: ${esc(p.details.notes)}</p>` : ''}`;
    if (p.service.code === 'excuse') body = `<p>بعد مراجعة المرفقات والتحقق من استيفائها للمدة النظامية، تقرر قبول العذر المقدَّم من الطالب/ـة ${who} عن امتحان مقرر «${esc(p.details.course)}» بتاريخ ${esc(p.details.exam_date)} (السبب: ${esc(p.details.reason)})، وتحديد موعد امتحان بديل.</p>`;
    return `<div class="doc"><div class="doc-head"><img class="crest" src="/brand/crest.svg" alt=""><h2>${esc(p.university)}</h2></div><div class="sub">قسم شؤون الطلاب · ${esc(p.service.label)}</div><hr>${body}
      <div class="doc-foot"><div><span class="stamp">موقّعة رقمياً</span><div style="margin-top:8px">رقم الطلب: <span class="mono">${esc(p.requestNo)}</span></div><div>تاريخ الإصدار: ${fmt(p.issuedAt)}</div><div>رمز التحقق: <span class="mono">${esc(d.code)}</span></div><div>البصمة: <span class="mono">${esc(d.hash.slice(0, 20))}…</span></div></div><div class="qr"><img alt="رمز QR للتحقق" src="/api/documents/${encodeURIComponent(d.code)}/qr.svg"></div></div></div>`;
  }

  /* ---------- العرض والأحداث ---------- */
  const BUILTIN = { affairs: affairsView, admin: adminView, audit: auditView };
  function render() {
    const app = $('#app');
    document.body.classList.toggle('is-m', !!(S.me && S.me.role === 'student' && !S.me.mustChange));
    if (!S.me && S.view !== 'verify') { app.innerHTML = loginView() + siteFoot(); return; }
    if (S.me && S.me.mustChange) { app.innerHTML = mustChangeView(); return; }
    if (S.me && S.me.role === 'student') { app.innerHTML = UA.studentShell(); return; }
    const v = S.view === 'verify' ? verifyView : (UA.views[S.view] || BUILTIN[S.view] || (() => ''));
    app.innerHTML = header() + '<main>' + v() + '</main></div>' + siteFoot();
  }
  async function loadFor(view) {
    if (!S.me) return;
    try {
      if (UA.loaders[view]) await UA.loaders[view]();
      else if (view === 'affairs') {
        const [r, st] = await Promise.all([api('GET', '/api/requests'), can('stats:read') ? api('GET', '/api/stats') : Promise.resolve(null)]);
        S.requests = r.requests; S.stats = st && st.stats;
        S.targets = can('request:forward') ? (await api('GET', '/api/units/targets')).targets : [];
        if (can('student:register') && !S.reg) { S.reg = await api('GET', '/api/registration/options'); S.profSections = S.reg.sections; }
        if (can('student:read')) await loadStudents();
      } else if (view === 'admin') {
        const g = (perm, url, key) => (can(perm) ? api('GET', url).then((x) => x[key]) : Promise.resolve([]));
        const [holds, rules, pg, fc] = await Promise.all([g('holds:manage', '/api/admin/holds', 'holds'), g('rules:manage', '/api/admin/rules', 'rules'), g('program:manage', '/api/programs', 'programs'), g('program:manage', '/api/faculties', 'faculties')]);
        S.admin = { holds, rules, programs: pg, faculties: fc };
      } else if (view === 'audit') S.audit = (await api('GET', '/api/audit?limit=100')).entries;
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }
  async function loadStudents() {
    const L = S.stList, p = new URLSearchParams();
    if (L.q) p.set('q', L.q); if (L.program) p.set('program', L.program); if (L.status) p.set('status', L.status);
    const r = await api('GET', '/api/students?' + p);
    L.students = r.students; L.total = r.total;
  }
  function collect(secs, edit) {
    const o = {};
    secs.forEach((sec) => sec.fields.forEach((f) => { if (f.editOnly && !edit) return; const e = document.getElementById('sf-' + f.name); if (e) o[f.name] = e.value; }));
    return o;
  }
  function showErr(e) {
    S.err = e.message; S.fieldErr = e.field || null;
    return e;
  }
  async function go(view) { S.view = view; await loadFor(view); render(); window.scrollTo(0, 0); }
  async function afterLogin(user) {
    S.me = user; S.err = '';
    if (user.mustChange) { render(); return; }
    S.services = (await api('GET', '/api/services')).services;
    await go(viewsFor(user.role)[0][0]);
  }
  async function doVerify(code) {
    S.vtext = (code ?? '').trim().toUpperCase();
    if (!S.vtext) { S.vres = null; return; }
    try { S.vres = await api('GET', '/api/verify/' + encodeURIComponent(S.vtext)); } catch (e) { S.vres = null; toast(e.message); }
  }
  const readFile = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
  async function guard(fn) { try { await fn(); } catch (e) { toast(e.message); } }

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (UA.forms[e.target.id]) { await guard(() => UA.forms[e.target.id](e.target)); return; }
    if (e.target.id === 'loginform') {
      await guard(async () => {
        try { const r = await api('POST', '/api/auth/login', { username: val('lg-u'), password: val('lg-p') }); await afterLogin(r.user); }
        catch (err) { if (err.status) { S.err = err.message; render(); } else throw err; }
      });
    } else if (e.target.id === 'pwform') {
      const cur = val('pw-cur'), nw = val('pw-new');
      if (nw !== val('pw-new2')) { S.err = 'تأكيد كلمة المرور غير مطابق.'; render(); return; }
      try { await api('POST', '/api/auth/change-password', { current: cur, next: nw }); S.err = ''; S.me.mustChange = false; await afterLogin(S.me); toast('تم تغيير كلمة المرور'); }
      catch (err) { S.err = err.message; render(); }
    } else if (e.target.id === 'stsearch') {
      Object.assign(S.stList, { q: val('st-q').trim(), program: val('st-prog'), status: val('st-status') }); await guard(async () => { await loadStudents(); S.stSel = null; render(); });
    } else if (e.target.id === 'regform') {
      const edit = S.stTab === 'edit';
      await guard(async () => {
        const body = collect(S.reg.sections, edit);
        try {
          if (edit) {
            const r = await api('PUT', '/api/students/' + S.stEdit.id, body);
            S.stSel = r.student; S.stTab = 'list'; S.stEdit = null; S.err = ''; S.fieldErr = null; await loadStudents(); render(); toast('حُفظت التعديلات');
          } else {
            const r = await api('POST', '/api/students', body);
            S.cred = { ...r.credentials, name: r.student.name, id: r.student.id }; S.newVals = {}; S.err = ''; S.fieldErr = null; render(); window.scrollTo(0, 0);
          }
        } catch (err) {
          if (!err.status) throw err;
          S.newVals = edit ? S.newVals : body; if (edit) S.stEdit.profile = { ...S.stEdit.profile, ...body };
          showErr(err); render();
          const el = err.field && document.getElementById('sf-' + err.field); if (el) el.focus(); else window.scrollTo(0, 0);
        }
      });
    } else if (e.target.id === 'vform') { await doVerify(val('vcode')); render(); }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    if (a === 'close') { if ((el.classList.contains('overlay') && e.target.closest('.sheet')) || (el.classList.contains('m-drawer-bd') && e.target.closest('.m-drawer'))) return; $('#layer').innerHTML = ''; return; }
    await guard(async () => {
      if (UA.actions[a]) await UA.actions[a](el, d, e);
      else if (a === 'view') await go(d.v);
      else if (a === 'tologin') { S.view = null; render(); }
      else if (a === 'goverify') { S.view = 'verify'; render(); }
      else if (a === 'logout') { await api('POST', '/api/auth/logout', {}); $('#layer').innerHTML = ''; UA.reset(); Object.assign(S, { me: null, view: null, requests: [], sel: null, reg: null, profile: null, stTab: 'requests', stSel: null, stEdit: null, cred: null }); render(); }
      else if (a === 'sel') { S.sel = Number(d.id); S.rej = null; render(); }
      else if (a === 'flt') { S.filter = d.f; render(); }
      else if (a === 'approve') { await api('POST', `/api/requests/${d.id}/approve`, {}); await loadFor('affairs'); render(); toast('تم الاعتماد وإصدار الوثيقة'); }
      else if (a === 'rejform') { S.rej = Number(d.id); render(); }
      else if (a === 'reject') { await api('POST', `/api/requests/${d.id}/reject`, { reason: val('rej-text') }); S.rej = null; await loadFor('affairs'); render(); toast('تم رفض الطلب'); }
      else if (a === 'doc') {
        const r = await api('GET', '/api/documents/' + encodeURIComponent(d.c));
        $('#layer').innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet"><div class="sheet-bar"><button class="btn" data-act="close">إغلاق</button><button class="btn pri" data-act="copy" data-c="${esc(d.c)}">نسخ رمز التحقق</button></div>${docHtml(r.document)}</div></div>`;
      }
      else if (a === 'copy') { try { await navigator.clipboard.writeText(d.c); toast('تم نسخ الرمز'); } catch { toast('الرمز: ' + d.c); } }
      else if (a === 'atab') { S.adminTab = d.t; S.edit = null; render(); }
      else if (a === 'addhold') { await api('POST', '/api/admin/holds', { studentNo: val('h-no'), holdType: val('h-type'), note: val('h-note') }); await loadFor('admin'); render(); toast('سُجّلت العقوبة'); }
      else if (a === 'clearhold') { await api('POST', `/api/admin/holds/${d.id}/clear`, {}); await loadFor('admin'); render(); toast('تمت التسوية'); }
      else if (a === 'rule') { await api('POST', `/api/admin/rules/${d.id}/toggle`, { enabled: d.on === '1' }); await loadFor('admin'); render(); }
      else if (a === 'edithold') {
        const h = S.admin.holds.find((x) => x.id === Number(d.id)); if (!h) return;
        const note = prompt('ملاحظة العقوبة', h.note || ''); if (note === null) return;
        const tp = prompt('نوع العقوبة: financial (مالية) / disciplinary (تأديبية) / library (مكتبة)', h.holdType); if (tp === null) return;
        await api('PUT', `/api/admin/holds/${d.id}`, { note, holdType: tp.trim() }); await loadFor('admin'); render(); toast('حُفظ تعديل العقوبة');
      }
      else if (a === 'delhold') { if (!confirm('حذف سجل هذه العقوبة نهائياً؟ (للتسوية دون حذف استخدم «تسوية»)')) return; await api('DELETE', `/api/admin/holds/${d.id}`); await loadFor('admin'); render(); toast('حُذفت العقوبة'); }
      else if (a === 'editrule') {
        const r = S.admin.rules.find((x) => x.id === Number(d.id)); if (!r) return;
        const message = prompt('رسالة الرفض التي تظهر للطالب', r.message); if (message === null) return;
        const params = prompt('معاملات القاعدة (JSON). مثال: {"max":2}', r.params); if (params === null) return;
        await api('PUT', `/api/admin/rules/${d.id}`, { message, params }); await loadFor('admin'); render(); toast('حُفظت القاعدة');
      }
      else if (a === 'delrule') { if (!confirm('حذف هذه القاعدة نهائياً؟ لن يُطبَّق هذا الفحص على الطلبات بعد الآن (للإيقاف المؤقت استخدم «تعطيل»).')) return; await api('DELETE', `/api/admin/rules/${d.id}`); await loadFor('admin'); render(); toast('حُذفت القاعدة'); }
      else if (a === 'facedit' || a === 'progedit') {
        S.edit = { type: a === 'facedit' ? 'fac' : 'prog', id: Number(d.id) }; render();
        const c = document.getElementById('editcard'); if (c) c.scrollIntoView({ block: 'center' });
      }
      else if (a === 'editcancel') { S.edit = null; render(); }
      else if (a === 'facsave') {
        const f = S.admin.faculties.find((x) => x.id === Number(d.id)); if (!f) return;
        await api('PUT', `/api/admin/faculties/${d.id}`, { name: val('ed-name'), nameEn: val('ed-en'), code: f.students ? f.code : val('ed-code'), kind: val('ed-kind') });
        S.edit = null; S.reg = null; await loadFor('admin'); render(); toast('حُفظ تعديل الجهة');
      }
      else if (a === 'progsave') {
        await api('PUT', `/api/admin/programs/${d.id}`, { name: val('ed-name'), degree: val('ed-deg'), years: Number(val('ed-years')) });
        S.edit = null; S.reg = null; await loadFor('admin'); render(); toast('حُفظ تعديل البرنامج');
      }
      else if (a === 'progdel') { const p = S.admin.programs.find((x) => x.id === Number(d.id)); if (!p || !confirm(`حذف البرنامج «${p.name}» نهائياً؟ (لا يُقبل الحذف إن كان فيه طلاب أو مقررات)`)) return; await api('DELETE', `/api/admin/programs/${d.id}`); S.reg = null; await loadFor('admin'); render(); toast('حُذف البرنامج'); }
      else if (a === 'stdel') {
        const st = S.stSel; if (!st || !confirm(`حذف الطالب «${st.name}» (${st.studentNo}) وكل علاماته وذممه وشكاواه نهائياً؟ لا يمكن التراجع.`)) return;
        await api('DELETE', '/api/students/' + st.id); S.stSel = null; S.stCert = null; await loadFor('affairs'); render(); toast('حُذف الطالب');
      }
      else if (a === 'sttab') { S.stTab = d.t; S.err = ''; S.fieldErr = null; S.stEdit = null; if (d.t === 'list') await loadStudents(); render(); }
      else if (a === 'stsel') { const r = await api('GET', '/api/students/' + d.id); S.stSel = r.student; S.stCert = r.certificate; render(); }
      else if (a === 'stcert') {
        const res = await fetch(`/api/students/${S.stSel.id}/certificate.pdf`, { credentials: 'same-origin' });
        if (!res.ok) { let m = 'تعذّر إصدار الشهادة.'; try { m = (await res.json()).message || m; } catch { /* */ } toast(m); return; }
        const al = document.createElement('a'); al.href = URL.createObjectURL(await res.blob()); al.download = `enrollment-${S.stSel.studentNo}.pdf`; al.click(); setTimeout(() => URL.revokeObjectURL(al.href), 4000);
        S.stCert = (await api('GET', '/api/students/' + S.stSel.id)).certificate; render();
      }
      else if (a === 'stedit') { S.stEdit = S.stSel; S.stTab = 'edit'; S.err = ''; S.fieldErr = null; render(); window.scrollTo(0, 0); }
      else if (a === 'stcancel') { S.stTab = 'list'; S.stEdit = null; S.err = ''; S.fieldErr = null; render(); }
      else if (a === 'stclear') { S.newVals = {}; S.err = ''; S.fieldErr = null; render(); }
      else if (a === 'stpw') {
        if (!confirm('سيُنشأ كلمة مرور مؤقتة جديدة وتُنهى جلسات الطالب الحالية. متابعة؟')) return;
        const r = await api('POST', `/api/students/${S.stSel.id}/reset-password`, {});
        S.cred = { ...r.credentials, name: S.stSel.name, id: S.stSel.id }; S.stTab = 'new'; render();
      }
      else if (a === 'credcopy') { try { await navigator.clipboard.writeText(`${S.cred.username}\n${S.cred.tempPassword}`); toast('تم النسخ'); } catch { toast('تعذّر النسخ؛ انسخ يدوياً'); } }
      else if (a === 'credprint') { document.body.classList.add('print-cred'); window.addEventListener('afterprint', () => document.body.classList.remove('print-cred'), { once: true }); window.print(); }
      else if (a === 'credopen') { const id = S.cred.id; S.cred = null; S.stTab = 'list'; S.stSel = (await api('GET', '/api/students/' + id)).student; await loadStudents(); render(); }
      else if (a === 'crednew') { S.cred = null; S.newVals = {}; render(); }
      else if (a === 'addfac') { const r = await api('POST', '/api/admin/faculties', { name: val('fc-name'), nameEn: val('fc-en'), code: val('fc-code'), kind: val('fc-kind') }); S.reg = null; await loadFor('admin'); render(); toast('أُضيفت الجهة، رمزها ' + r.code); }
      else if (a === 'factoggle') { await api('POST', `/api/admin/faculties/${d.id}/toggle`, { enabled: d.on === '1' }); S.reg = null; await loadFor('admin'); render(); }
      else if (a === 'fwd') { await api('POST', `/api/requests/${d.id}/forward`, { unitId: Number(val('fw-unit')), note: val('fw-note') }); await loadFor('affairs'); render(); toast('أُحيل الطلب'); }
      else if (a === 'addprog') { await api('POST', '/api/admin/programs', { facultyId: Number(val('pg-fac')), name: val('pg-name'), degree: val('pg-deg'), years: Number(val('pg-years')) }); S.reg = null; await loadFor('admin'); render(); toast('أُضيف البرنامج'); }
      else if (a === 'progtoggle') { await api('POST', `/api/admin/programs/${d.id}/toggle`, { enabled: d.on === '1' }); S.reg = null; await loadFor('admin'); render(); }
      else if (a === 'reqopen') { S.stTab = 'requests'; S.sel = Number(d.id); S.rej = null; render(); window.scrollTo(0, 0); }
      else if (a === 'openstud') { S.stSel = (await api('GET', '/api/students/' + d.id)).student; S.stTab = 'list'; render(); window.scrollTo(0, 0); }
      else if (a === 'chain') { S.chain = await api('GET', '/api/audit/verify'); render(); }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#layer').innerHTML = '';
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.row')) { e.preventDefault(); e.target.click(); }
  });

  /* ---------- الإقلاع ---------- */
  UA.start = async function start() {
    const params = new URLSearchParams(location.search), code = params.get('verify');
    try { const r = await api('GET', '/api/me'); S.uni = r.university ?? S.uni; if (r.user) await afterLogin(r.user); } catch { S.me = null; }
    if (code) { S.view = 'verify'; await doVerify(code); history.replaceState(null, '', location.pathname); }
    render();
  };
  document.addEventListener('change', async (e) => {
    if (!e.target || e.target.id !== 'vfile' || !e.target.files[0]) return;
    try {
      const h = await crypto.subtle.digest('SHA-256', await e.target.files[0].arrayBuffer()), hex = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
      S.vres = await api('GET', '/api/verify-hash/' + hex); S.vtext = ''; render();
      if (!S.vres.valid && S.vres.reason === 'not_found') toast('لا توجد شهادة بهذه البصمة؛ الملف مختلف عن النسخة الأصلية أو ليس من إصدار الجامعة');
    } catch (err) { if (!err.status) throw err; toast(err.message); }
  });
  Object.assign(UA, { upload, mediaHtml, viewsFor, S, api, esc, fmt, dur, $, val, toast, render, guard, go, loadFor, can, pill, steps, detailsText, events, docHtml, verifyView, readFile, afterLogin, ROLE_LABEL });
})();
