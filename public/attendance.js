/* سجل دخول وخروج الطلاب من القاعات: مسح الباركود (Code 128) لحضور مادة أو فحص، مع جدول بفلاتر وتعديل. */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;
  const tz = () => new Date().getTimezoneOffset();
  const KEY = 'ua-hall-session';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const keep = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* التخزين غير متاح */ } };
  const A = { tab: 'scan', sess: Object.assign({ kind: 'course', courseId: '', subject: '', hall: '' }, load()), recent: [], open: [], opts: null, last: null,
    f: null, data: null, err: '', modal: null, cam: false };
  const fDef = () => ({ q: '', kind: '', faculty: '', course: '', hall: '', state: '', method: '', from: '', to: '', sort: 'enteredAt', dir: 'desc', page: 1, size: 25 });
  A.f = fDef();
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(A, { tab: 'scan', recent: [], open: [], opts: null, last: null, data: null, modal: null, cam: false }); A.f = fDef(); };

  /* ---------- Code 128 (المجموعة B): يكفي للأرقام الجامعية مثل CSS-2024-0001 ---------- */
  const PAT = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
  function code128(text) {
    const s = String(text);
    const codes = [104]; let sum = 104;
    [...s].forEach((ch, i) => { const c = ch.charCodeAt(0) - 32; if (c < 0 || c > 94) return; codes.push(c); sum += c * (i + 1); });
    codes.push(sum % 103, 106);
    const bars = codes.map((c) => PAT[c]).join('');
    let x = 10, out = '', bar = true;
    for (const n of bars) { const w = Number(n); if (bar) out += `<rect x="${x}" y="0" width="${w}" height="60"/>`; x += w; bar = !bar; }
    return `<svg class="bc128" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 60" role="img" aria-label="باركود ${esc(s)}" preserveAspectRatio="none" fill="#000"><rect x="0" y="0" width="${x + 10}" height="60" fill="#fff"/>${out}</svg>`;
  }
  UA.code128 = code128;

  /* ---------- أدوات ---------- */
  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const opts = (list, sel, all) => (all ? `<option value="">${all}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const t2 = (n) => String(n).padStart(2, '0');
  const dt = (ms) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getFullYear()}-${t2(d.getMonth() + 1)}-${t2(d.getDate())} ${t2(d.getHours())}:${t2(d.getMinutes())}`; };
  const hm = (ms) => { const d = new Date(ms); return `${t2(d.getHours())}:${t2(d.getMinutes())}:${t2(d.getSeconds())}`; };
  const local = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${t2(d.getMonth() + 1)}-${t2(d.getDate())}T${t2(d.getHours())}:${t2(d.getMinutes())}`; };
  const dur = (m) => (m === null || m === undefined ? '<span class="pill p-review">داخل القاعة</span>' : m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m} د`);
  const METHOD = { barcode: 'باركود', manual: 'يدوي', import: 'استيراد' };
  const sortTh = (k, label) => `<th aria-sort="${A.f.sort === k ? (A.f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-act="atsort" data-k="${k}">${label}<span class="arr">${A.f.sort === k ? (A.f.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;

  async function loadOpts() { if (!A.opts) A.opts = (await api('GET', '/api/attendance?size=5')).options; }
  async function loadOpen() { A.open = (await api('GET', '/api/attendance/open')).logs; }
  async function loadLogs() {
    const q = new URLSearchParams({ tz: tz() }); for (const [k, v] of Object.entries(A.f)) if (v) q.set(k, v);
    try { const r = await api('GET', '/api/attendance?' + q); A.data = r; A.opts = r.options; A.err = ''; A.f.page = r.page; } catch (e) { if (!e.status) throw e; A.err = e.message; }
  }
  UA.loaders.attendance = async () => { await loadOpts(); if (A.tab === 'scan') await loadOpen(); else await loadLogs(); };

  /* ---------- شاشة المسح ---------- */
  function sessionOk() { const s = A.sess; return s.hall && (s.courseId || s.subject); }
  function scanTab() {
    const s = A.sess, o = A.opts || { courses: [], kinds: {} };
    const res = A.last ? (A.last.err ? `<div class="scan-res bad" role="alert"><b>${esc(A.last.err)}</b></div>` : `<div class="scan-res ${A.last.action === 'in' ? 'in' : 'out'}" role="status">${A.last.student.photoId ? `<img class="scan-ph" alt="" src="/api/student-files/${A.last.student.photoId}">` : `<i class="scan-ph scan-ph0">${esc(A.last.student.name[0])}</i>`}
      <div><b class="scan-n">${esc(A.last.student.name)}</b><div class="mono">${esc(A.last.student.studentNo)} · ${esc(A.last.student.faculty)}</div><div class="scan-a">${A.last.action === 'in' ? 'تم تسجيل الدخول' : 'تم تسجيل الخروج'} — ${hm(A.last.at)}</div>${(A.last.warnings || []).map((w) => `<div class="scan-w">⚠ ${esc(w)}</div>`).join('')}</div></div>`) : '<div class="scan-res idle">امسح باركود الطالب أو اكتب رقمه الجامعي ثم Enter.</div>';
    const recent = A.recent.length ? `<ul class="mini-list scan-list">${A.recent.map((r) => `<li class="${r.err ? 'x' : ''}"><span class="mono small">${hm(r.at)}</span> ${r.err ? `<b>${esc(r.code)}</b> — ${esc(r.err)}` : `<b>${esc(r.student.name)}</b> <span class="pill ${r.action === 'in' ? 'p-approved' : 'p-review'}">${r.action === 'in' ? 'دخول' : 'خروج'}</span>`}</li>`).join('')}</ul>` : '';
    const inside = A.open.length ? `<div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الطالب</th><th>المادة / الفحص</th><th>القاعة</th><th>منذ</th><th></th></tr></thead><tbody>${A.open.map((l) => `<tr><td class="nm"><b>${esc(l.studentName)}</b><div class="mono small">${esc(l.studentNo)}</div></td><td>${esc(l.subject)}</td><td>${esc(l.hall)}</td><td class="nowrap">${dt(l.enteredAt)}</td><td><button class="btn sm" data-act="atout" data-id="${l.id}" data-no="${esc(l.studentNo)}">تسجيل خروج</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا أحد داخل القاعات الآن.</div>';
    return `<div class="grid2"><section class="card"><h2>${UA.icon('barcode', 22)} جلسة المسح</h2><p class="hint" style="margin-top:0">حدّد المادة أو الفحص والقاعة مرة واحدة؛ المسح الأول للطالب يسجّل دخوله والمسح التالي يسجّل خروجه.</p>
        <div class="form" style="border:0;padding:0"><div class="two"><label>النوع<select data-as="kind">${opts(Object.entries(o.kinds), s.kind)}</select></label><label>القاعة<input data-as="hall" id="as-hall" value="${esc(s.hall)}" maxlength="60" placeholder="مثال: القاعة 3"></label></div>
          <label>المادة<select data-as="courseId">${opts(o.courses.map((c) => [c.id, `${c.faculty} · ${c.name}`]), s.courseId, '— مادة غير مدرجة (اكتب الاسم) —')}</select></label>
          <label>${s.kind === 'exam' ? 'وصف الفحص (اختياري، مثل: امتحان نهائي)' : 'اسم المادة / الجلسة'}<input data-as="subject" id="as-subject" value="${esc(s.subject)}" maxlength="60"${s.courseId && s.kind !== 'exam' ? ' placeholder="اختياري"' : ''}></label></div>
        <form id="ascan" class="scan-form" autocomplete="off"><input id="as-code" dir="ltr" inputmode="text" placeholder="امسح الباركود أو اكتب الرقم الجامعي" maxlength="40" ${sessionOk() ? 'autofocus' : 'disabled'} aria-label="باركود الطالب"><button class="btn pri" type="submit"${sessionOk() ? '' : ' disabled'}>تسجيل</button>
          ${'BarcodeDetector' in window ? `<button class="btn" type="button" data-act="atcam"${sessionOk() ? '' : ' disabled'}>${A.cam ? 'إيقاف الكاميرا' : 'مسح بالكاميرا'}</button>` : ''}</form>
        ${sessionOk() ? '' : '<div class="small">أكمل القاعة والمادة (أو اسم الجلسة) لتفعيل المسح.</div>'}${A.cam ? '<video id="as-video" class="scan-video" playsinline muted></video>' : ''}
        ${res}${recent}</section>
      <section class="card"><div class="tool-row"><h2 style="margin:0">داخل القاعات الآن <span class="small">(${A.open.length})</span></h2><button class="btn sm" data-act="atrefresh">تحديث</button></div>${inside}</section></div>`;
  }

  /* ---------- جدول السجل ---------- */
  function rowsHtml(d) {
    return d.rows.map((l) => `<tr><td class="mono nowrap">${esc(l.studentNo)}</td><td class="nm"><b>${esc(l.studentName)}</b></td><td class="nm">${esc(l.faculty)}</td><td>${esc(l.kindLabel)}</td><td class="nm">${esc(l.subject)}</td><td>${esc(l.hall)}</td><td class="nowrap">${dt(l.enteredAt)}</td><td class="nowrap">${l.exitedAt ? dt(l.exitedAt) : '—'}</td><td class="nowrap">${dur(l.minutes)}</td><td>${METHOD[l.method] || l.method}</td>
      <td class="nowrap"><button class="btn sm" data-act="atedit" data-id="${l.id}">تعديل</button> <button class="btn sm bad" data-act="atdel" data-id="${l.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">لا سجلات مطابقة.</td></tr>';
  }
  function logTable() {
    const d = A.data; if (!d) return `<div class="empty">${esc(A.err || 'جارٍ التحميل…')}</div>`;
    const s = d.summary;
    return `<div class="imp-sum gt-sum"><div class="stat"><small>السجلات</small><b>${s.count}</b></div><div class="stat"><small>الطلاب</small><b>${s.students}</b></div><div class="stat"><small>داخل القاعات</small><b>${s.open}</b></div><div class="stat"><small>متوسط المدة</small><b>${s.avgMinutes === null ? '—' : s.avgMinutes + ' د'}</b></div></div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${sortTh('studentNo', 'الرقم الجامعي')}${sortTh('studentName', 'الطالب')}${sortTh('faculty', 'الكلية / المعهد')}${sortTh('kind', 'النوع')}${sortTh('subject', 'المادة / الفحص')}${sortTh('hall', 'القاعة')}${sortTh('enteredAt', 'الدخول')}${sortTh('exitedAt', 'الخروج')}${sortTh('minutes', 'المدة')}<th>الطريقة</th><th></th></tr></thead><tbody>${rowsHtml(d)}</tbody></table></div>
      <div class="pager no-print"><span class="small">${d.total} نتيجة</span><span class="pg-ctl"><button class="btn sm" data-act="atpage" data-p="${d.page - 1}"${d.page <= 1 ? ' disabled' : ''}>‹ السابق</button><span>صفحة ${d.page} من ${d.pages}</span><button class="btn sm" data-act="atpage" data-p="${d.page + 1}"${d.page >= d.pages ? ' disabled' : ''}>التالي ›</button></span>
      <label class="small">الصفوف <select data-af="size">${[25, 50, 100, 250, 500].map((n) => `<option${n === d.size ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
  }
  function logTab() {
    const f = A.f, o = A.opts || { kinds: {}, halls: [], courses: [], faculties: [] };
    const any = f.q || f.kind || f.faculty || f.course || f.hall || f.state || f.method || f.from || f.to;
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">سجل دخول وخروج القاعات</h2><span class="no-print"><button class="btn sm" data-act="atexport">تصدير</button> <button class="btn sm" data-act="atimport">استيراد</button> <button class="btn pri" data-act="atnew">＋ إضافة سجل يدوي</button></span></div>
      <div class="filters no-print"><label class="grow">بحث<input data-af="q" id="af-q" value="${esc(f.q)}" placeholder="اسم الطالب، الرقم الجامعي، المادة، القاعة…" maxlength="60" autocomplete="off"></label>
        <label>النوع<select data-af="kind">${opts(Object.entries(o.kinds), f.kind, 'الكل')}</select></label>
        <label>الكلية / المعهد<select data-af="faculty">${opts(o.faculties.map((x) => [x.id, x.name]), f.faculty, 'الكل')}</select></label>
        <label>المادة<select data-af="course">${opts(o.courses.map((c) => [c.id, c.name]), f.course, 'الكل')}</select></label>
        <label>القاعة<select data-af="hall">${opts(o.halls.map((h) => [h, h]), f.hall, 'الكل')}</select></label>
        <label>الحالة<select data-af="state">${opts([['open', 'داخل القاعة'], ['closed', 'خرج']], f.state, 'الكل')}</select></label>
        <label>الطريقة<select data-af="method">${opts(Object.entries(METHOD), f.method, 'الكل')}</select></label>
        <label>من تاريخ<input type="date" data-af="from" value="${esc(f.from)}"></label><label>إلى تاريخ<input type="date" data-af="to" value="${esc(f.to)}"></label>
        ${any ? '<button class="btn sm" data-act="atclear">مسح الفلاتر</button>' : ''}</div><div id="at-table">${logTable()}</div></section>`;
  }
  const refreshTable = () => { const el = document.getElementById('at-table'); if (el) el.innerHTML = logTable(); };

  /* ---------- نافذة الإضافة/التعديل ---------- */
  function modalHtml() {
    const m = A.modal; if (!m) return '';
    const o = A.opts || { kinds: {}, courses: [] }, e = m.edit ? A.data.rows.find((r) => r.id === m.edit) : null, d = m.d || {};
    const v = (k, fb) => (d[k] !== undefined ? d[k] : fb);
    return `<div class="modal-back" data-act="atmclose"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mttl"><h2 id="mttl">${e ? 'تعديل سجل قاعة' : 'إضافة سجل قاعة يدوي'}</h2>${m.err ? `<div class="err" role="alert">${esc(m.err)}</div>` : ''}
      <form class="form" id="atform" style="border:0;margin:0;padding:0"><label>الرقم الجامعي<input id="am-no" dir="ltr" required maxlength="40" value="${esc(v('no', e ? e.studentNo : ''))}"${e ? ' readonly' : ''}></label>
        <div class="two"><label>النوع<select id="am-kind">${opts(Object.entries(o.kinds), v('kind', e ? e.kind : 'course'))}</select></label><label>القاعة<input id="am-hall" maxlength="60" required value="${esc(v('hall', e ? e.hall : A.sess.hall))}"></label></div>
        <label>المادة<select id="am-course">${opts(o.courses.map((c) => [c.id, `${c.faculty} · ${c.name}`]), v('course', e ? e.courseId : ''), '— مادة غير مدرجة —')}</select></label>
        <label>اسم المادة / الفحص (إن لم تُختر مادة)<input id="am-subject" maxlength="60" value="${esc(v('subject', e && !e.courseId ? e.subject : ''))}"></label>
        <div class="two"><label>وقت الدخول<input id="am-in" type="datetime-local" required value="${esc(v('in', e ? local(e.enteredAt) : local(Date.now())))}"></label><label>وقت الخروج (اتركه فارغاً إن لم يخرج)<input id="am-out" type="datetime-local" value="${esc(v('out', e ? local(e.exitedAt) : ''))}"></label></div>
        <label>ملاحظة (اختياري)<input id="am-note" maxlength="200" value="${esc(v('note', e ? e.note : ''))}"></label>
        <div class="actions"><button class="btn pri" type="submit">${e ? 'حفظ التعديل' : 'إضافة'}</button><button class="btn" type="button" data-act="atmclose">إلغاء</button></div></form></div></div>`;
  }

  UA.views.attendance = () => bar([['scan', 'مسح الدخول والخروج'], ['log', 'السجل']], A.tab, 'attab') + (A.tab === 'scan' ? scanTab() : logTab()) + modalHtml();

  /* ---------- الأحداث ---------- */
  let timer = null;
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.af === 'q') { A.f.q = t.value; A.f.page = 1; clearTimeout(timer); timer = setTimeout(async () => { await loadLogs(); refreshTable(); }, 280); }
    else if (t.dataset.as === 'hall' || t.dataset.as === 'subject') { A.sess[t.dataset.as] = t.value; keep(A.sess); const ok = sessionOk(), c = document.getElementById('as-code'); if (c) c.disabled = !ok; }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.as) { A.sess[t.dataset.as] = t.value; keep(A.sess); UA.render(); focusScan(); }
    else if (t.dataset.af && t.dataset.af !== 'q') { if (t.dataset.af === 'size') A.f.size = Number(t.value); else A.f[t.dataset.af] = t.value; A.f.page = 1; await loadLogs(); UA.render(); }
  });
  const focusScan = () => setTimeout(() => { const c = document.getElementById('as-code'); if (c && !c.disabled) c.focus(); }, 30);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && A.modal) { A.modal = null; UA.render(); } });
  let stream = null, camTimer = null;
  function stopCam() { if (camTimer) clearInterval(camTimer); camTimer = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }

  async function doScan(code, action) {
    const s = A.sess, at = Date.now();
    try {
      const r = await api('POST', '/api/attendance/scan', { code, kind: s.kind, courseId: s.courseId ? Number(s.courseId) : null, subject: s.subject, hall: s.hall, action });
      A.last = { ...r, at }; A.recent.unshift({ ...r, at }); beep(true);
    } catch (e) { if (!e.status) throw e; A.last = { err: e.message, code, at }; A.recent.unshift({ err: e.message, code, at }); beep(false); }
    A.recent = A.recent.slice(0, 12); await loadOpen(); UA.render(); focusScan();
  }
  function beep(ok) {
    try { const C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = ok ? 880 : 220; g.gain.value = 0.06; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? 0.12 : 0.35)); } catch { /* لا صوت */ }
  }
  async function startCam() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      A.cam = true; UA.render(); const v = document.getElementById('as-video'); if (!v) return; v.srcObject = stream; await v.play();
      const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13'] }); let busy = false, lastCode = '', lastAt = 0;
      camTimer = setInterval(async () => {
        if (busy) return; busy = true;
        try { const r = await det.detect(v); if (r[0] && (r[0].rawValue !== lastCode || Date.now() - lastAt > 4000)) { lastCode = r[0].rawValue; lastAt = Date.now(); await doScan(lastCode, 'auto'); } } catch { /* إطار غير جاهز */ }
        busy = false;
      }, 500);
    } catch { A.cam = false; stopCam(); toast('تعذّر تشغيل الكاميرا (تحقق من الإذن).'); UA.render(); }
  }

  const modalDraft = () => { const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; }; return { no: g('am-no'), kind: g('am-kind'), hall: g('am-hall'), course: g('am-course'), subject: g('am-subject'), in: g('am-in'), out: g('am-out'), note: g('am-note') }; };
  Object.assign(UA.actions, {
    attab: async (el, d) => { stopCam(); A.cam = false; A.tab = d.t; A.modal = null; if (d.t === 'log') await loadLogs(); else await loadOpen(); UA.render(); if (d.t === 'scan') focusScan(); },
    atrefresh: async () => { await loadOpen(); UA.render(); focusScan(); },
    atout: async (el, d) => { await doScan(d.no, 'out'); },
    atcam: async () => { if (A.cam) { stopCam(); A.cam = false; UA.render(); } else await startCam(); },
    atsort: async (el, d) => { A.f.dir = A.f.sort === d.k && A.f.dir === 'desc' ? 'asc' : (A.f.sort === d.k ? 'desc' : (['enteredAt', 'exitedAt', 'minutes'].includes(d.k) ? 'desc' : 'asc')); A.f.sort = d.k; A.f.page = 1; await loadLogs(); UA.render(); },
    atpage: async (el, d) => { A.f.page = Number(d.p); await loadLogs(); UA.render(); },
    atclear: async () => { A.f = Object.assign(fDef(), { sort: A.f.sort, dir: A.f.dir, size: A.f.size }); await loadLogs(); UA.render(); },
    atnew: async () => { A.modal = { edit: null, d: null, err: '' }; UA.render(); },
    atedit: async (el, d) => { A.modal = { edit: Number(d.id), d: null, err: '' }; UA.render(); },
    atmclose: async (el, d, e) => { if (e && e.target.closest('.modal') && el.classList.contains('modal-back')) return; A.modal = null; UA.render(); },
    atdel: async (el, d) => {
      const x = A.data.rows.find((r) => r.id === Number(d.id)); if (!x || !confirm(`حذف سجل ${x.studentName} (${x.subject} — ${x.hall}) نهائياً؟`)) return;
      try { await api('DELETE', '/api/attendance/' + d.id); await loadLogs(); UA.render(); toast('حُذف السجل'); } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
    atexport: async () => { S.exportPreset = { dataset: 'attendance' }; await UA.go('export'); },
    atimport: async () => { S.importPreset = 'attendance'; await UA.go('import'); },
  });
  Object.assign(UA.forms, {
    ascan: async () => { const c = val('as-code').trim(); if (!c) return; document.getElementById('as-code').value = ''; await doScan(c, 'auto'); },
    atform: async () => {
      const m = A.modal, body = { kind: val('am-kind'), hall: val('am-hall'), courseId: val('am-course') ? Number(val('am-course')) : null, subject: val('am-subject'), enteredAt: new Date(val('am-in')).getTime(), note: val('am-note') };
      const out = val('am-out'); body.exitedAt = out ? new Date(out).getTime() : null;
      try {
        if (m.edit) await api('PUT', '/api/attendance/' + m.edit, body); else await api('POST', '/api/attendance', { ...body, studentNo: val('am-no') });
        A.modal = null; await loadLogs(); UA.render(); toast(m.edit ? 'حُفظ التعديل' : 'أُضيف السجل');
      } catch (e) { if (!e.status) throw e; m.d = modalDraft(); m.err = e.message; UA.render(); }
    },
  });
})();
