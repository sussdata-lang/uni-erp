/* كشف العلامات الرسمي: أربعة نماذج بهوية الجامعة (كلاسيكي، عصري، أكاديمي، فاخر)، مع ملخص المواد، ترتيب الدفعة، الإنذار الأكاديمي، واعتماد القالب الافتراضي. */
(function () {
  const UA = window.UA || (window.UA = {});
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'];
  const lvName = (n) => `السنة ${LV[n - 1] || n}`;
  const SEM = { 1: 'الفصل الأول', 2: 'الفصل الثاني' };
  const PASS = 60;
  const STATUS = { active: 'مقيَّد', suspended: 'موقوف القيد', withdrawn: 'منسحب', transferred: 'محوَّل', graduated: 'متخرج' };
  const rating = (m) => (m === null || m === undefined ? '—' : m >= 90 ? 'ممتاز (مرتبة الشرف)' : m >= 80 ? 'جيد جداً' : m >= 70 ? 'جيد' : m >= PASS ? 'مقبول' : 'راسب');
  const f1 = (n) => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10));
  const dt = (t) => { try { return new Date(t).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return ''; } };
  const wavg = (rows) => { const h = rows.reduce((s, r) => s + r.hours, 0); return h ? rows.reduce((s, r) => s + r.hours * r.mark, 0) / h : null; };
  const crest = () => window.TR_CREST || '/brand/crest.svg';
  const DEF_KEY = 'uni_erp_default_transcript_template';

  function getDefaultTemplate() {
    try { return localStorage.getItem(DEF_KEY) || window.TR_DEFAULT_TEMPLATE || 'classic'; } catch { return 'classic'; }
  }
  async function setDefaultTemplate(id) {
    try { localStorage.setItem(DEF_KEY, id); } catch { /* ignore */ }
    window.TR_DEFAULT_TEMPLATE = id;
    if (UA.api) {
      try { await UA.api('POST', '/api/site/transcript-template', { template: id }); } catch { /* يحفظ محلياً إن لم تتوفر الصلاحية */ }
    }
    if (UA.toast) UA.toast('تم اعتماد هذا الشكل كافتراضي لكشف العلامات عند الحفظ والتصدير');
  }

  /* ---------- توحيد البيانات وإدراج كافة السنوات وملخص المواد ---------- */
  function normalize(d) {
    const p = d.payload, st = p.student || {}, tr = p.transcript || { grades: [] };
    const rows = (tr.grades || []).map((g) => ({
      course: g.course, code: g.code || '', hours: Number(g.hours) || 0, theory: g.theory ?? null, practical: g.practical ?? null, mark: Number(g.mark),
      level: Number(g.level) || 0, semester: Number(g.semester) || 0, ay: g.academicYear || '', term: g.term || '', prev: !!g.previous,
    }));
    const cur = rows.filter((r) => !r.prev);
    const levels = new Map();

    // تحديد السنوات الواجب إظهارها: إن كان الطالب في سنة محددة (مثلاً السنة الثانية) تدرج السنوات 1..2، وإن لم يوجد أو كان متخرجاً تدرج كافة سنوات البرنامج (1..4)
    const maxProgYears = Number(st.years) || 4;
    const targetMaxLevel = st.level && st.status === 'active' ? Math.min(maxProgYears, Math.max(1, Number(st.level))) : maxProgYears;
    for (let lv = 1; lv <= targetMaxLevel; lv++) {
      levels.set(lv, new Map([[1, []], [2, []]]));
    }

    for (const r of rows) {
      if (!levels.has(r.level)) levels.set(r.level, new Map());
      const sk = r.level ? (r.semester || 1) : (r.term || 'ملخص المواد');
      const L = levels.get(r.level);
      if (!L.has(sk)) L.set(sk, []);
      L.get(sk).push(r);
    }

    const years = [...levels.entries()].sort((a, b) => (a[0] === 0 ? -1 : b[0] === 0 ? 1 : a[0] - b[0])).map(([lv, sems]) => {
      const lrows = [...sems.values()].flat().filter((r) => !r.prev);
      const ays = lrows.map((r) => r.ay).filter(Boolean), ay = ays.sort((a, b) => ays.filter((x) => x === b).length - ays.filter((x) => x === a).length)[0] || '';
      const terms = [...sems.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([k, rs]) => {
        const c = rs.filter((r) => !r.prev);
        return { label: SEM[k] || String(k).replace(/^\d{4}\/\d{4}-/, '') || 'ملخص المواد', rows: rs, hours: c.reduce((s, r) => s + r.hours, 0), avg: wavg(c) };
      });
      return {
        level: lv,
        label: lv ? lvName(lv) : 'ملخص المواد',
        ay,
        hours: lrows.reduce((s, r) => s + r.hours, 0),
        avg: wavg(lrows),
        terms,
      };
    });

    const avg = tr.average ?? wavg(cur), sm = tr.summary || {};
    const failedCount = sm.failed ?? cur.filter((r) => r.mark < PASS).length;
    const rankStr = tr.cohortRank ? `${tr.cohortRank} من ${tr.cohortTotal || tr.cohortRank}` : (sm.cohortRank ? `${sm.cohortRank} من ${sm.cohortTotal}` : '—');

    // التنبيه التلقائي لمن يقترب من الإنذار الأكاديمي
    let warning = tr.warning || sm.warning || null;
    if (!warning && avg !== null) {
      if (avg < PASS || failedCount >= 4) warning = { level: 2, label: 'إنذار أكاديمي', text: `تنبيه أكاديمي: المعدل التراكمي (${f1(avg)}%) دون الحد الأدنى للنجاح (${PASS}%) أو لتراكم المقررات الراسبة.` };
      else if (avg < PASS + 5 || failedCount === 3) warning = { level: 1, label: 'يقترب من الإنذار الأكاديمي', text: `تنبيه استباقي: المعدل التراكمي (${f1(avg)}%) قريب من حد الإنذار الأكاديمي (${PASS}%). يُرجى مراجعة المرشد الأكاديمي.` };
    }

    const info = [
      ['الرقم الجامعي', st.studentNo],
      ['الكلية / المعهد', st.faculty],
      ['البرنامج', st.programName ? `${st.degree ? st.degree + ' ' : ''}${st.programName === st.faculty ? '' : st.programName}`.trim() || st.programName : st.program],
      ['السنة الدراسية الحالية', st.level ? lvName(st.level) : 'كافة السنوات'],
      ['سنة القيد', st.enrollYear],
      ['حالة القيد', STATUS[st.status] || ''],
      ['الترتيب في الدفعة', rankStr],
    ].filter((x) => x[1] !== '' && x[1] !== null && x[1] !== undefined);

    return {
      uni: p.university, name: st.name, no: st.studentNo, faculty: st.faculty || '', info, years, code: d.code, hash: d.hash, requestNo: p.requestNo, issuedAt: p.issuedAt, logo: d.logo || '',
      warning,
      sum: {
        title: 'ملخص المواد',
        courses: sm.courses ?? cur.length,
        passed: sm.passed ?? cur.filter((r) => r.mark >= PASS).length,
        failed: failedCount,
        hours: sm.hours ?? cur.reduce((s, r) => s + r.hours, 0),
        earned: sm.earnedHours ?? cur.filter((r) => r.mark >= PASS).reduce((s, r) => s + r.hours, 0),
        avg,
        rating: rating(avg),
        rank: rankStr,
      },
    };
  }

  /* ---------- مكونات مشتركة ---------- */
  const wm = (n) => `<div class="trp-wm" aria-hidden="true"><img src="${esc(n.logo || crest())}" alt=""></div>`;
  const qr = (n) => (window.TR_QR ? `<img class="trp-qr" alt="رمز QR للتحقق" src="${esc(window.TR_QR)}">` : `<img class="trp-qr" alt="رمز QR للتحقق" src="/api/documents/${encodeURIComponent(n.code)}/qr.svg">`);
  const seal = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7.5 2.8v5.6c0 4.4-3.1 7.6-7.5 9.6-4.4-2-7.5-5.2-7.5-9.6V5.8z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>`;
  const markCls = (m) => (m >= PASS ? 'ok' : 'bad');
  const noteTxt = 'وثيقة صادرة إلكترونياً وموقَّعة رقمياً. للتحقق من صحتها امسح رمز QR أو أدخل رمز التحقق في بوابة الجامعة (صفحة «التحقق العام»).';
  const metaLines = (n) => `<div>رقم الطلب: <span class="mono">${esc(n.requestNo)}</span></div><div>تاريخ الإصدار: ${esc(dt(n.issuedAt))}</div><div>رمز التحقق: <span class="mono">${esc(n.code)}</span></div><div>البصمة: <span class="mono">${esc((n.hash || '').slice(0, 20))}…</span></div>`;
  const prevTag = (r) => (r.prev ? ' <small class="prev-t">(محاولة سابقة)</small>' : '');
  const opt = (v) => (v === null || v === undefined ? '—' : v);
  const warnBanner = (n) => (n.warning ? `<div class="reason" style="margin-block:10px;border:1px solid currentColor;font-weight:600">⚠️ ${esc(n.warning.label)}: ${esc(n.warning.text)}</div>` : '');
  const topSummaryBox = (n) => `<div class="a-sum" style="margin-bottom:14px"><div><small>${esc(n.sum.title)}</small><b>${n.sum.courses} مقرر</b></div><div><small>الناجحة / الراسبة</small><b>${n.sum.passed} / ${n.sum.failed}</b></div><div><small>الساعات المنجزة</small><b>${n.sum.earned}<em>/${n.sum.hours}</em></b></div><div><small>المعدل التراكمي</small><b>${f1(n.sum.avg)}</b></div><div><small>الترتيب في الدفعة</small><b>${esc(n.sum.rank)}</b></div><div class="hl"><small>التقدير العام</small><b>${esc(n.sum.rating)}</b></div></div>`;

  /* ====== النموذج الأول: الكلاسيكي الرسمي ====== */
  function classic(n) {
    const info = n.info.map(([k, v]) => `<div class="a-cell"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    const years = n.years.map((y) => {
      let i = 0;
      const body = y.terms.map((t) => `<tr class="a-sem"><td colspan="8">${esc(t.label)}</td></tr>${t.rows.length ? t.rows.map((r) => `<tr class="${r.prev ? 'prev' : ''}"><td class="c-n">${r.prev ? '' : ++i}</td><td class="c-nm">${esc(r.course)}${prevTag(r)}${r.code ? ` <small class="mono">${esc(r.code)}</small>` : ''}</td><td>${r.hours}</td><td class="o">${opt(r.theory)}</td><td class="o">${opt(r.practical)}</td><td class="mk ${markCls(r.mark)}">${r.mark}</td><td class="${markCls(r.mark)}">${rating(r.mark)}</td><td class="o">${esc(r.ay)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty" style="padding:8px">لا توجد مقررات مسجلة في هذا الفصل حتى تاريخه</td></tr>'}
        <tr class="a-tot"><td colspan="2">مجموع ${esc(t.label)}</td><td>${t.hours}</td><td colspan="3">المعدل: <b>${f1(t.avg)}</b></td><td colspan="2" class="o"></td></tr>`).join('');
      return `<section class="a-year"><h3 class="a-yh"><span>${esc(y.label)}</span>${y.ay ? `<em>${esc(y.ay)}</em>` : ''}<i>معدل السنة: <b>${f1(y.avg)}</b></i></h3>
        <table class="a-t"><thead><tr><th class="c-n">م</th><th>المقرر</th><th>الساعات</th><th class="o">نظري</th><th class="o">عملي</th><th>المجموع</th><th>التقدير</th><th class="o">العام</th></tr></thead><tbody>${body}</tbody></table></section>`;
    }).join('');
    return `<div class="trp trp-a">${wm(n)}<div class="trp-pg"><div class="a-frame"><i class="a-c a-c1"></i><i class="a-c a-c2"></i><i class="a-c a-c3"></i><i class="a-c a-c4"></i>
      <header class="a-head"><div class="a-mini">الجمهورية العربية السورية · وزارة الداخلية</div><img class="a-crest" src="${esc(crest())}" alt="شعار الجامعة"><h1 class="a-uni">${esc(n.uni)}</h1>${n.faculty ? `<div class="a-fac">${esc(n.faculty)}</div>` : ''}
        <div class="a-rule"><i></i></div><h2 class="a-title">كشف علامات</h2><div class="a-sub">السجل الأكاديمي الرسمي للطالب</div></header>
      <div class="a-name"><span>اسم الطالب</span><b>${esc(n.name)}</b></div><div class="a-info">${info}</div>${warnBanner(n)}${topSummaryBox(n)}${years}
      <footer class="a-foot"><div class="a-qr">${qr(n)}</div><div class="a-seal"><div class="a-seal-i">${seal}<b>موقَّعة رقمياً</b><small>${esc(n.uni)}</small></div></div><div class="a-meta">${metaLines(n)}</div></footer>
      <p class="a-note">${noteTxt} الحدّ الأدنى للنجاح ${PASS} من 100، والمقررات المعادة تُحتسب بأحدث علامة.</p></div></div></div>`;
  }

  /* ====== النموذج الثاني: العصري ====== */
  function modern(n) {
    const C = 2 * Math.PI * 34, pct = Math.max(0, Math.min(100, n.sum.avg || 0)), ring = `<svg class="b-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="7"/><circle cx="40" cy="40" r="34" fill="none" stroke="#E6CB84" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>`;
    const chips = n.info.filter((x) => x[0] !== 'الرقم الجامعي').map(([k, v]) => `<span class="b-chip"><small>${esc(k)}</small>${esc(v)}</span>`).join('');
    const years = n.years.map((y, yi) => `<section class="b-year"><header><span class="b-num">${yi + 1}</span><h3>${esc(y.label)}${y.ay ? ` <small>${esc(y.ay)}</small>` : ''}</h3><span class="b-avg">المعدل <b>${f1(y.avg)}</b></span></header>
      ${y.terms.map((t) => `<div class="b-term"><div class="b-th"><b>${esc(t.label)}</b><span>${t.hours} ساعة · المعدل ${f1(t.avg)}</span></div>
        <table class="b-t"><thead><tr><th>المقرر</th><th>الساعات</th><th class="o">نظري</th><th class="o">عملي</th><th class="b-bc">العلامة</th><th>الحالة</th></tr></thead><tbody>${t.rows.length ? t.rows.map((r) => `<tr class="${r.prev ? 'prev' : ''}"><td class="c-nm">${esc(r.course)}${prevTag(r)}</td><td>${r.hours}</td><td class="o">${opt(r.theory)}</td><td class="o">${opt(r.practical)}</td>
          <td class="b-bc"><span class="b-bar"><i class="${markCls(r.mark)}" style="width:${Math.max(0, Math.min(100, r.mark))}%"></i></span><b class="${markCls(r.mark)}">${r.mark}</b></td><td><span class="b-pill ${markCls(r.mark)}">${r.mark >= PASS ? 'ناجح' : 'راسب'}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty" style="padding:8px">لا توجد مقررات مسجلة في هذا الفصل</td></tr>'}</tbody></table></div>`).join('')}</section>`).join('');
    return `<div class="trp trp-b">${wm(n)}<div class="trp-pg"><header class="b-head"><div class="b-brand"><img src="${esc(crest())}" alt="شعار الجامعة"><div><b>${esc(n.uni)}</b><span>${esc(n.faculty || 'قسم شؤون الطلاب')}</span></div></div>
        <div class="b-ttl"><small>الوثيقة الرسمية</small><h1>كشف علامات</h1></div></header>
      <div class="b-card"><div class="b-av">${esc((n.name || '?')[0])}</div><div class="b-who"><h2>${esc(n.name)}</h2><div class="b-no">الرقم الجامعي <span class="mono">${esc(n.no)}</span></div><div class="b-chips">${chips}</div></div></div>
      ${warnBanner(n)}
      <div class="b-stats"><div class="b-gpa">${ring}<div><small>المعدل التراكمي</small><b>${f1(n.sum.avg)}</b><span>${esc(n.sum.rating)}</span></div></div><div><small>${esc(n.sum.title)}</small><b>${n.sum.courses}</b></div><div><small>الساعات المنجزة</small><b>${n.sum.earned}<em>/${n.sum.hours}</em></b></div><div><small>الترتيب</small><b>${esc(n.sum.rank)}</b></div><div class="ok"><small>ناجح</small><b>${n.sum.passed}</b></div><div class="${n.sum.failed ? 'bad' : ''}"><small>راسب</small><b>${n.sum.failed}</b></div></div>
      ${years}
      <footer class="b-foot">${qr(n)}<div class="b-meta">${metaLines(n)}</div><p>${noteTxt}</p></footer></div></div>`;
  }

  /* ====== النموذج الثالث: الأكاديمي المنسَّق (فصلان متجاوران) ====== */
  function academic(n) {
    const info = n.info.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
    const years = n.years.map((y) => `<section class="c-year"><h3><span>${esc(y.label)}${y.ay ? ` · ${esc(y.ay)}` : ''}</span><i>المعدل السنوي <b>${f1(y.avg)}</b> · ${y.hours} ساعة</i></h3>
      <div class="c-sems">${y.terms.map((t) => `<div class="c-sem"><div class="c-sh">${esc(t.label)}</div><table class="c-t"><thead><tr><th>المقرر</th><th>س</th><th>العلامة</th></tr></thead><tbody>${t.rows.length ? t.rows.map((r) => `<tr class="${r.prev ? 'prev' : ''}"><td class="c-nm">${esc(r.course)}${prevTag(r)}</td><td>${r.hours}</td><td class="mk ${markCls(r.mark)}">${r.mark}</td></tr>`).join('') : '<tr><td colspan="3" class="empty" style="padding:6px">—</td></tr>'}</tbody>
        <tfoot><tr><td>الساعات ${t.hours}</td><td colspan="2">المعدل ${f1(t.avg)}</td></tr></tfoot></table></div>`).join('')}</div></section>`).join('');
    const sumRows = n.years.map((y) => `<tr><td>${esc(y.label)}</td><td>${y.hours}</td><td>${f1(y.avg)}</td><td class="c-b"><span><i style="width:${Math.max(0, Math.min(100, y.avg || 0))}%"></i></span></td></tr>`).join('');
    return `<div class="trp trp-c">${wm(n)}<div class="trp-pg"><aside class="c-rib"><img src="${esc(crest())}" alt=""><span>${esc(n.uni)} · كشف العلامات الرسمي</span></aside>
      <div class="c-body"><header class="c-head"><div><small>${esc(n.faculty || 'قسم شؤون الطلاب')}</small><h1>السجل الأكاديمي (${esc(n.sum.title)})</h1></div><div class="c-code"><small>رمز التحقق</small><span class="mono">${esc(n.code)}</span></div></header>
        <div class="c-who"><small>اسم الطالب</small><h2>${esc(n.name)}</h2></div><div class="c-info">${info}</div>${warnBanner(n)}${years}
        <section class="c-final"><table><thead><tr><th>ملخص المواد والسنوات</th><th>الساعات</th><th>المعدل</th><th class="c-b">الترتيب: ${esc(n.sum.rank)}</th></tr></thead><tbody>${sumRows}</tbody>
          <tfoot><tr><td>المعدل التراكمي العام</td><td>${n.sum.earned}/${n.sum.hours}</td><td>${f1(n.sum.avg)}</td><td class="c-r">${esc(n.sum.rating)}</td></tr></tfoot></table></section>
        <footer class="c-foot">${qr(n)}<div class="c-meta">${metaLines(n)}</div><p>${noteTxt}</p></footer></div></div></div>`;
  }

  /* ====== النموذج الرابع: الفاخر (شهادة) ====== */
  const orn = '<svg class="d-orn" viewBox="0 0 220 16" aria-hidden="true"><path d="M2 8h82M136 8h82" stroke="#C9A24B" stroke-width="1.2"/><path d="M92 8l6-6 6 6-6 6zM116 8l6-6 6 6-6 6z" fill="none" stroke="#C9A24B" stroke-width="1.2"/><path d="M106 8l4-4 4 4-4 4z" fill="#C9A24B"/></svg>';
  function royal(n) {
    const years = n.years.map((y) => {
      let i = 0;
      return `<section class="d-year"><h3>${orn.replace('class="d-orn"', 'class="d-orn s"')}<span>${esc(y.label)}${y.ay ? ` — ${esc(y.ay)}` : ''}</span></h3>
        <table class="d-t"><thead><tr><th class="c-n">م</th><th>المقرر</th><th>الساعات</th><th class="o">نظري</th><th class="o">عملي</th><th>المجموع</th><th>التقدير</th></tr></thead><tbody>${y.terms.map((t) => `<tr class="d-sem"><td colspan="7">${esc(t.label)}</td></tr>${t.rows.length ? t.rows.map((r) => `<tr class="${r.prev ? 'prev' : ''}"><td class="c-n">${r.prev ? '' : ++i}</td><td class="c-nm">${esc(r.course)}${prevTag(r)}</td><td>${r.hours}</td><td class="o">${opt(r.theory)}</td><td class="o">${opt(r.practical)}</td><td class="mk ${markCls(r.mark)}">${r.mark}</td><td class="${markCls(r.mark)}">${rating(r.mark)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty" style="padding:6px">لا توجد مقررات مسجلة في هذا الفصل</td></tr>'}`).join('')}
        <tr class="d-tot"><td colspan="2">معدل ${esc(y.label)}</td><td>${y.hours}</td><td colspan="4">${f1(y.avg)}</td></tr></tbody></table></section>`;
    }).join('');
    const prog = (n.info.find((x) => x[0] === 'البرنامج') || [])[1];
    return `<div class="trp trp-d">${wm(n)}<div class="trp-pg"><div class="d-ring"><i class="d-m d-m1"></i><i class="d-m d-m2"></i><i class="d-m d-m3"></i><i class="d-m d-m4"></i><div class="d-in">
      <header class="d-head"><img class="d-crest" src="${esc(crest())}" alt="شعار الجامعة"><h1 class="d-uni">${esc(n.uni)}</h1>${n.faculty ? `<div class="d-fac">${esc(n.faculty)}</div>` : ''}${orn}<h2 class="d-title">كشف علامات (${esc(n.sum.title)})</h2></header>
      <div class="d-narr"><p>تشهد ${esc(n.uni)} بأن الطالب/ـة</p><div class="d-name">${esc(n.name)}</div><p>الرقم الجامعي <span class="mono">${esc(n.no)}</span>${prog ? ` · المقيَّد/ـة في برنامج «${esc(prog)}»` : ''}${n.faculty ? ` · ${esc(n.faculty)}` : ''} · الترتيب في الدفعة: <b>${esc(n.sum.rank)}</b><br>قد أنجز/ت المقررات الآتية بالعلامات المبيَّنة قرين كلٍّ منها:</p></div>
      ${warnBanner(n)}${years}
      <div class="d-end"><div class="d-qr">${qr(n)}<small>${esc(n.code)}</small></div><div class="d-medal"><div class="d-medal-i"><small>المعدل التراكمي</small><b>${f1(n.sum.avg)}</b><span>${esc(n.sum.rating)}</span></div><i class="d-tail d-t1"></i><i class="d-tail d-t2"></i></div><div class="d-meta">${metaLines(n)}<div class="d-esig">${seal}<span>موقَّعة رقمياً</span></div></div></div>
      <p class="d-note">${noteTxt} الحدّ الأدنى للنجاح ${PASS} من 100، والمقررات المعادة تُحتسب بأحدث علامة.</p></div></div></div></div>`;
  }

  const TEMPLATES = [
    { id: 'classic', name: 'الكلاسيكي الرسمي', desc: 'إطار مزدوج بزوايا ذهبية وجدول رسمي دقيق، يناسب الوثائق المعتمدة والمعاملات الرسمية.', render: classic },
    { id: 'modern', name: 'العصري', desc: 'ترويسة خضراء متدرجة وبطاقات ومؤشرات ملوّنة وأشرطة علامات، الأوضح للقراءة على الشاشة.', render: modern },
    { id: 'academic', name: 'الأكاديمي المنسَّق', desc: 'فصلان متجاوران في كل سنة بجداول مضغوطة وشريط جانبي، الأقصر طولاً عند كثرة المقررات.', render: academic },
    { id: 'royal', name: 'الفاخر (شهادة)', desc: 'إطار منسوج وأوسمة ذهبية وميدالية للمعدل وصياغة شهادة، الأكثر فخامة.', render: royal },
  ];
  const ids = TEMPLATES.map((t) => t.id);

  // شريط التحكم العلوي لاختيار القالب + زر "اعتماده كافتراضي" + رابط تحميل PDF المطابق للشكل
  function renderToolbar(docCode, activeId) {
    const cur = activeId || getDefaultTemplate();
    const isDef = cur === getDefaultTemplate();
    return `<div class="tool-row no-print" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="chips">${TEMPLATES.map((t) => `<button class="chip" type="button" data-act="tr-tpl" data-tpl="${t.id}" aria-pressed="${cur === t.id}">${esc(t.name)}</button>`).join('')}</div>
      <div class="actions" style="margin:0">
        <button class="btn sm ${isDef ? 'ok' : ''}" type="button" data-act="tr-setdefault" data-tpl="${esc(cur)}">${isDef ? '✓ الشكل الافتراضي المعتمد' : 'اعتماده كافتراضي'}</button>
        ${docCode ? `<a class="btn sm pri" href="/api/documents/${encodeURIComponent(docCode)}/pdf?template=${encodeURIComponent(cur)}" target="_blank" rel="noopener">حفظ وتصدير PDF (${esc((TEMPLATES.find((t) => t.id === cur) || TEMPLATES[0]).name)})</a>` : ''}
      </div>
    </div>`;
  }

  UA.transcript = {
    templates: TEMPLATES, ids, normalize,
    getDefaultTemplate, setDefaultTemplate, renderToolbar,
    render(d, id) {
      const chosen = id || getDefaultTemplate();
      const t = TEMPLATES.find((x) => x.id === chosen) || TEMPLATES[0];
      return t.render(normalize(d));
    },
  };
})();
