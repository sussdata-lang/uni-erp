/* واجهة الطالب بنمط تطبيق الجوال: الرئيسية، دليل المواد، علاماتي، الأخبار، معاملاتي + قائمة الملف الشخصي */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];
  const GOV = ['دمشق', 'ريف دمشق', 'حلب', 'حمص', 'حماة', 'اللاذقية', 'طرطوس', 'إدلب', 'درعا', 'السويداء', 'القنيطرة', 'دير الزور', 'الرقة', 'الحسكة', 'خارج سوريا'];
  const SEM_LABEL = { 1: 'الفصل الأول', 2: 'الفصل الثاني' };
  const day = (t) => { try { return new Date(t).toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }); } catch { return ''; } };

  const T = { all: null, profile: null, news: null, courses: null, grades: null, reqs: null, cmps: null, loading: {},
    guide: { level: null, sem: '' }, gr: { level: null, sem: '', open: {} }, openReq: {}, wz: null, error: '' };
  UA.reset = () => Object.assign(T, { all: null, profile: null, news: null, courses: null, grades: null, reqs: null, cmps: null, loading: {}, guide: { level: null, sem: '' }, gr: { level: null, sem: '', open: {} }, openReq: {}, wz: null });

  /* ---------- أيقونات ---------- */
  // الأيقونات من المجموعة الموحّدة بهوية الجامعة (public/icons.js)
  const IC = Object.fromEntries(['home', 'guide', 'grades', 'news', 'tx', 'cap', 'doc', 'bed', 'back', 'plus', 'out', 'edit', 'lock', 'help', 'shield'].map((k) => [k, UA.icon(k === 'doc' ? 'tx' : k)]));
  IC.check = UA.icon('check', 16); IC.cross = UA.icon('cross', 16);
  const svcIcon = (c) => ({ transcript: IC.doc, excellence_year: IC.cap, campus_life: IC.bed }[c] || IC.doc);
  const emblem = `<img class="emblem" src="/brand/crest.svg" alt="شعار الجامعة" width="87" height="104">`;

  /* ---------- مكونات ---------- */
  const sk = (n = 5) => Array.from({ length: n }, () => '<div class="sk-card"><i class="sk-l w60"></i><i class="sk-l w40"></i></div>').join('');
  const pageHead = (title, extra = '') => `<header class="m-head"><h1>${esc(title)}</h1>${extra}</header>`;
  const empty = (t, d) => `<div class="m-empty"><b>${esc(t)}</b>${d ? `<p>${esc(d)}</p>` : ''}</div>`;
  const years = () => (T.profile && T.profile.program && T.profile.program.years) || 4;
  const curLevel = () => (T.profile ? T.profile.level : 1);
  const levelChips = (act, cur) => `<div class="m-chips" role="tablist">${Array.from({ length: years() }, (_, i) => i + 1).map((n) => `<button class="m-chip" role="tab" data-act="${act}" data-l="${n}" aria-selected="${cur === n}">السنة ${LV[n - 1] || n}</button>`).join('')}</div>`;
  const semSelect = (id, cur) => `<div class="m-sort"><span>ترتيب حسب</span><select data-chg="${id}" aria-label="الفصل الدراسي"><option value=""${cur === '' ? ' selected' : ''}>الفصلين معاً</option><option value="1"${cur === '1' ? ' selected' : ''}>الفصل الأول</option><option value="2"${cur === '2' ? ' selected' : ''}>الفصل الثاني</option></select></div>`;

  /* ---------- الصفحات ---------- */
  function homePage() {
    const h = new Date().getHours(), hello = h < 12 ? 'صباح الخير' : 'مساء الخير';
    const news = T.news ? (T.news.length ? `<div class="m-car" tabindex="0" aria-label="أبرز الأخبار">${T.news.slice(0, 8).map((n) => `<button class="m-news-c" data-act="newsopen" data-id="${n.id}"><span class="d">${esc(day(n.publishedAt))}</span><b>${esc(n.title)}</b></button>`).join('')}</div>` : '<div class="m-empty small-e">لا أخبار حالياً.</div>') : '<div class="m-car">' + sk(1) + '</div>';
    const order = { excellence_year: 1, campus_life: 2, transcript: 3, attendance: 4, excuse: 5 };
    const svcs = [...S.services].sort((a, b) => (order[a.code] || 9) - (order[b.code] || 9));
    const cards = svcs.map((s, i) => `<button class="m-svc${svcs.length % 2 && i === 0 ? ' wide' : ''}" data-act="wzstart" data-k="${esc(s.code)}"><span class="ic">${svcIcon(s.code)}</span><b>${esc(s.label)}</b></button>`).join('');
    return `<header class="m-hello"><button class="m-avatar" data-act="drawer" aria-label="الملف الشخصي"><span>${esc(S.me.name[0])}</span></button><div><small>${hello}</small><b>${esc(S.me.name)}</b></div></header>
      <section><div class="m-sec"><h2>أبرز الأخبار</h2><button class="link" data-act="snav" data-v="news">عرض الكل</button></div>${news}</section>
      <section><div class="m-sec"><h2>المعاملات</h2></div><div class="m-svcs">${cards}</div></section>`;
  }
  function guidePage() {
    const lv = T.guide.level || curLevel();
    let body;
    if (T.loading.guide || !T.courses) body = sk(6);
    else if (!T.courses.length) body = empty('لا توجد مقررات مسجَّلة لهذه السنة بعد', 'تُضاف المقررات من قسم شؤون الطلاب.');
    else body = T.courses.map((c) => `<article class="m-card"><b>${esc(c.name)} - ${SEM_LABEL[c.semester]}</b><small>${esc(c.instructor || 'المدرّس غير محدد')}</small></article>`).join('');
    return pageHead('دليل المواد') + levelChips('glvl', lv) + semSelect('gsem', T.guide.sem) + `<div class="m-list">${body}</div>`;
  }
  function gradeCard(g) {
    const open = T.gr.open[g.id], badge = g.passed ? `<span class="m-badge ok">${IC.check}ناجح</span>` : `<span class="m-badge bad">${IC.cross}راسب</span>`;
    const marks = (x) => `<div class="m-marks">${x.theory !== null ? `<span>علامة الامتحان النظري <b>${x.theory}</b></span>` : ''}${x.practical !== null ? `<span>علامة الامتحان العملي <b>${x.practical}</b></span>` : ''}<span>العلامة الكلية <b>${x.total}</b></span></div>`;
    const prev = g.previous.length ? `<button class="m-prev" data-act="gprev" data-id="${g.id}" aria-expanded="${!!open}"><span>عرض العلامات السابقة</span>${IC.back}</button>` : '';
    const prevList = open ? g.previous.map((p) => `<div class="m-prevrow"><small>${esc(p.academicYear || '')}</small>${marks(p)}</div>`).join('') : '';
    return `<article class="m-card g">${badge}<b>${esc(g.course)} - ${SEM_LABEL[g.semester] || ''}</b>${g.instructor ? `<small>${esc(g.instructor)}</small>` : ''}<hr>${marks(g)}${prev}${prevList}</article>`;
  }
  function gradesPage() {
    const lv = T.gr.level || curLevel();
    let body;
    if (T.loading.grades || !T.grades) body = sk(4);
    else {
      let list = T.grades.grades; if (T.gr.sem) list = list.filter((g) => String(g.semester) === T.gr.sem);
      const sm = T.grades.summary;
      const sum = sm.count ? `<div class="m-sum"><div><b>${sm.count}</b><small>مقرراً</small></div><div class="ok"><b>${sm.passed}</b><small>ناجح</small></div><div class="bad"><b>${sm.failed}</b><small>راسب</small></div><div><b>${sm.average ?? '—'}</b><small>المعدل</small></div></div>` : '';
      body = sum + (list.length ? list.map(gradeCard).join('') : empty('لا توجد علامات لهذه السنة بعد', 'تظهر العلامات هنا فور اعتمادها من شؤون الطلاب.'));
    }
    return pageHead('علاماتي') + levelChips('grlvl', lv) + semSelect('grsem', T.gr.sem) + `<div class="m-list">${body}</div>`;
  }
  function newsPage() {
    const body = !T.news ? sk(5) : (T.news.length ? T.news.map((n) => `<button class="m-news-r" data-act="newsopen" data-id="${n.id}"><span class="t"><small>${esc(day(n.publishedAt))}${n.pinned ? ' · ' + UA.icon('pin', 14) + ' مثبّت' : ''}</small><b>${esc(n.title)}</b><span class="ex">${esc(n.body.length > 90 ? n.body.slice(0, 90) + '…' : n.body)}</span></span>${(n.media.find((m) => m.kind === 'image') || {}).src ? `<img class="th" src="${esc(n.media.find((m) => m.kind === 'image').src)}" alt="" loading="lazy">` : (n.media.length ? '<span class="th vid-ic" aria-hidden="true">▶</span>' : '')}</button>`).join('') : empty('لا أخبار حالياً'));
    return pageHead('التعميمات والأخبار') + `<div class="m-list">${body}</div>`;
  }
  function reqCard(r) {
    const open = T.openReq[r.id], st = UA.pill(r);
    const det = open ? `<div class="m-det"><div class="hint">${esc(UA.detailsText(r))}</div>${UA.steps(r)}${r.status === 'rejected' ? `<div class="reason">سبب الرفض: ${esc(r.rejectReason)}</div>` : ''}
      ${r.document ? `<div class="actions"><button class="btn pri sm" data-act="doc" data-c="${esc(r.document.code)}">عرض الوثيقة</button><button class="btn sm" data-act="docpdf" data-c="${esc(r.document.code)}">حفظ كملف PDF</button><span class="hint" style="align-self:center">رمز التحقق: <span class="mono">${esc(r.document.code)}</span></span></div>` : ''}${UA.events(r)}</div>` : '';
    return `<article class="m-card r"><button class="m-reqh" data-act="reqtoggle" data-id="${r.id}" aria-expanded="${!!open}"><span><b>${esc(r.service.label)}</b><small>${esc(r.no)} · ${fmt(r.createdAt)}</small></span>${st}</button>${det}</article>`;
  }
  function txPage() {
    let body;
    if (!T.reqs) body = sk(4);
    else if (!T.reqs.length) body = `<div class="m-empty big"><b>لا يوجد معاملات سابقة لك</b><p>إذا كنت ترغب في الحصول على معاملة جديدة وبسهولة مطلقة، ما عليك إلا أن تبدأ بإنشاء واحدة الآن</p><button class="m-btn" data-act="wzstart">إنشاء معاملة جديدة ${IC.plus}</button></div>`;
    else body = T.reqs.map(reqCard).join('');
    return pageHead('المعاملات', `<button class="btn pri sm m-newtx" data-act="wzstart">${IC.plus}<span>إنشاء معاملة جديدة</span></button>`) + `<div class="m-list">${body}</div><button class="m-fab" data-act="wzstart" aria-label="إنشاء معاملة جديدة">${IC.plus}</button>`;
  }

  /* ---------- صفحات الحاسوب بالتصميم الجديد (الهيكل من shell.js) ---------- */
  const sx = () => UA.sx;
  const sxTabs = (act, cur) => `<div class="sx-tabs" role="tablist">${Array.from({ length: years() }, (_, i) => i + 1).map((n) => `<button role="tab" data-act="${act}" data-l="${n}" aria-selected="${n === cur}">السنة ${LV[n - 1]}</button>`).join('')}</div>`;
  const sxSem = (id, cur) => `<label class="sx-sel"><span>الفصل</span><select data-chg="${id}" aria-label="الفصل الدراسي"><option value=""${cur === '' ? ' selected' : ''}>الفصلان معاً</option><option value="1"${cur === '1' ? ' selected' : ''}>الفصل الأول</option><option value="2"${cur === '2' ? ' selected' : ''}>الفصل الثاني</option></select></label>`;
  const sxHead = (title, sub, extra = '') => `<section class="sx-hero"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${extra}</section>`;
  const sxWait = () => '<div class="sx-empty">جارٍ التحميل…</div>';
  const sxEmpty = (t, d) => `<div class="sx-empty"><b>${esc(t)}</b>${d ? `<p>${esc(d)}</p>` : ''}</div>`;
  const newTxBtn = () => `<button class="sx-btn" data-act="wzstart">${sx().ico('plus', 18)} إنشاء معاملة جديدة</button>`;
  const dash = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

  function homeD() {
    const p = T.profile, al = T.all, reqs = T.reqs || [], review = reqs.filter((r) => r.status === 'review').length;
    const h = new Date().getHours(), hello = h < 12 ? 'صباح الخير' : 'مساء الخير';
    const cards = [
      sx().statCard('السنة الدراسية', p ? esc(p.levelLabel) : '—', p ? esc(p.program.faculty) : '', 'cap', 'mint'),
      sx().statCard('المعدل العام', al && al.avg !== null ? al.avg : '—', al ? `من ${al.count} مقرراً مسجَّلاً` : '', 'chart', 'sand', al && al.avg !== null ? al.avg : undefined),
      sx().statCard('المقررات الناجحة', al ? al.passed : '—', al ? `${al.failed} راسب · ${al.count} إجمالي` : '', 'check', 'blue', al && al.count ? (al.passed / al.count) * 100 : undefined),
      sx().statCard('معاملاتي', reqs.length, review ? `${review} قيد المراجعة` : 'لا معاملات قيد المراجعة', 'file', 'lav'),
    ].join('');
    const rows = reqs.slice(0, 5).map((r) => `<tr><td><strong>${esc(r.service.label)}</strong><div class="sx-sub">${esc(r.no)}</div></td><td class="sx-muted" data-l="وقت التقديم">${sx().ago(r.createdAt)}</td><td data-l="الحالة">${UA.pill(r)}</td></tr>`).join('');
    const reqPanel = `<article class="sx-panel"><div class="sx-ph"><div><h2>أحدث معاملاتي</h2><p>آخر المعاملات التي قدّمتها</p></div><button class="sx-link" data-act="snav" data-v="tx">عرض الكل ${sx().ico('arrow', 16)}</button></div>
      <div class="sx-tscroll">${!T.reqs ? sxWait() : (rows ? `<table class="sx-table rsp"><thead><tr><th>المعاملة</th><th>وقت التقديم</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>` : sxEmpty('لا توجد معاملات سابقة', 'ابدأ بإنشاء معاملة جديدة من القائمة المجاورة.'))}</div></article>`;
    const order = { excellence_year: 1, campus_life: 2, transcript: 3, attendance: 4, excuse: 5 };
    const svcs = [...S.services].sort((a, b) => (order[a.code] || 9) - (order[b.code] || 9));
    const tones = ['mint', 'sand', 'blue', 'lav'];
    const quick = `<article class="sx-panel"><div class="sx-ph"><div><h2>المعاملات المتاحة</h2><p>اختر المعاملة التي تريد تقديمها</p></div></div><div class="sx-quick">${svcs.map((s, i) => `<button data-act="wzstart" data-k="${esc(s.code)}"><span class="sx-${tones[i % 4]}">${sx().ico('file')}</span><div><strong>${esc(s.label)}</strong><small>${esc(s.description || '')}</small></div>${sx().ico('chevron', 17)}</button>`).join('')}</div></article>`;
    const news = !T.news ? sxWait() : (T.news.length ? `<div class="sx-news">${T.news.slice(0, 4).map(newsCardD).join('')}</div>` : sxEmpty('لا أخبار حالياً'));
    return `<section class="sx-hero"><div><span class="sx-eyebrow">${esc(sx().dateLong())}</span><h1>${hello}، ${esc(S.me.name)}</h1><p>هذا ملخص وضعك الدراسي وآخر المستجدات.</p></div>${newTxBtn()}</section>
      <section class="sx-stats" aria-label="ملخص وضعك الدراسي">${cards}</section>
      <section class="sx-grid-b">${reqPanel}${quick}</section>
      <article class="sx-panel" style="margin-top:16px"><div class="sx-ph"><div><h2>أبرز الأخبار</h2><p>آخر التعميمات والأخبار</p></div><button class="sx-link" data-act="snav" data-v="news">عرض الكل ${sx().ico('arrow', 16)}</button></div><div style="margin-top:14px">${news}</div></article>`;
  }
  function newsCardD(n) {
    const snippet = String(n.body || '').replace(/\s+/g, ' ').slice(0, 130);
    return `<button class="sx-newsc" data-act="newsopen" data-id="${n.id}"><small>${esc(day(n.publishedAt))}${n.pinned ? ' · مثبّت' : ''}</small><strong>${esc(n.title)}</strong><span>${esc(snippet)}${String(n.body || '').length > 130 ? '…' : ''}</span></button>`;
  }
  function guideD() {
    const lv = T.guide.level || curLevel();
    let body;
    if (T.loading.guide || !T.courses) body = sxWait();
    else if (!T.courses.length) body = sxEmpty('لا توجد مقررات مسجَّلة لهذه السنة بعد', 'تُضاف المقررات من قسم شؤون الطلاب.');
    else body = `<table class="sx-table rsp"><thead><tr><th>المقرر</th><th>الفصل</th><th>المدرّس</th><th>الساعات</th></tr></thead><tbody>${T.courses.map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.code ? `<div class="sx-sub">${esc(c.code)}</div>` : ''}</td><td data-l="الفصل">${SEM_LABEL[c.semester] || ''}</td><td class="sx-muted" data-l="المدرّس">${esc(c.instructor || 'غير محدد')}</td><td data-l="الساعات">${dash(c.hours)}</td></tr>`).join('')}</tbody></table>`;
    return sxHead('دليل المواد', 'مقررات برنامجك الدراسي حسب السنة والفصل.') + `<article class="sx-panel"><div class="sx-bar">${sxTabs('glvl', lv)}${sxSem('gsem', T.guide.sem)}</div><div class="sx-tscroll">${body}</div></article>`;
  }
  function gradesD() {
    const lv = T.gr.level || curLevel();
    let cards = '', body;
    if (T.loading.grades || !T.grades) body = sxWait();
    else {
      let list = T.grades.grades; if (T.gr.sem) list = list.filter((g) => String(g.semester) === T.gr.sem);
      const sm = T.grades.summary;
      cards = `<section class="sx-stats" style="margin-bottom:16px">${sx().statCard('المقررات', sm.count, 'في هذه السنة', 'book', 'mint')}${sx().statCard('ناجح', sm.passed, 'مقررات مجتازة', 'check', 'blue', sm.count ? (sm.passed / sm.count) * 100 : undefined)}${sx().statCard('راسب', sm.failed, 'مقررات غير مجتازة', 'clock', 'sand')}${sx().statCard('المعدل', sm.average !== null ? sm.average : '—', 'من 100 (موزون بالساعات)', 'chart', 'lav', sm.average !== null ? sm.average : undefined)}</section>`;
      const rows = list.map((g) => {
        const open = T.gr.open[g.id];
        const badge = g.passed ? '<span class="sx-st green"><i></i>ناجح</span>' : '<span class="sx-st red"><i></i>راسب</span>';
        const prevBtn = g.previous.length ? `<button class="sx-link" data-act="gprev" data-id="${g.id}" aria-expanded="${!!open}">${open ? 'إخفاء' : 'العلامات السابقة'}</button>` : '';
        const prev = open ? g.previous.map((p) => `<tr class="sx-prev"><td colspan="7"><span class="sx-muted">${esc(p.academicYear || '')}</span> · نظري <b>${dash(p.theory)}</b> · عملي <b>${dash(p.practical)}</b> · المجموع <b>${dash(p.total)}</b></td></tr>`).join('') : '';
        return `<tr><td><strong>${esc(g.course)}</strong>${g.instructor ? `<div class="sx-sub rtl">${esc(g.instructor)}</div>` : ''}</td><td data-l="الفصل">${SEM_LABEL[g.semester] || ''}</td><td data-l="النظري">${dash(g.theory)}</td><td data-l="العملي">${dash(g.practical)}</td><td data-l="المجموع"><b>${dash(g.total)}</b></td><td data-l="النتيجة">${badge}</td><td>${prevBtn}</td></tr>${prev}`;
      }).join('');
      body = list.length ? `<table class="sx-table rsp"><thead><tr><th>المقرر</th><th>الفصل</th><th>النظري</th><th>العملي</th><th>المجموع</th><th>النتيجة</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : sxEmpty('لا توجد علامات لهذه السنة بعد', 'تظهر العلامات هنا فور اعتمادها من شؤون الطلاب.');
    }
    return sxHead('علاماتي', 'نتائجك في كل مقرر، مع المحاولات السابقة إن وُجدت.') + cards + `<article class="sx-panel"><div class="sx-bar">${sxTabs('grlvl', lv)}${sxSem('grsem', T.gr.sem)}</div><div class="sx-tscroll">${body}</div></article>`;
  }
  function newsD() {
    const body = !T.news ? sxWait() : (T.news.length ? `<div class="sx-news">${T.news.map(newsCardD).join('')}</div>` : sxEmpty('لا أخبار حالياً'));
    return sxHead('التعميمات والأخبار', 'آخر ما نشرته الجامعة.') + `<article class="sx-panel">${body}</article>`;
  }
  function txD() {
    let body;
    if (!T.reqs) body = sxWait();
    else if (!T.reqs.length) body = sxEmpty('لا يوجد معاملات سابقة لك', 'ابدأ بإنشاء معاملة جديدة الآن بسهولة.');
    else body = `<table class="sx-table rsp"><thead><tr><th>المعاملة</th><th>تاريخ التقديم</th><th>الحالة</th><th></th></tr></thead><tbody>${T.reqs.map((r) => {
      const open = T.openReq[r.id];
      const det = open ? `<tr class="sx-prev"><td colspan="4"><div class="sx-det"><div class="hint">${esc(UA.detailsText(r))}</div>${UA.steps(r)}${r.status === 'rejected' ? `<div class="reason">سبب الرفض: ${esc(r.rejectReason)}</div>` : ''}${r.document ? `<div class="actions"><button class="btn pri sm" data-act="doc" data-c="${esc(r.document.code)}">عرض الوثيقة</button><button class="btn sm" data-act="docpdf" data-c="${esc(r.document.code)}">حفظ كملف PDF</button><span class="hint" style="align-self:center">رمز التحقق: <span class="mono">${esc(r.document.code)}</span></span></div>` : ''}${UA.events(r)}</div></td></tr>` : '';
      return `<tr><td><strong>${esc(r.service.label)}</strong><div class="sx-sub">${esc(r.no)}</div></td><td class="sx-muted" data-l="تاريخ التقديم">${esc(fmt(r.createdAt))}</td><td data-l="الحالة">${UA.pill(r)}</td><td class="sx-acts"><button class="sx-link" data-act="reqtoggle" data-id="${r.id}" aria-expanded="${!!open}">${open ? 'إخفاء' : 'التفاصيل'}</button>${r.document ? `<button class="sx-link" data-act="docpdf" data-c="${esc(r.document.code)}">${sx().ico('download', 15)} حفظ PDF</button>` : ''}</td></tr>${det}`;
    }).join('')}</tbody></table>`;
    return sxHead('المعاملات', 'تابع حالة معاملاتك أو قدّم معاملة جديدة.', newTxBtn()) + `<article class="sx-panel"><div class="sx-tscroll" style="margin-top:-20px">${body}</div></article>`;
  }
  function desktopShell(page, act) {
    const nav = UA.viewsFor('student');
    const pending = (T.reqs || []).filter((r) => r.status === 'review').length;
    const latest = T.news && T.news[0];
    const i = (n, z = 18) => sx().ico(n, z);
    const notif = { count: pending, text: [pending ? `لديك ${pending} معاملة قيد المراجعة.` : 'لا توجد معاملات قيد المراجعة.', latest ? `آخر خبر: ${esc(latest.title)}` : ''].filter(Boolean).join('<br>'), btn: '<button data-act="snav" data-v="tx">عرض معاملاتي</button>' };
    const menu = `<button class="sx-menu-item" data-act="drawer">${i('users')} الملف الشخصي</button><button class="sx-menu-item" data-act="acctopen">${i('settings')} تعديل معلومات الحساب</button><button class="sx-menu-item" data-act="pwopen">${i('shield')} تعديل كلمة المرور</button><button class="sx-menu-item" data-act="cmpopen">${i('news')} إضافة شكوى</button><button class="sx-menu-item" data-act="goverify2">${i('check')} التحقق من وثيقة</button><button class="sx-menu-item" data-act="logout">${i('out')} تسجيل الخروج</button>`;
    const help = `<div class="sx-help"><i>${i('file', 22)}</i><strong>شهادة التسجيل</strong><p>نزّل شهادة تسجيلك موقَّعة رقمياً بصيغة PDF.</p><button data-act="certdl">تنزيل الشهادة ${i('download', 15)}</button></div>`;
    const label = S.view === 'verify' ? 'التحقق من وثيقة' : (nav.find((v) => v[0] === act) || [])[1] || '';
    return UA.shell(page, { views: nav, act: 'snav', active: act, label, root: 'بوابة خدمات الطلاب', search: false, notif, menu, help, badges: { tx: pending }, student: true });
  }

  /* ---------- الهيكل العام ---------- */
  UA.studentShell = function () {
    const nav = UA.viewsFor ? UA.viewsFor('student') : [['home', 'الرئيسية'], ['guide', 'دليل المواد'], ['grades', 'علاماتي'], ['news', 'الأخبار'], ['tx', 'معاملاتي']];
    let page;
    if (S.view === 'verify') page = `<div class="m-verify"><button class="m-back" data-act="snav" data-v="home" aria-label="رجوع">${IC.back}<span>رجوع</span></button>${UA.verifyView()}</div>`;
    else page = ({ home: homePage, guide: guidePage, grades: gradesPage, news: newsPage, tx: txPage }[S.view] || homePage)();
    const act = S.view === 'verify' ? 'home' : S.view;
    {                                           // الهيكل الجديد لكل المقاسات: قائمة جانبية (منزلقة على الجوال) + شريط علوي
      const pageD = S.view === 'verify' ? `<div class="sx-verify">${UA.verifyView()}</div>` : ({ home: homeD, guide: guideD, grades: gradesD, news: newsD, tx: txD }[S.view] || homeD)();
      return desktopShell(pageD, act);
    }
    return `<div class="m-app"><main class="m-main">${page}</main><nav class="m-nav" aria-label="التنقل الرئيسي">${nav.map(([k, l]) => `<button data-act="snav" data-v="${k}" aria-current="${act === k ? 'page' : 'false'}">${IC[{ home: 'home', guide: 'guide', grades: 'grades', news: 'news', tx: 'tx' }[k]]}<span>${l}</span></button>`).join('')}</nav></div>`;
  };

  /* ---------- تحميل البيانات ---------- */
  async function ensureProfile() { if (!T.profile) T.profile = (await api('GET', '/api/me/profile')).profile; }
  const L = {
    home: async () => {
      const [n] = await Promise.all([api('GET', '/api/news'), ensureProfile()]); T.news = n.news;
      const lv = Math.min(curLevel(), years());
      const [rq, ...gs] = await Promise.all([api('GET', '/api/requests').catch(() => null), ...Array.from({ length: lv }, (_, i) => api('GET', '/api/me/grades?level=' + (i + 1)).catch(() => null))]);
      if (rq) T.reqs = rq.requests;
      let hrs = 0, sum = 0, count = 0, passed = 0;
      gs.filter(Boolean).forEach((r) => r.grades.forEach((g) => { count++; if (g.passed) passed++; hrs += g.hours || 0; sum += (g.hours || 0) * g.total; }));
      T.all = { count, passed, failed: count - passed, avg: hrs ? Math.round((sum / hrs) * 10) / 10 : null };
    },
    guide: async () => { await ensureProfile(); const lv = T.guide.level || curLevel(); T.courses = (await api('GET', `/api/courses?level=${lv}${T.guide.sem ? '&semester=' + T.guide.sem : ''}`)).courses; },
    grades: async () => {
      await ensureProfile(); let lv = T.gr.level || curLevel(); T.grades = await api('GET', '/api/me/grades?level=' + lv);
      if (!T.gr.level) {   // إن لم تصدر علامات السنة الحالية بعد يُعرض آخر عام فيه علامات
        while (!T.grades.grades.length && lv > 1) { lv--; T.grades = await api('GET', '/api/me/grades?level=' + lv); }
        T.gr.level = lv;
      }
    },
    news: async () => { T.news = (await api('GET', '/api/news')).news; },
    tx: async () => { T.reqs = (await api('GET', '/api/requests')).requests; },
  };
  Object.keys(L).forEach((k) => { UA.loaders[k] = L[k]; });
  async function open(view) {            // يعرض الهيكل فوراً (هياكل تحميل) ثم يملؤه
    S.view = view; T.loading[view] = true; UA.render(); window.scrollTo(0, 0);
    try { await L[view](); } catch (e) { if (e.status !== 401) toast(e.message); }
    T.loading[view] = false; if (S.view === view) UA.render();
  }

  /* ---------- نوافذ كاملة الشاشة ---------- */
  const layer = () => document.getElementById('layer');
  const close = () => { layer().innerHTML = ''; T.wz = null; };
  const sheet = (title, body, { back = 'close', foot = '' } = {}) => { layer().innerHTML = `<div class="m-full" dir="rtl" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="m-full-in"><header class="m-fh"><h2>${esc(title)}</h2><button class="m-back" data-act="${back}" aria-label="رجوع">${IC.back}</button></header><div class="m-fb">${body}</div>${foot ? `<footer class="m-ff">${foot}</footer>` : ''}</div></div>`; };

  // --- معاملة جديدة (3 خطوات) ---
  function fieldHtml(f, v) {
    const id = 'wz-' + f.name, req = f.required ? ' required' : '', cur = v ?? f.default ?? '';
    let c;
    if (f.type === 'select') c = `<select id="${id}"${req}><option value="">— اختر —</option>${f.options.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'number') c = `<input id="${id}" type="number" min="${f.min ?? 0}" max="${f.max ?? 99}" value="${esc(cur)}"${req}>`;
    else if (f.type === 'date') c = `<input id="${id}" type="date" value="${esc(cur)}"${req}>`;
    else c = `<input id="${id}" type="text" maxlength="200" value="${esc(cur)}"${req}>`;
    return `<label>${esc(f.label)}${f.required ? ' <i class="req-m">*</i>' : ''}${c}</label>`;
  }
  const svcOf = () => S.services.find((s) => s.code === T.wz.k);
  function drawWizard() {
    const w = T.wz, step = w.step;
    if (step === 1) {
      const order = { excellence_year: 1, campus_life: 2, transcript: 3, attendance: 4, excuse: 5 };
      const svcs = [...S.services].sort((a, b) => (order[a.code] || 9) - (order[b.code] || 9));
      sheet('المعاملات', `<p class="m-lead">حدد نوع المعاملة المطلوب إنشائها.</p><div class="m-emblem">${emblem}</div><div class="m-svcs">${svcs.map((s, i) => `<button class="m-svc${svcs.length % 2 && i === 0 ? ' wide' : ''}" data-act="wzpick" data-k="${esc(s.code)}"><span class="ic">${svcIcon(s.code)}</span><b>${esc(s.label)}</b></button>`).join('')}</div>`, { foot: '<span>الخطوة 1/3</span>' });
    } else if (step === 2) {
      const s = svcOf();
      sheet(s.label, `<form id="wzform" class="m-form"><p class="m-lead">${esc(s.description)}</p>${s.fields.map((f) => fieldHtml(f, w.vals[f.name])).join('')}
        ${s.requiresAttachment ? `<label>المرفق (PDF أو صورة، حتى 2 ميغابايت) <i class="req-m">*</i><input id="wz-file" type="file" accept=".pdf,.png,.jpg,.jpeg"${w.file ? '' : ' required'}>${w.file ? `<span class="small">المرفق الحالي: ${esc(w.file.name)}</span>` : ''}</label>` : ''}
        ${w.err ? `<div class="err" role="alert">${esc(w.err)}</div>` : ''}<button class="m-btn" type="submit">التالي</button></form>`, { back: 'wzback', foot: '<span>الخطوة 2/3</span>' });
    } else {
      const s = svcOf(), rows = s.fields.filter((f) => w.vals[f.name] !== '' && w.vals[f.name] !== undefined).map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(w.vals[f.name])}</dd>`).join('');
      sheet('مراجعة وتأكيد', `<div class="m-form"><p class="m-lead">راجع بيانات معاملتك قبل التقديم.</p><dl class="kv"><dt>نوع المعاملة</dt><dd>${esc(s.label)}</dd>${rows}${w.file ? `<dt>المرفق</dt><dd>${esc(w.file.name)}</dd>` : ''}</dl>
        <p class="hint">يُجرى فحص آلي فوري، ثم يراجعها الموظف خلال ${s.slaHours} ساعة تقريباً.</p>${w.err ? `<div class="err" role="alert">${esc(w.err)}</div>` : ''}
        <button class="m-btn" data-act="wzsubmit"${w.busy ? ' disabled' : ''}>${w.busy ? 'جارٍ التقديم…' : 'تأكيد وتقديم المعاملة'}</button></div>`, { back: 'wzback', foot: '<span>الخطوة 3/3</span>' });
    }
  }
  const saveVals = () => { const s = svcOf(); s.fields.forEach((f) => { const e = document.getElementById('wz-' + f.name); if (e) T.wz.vals[f.name] = e.value; }); const fi = document.getElementById('wz-file'); if (fi && fi.files[0]) T.wz.file = fi.files[0]; };

  // --- القائمة الجانبية (الملف الشخصي) ---
  async function drawDrawer() {
    await ensureProfile();
    const st = T.profile, p = st ? st.profile : {}, row = (k, v) => (v ? `<div class="m-kv"><small>${k}</small><b>${esc(v)}</b></div>` : '');
    const info = st ? [row('الاسم الأول', p.first_name), row('الاسم الأخير', p.last_name), row('اسم الأب الأول', p.father_name), row('اسم الأم', p.mother_name), row('تاريخ الميلاد', p.birth_date), row('الكلية', st.program.faculty),
      row('البرنامج', st.program.faculty === st.program.name ? st.program.degree : `${st.program.degree} ${st.program.name}`), row('العام الدراسي', st.levelLabel), row('الرقم الوزاري', p.ministerial_no), row('الرقم الجامعي', st.studentNo)].join('')
      : '<p class="hint">لا يوجد ملف شخصي مسجَّل لحسابك بعد. راجع قسم شؤون الطلاب.</p>';
    layer().innerHTML = `<div class="m-drawer-bd" data-act="close"><aside class="m-drawer" dir="rtl" role="dialog" aria-modal="true" aria-label="الملف الشخصي" data-stop="1"><header><div class="m-avatar big"><span>${esc(S.me.name[0])}</span></div><div><b>${esc(S.me.name)}</b><small dir="ltr">${esc((p.email) || S.me.username)}</small></div></header>
      <div class="m-info">${info}</div><nav class="m-acts"><button data-act="cmpopen">${IC.help}<span>إضافة شكوى جديدة</span></button><button data-act="acctopen">${IC.edit}<span>تعديل معلومات الحساب</span></button><button data-act="pwopen">${IC.lock}<span>تعديل كلمة المرور</span></button><button data-act="certdl">${IC.doc}<span>تنزيل شهادة التسجيل الموقَّعة (PDF)</span></button><button data-act="goverify2">${IC.shield}<span>التحقق من وثيقة</span></button><button class="out" data-act="logout">${IC.out}<span>تسجيل الخروج</span></button></nav></aside></div>`;
  }
  const CST = { open: ['p-review', 'قيد المعالجة'], answered: ['p-approved', 'تم الرد'], closed: ['p-approved', 'مغلقة'] };
  async function drawComplaints(err = '') {
    T.cmps = (await api('GET', '/api/complaints')).complaints;
    sheet('الشكاوى', `<form id="cmpform" class="m-form"><label>الموضوع<input id="cp-s" maxlength="120" required></label><label>نص الشكوى<textarea id="cp-b" rows="4" maxlength="2000" required placeholder="اشرح المشكلة بوضوح (10 أحرف على الأقل)"></textarea></label>${err ? `<div class="err" role="alert">${esc(err)}</div>` : ''}<button class="m-btn" type="submit">إرسال الشكوى</button></form>
      <h3 class="m-h3">شكاواي السابقة</h3>${T.cmps.length ? T.cmps.map((c) => `<article class="m-card"><span class="pill ${CST[c.status][0]}" style="float:inline-end">${CST[c.status][1]}</span><b>${esc(c.subject)}</b><small>${esc(c.no)} · ${fmt(c.createdAt)}</small><p class="hint" style="white-space:pre-wrap;margin:6px 0 0">${esc(c.body)}</p>${c.response ? `<div class="m-reply"><small>رد الجامعة</small><p style="white-space:pre-wrap;margin:2px 0 0">${esc(c.response)}</p></div>` : ''}</article>`).join('') : '<div class="m-empty small-e">لم تقدّم أي شكوى.</div>'}`);
  }
  function drawAccount(err = '') {
    const p = (T.profile && T.profile.profile) || {};
    sheet('تعديل معلومات الحساب', `<form id="acctform" class="m-form"><p class="m-lead">يمكنك تعديل بيانات الاتصال فقط. أما الاسم وبقية البيانات الشخصية فتُصحَّح من قسم شؤون الطلاب بالوثائق الرسمية.</p>
      <label>رقم الهاتف المحمول<input id="ac-phone" type="tel" dir="ltr" value="${esc(p.phone || '')}" required></label><label>البريد الإلكتروني<input id="ac-email" type="email" dir="ltr" value="${esc(p.email || '')}"></label>
      <label>محافظة السكن<select id="ac-gov" required>${GOV.map((g) => `<option${g === p.governorate ? ' selected' : ''}>${g}</option>`).join('')}</select></label><label>المدينة / المنطقة<input id="ac-city" value="${esc(p.city || '')}" required maxlength="60"></label>
      <label>العنوان التفصيلي<input id="ac-addr" value="${esc(p.address || '')}" required maxlength="200"></label><label>هاتف آخر للطوارئ<input id="ac-emer" type="tel" dir="ltr" value="${esc(p.emergency_phone || '')}"></label>
      ${err ? `<div class="err" role="alert">${esc(err)}</div>` : ''}<button class="m-btn" type="submit">حفظ</button></form>`);
  }
  function drawPassword(err = '') {
    sheet('تعديل كلمة المرور', `<form id="pwform2" class="m-form"><label>كلمة المرور الحالية<input id="pw2-cur" type="password" autocomplete="current-password" required></label><label>كلمة المرور الجديدة<input id="pw2-new" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>تأكيد كلمة المرور الجديدة<input id="pw2-new2" type="password" autocomplete="new-password" minlength="10" required></label><div class="small">10 أحرف على الأقل، وتحوي حروفاً وأرقاماً.</div>${err ? `<div class="err" role="alert">${esc(err)}</div>` : ''}<button class="m-btn" type="submit">حفظ كلمة المرور</button></form>`);
  }
  function drawNews(id) {
    const n = (T.news || []).find((x) => x.id === Number(id)); if (!n) return;
    sheet('الخبر', `<article class="m-article"><small>${esc(fmt(n.publishedAt))}</small><h3>${esc(n.title)}</h3><p style="white-space:pre-wrap">${esc(n.body)}</p>${UA.mediaHtml(n.media)}</article>`);
  }

  /* ---------- الأحداث ---------- */
  Object.assign(UA.actions, {
    snav: async (el, d) => { close(); await open(d.v); },
    glvl: async (el, d) => { T.guide.level = Number(d.l); T.courses = null; await open('guide'); },
    grlvl: async (el, d) => { T.gr.level = Number(d.l); T.grades = null; T.gr.open = {}; await open('grades'); },
    gprev: async (el, d) => { T.gr.open[d.id] = !T.gr.open[d.id]; UA.render(); },
    reqtoggle: async (el, d) => { T.openReq[d.id] = !T.openReq[d.id]; UA.render(); },
    newsopen: async (el, d) => { drawNews(d.id); },
    drawer: async () => { await drawDrawer(); },
    cmpopen: async () => { await drawComplaints(); },
    acctopen: async () => { await ensureProfile(); drawAccount(); },
    pwopen: async () => { drawPassword(); },
    certdl: async () => {
      try {
        const res = await fetch('/api/me/certificate.pdf', { credentials: 'same-origin' });
        if (!res.ok) { let m = 'تعذّر تنزيل الشهادة.'; try { m = (await res.json()).message || m; } catch { /* */ } toast(m); return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `enrollment-${S.me.username}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch { toast('تعذّر تنزيل الشهادة.'); }
    },
    goverify2: async () => { close(); S.view = 'verify'; UA.render(); window.scrollTo(0, 0); },
    close: async (el, d, e) => { if (el.classList.contains('m-drawer-bd') && e.target.closest('.m-drawer')) return; close(); },
    wzstart: async (el, d) => { T.wz = { step: d.k ? 2 : 1, k: d.k || null, vals: {}, file: null, err: '' }; drawWizard(); },
    wzpick: async (el, d) => { T.wz.k = d.k; T.wz.step = 2; T.wz.vals = {}; T.wz.file = null; T.wz.err = ''; drawWizard(); },
    wzback: async () => { saveVals(); T.wz.err = ''; if (T.wz.step === 3) T.wz.step = 2; else T.wz.step = 1; drawWizard(); },
    wzsubmit: async () => {
      const w = T.wz, s = svcOf(); if (w.busy) return;
      w.busy = true; w.err = ''; drawWizard();
      try {
        const details = {}; s.fields.forEach((f) => { if (w.vals[f.name] !== undefined && w.vals[f.name] !== '') details[f.name] = f.type === 'number' ? Number(w.vals[f.name]) : w.vals[f.name]; });
        const attachment = w.file ? { name: w.file.name, data: await UA.readFile(w.file) } : undefined;
        const r = await api('POST', '/api/requests', { service: s.code, details, attachment });
        close(); T.reqs = null; T.openReq = { [r.request.id]: true }; await open('tx');
        toast(r.request.status === 'rejected' ? 'رُفضت المعاملة آلياً: ' + r.request.rejectReason : 'تم تقديم المعاملة برقم ' + r.request.no);
      } catch (e) { w.busy = false; if (!e.status) throw e; w.err = e.message; drawWizard(); }
    },
  });
  Object.assign(UA.forms, {
    wzform: async () => {
      saveVals(); const s = svcOf(), w = T.wz;
      const miss = s.fields.find((f) => f.required && (w.vals[f.name] === undefined || w.vals[f.name] === ''));
      if (miss) { w.err = `الحقل «${miss.label}» مطلوب.`; drawWizard(); return; }
      if (s.requiresAttachment && !w.file) { w.err = 'هذه المعاملة تتطلب مرفقاً.'; drawWizard(); return; }
      w.err = ''; w.step = 3; drawWizard();
    },
    cmpform: async () => {
      try { await api('POST', '/api/complaints', { subject: val('cp-s'), body: val('cp-b') }); await drawComplaints(); toast('أُرسلت الشكوى'); }
      catch (e) { if (!e.status) throw e; await drawComplaints(e.message); }
    },
    acctform: async () => {
      try { T.profile = (await api('PUT', '/api/me/profile', { phone: val('ac-phone'), email: val('ac-email'), governorate: val('ac-gov'), city: val('ac-city'), address: val('ac-addr'), emergency_phone: val('ac-emer') })).profile; close(); toast('حُفظت المعلومات'); }
      catch (e) { if (!e.status) throw e; drawAccount(e.message); }
    },
    pwform2: async () => {
      if (val('pw2-new') !== val('pw2-new2')) { drawPassword('تأكيد كلمة المرور غير مطابق.'); return; }
      try { await api('POST', '/api/auth/change-password', { current: val('pw2-cur'), next: val('pw2-new') }); close(); toast('تم تغيير كلمة المرور'); }
      catch (e) { if (!e.status) throw e; drawPassword(e.message); }
    },
  });
  const CHG = {
    gsem: async (el) => { T.guide.sem = el.value; T.courses = null; await open('guide'); },
    grsem: async (el) => { T.gr.sem = el.value; UA.render(); },
  };
  document.addEventListener('change', (e) => { const el = e.target.closest && e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) UA.guard(() => CHG[el.dataset.chg](el)); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { T.wz = null; } });
})();
