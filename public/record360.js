/* سجل الطالب الموحّد 360°: خلاصة أكاديمية، علامات بمراحل اعتمادها، تعارض الجداول، الطلبات، العقوبات، حضور القاعات */
(function () {
  const UA = window.UA, { api, esc, fmt, toast } = UA;
  const WF = { draft: ['p-review', 'مدخلة'], reviewed: ['p-review', 'مراجَعة'], approved: ['p-approved', 'معتمدة'] };
  const RS = { review: ['p-review', 'قيد المراجعة'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'] };
  const HOLD = { financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' };
  const t = (ms) => (ms ? fmt(ms) : '—');

  function html(r) {
    const st = r.student, sm = r.academicSummary || {}, al = sm.academicAlert, sc = r.scheduleConflicts || { conflicts: [], withoutSchedule: 0, checkedCourses: 0 }, p = Object.assign({}, st.profile || {}, { phone: (st.profile && st.profile.phone) || st.phone });
    r.courses = r.courses || [];
    r.grades = r.grades || []; r.requests = r.requests || []; r.holds = r.holds || []; r.hallLogs = r.hallLogs || [];
    const alert = al ? `<div class="reason" role="alert" style="margin-block:10px"><b>${esc(al.label)}:</b> ${esc(al.message)}</div>` : '';
    const conf = sc.conflicts.length
      ? `<div class="reason" role="alert"><b>تعارض في الجدول (${sc.conflicts.length}):</b><ul class="mini-list">${sc.conflicts.map((c) => `<li>${esc(c.dayLabel)} · الفصل ${c.semester === 1 ? 'الأول' : 'الثاني'}: «${esc(c.a.course)}» (${c.a.start}–${c.a.end}) مع «${esc(c.b.course)}» (${c.b.start}–${c.b.end}) — تداخل ${c.overlapMinutes} دقيقة</li>`).join('')}</ul></div>`
      : `<p class="small">لا تعارض في جدول مقررات السنة الحالية${sc.withoutSchedule ? ` (${sc.withoutSchedule} من ${sc.checkedCourses} مقرر بلا جدول محاضرات)` : ''}.</p>`;
    const grades = r.grades.length ? `<div class="tbl-wrap"><table><thead><tr><th>المقرر</th><th>العام</th><th>المجموع</th><th>النتيجة</th><th>الاعتماد</th></tr></thead><tbody>${r.grades.map((g) => { const w = WF[g.workflowStatus] || WF.draft;
      return `<tr><td>${esc(g.course)}</td><td class="mono">${esc(g.academicYear || '—')}</td><td><b>${g.total}</b></td><td>${g.passed ? 'ناجح' : 'راسب'}</td><td><span class="pill ${w[0]}">${w[1]}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">لا علامات.</p>';
    const SEM = { 1: 'الفصل الأول', 2: 'الفصل الثاني' };
    const courses = r.courses.length ? `<div class="tbl-wrap"><table><thead><tr><th>المقرر</th><th>الرمز</th><th>السنة</th><th>الفصل</th><th>الساعات</th><th>المدرّس</th><th>العلامة</th><th>الحالة</th></tr></thead><tbody>${r.courses.map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.code || '—')}</td><td>${c.level}</td><td>${SEM[c.semester] || c.semester}</td><td>${c.hours}</td><td>${esc(c.instructor || '—')}</td><td>${c.total === null ? '—' : `<b>${c.total}</b>`}</td><td>${c.total === null ? '<span class="pill p-review">لم تُرصد</span>' : (c.passed ? '<span class="pill p-approved">ناجح</span>' : '<span class="pill p-rejected">راسب</span>')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">لا مقررات مسجَّلة لبرنامج الطالب بعد.</p>';
    const ex = (st.extra || []).length ? `<dl class="kv" style="margin-block:8px">${st.extra.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('')}</dl>` : '';
    const info = `<dl class="kv"><dt>الكلية / المعهد</dt><dd>${esc((st.program && st.program.faculty) || '—')}</dd><dt>سنة القيد</dt><dd>${esc(st.enrollYear || '—')}</dd><dt>الحالة</dt><dd>${esc(st.statusLabel || '—')}</dd><dt>الهاتف</dt><dd dir="ltr" style="text-align:right">${esc(p.phone || '—')}</dd>${p.email ? `<dt>البريد</dt><dd dir="ltr" style="text-align:right">${esc(p.email)}</dd>` : ''}${p.governorate ? `<dt>المحافظة</dt><dd>${esc(p.governorate)}</dd>` : ''}</dl>${ex}`;
    const reqs = r.requests.length ? `<div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>الخدمة</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${r.requests.map((q) => `<tr><td class="mono">${esc(q.no)}</td><td>${esc(q.service)}</td><td><span class="pill ${RS[q.status][0]}">${RS[q.status][1]}</span></td><td class="small">${t(q.createdAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">لا طلبات.</p>';
    const holds = r.holds.length ? `<ul class="mini-list">${r.holds.map((h) => `<li><span class="pill p-rejected">${esc(HOLD[h.type] || h.type)}</span> ${esc(h.note || '')} <span class="small">${t(h.createdAt)}</span></li>`).join('')}</ul>` : '<p class="small">لا عقوبات قائمة.</p>';
    const halls = r.hallLogs.length ? `<div class="tbl-wrap"><table><thead><tr><th>المادة / الفحص</th><th>القاعة</th><th>دخول</th><th>خروج</th></tr></thead><tbody>${r.hallLogs.map((h) => `<tr><td>${esc(h.subject)}</td><td>${esc(h.hall)}</td><td class="small">${t(h.enteredAt)}</td><td class="small">${h.exitedAt ? t(h.exitedAt) : 'داخل القاعة'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small">لا سجل حضور.</p>';
    return `<div class="me"><div class="avatar">${esc(String(st.name || '؟').trim()[0] || '؟')}</div><div><b>${esc(st.name)}</b><small class="mono">${esc(st.studentNo)}</small><small>${esc((st.program && (st.program.label || st.program.name)) || '')} · ${esc(st.levelLabel || '')}</small></div></div>
      ${r.warnings && r.warnings.length ? `<p class="reason" role="status">تعذّر تحميل بعض الأقسام: ${r.warnings.map(esc).join('، ')}.</p>` : ''}
      ${alert}
      <div class="stats" style="margin-block:12px"><div class="stat"><small>المعدل التراكمي</small><b>${sm.gpa ?? '—'}${sm.gpa === null ? '' : '%'}</b></div>
        <div class="stat"><small>الترتيب في الدفعة</small><b>${sm.cohortRank ? `${sm.cohortRank} / ${sm.cohortTotal}` : '—'}</b></div>
        <div class="stat"><small>الساعات المنجزة</small><b>${sm.earnedHours} / ${sm.totalHours}</b></div>
        <div class="stat"><small>ناجح / راسب</small><b>${sm.passed} / ${sm.failed}</b></div></div>
      <h3 class="rec-h">بيانات الطالب</h3>${info}
      <h3 class="rec-h">المقررات</h3>${courses}
      <h3 class="rec-h">تعارض الجداول</h3>${conf}
      <h3 class="rec-h">العلامات</h3>${grades}
      <h3 class="rec-h">الطلبات</h3>${reqs}
      <h3 class="rec-h">العقوبات والموانع</h3>${holds}
      <h3 class="rec-h">آخر دخول وخروج القاعات</h3>${halls}
      <p class="small">أُصدر هذا السجل بتاريخ ${fmt(Date.now())}.</p>`;
  }
  async function open(id) {
    try {
      const r = await api('GET', `/api/students/${id}/unified-record`);
      document.getElementById('layer').innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet rec-sheet" role="dialog" aria-modal="true" aria-label="سجل الطالب الموحّد"><div class="sheet-bar no-print"><button class="btn" data-act="close">إغلاق</button><b>سجل الطالب الموحّد 360°</b><button class="btn" data-act="r360print">طباعة</button></div><div class="stu-body">${html(r)}</div></div></div>`;
    } catch (e) { console.error('[record360]', e); toast(e && e.status ? e.message : 'تعذّر عرض السجل الموحّد: ' + (e && e.message || 'خطأ غير متوقع')); }
  }
  UA.record360 = { open, html };
  Object.assign(UA.actions, {
    strecord: async (el, d) => open(d.id),
    // الطباعة عبر جذر الطباعة المستقل (الطباعة المباشرة كانت تُخرج صفحة فارغة لأن النافذة المنبثقة مخفية في وضع الطباعة)
    r360print: () => { const b = document.querySelector('#layer .stu-body'); if (b) UA.printHtml(`<div class="rec-print" dir="rtl"><div class="print-hd"><b>${esc(UA.S.uni)}</b><span>السجل الموحّد للطالب 360°</span></div>${b.innerHTML}</div>`); },
  });
})();
