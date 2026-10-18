/* سجل الطالب الموحّد 360°: خلاصة أكاديمية، علامات بمراحل اعتمادها، تعارض الجداول، الطلبات، العقوبات، حضور القاعات */
(function () {
  const UA = window.UA, { api, esc, fmt, toast } = UA;
  const WF = { draft: ['p-review', 'مدخلة'], reviewed: ['p-review', 'مراجَعة'], approved: ['p-approved', 'معتمدة'] };
  const RS = { review: ['p-review', 'قيد المراجعة'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'] };
  const HOLD = { financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' };
  const t = (ms) => (ms ? fmt(ms) : '—');

  function html(r) {
    const st = r.student, sm = r.academicSummary || {}, al = sm.academicAlert, sc = r.scheduleConflicts || { conflicts: [], withoutSchedule: 0, checkedCourses: 0 }, p = st.profile || {};
    r.grades = r.grades || []; r.requests = r.requests || []; r.holds = r.holds || []; r.hallLogs = r.hallLogs || [];
    const alert = al ? `<div class="reason" role="alert" style="margin-block:10px"><b>${esc(al.label)}:</b> ${esc(al.message)}</div>` : '';
    const conf = sc.conflicts.length
      ? `<div class="reason" role="alert"><b>تعارض في الجدول (${sc.conflicts.length}):</b><ul class="mini-list">${sc.conflicts.map((c) => `<li>${esc(c.dayLabel)} · الفصل ${c.semester === 1 ? 'الأول' : 'الثاني'}: «${esc(c.a.course)}» (${c.a.start}–${c.a.end}) مع «${esc(c.b.course)}» (${c.b.start}–${c.b.end}) — تداخل ${c.overlapMinutes} دقيقة</li>`).join('')}</ul></div>`
      : `<p class="small">لا تعارض في جدول مقررات السنة الحالية${sc.withoutSchedule ? ` (${sc.withoutSchedule} من ${sc.checkedCourses} مقرر بلا جدول محاضرات)` : ''}.</p>`;
    const grades = r.grades.length ? `<div class="tbl-wrap"><table><thead><tr><th>المقرر</th><th>العام</th><th>المجموع</th><th>النتيجة</th><th>الاعتماد</th></tr></thead><tbody>${r.grades.map((g) => { const w = WF[g.workflowStatus] || WF.draft;
      return `<tr><td>${esc(g.course)}</td><td class="mono">${esc(g.academicYear || '—')}</td><td><b>${g.total}</b></td><td>${g.passed ? 'ناجح' : 'راسب'}</td><td><span class="pill ${w[0]}">${w[1]}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">لا علامات.</p>';
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
      <h3 class="rec-h">تعارض الجداول</h3>${conf}
      <h3 class="rec-h">العلامات</h3>${grades}
      <h3 class="rec-h">الطلبات</h3>${reqs}
      <h3 class="rec-h">العقوبات والموانع</h3>${holds}
      <h3 class="rec-h">آخر دخول وخروج القاعات</h3>${halls}
      <p class="small">الهاتف: <span class="mono" dir="ltr">${esc(p.phone || '—')}</span> · الحالة: ${esc(st.statusLabel || '')}</p>`;
  }
  async function open(id) {
    try {
      const r = await api('GET', `/api/students/${id}/unified-record`);
      document.getElementById('layer').innerHTML = `<div class="overlay" dir="rtl" data-act="close"><div class="sheet rec-sheet" role="dialog" aria-modal="true" aria-label="سجل الطالب الموحّد"><div class="sheet-bar no-print"><button class="btn" data-act="close">إغلاق</button><b>سجل الطالب الموحّد 360°</b><button class="btn" onclick="window.print()">طباعة</button></div><div class="stu-body">${html(r)}</div></div></div>`;
    } catch (e) { console.error('[record360]', e); toast(e && e.status ? e.message : 'تعذّر عرض السجل الموحّد: ' + (e && e.message || 'خطأ غير متوقع')); }
  }
  UA.record360 = { open, html };
  Object.assign(UA.actions, { strecord: async (el, d) => open(d.id) });
})();
