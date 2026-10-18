/* الهيكل الجديد للعاملين: شريط جانبي أخضر داكن، شريط علوي (مسار، بحث، إشعارات، ملف المستخدم)،
   ولوحة التحكم الرئيسية ببطاقات إحصائية ومخططات وجدول أحدث الطلبات وإجراءات سريعة.
   التصميم مستمد من ملف Figma «تعديل تصميم الموقع»؛ والبيانات حقيقية من الخادم (لا أرقام ثابتة). */
(function () {
  const UA = window.UA, { S, api, esc, can } = UA;
  const X = { data: null };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); X.data = null; };

  /* ---------- أيقونات التصميم ---------- */
  const ICO = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4H8v16a2 2 0 0 1-4 0V6H2v14a2 2 0 0 0 2 2Z"/><path d="M12 8h6M12 12h6M12 16h6M8 8v8"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 15v5H4v-5"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M20 15v5H4v-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.65 1.03 1.26 1.03H21v4h-.34c-.61 0-1.14.43-1.26 1Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cap: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    out: '<path d="M15 4.5h4.5v15H15"/><path d="M10.5 8l-4 4 4 4M6.5 12h10"/>',
  };
  const ico = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n] || ''}</svg>`;
  const NAV_ICON = { overview: 'grid', home: 'grid', guide: 'book', grades: 'chart', tx: 'file', affairs: 'users', dashboard: 'chart', academics: 'book', comms: 'news', exchange: 'upload', import: 'upload', export: 'download', attendance: 'scan', admin: 'settings', access: 'shield', audit: 'file', verify: 'check' };
  const PARENT = { site: 'admin', services: 'admin', academics: 'affairs' };
  const EXTRA_LABEL = { site: 'إعدادات الموقع', services: 'الخدمات' };

  /* ---------- أدوات ---------- */
  const nf = new Intl.NumberFormat('en-US');
  const initials = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ') || '؟';
  const ago = (t) => {
    const m = Math.max(1, Math.round((Date.now() - t) / 60000));
    if (m < 60) return `منذ ${m} دقيقة`;
    const h = Math.round(m / 60); if (h < 24) return `منذ ${h} ساعة`;
    return `منذ ${Math.round(h / 24)} يوماً`;
  };
  const dateLong = () => { try { return new Date().toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return new Date().toLocaleDateString(); } };
  const pending = () => {
    if (S.stats && S.stats.review !== undefined) return S.stats.review;
    if (X.data && X.data.stats) return X.data.stats.review;
    const list = (X.data && X.data.requests) || S.requests || [];
    return list.filter((r) => r.status === 'review').length;
  };

  /* ---------- تحميل بيانات لوحة التحكم ---------- */
  UA.loaders.overview = async () => {
    const D = { analytics: null, stats: null, requests: null };
    const jobs = [];
    if (can('stats:read')) {
      jobs.push(api('GET', '/api/analytics').then((r) => { D.analytics = r; }).catch(() => {}));
      jobs.push(api('GET', '/api/stats').then((r) => { D.stats = r.stats; S.stats = r.stats; }).catch(() => {}));
    }
    if (can('request:read_all') || can('request:read_unit')) jobs.push(api('GET', '/api/requests').then((r) => { D.requests = r.requests; }).catch(() => {}));
    await Promise.all(jobs);
    X.data = D;
  };

  /* ---------- لوحة التحكم ---------- */
  const statCard = (label, value, meta, icon, color, progress) => `<article class="sx-stat"><div class="sx-ic sx-${color}">${ico(icon, 22)}</div><div class="cp"><span>${label}</span><strong>${value}</strong></div>
    <div class="mt"><span>${meta}</span>${progress === undefined ? '' : `<div><i style="width:${Math.max(0, Math.min(100, progress))}%"></i></div>`}</div></article>`;

  function weekChart(reqs) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      let label = ''; try { label = d.toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long' }); } catch { label = String(d.getDay()); }
      days.push({ from: d.getTime(), to: d.getTime() + 864e5, label, n: 0 });
    }
    reqs.forEach((r) => { const d = days.find((x) => r.createdAt >= x.from && r.createdAt < x.to); if (d) d.n++; });
    const top = Math.max(4, Math.ceil(Math.max(...days.map((d) => d.n)) / 4) * 4);
    const ys = [top, top * 0.75, top * 0.5, top * 0.25, 0].map((v) => `<span>${nf.format(Math.round(v * 10) / 10)}</span>`).join('');
    const cols = days.map((d) => `<div class="sx-col" title="${esc(d.label)}: ${d.n}"><div class="sx-track"><i style="height:${(d.n / top) * 100}%"><b>${d.n}</b></i></div><span>${esc(d.label)}</span></div>`).join('');
    return `<div class="sx-bars" role="img" aria-label="عدد الطلبات خلال آخر 7 أيام"><div class="sx-y">${ys}</div><div class="sx-plot">${cols}</div></div>`;
  }

  function donut(D, reqs, cnt) {
    const PAL = ['#0E6655', '#D5B65D', '#65A99A', '#356C8A', '#9A6D20', '#8C9A94'];
    const fac = D.analytics && D.analytics.tables.find((t) => t.id === 'byFaculty');
    let rows, total, center, title, sub;
    if (fac && fac.rows.some((r) => r[1] > 0)) {
      const all = fac.rows.filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
      rows = all.slice(0, 5).map((r, i) => [r[0], r[1], PAL[i]]);
      const rest = all.slice(5).reduce((s, r) => s + r[1], 0); if (rest) rows.push(['أخرى', rest, PAL[5]]);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلاب'; title = 'توزيع الطلاب'; sub = 'حسب الكلية أو المعهد';
    } else {
      rows = [['قيد المراجعة', cnt.review, '#D5B65D'], ['معتمدة', cnt.approved, '#0E6655'], ['مرفوضة', cnt.rejected, '#B3261E']].filter((r) => r[1] > 0);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلبات'; title = 'حالة الطلبات'; sub = 'توزيع الطلبات الظاهرة لك';
    }
    if (!total) return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div><div class="sx-empty">لا بيانات لعرضها بعد.</div></article>`;
    let acc = 0;
    const stops = rows.map((r) => { const a = acc, b = acc + (r[1] / total) * 100; acc = b; return `${r[2]} ${a}% ${b}%`; }).join(', ');
    const legend = rows.map((r) => `<div><i style="background:${r[2]}"></i><span>${esc(r[0])}</span><b>${Math.round((r[1] / total) * 100)}%</b></div>`).join('');
    return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div>
      <div class="sx-donut-w"><div class="sx-donut" style="background:conic-gradient(${stops})" role="img" aria-label="${title}"><div><strong>${nf.format(total)}</strong><span>${center}</span></div></div><div class="sx-legend">${legend}</div></div></article>`;
  }

  function homeView() {
    const D = X.data || { analytics: null, stats: null, requests: null };
    const reqs = (D.requests || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const cnt = { review: 0, approved: 0, rejected: 0 };
    reqs.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
    const st = D.stats;
    const total = st ? st.review + st.approved + st.rejected : reqs.length;
    const review = st ? st.review : cnt.review, approved = st ? st.approved : cnt.approved, rejected = st ? st.rejected : cnt.rejected;
    const decided = approved + rejected;
    const kpi = (id) => D.analytics && D.analytics.kpis.find((k) => k.id === id);
    const cards = [];
    if (kpi('students')) cards.push(statCard('الطلاب المقيَّدون', nf.format(kpi('students').value), esc(kpi('students').hint || ''), 'users', 'mint'));
    cards.push(statCard('إجمالي الطلبات', nf.format(total), `${nf.format(approved)} معتمدة · ${nf.format(rejected)} مرفوضة`, 'file', 'sand'));
    cards.push(statCard('طلبات قيد المراجعة', nf.format(review), st && st.slaBreaches ? `${nf.format(st.slaBreaches)} متأخرة عن مدة الخدمة` : 'لا طلبات متأخرة عن المدة', 'clock', 'blue', total ? (review / total) * 100 : 0));
    cards.push(statCard('نسبة الاعتماد', decided ? `${Math.round((approved / decided) * 1000) / 10}%` : '—', st && st.avgApprovalMs ? `متوسط زمن الاعتماد ${UA.dur(st.avgApprovalMs)}` : 'من الطلبات المبتوت فيها', 'check', 'lav', decided ? (approved / decided) * 100 : 0));

    const rows = reqs.slice(0, 6).map((r) => {
      const m = { review: ['amber', 'قيد المراجعة'], approved: ['green', 'معتمد'], rejected: ['red', 'مرفوض'] }[r.status] || ['amber', r.status];
      return `<tr><td><div class="sx-sc"><span>${esc(initials(r.student.name))}</span><div><strong>${esc(r.student.name)}</strong><small>${esc(r.student.studentNo || r.no)}</small></div></div></td>
        <td data-l="نوع الطلب">${esc(r.service.label)}</td><td class="sx-muted" data-l="وقت التقديم">${ago(r.createdAt)}</td><td data-l="الحالة"><span class="sx-st ${m[0]}"><i></i>${m[1]}</span></td>
        <td><button class="sx-go" data-sx="openreq" data-id="${r.id}" aria-label="عرض طلب ${esc(r.student.name)}">${ico('chevron', 17)}</button></td></tr>`;
    }).join('');
    const reqPanel = D.requests ? `<article class="sx-panel"><div class="sx-ph"><div><h2>أحدث الطلبات</h2><p>آخر المعاملات الواردة إلى النظام</p></div>
        <button class="sx-link" data-sx="go" data-v="affairs">عرض جميع الطلبات ${ico('arrow', 16)}</button></div>
      <div class="sx-tscroll">${rows ? `<table class="sx-table rsp"><thead><tr><th>الطالب</th><th>نوع الطلب</th><th>وقت التقديم</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="sx-empty">لا توجد طلبات حتى الآن.</div>'}</div></article>`
      : '';

    const views = new Set(UA.viewsFor(S.me.role).map((v) => v[0]));
    const qa = [];
    if (can('student:register')) qa.push(['mint', 'users', 'إضافة طالب جديد', 'تسجيل بيانات طالب في النظام', 'newstudent', '']);
    if (can('student:register') || can('course:manage') || can('grade:manage')) qa.push(['sand', 'upload', 'استيراد بيانات', 'رفع ملف Excel إلى النظام', 'go', 'import']);
    if (can('data:export')) qa.push(['blue', 'file', 'إنشاء تقرير', 'تصدير تقرير مخصص', 'go', 'export']);
    if (views.has('access')) qa.push(['lav', 'shield', 'إدارة الصلاحيات', 'التحكم بحسابات المستخدمين', 'go', 'access']);
    if (!qa.length && views.has('dashboard')) qa.push(['blue', 'chart', 'الإحصاءات التفصيلية', 'مؤشرات ومخططات تفاعلية', 'go', 'dashboard']);
    const quick = `<article class="sx-panel"><div class="sx-ph"><div><h2>إجراءات سريعة</h2><p>وصول مباشر للمهام المتكررة</p></div></div><div class="sx-quick">${qa.length ? qa.map((q) => `<button data-sx="${q[4]}" data-v="${q[5]}"><span class="sx-${q[0]}">${ico(q[1])}</span><div><strong>${q[2]}</strong><small>${q[3]}</small></div>${ico('chevron', 17)}</button>`).join('') : '<div class="sx-empty">لا إجراءات متاحة لحسابك.</div>'}</div></article>`;

    return `<section class="sx-hero"><div><span class="sx-eyebrow">${esc(dateLong())}</span><h1>مرحباً بك، ${esc(S.me.name)}</h1><p>إليك ملخصاً لأداء الجامعة وآخر المستجدات لهذا اليوم.</p></div>
      ${can('student:register') ? `<button class="sx-btn" data-sx="newstudent">${ico('plus', 18)} تسجيل طالب جديد</button>` : ''}</section>
      <section class="sx-stats" aria-label="ملخص الإحصاءات">${cards.join('')}</section>
      ${D.requests ? `<section class="sx-grid-a"><article class="sx-panel"><div class="sx-ph"><div><h2>نشاط الطلبات</h2><p>عدد الطلبات المستلمة خلال آخر 7 أيام</p></div></div>${weekChart(reqs)}</article>${donut(D, reqs, cnt)}</section>` : (D.analytics ? `<section class="sx-grid-a">${donut(D, reqs, cnt)}${quick}</section>` : '')}
      ${D.requests ? `<section class="sx-grid-b">${reqPanel}${quick}</section>` : (D.analytics ? '' : `<section class="sx-grid-b">${quick}</section>`)}`;
  }
  UA.views.overview = homeView;

  /* ---------- الهيكل ----------
     o (اختياري، تستعمله واجهة الطالب): views, act, active, label, root, search, notif {count,text,btn}, badges, help, menu */
  UA.shell = function shell(body, o = {}) {
    document.body.classList.add('sx-on');
    const views = o.views || UA.viewsFor(S.me.role);
    const act = o.act || 'view';
    const activeKey = o.active || PARENT[S.view] || S.view;
    const label = o.label || (views.find((v) => v[0] === S.view) || [])[1] || EXTRA_LABEL[S.view] || '';
    const review = o.notif ? o.notif.count : pending();
    const comp = X.data && X.data.analytics && X.data.analytics.kpis.find((k) => k.id === 'complaints');
    const badge = (k) => {
      if (o.badges) return o.badges[k] ? `<small>${o.badges[k]}</small>` : '';
      return k === 'affairs' && review ? `<small>${review}</small>` : (k === 'comms' && comp && comp.value ? `<small>${comp.value}</small>` : '');
    };
    const hasGroup = !o.views && views.some((v) => v[0] === 'affairs');
    const inGroup = hasGroup && (S.view === 'affairs' || S.view === 'academics');
    document.body.classList.toggle('sx-grouped', !!inGroup);
    const subs = () => {
      const t = S.stTab === 'edit' ? 'list' : S.stTab;
      const it = [['affairs', 'requests', can('request:decide') ? 'سجل الطلبات' : 'الطلبات']];
      if (can('student:read')) it.push(['affairs', 'list', 'سجل الطلاب']);
      if (can('student:register')) it.push(['affairs', 'new', 'تسجيل طالب جديد']);
      if (views.some((v) => v[0] === 'academics')) it.push(['academics', 'courses', 'دليل المواد'], ['academics', 'grades', 'جدول العلامات']);
      const at = UA.acTab ? UA.acTab() : '';
      return `<div class="sx-sub-list" role="group" aria-label="شؤون الطلاب">${it.map((x) => `<button data-sx="sub" data-v="${x[0]}" data-t="${x[1]}"${S.view === x[0] && (x[0] === 'affairs' ? t === x[1] : at === x[1]) ? ' aria-current="true"' : ''}>${esc(x[2])}</button>`).join('')}</div>`;
    };
    // تبويبات الصفحة الداخلية تنتقل إلى القائمة الجانبية تحت عنوان الصفحة ولا تُكرَّر داخلها (كما في «شؤون الطلاب»)
    let sideSub = '';
    if (!o.views && !inGroup) {
      const m = /<div class="sub-tabs[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body);
      if (m) {
        const items = [...m[1].matchAll(/<button[^>]*data-act="([^"]+)"[^>]*data-t="([^"]+)"[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)];
        if (items.length) {
          body = body.replace(m[0], '');
          sideSub = `<div class="sx-sub-list" role="group" aria-label="${esc(label)}">${items.map((x) => `<button data-act="${x[1]}" data-t="${x[2]}"${x[3] === 'true' ? ' aria-current="true"' : ''}>${x[4].trim()}</button>`).join('')}</div>`;
        }
      }
    }
    const nav = views.filter((v) => !(hasGroup && v[0] === 'academics')).map((v) => `<button data-act="${act}" data-v="${v[0]}"${activeKey === v[0] || (hasGroup && v[0] === 'affairs' && inGroup) ? ' aria-current="page"' : ''}>${ico(NAV_ICON[v[0]] || 'file')}<span>${esc(v[1])}</span>${badge(v[0])}${hasGroup && v[0] === 'affairs' ? `<em class="sx-caret${inGroup ? ' open' : ''}">${ico('chevron', 15)}</em>` : ''}</button>${hasGroup && v[0] === 'affairs' && inGroup ? subs() : ''}${sideSub && activeKey === v[0] ? sideSub : ''}`).join('');
    const uni = String(S.uni || ''), cut = uni.indexOf(' للعلوم');
    const brand1 = cut > 0 ? uni.slice(0, cut) : uni, brand2 = cut > 0 ? uni.slice(cut + 1) : 'نظام إدارة الجامعة';
    const role = S.me.roleLabel || UA.ROLE_LABEL[S.me.role] || '';
    const help = o.help || `<div class="sx-help"><i>${ico('shield', 22)}</i><strong>التحقق من الوثائق</strong><p>تحقّق من صحة أي وثيقة صادرة عن الجامعة.</p><button data-act="view" data-v="verify">فتح صفحة التحقق ${ico('arrow', 15)}</button></div>`;
    const notifBody = o.notif ? `<p>${o.notif.text}</p>${o.notif.btn || ''}` : `<p>${review ? `لديك ${review} طلب قيد المراجعة.` : 'لا توجد إشعارات جديدة.'}</p>${review ? '<button data-sx="go" data-v="affairs">عرض الطلبات</button>' : ''}`;
    const menu = o.menu || `<button class="sx-menu-item" data-act="logout">${ico('out', 18)} تسجيل الخروج</button>`;
    const search = o.search === false ? '<div class="sx-sp"></div>' : `<label class="sx-search">${ico('search', 19)}<input id="sx-q" type="search" placeholder="${can('student:read') ? 'ابحث عن طالب بالاسم أو الرقم الجامعي...' : 'ابحث...'}" autocomplete="off"><kbd>Ctrl K</kbd></label>`;
    return `<div class="sx-shell" dir="rtl">
      <button class="sx-backdrop" data-sx="close" aria-label="إغلاق القائمة"></button>
      <aside class="sx-side" aria-label="القائمة الجانبية">
        <div class="sx-brand"><img src="/brand/crest.svg" alt="" width="42" height="48"><div><strong>${esc(brand1)}</strong><span>${esc(brand2)}</span></div><button class="sx-ib sx-close" data-sx="close" aria-label="إغلاق" style="color:#fff">${ico('close')}</button></div>
        <div class="sx-navlabel">القائمة الرئيسية</div>
        <nav class="sx-nav" aria-label="القائمة الرئيسية">${nav}</nav>
        ${help}
        <div class="sx-state"><i></i> النظام يعمل بشكل طبيعي</div>
      </aside>
      <div class="sx-content">
        <header class="sx-top">
          <button class="sx-ib sx-burger" data-sx="open" aria-label="فتح القائمة">${ico('menu')}</button>
          <div class="sx-crumbs"><span>${esc(o.root || 'نظام إدارة الجامعة')}</span>${ico('chevron', 15)}<strong>${esc(label)}</strong></div>
          ${search}
          <div class="sx-actions">
            ${window.UAtheme ? window.UAtheme.button() : ''}
            <div class="sx-wrap"><button class="sx-ib" data-sx="notif" aria-label="الإشعارات">${ico('bell')}${review ? '<i class="sx-dot"></i>' : ''}</button>
              <div class="sx-pop" id="sx-notif" hidden><strong>الإشعارات</strong>${notifBody}${UA.push ? UA.push.panel() : ''}</div></div>
            <div class="sx-sep"></div>
            <div class="sx-wrap"><button class="sx-profile" data-sx="profile" aria-label="قائمة المستخدم"><span class="sx-av">${esc(initials(S.me.name))}</span><span><strong>${esc(S.me.name)}</strong><small>${esc(role)}</small></span>${ico('chevron', 15)}</button>
              <div class="sx-pop" id="sx-menu" hidden>${menu}</div></div>
          </div>
        </header>
        <main class="sx-main"><div class="sx-page">${body}</div></main>
        <footer class="sx-foot"><span>© 2026 ${esc(S.uni)}</span><span>جميع الحقوق محفوظة</span></footer>
      </div></div>`;
  };
  UA.sx = { ico, initials, ago, dateLong, nf, statCard };

  /* ---------- الأحداث ---------- */
  const pops = () => [document.getElementById('sx-notif'), document.getElementById('sx-menu')].filter(Boolean);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-sx]');
    if (!t) { if (!(e.target.closest && e.target.closest('.sx-pop') && !e.target.closest('[data-act]'))) pops().forEach((p) => { p.hidden = true; }); return; }
    const a = t.dataset.sx;
    if (a === 'open') document.body.classList.add('sx-drawer');
    else if (a === 'close') document.body.classList.remove('sx-drawer');
    else if (a === 'notif' || a === 'profile') { const mine = document.getElementById(a === 'notif' ? 'sx-notif' : 'sx-menu'); const was = mine && !mine.hidden; pops().forEach((p) => { p.hidden = true; }); if (mine) mine.hidden = was; }
    else if (a === 'sub') {
      const v = t.dataset.v, tab = t.dataset.t;
      if (v === 'affairs') { S.stTab = tab; S.err = ''; S.fieldErr = null; S.stEdit = null; if (tab === 'new') { S.cred = null; S.stSel = null; } await UA.guard(() => UA.go('affairs')); }
      else { await UA.guard(() => UA.go('academics')); if (UA.actions.actab) await UA.actions.actab(null, { t: tab }); }
      document.body.classList.remove('sx-drawer');
    }
    else if (a === 'go') { await UA.guard(() => UA.go(t.dataset.v)); }
    else if (a === 'newstudent') { S.stTab = 'new'; S.stSel = null; await UA.guard(() => UA.go('affairs')); }
    else if (a === 'openreq') { S.stTab = 'requests'; S.sel = Number(t.dataset.id); S.rej = null; S.view = 'affairs'; await UA.guard(async () => { await UA.loadFor('affairs'); UA.render(); window.scrollTo(0, 0); }); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.sx-sub-list [data-act]')) document.body.classList.remove('sx-drawer'); });
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') { const q = document.getElementById('sx-q'); if (q) { e.preventDefault(); q.focus(); } }
    if (e.key === 'Escape') { pops().forEach((p) => { p.hidden = true; }); document.body.classList.remove('sx-drawer'); }
    if (e.key === 'Enter' && e.target && e.target.id === 'sx-q') {
      e.preventDefault(); const v = e.target.value.trim();
      if (can('student:read')) { S.stList.q = v; S.stTab = 'list'; S.stSel = null; } else S.stTab = 'requests';
      await UA.guard(() => UA.go('affairs'));
    }
  });
})();
