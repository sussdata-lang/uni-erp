/* صفحة تصدير البيانات: اختيار المجموعة (طلاب، مواد، علامات...) والمرشحات (كلية، برنامج، سنة، فصل، عام دراسي)، معاينة، وتنزيل بأكثر من صيغة */
(function () {
  const UA = window.UA, { S, api, esc, toast } = UA;
  const X = { opts: null, dataset: 'grades', f: { faculty: '', program: '', level: '', semester: '', academicYear: '', status: '', enrollYear: '' }, layout: 'single', data: null, busy: '', loading: false, err: '' };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(X, { opts: null, data: null, busy: '', err: '' }); };

  const APPLIES = {
    students: ['faculty', 'program', 'level', 'status', 'enrollYear'],
    grades: ['faculty', 'program', 'level', 'semester', 'academicYear', 'status', 'enrollYear'],
    courses: ['faculty', 'program', 'level', 'semester'],
    requests: ['faculty', 'program', 'level', 'status', 'enrollYear'], holds: ['faculty', 'program', 'level', 'status', 'enrollYear'], complaints: ['faculty', 'program', 'level', 'status', 'enrollYear'],
    all: ['faculty', 'program', 'level', 'semester', 'academicYear', 'status', 'enrollYear'],
  };
  const DS_ICON = { students: 'students', grades: 'grades', courses: 'guide', requests: 'tx', holds: 'lock', complaints: 'help', all: 'export' };
  const FORMATS = [['xlsx', 'Excel', 'sheet'], ['csv', 'CSV', 'csv'], ['json', 'JSON', 'json'], ['docx', 'Word', 'word'], ['pdf', 'PDF', 'pdf']];
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];

  const query = (extra = {}) => {
    const q = new URLSearchParams({ dataset: X.dataset, ...extra });
    for (const k of APPLIES[X.dataset]) if (X.f[k]) q.set(k, X.f[k]);
    return q;
  };
  async function loadPreview(extra) {
    X.loading = true; X.err = '';
    try { X.data = await api('GET', '/api/export/preview?' + query(extra)); } catch (e) { if (!e.status) throw e; X.err = e.message; X.data = null; }
    X.loading = false;
  }
  UA.loaders.export = async () => { if (!X.opts) X.opts = await api('GET', '/api/export/options'); await loadPreview(); };

  const sel = (key, label, options, all = 'الكل') => `<label>${label}<select data-chg="xfilter" data-k="${key}"><option value="">${all}</option>${options.map(([v, l]) => `<option value="${esc(v)}"${String(X.f[key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

  function filters() {
    const o = X.opts, on = new Set(APPLIES[X.dataset]);
    const progs = o.programs.filter((p) => !X.f.faculty || String(p.facultyId) === String(X.f.faculty));
    const lvlLabel = X.dataset === 'students' ? 'السنة الدراسية الحالية' : 'السنة الدراسية';
    return `<div class="xf-grid">
      ${on.has('faculty') ? sel('faculty', 'الكلية / المعهد', o.faculties.map((f) => [f.id, f.name])) : ''}
      ${on.has('program') ? sel('program', 'البرنامج', progs.map((p) => [p.id, p.label])) : ''}
      ${on.has('level') ? sel('level', lvlLabel, LV.map((l, i) => [i + 1, 'السنة ' + l])) : ''}
      ${on.has('semester') ? sel('semester', 'الفصل', [[1, 'الفصل الأول'], [2, 'الفصل الثاني']]) : ''}
      ${on.has('academicYear') ? sel('academicYear', 'العام الدراسي', o.academicYears.map((y) => [y, y])) : ''}
      ${on.has('status') ? sel('status', 'حالة القيد', Object.entries(o.statuses)) : ''}
      ${on.has('enrollYear') ? sel('enrollYear', 'سنة القيد', o.enrollYears.map((y) => [y, y])) : ''}
    </div>`;
  }

  function table(s) {
    const more = s.total > s.rows.length ? `<p class="small no-print">المعروض أول ${s.rows.length} من ${s.total} صفاً؛ الملف المُصدَّر يضم كل الصفوف.</p>` : '';
    return `<section class="xp-set"><h3>${esc(s.title)} <span class="small">(${s.total})</span></h3><div class="tbl-wrap"><table class="xp"><thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.headers.length}" class="empty">لا بيانات ضمن المرشحات الحالية.</td></tr>`}</tbody></table></div>${more}</section>`;
  }

  UA.views.export = () => {
    if (!X.opts) return `<div class="empty">${X.err ? esc(X.err) : 'جارٍ التحميل…'}</div>`;
    const total = X.data ? X.data.sets.reduce((n, s) => n + s.total, 0) : 0;
    const dsCards = X.opts.datasets.map((d) => `<button class="xd" data-act="xds" data-d="${d.id}" aria-pressed="${X.dataset === d.id}"><span class="xd-i">${UA.icon(DS_ICON[d.id] || 'tx', 24)}</span><b>${esc(d.label)}</b><small>${esc(d.hint)}</small></button>`).join('');
    const fmts = FORMATS.map(([k, l, ic]) => `<button class="btn xfmt" data-act="xdl" data-k="${k}"${X.busy || !total ? ' disabled' : ''}>${UA.icon(ic, 18)}<span>${X.busy === k ? 'جارٍ التجهيز…' : l}</span></button>`).join('');
    const layoutOpt = ['grades', 'all'].includes(X.dataset) ? `<label class="chk xlay"><input type="checkbox" data-chg="xlayout"${X.layout === 'terms' ? ' checked' : ''}> في ملف Excel: ورقة مستقلة لكل سنة دراسية وفصل</label>` : '';
    const dsLabel = (X.opts.datasets.find((d) => d.id === X.dataset) || {}).label || '';
    return `<div class="xpage"><div class="print-head"><b>تصدير البيانات — الجامعة السورية للعلوم الأمنية</b><span>${esc(dsLabel)} · ${new Date().toLocaleDateString('ar-SY')}</span></div>
      <section class="card no-print"><h2>تصدير البيانات</h2><p class="hint" style="margin-top:0">اختر ما تريد تصديره، ضيّق بالمرشحات (السنة والفصل والبرنامج...)، ثم نزّله بالصيغة المناسبة. كل عملية تصدير تُسجَّل في سجل التدقيق.</p>
        <div class="xd-grid" role="group" aria-label="مجموعة البيانات">${dsCards}</div></section>
      <section class="card no-print"><h2>${UA.icon('filter', 20)} المرشحات</h2>${filters()}${layoutOpt}</section>
      <section class="card no-print xbar"><div class="xbar-t"><b>${total}</b> صف جاهز للتصدير</div><div class="xfmts">${fmts}</div>
        <p class="small" style="margin:0">PDF: تُفتح نافذة الطباعة (حتى 5000 صف) فاختر «حفظ كـ PDF».</p></section>
      <section class="card"><h2>معاينة</h2>${X.err ? `<div class="err" role="alert">${esc(X.err)}</div>` : ''}${X.loading ? '<div class="empty">جارٍ التحميل…</div>' : (X.data ? X.data.sets.map(table).join('') : '')}</section></div>`;
  };

  async function download(k) {
    const q = query({ format: k }); if (X.layout === 'terms') q.set('layout', 'terms');
    const res = await fetch('/api/export/file?' + q, { credentials: 'same-origin' });
    if (!res.ok) { let m = 'تعذّر التصدير.'; try { m = (await res.json()).message || m; } catch { /* */ } throw Object.assign(new Error(m), { status: res.status }); }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `export.${k}`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  Object.assign(UA.actions, {
    xds: async (el, d) => { X.dataset = d.d; X.layout = 'single'; await loadPreview(); UA.render(); },
    xdl: async (el, d) => {
      X.busy = d.k; UA.render();
      try {
        if (d.k === 'pdf') {                                             // الطباعة تحتاج كل الصفوف لا أول 100
          await loadPreview({ limit: 5000 }); X.busy = ''; UA.render();
          document.body.classList.add('print-export'); window.addEventListener('afterprint', async () => { document.body.classList.remove('print-export'); await loadPreview(); UA.render(); }, { once: true });
          setTimeout(() => window.print(), 120); return;
        }
        await download(d.k); toast('تم التصدير');
      } catch (e) { if (!e.status) throw e; toast(e.message); } finally { if (X.busy) { X.busy = ''; UA.render(); } }
    },
  });
  document.addEventListener('change', async (e) => {
    const t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.chg === 'xfilter') {
      X.f[t.dataset.k] = t.value;
      if (t.dataset.k === 'faculty') X.f.program = '';
      await loadPreview(); UA.render();
    } else if (t.dataset.chg === 'xlayout') { X.layout = t.checked ? 'terms' : 'single'; }
  });
})();
