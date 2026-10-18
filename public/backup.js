/* النسخ الاحتياطي (تبويب في «الإدارة»): إنشاء نسخة الآن، قائمة النسخ، تنزيل وحذف. */
(function () {
  const UA = window.UA, { S, api, esc, toast, fmt } = UA;
  const sz = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');
  UA.backupView = () => {
    const b = S.admin && S.admin.backup; if (!b) return '<div class="empty">جارٍ التحميل…</div>';
    const ls = b.last;
    const status = ls ? (ls.error ? `<div class="err" role="alert">آخر محاولة فشلت (${fmt(ls.createdAt)}): ${esc(ls.error)}</div>` : `<p class="ok-t">آخر نسخة ناجحة: ${fmt(ls.createdAt)}${ls.remote === true ? ' — رُفعت إلى المخزن الخارجي' : ''}${ls.remote === false ? ' — فشل الرفع الخارجي' : ''}</p>`) : '<p class="hint">لم تُنشأ نسخة بعد.</p>';
    return `<section class="card"><div class="tool-row"><h2 style="margin:0">${UA.icon('backup', 22)} النسخ الاحتياطي</h2><button class="btn pri" data-act="bknow">إنشاء نسخة الآن</button></div>
      <p class="hint" style="margin-top:0">تُنشأ نسخة تلقائياً كل يوم (${b.auto ? 'مفعَّل، نحو الساعة ' + b.hourUtc + ' UTC' : 'متوقف'}) وتضم: قاعدة البيانات، المرفقات (ملفات الطلاب والوسائط والشهادات)، ومفتاح التوقيع. يُحتفظ بآخر ${b.keep} نسخة.${b.encrypted ? ' <b>النسخ مشفَّرة</b> بعبارة المرور.' : ' <b>تنبيه:</b> النسخ غير مشفَّرة وتحوي بيانات الطلاب ومفتاح التوقيع؛ اضبط BACKUP_PASSPHRASE لتشفيرها.'}</p>
      ${status}<div class="reason" style="margin:8px 0">${esc(b.persistentHint)}${b.remote ? ' (الرفع الخارجي مفعَّل.)' : ''}</div>
      <div class="tbl-wrap"><table class="grid-tbl"><thead><tr><th>الملف</th><th>التاريخ</th><th>الحجم</th><th></th></tr></thead><tbody>${b.backups.map((x) => `<tr><td class="mono" dir="ltr" style="text-align:right">${esc(x.name)}</td><td class="nowrap">${fmt(x.createdAt)}</td><td>${sz(x.size)}</td><td class="nowrap"><button class="btn sm" data-act="bkdl" data-n="${esc(x.name)}">تنزيل</button> <button class="btn sm bad" data-act="bkdel" data-n="${esc(x.name)}">حذف</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا نسخ محفوظة.</td></tr>'}</tbody></table></div>
      <h3 class="sec-h">الاستعادة</h3><p class="small">أوقف الخادم ثم نفّذ: <span class="mono" dir="ltr">node scripts/restore.js data/backups/&lt;الملف&gt;</span> (يُحفظ الوضع الحالي قبل أي كتابة). على Railway: أنشئ Volume وضع DB_PATH وUPLOAD_DIR داخله، وثبّت SIGNING_KEY، ونزّل نسخة دورية خارج الخادم.</p></section>`;
  };
  async function reload() { S.admin.backup = await api('GET', '/api/admin/backups'); UA.render(); }
  Object.assign(UA.actions, {
    bknow: async () => { toast('جارٍ إنشاء النسخة…'); await api('POST', '/api/admin/backups', {}); await reload(); toast('أُنشئت النسخة الاحتياطية'); },
    bkdl: async (el, d) => {
      const res = await fetch('/api/admin/backups/' + encodeURIComponent(d.n), { credentials: 'same-origin' });
      if (!res.ok) { toast('تعذّر تنزيل النسخة'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = d.n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    bkdel: async (el, d) => { if (!confirm('حذف هذه النسخة نهائياً؟')) return; await api('DELETE', '/api/admin/backups/' + encodeURIComponent(d.n)); await reload(); toast('حُذفت النسخة'); },
  });
})();
