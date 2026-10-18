/* فلترة موحّدة لكل الجداول: سطر فلترة لكل عمود تحت الترويسة + سطر شامل فوق الجدول + زر «إلغاء الفلترة».
   الفلترة محلية على الصفوف المعروضة (في الجداول المقسّمة إلى صفحات تشمل الصفحة الحالية فقط) وتبقى بعد إعادة رسم الصفحة.
   الجداول التي لها شريط فلاتر خاص من الخادم تأخذ فلتر الأعمدة فقط دون السطر الشامل. استثناء جدول: data-tf="off". */
(function () {
  const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
  const kept = new Map();                                         // مفتاح الجدول ← { g: نص شامل, c: [نص لكل عمود] }
  const SKIP = '.trp, .sheet-tr, .doc, .no-tf, [data-no-tf], .kv, .bc-card, .sx-prev';
  let queued = false;

  const dataRows = (tb) => [...tb.rows].filter((r) => r.parentElement.tagName !== 'THEAD' && !r.classList.contains('tf-none') && !r.querySelector('td.empty'));
  const headCells = (t) => [...(t.tHead?.rows[0]?.cells ?? [])];
  const keyOf = (t) => (t.dataset.tfk ||= headCells(t).map((c) => c.textContent.trim()).join('|') + '#' + (document.querySelector('.tab[aria-selected=true], .nav [aria-current=page]')?.textContent.trim() ?? ''));
  const hasOwnFilters = (t) => !!t.closest('section.card, .card')?.querySelector('.filters');
  const eligible = (t) => !t.closest(SKIP) && t.dataset.tf !== 'off' && !!t.tHead && t.tBodies.length > 0 && dataRows(t).length >= 1;
  const words = (s) => { const q = norm(s); return q ? q.split(' ') : []; };

  function apply(t) {
    const st = t._tf, rows = dataRows(t), gw = words(st.g.value), cw = st.cols.map((i) => words(i ? i.value : ''));
    let shown = 0;
    for (const r of rows) {
      r._tfa ??= norm(r.textContent); r._tfc ??= [...r.cells].map((c) => norm(c.textContent));
      const ok = gw.every((w) => r._tfa.includes(w)) && cw.every((ws, i) => !ws.length || ws.every((w) => (r._tfc[i] ?? '').includes(w)));
      r.hidden = !ok; if (ok) shown++;
    }
    const any = !!gw.length || cw.some((w) => w.length);
    st.clear.hidden = !any; st.count.textContent = any ? `عرض ${shown} من ${rows.length}` : `${rows.length} صف`;
    let none = t.tBodies[0].querySelector('tr.tf-none');
    if (any && !shown) { if (!none) { none = t.tBodies[0].insertRow(); none.className = 'tf-none'; none.innerHTML = `<td colspan="${headCells(t).length}" class="empty">لا صفوف مطابقة للفلترة.</td>`; } }
    else if (none) none.remove();
    kept.set(keyOf(t), { g: st.g.value, c: st.cols.map((i) => (i ? i.value : '')) });
  }

  function attach(t) {
    const host = t.closest('.tbl-wrap') || t, key = keyOf(t), saved = kept.get(key) ?? { g: '', c: [] }, own = hasOwnFilters(t), heads = headCells(t);
    const el = document.createElement('div'); el.className = 'tf-bar no-print';
    el.innerHTML = `${own ? '' : '<input type="search" class="tf-in" placeholder="فلترة شاملة لكل الأعمدة…" aria-label="فلترة شاملة" autocomplete="off" maxlength="80">'}<button type="button" class="btn sm tf-clear" hidden>إلغاء الفلترة</button><span class="small tf-count"></span>`;
    host.parentNode.insertBefore(el, host);
    const st = { el, g: el.querySelector('.tf-in') || { value: '' }, clear: el.querySelector('.tf-clear'), count: el.querySelector('.tf-count'), cols: [] };
    if (st.g.addEventListener) { st.g.value = saved.g; st.g.addEventListener('input', () => apply(t)); st.g.addEventListener('keydown', esc); }
    // سطر فلاتر الأعمدة (إلا إن وُجدت خلايا مدموجة)
    if (!heads.some((c) => c.colSpan > 1)) {
      const tr = t.tHead.insertRow(); tr.className = 'tf-cols no-print';
      heads.forEach((c, i) => {
        const th = document.createElement('th'); tr.appendChild(th);
        const label = c.textContent.trim();
        if (!label) { st.cols.push(null); return; }                       // عمود أزرار بلا عنوان
        const inp = document.createElement('input'); inp.type = 'search'; inp.className = 'tf-col'; inp.maxLength = 60; inp.autocomplete = 'off';
        inp.placeholder = 'فلترة…'; inp.setAttribute('aria-label', 'فلترة عمود ' + label); inp.value = saved.c[i] ?? '';
        inp.addEventListener('input', () => apply(t)); inp.addEventListener('keydown', esc); th.appendChild(inp); st.cols.push(inp);
      });
    }
    st.clear.addEventListener('click', () => { if (st.g.value !== undefined) st.g.value = ''; st.cols.forEach((i) => { if (i) i.value = ''; }); apply(t); (st.g.focus ? st.g : st.cols.find(Boolean) || st.clear).focus?.(); });
    function esc(e) { if (e.key === 'Escape' && !st.clear.hidden) { e.stopPropagation(); st.clear.click(); } }
    t._tf = st; t.dataset.tf = '1'; apply(t);
  }

  function scan() {
    queued = false;
    for (const t of document.querySelectorAll('#app table, #layer table')) {
      if (t.dataset.tf === '1') {
        if (!t._tf) continue;
        if (t._tfRows !== t.tBodies[0].rows.length) { for (const r of t.rows) { delete r._tfa; delete r._tfc; } apply(t); }      // أُعيد رسم الصفوف
        t._tfRows = t.tBodies[0].rows.length; continue;
      }
      if (eligible(t)) { attach(t); t._tfRows = t.tBodies[0].rows.length; }
    }
    for (const b of document.querySelectorAll('.tf-bar')) if (!b.nextElementSibling) b.remove();   // شريط يتيم
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  const mine = (n) => n.nodeType === 3 || (n.nodeType === 1 && (n.classList.contains('tf-bar') || n.classList.contains('tf-none') || n.classList.contains('tf-cols')));
  new MutationObserver((ms) => { if (ms.some((m) => ![...m.addedNodes, ...m.removedNodes].every(mine))) queue(); }).observe(document.documentElement, { childList: true, subtree: true });
  queue();
})();
