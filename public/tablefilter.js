/* فلترة موحّدة لكل الجداول: قائمة منسدلة في كل عنوان عمود (ترتيب + بحث + اختيار قيم) + سطر شامل فوق الجدول + زر «إلغاء الفلترة».
   الفلترة على كل الصفوف المحمّلة؛ وفي الجداول المقسّمة إلى صفحات يرفع تفعيل أي فلتر عدد الصفوف تلقائياً إلى 500 ليشمل الفلتر كامل البيانات وتبقى بعد إعادة رسم الصفحة.
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

  const cellRaw = (c) => String(c ? c.textContent : '').replace(/\s+/g, ' ').trim();
  const colOn = (c) => !!c && (!!words(c.text).length || !!c.set);
  /* الجداول المقسّمة إلى صفحات: عند تفعيل أي فلتر نرفع عدد الصفوف إلى الحد الأقصى (500) ليشمل الفلتر كل البيانات لا الصفحة الظاهرة فقط */
  function needAll(t) {
    const sel = t.closest('.card, section, #app, #layer')?.querySelector('select[data-stt=size], select[data-cf=size], select[data-gt=size], select[data-af=size]');
    if (!sel || sel.value === '500' || ![...sel.options].some((o) => o.value === '500' || o.text === '500')) return;
    sel.value = '500'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function apply(t) {
    const st = t._tf, rows = dataRows(t), gw = words(st.g.value), cw = st.cols.map((c) => (c ? words(c.text) : []));
    let shown = 0;
    for (const r of rows) {
      r._tfa ??= norm(r.textContent); r._tfc ??= [...r.cells].map((c) => norm(c.textContent)); r._tfr ??= [...r.cells].map(cellRaw);
      const ok = gw.every((w) => r._tfa.includes(w)) && st.cols.every((c, i) => !c || ((!cw[i].length || cw[i].every((w) => (r._tfc[i] ?? '').includes(w))) && (!c.set || c.set.has(r._tfr[i] ?? ''))));
      r.hidden = !ok; if (ok) shown++;
    }
    const any = !!gw.length || st.cols.some(colOn);
    if (any) needAll(t);
    st.clear.hidden = !any; st.count.textContent = any ? `عرض ${shown} من ${rows.length}` : `${rows.length} صف`;
    st.cols.forEach((c, i) => { const b = st.btns[i]; if (b) b.classList.toggle('on', colOn(c)); });
    let none = t.tBodies[0].querySelector('tr.tf-none');
    if (any && !shown) { if (!none) { none = t.tBodies[0].insertRow(); none.className = 'tf-none'; none.innerHTML = `<td colspan="${headCells(t).length}" class="empty">لا صفوف مطابقة للفلترة.</td>`; } }
    else if (none) none.remove();
    kept.set(keyOf(t), { g: st.g.value, c: st.cols.map((c) => (c ? { text: c.text, set: c.set ? [...c.set] : null } : null)) });
  }

  /* ---------- القائمة المنسدلة لعمود ---------- */
  let pop = null;
  const closePop = () => { if (pop) { pop.el.remove(); pop.btn.setAttribute('aria-expanded', 'false'); pop = null; } };
  function sortRows(t, i, dir) {
    const tb = t.tBodies[0], rows = dataRows(t);
    rows.sort((x, y) => cellRaw(x.cells[i]).localeCompare(cellRaw(y.cells[i]), 'ar', { numeric: true, sensitivity: 'base' }) * dir);
    for (const r of rows) tb.appendChild(r);
    const none = tb.querySelector('tr.tf-none'); if (none) tb.appendChild(none);
    headCells(t).forEach((c, k) => { if (k === i) c.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); else c.removeAttribute('aria-sort'); });
  }
  function openPop(t, i, btn) {
    if (pop && pop.btn === btn) { closePop(); return; }
    closePop();
    const st = t._tf, col = st.cols[i], th = btn.closest('th'), label = th.textContent.replace(/[▾⇅⇕↕↑↓▲▼]/g, '').replace(/\s+/g, ' ').trim();
    const vals = new Map();
    for (const r of dataRows(t)) { r._tfr ??= [...r.cells].map(cellRaw); const v = r._tfr[i] ?? ''; vals.set(v, (vals.get(v) || 0) + 1); }
    const list = [...vals.keys()].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' }));
    const own = th.querySelector('.th-sort');
    const el = document.createElement('div'); el.className = 'tf-pop no-print'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'قائمة العمود: ' + label); el.dir = 'rtl';
    el.innerHTML = `<div class="tf-pop-t">${label.replace(/[<>&]/g, '')}</div>
      <div class="tf-pop-s">${own ? '<button type="button" data-s="own">⇅ تبديل ترتيب العمود</button>' : '<button type="button" data-s="1">↑ ترتيب تصاعدي</button><button type="button" data-s="-1">↓ ترتيب تنازلي</button>'}</div>
      <input type="search" class="tf-pop-q" placeholder="ابحث في هذا العمود…" aria-label="بحث في قيم العمود" autocomplete="off" maxlength="60">
      <label class="tf-pop-all"><input type="checkbox" data-all> تحديد الكل</label>
      <div class="tf-pop-l" role="group" aria-label="قيم العمود"></div>
      <div class="tf-pop-f"><button type="button" data-x="clear">مسح فلتر العمود</button><button type="button" data-x="ok" class="pri">تم</button></div>`;
    document.body.appendChild(el);
    const q = el.querySelector('.tf-pop-q'), box = el.querySelector('.tf-pop-l'), all = el.querySelector('[data-all]');
    q.value = col.text;
    const draw = () => {
      const w = words(q.value), shownVals = list.filter((v) => !w.length || w.every((x) => norm(v).includes(x))).slice(0, 300);
      box.innerHTML = shownVals.map((v, k) => `<label><input type="checkbox" data-v="${k}"${!col.set || col.set.has(v) ? ' checked' : ''}><span>${v ? v.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) : '(فارغ)'}</span><em>${vals.get(v)}</em></label>`).join('') || '<p class="tf-pop-n">لا قيم مطابقة.</p>';
      box._vals = shownVals; all.checked = !col.set; all.indeterminate = !!col.set && list.some((v) => col.set.has(v)) && list.some((v) => !col.set.has(v));
    };
    draw();
    q.addEventListener('input', () => { col.text = q.value; draw(); apply(t); });
    all.addEventListener('change', () => { col.set = all.checked ? null : new Set(); draw(); apply(t); });
    box.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-v]'); if (!cb) return;
      const v = box._vals[Number(cb.dataset.v)]; if (!col.set) col.set = new Set(list);
      if (cb.checked) col.set.add(v); else col.set.delete(v);
      if (list.every((x) => col.set.has(x))) col.set = null;
      all.checked = !col.set; all.indeterminate = !!col.set && col.set.size > 0; apply(t);
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s === 'own') { closePop(); own.click(); }
      else if (b.dataset.s) { sortRows(t, i, Number(b.dataset.s)); closePop(); }
      else if (b.dataset.x === 'clear') { col.text = ''; col.set = null; q.value = ''; draw(); apply(t); }
      else if (b.dataset.x === 'ok') closePop();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); btn.focus(); } });
    const r = btn.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 16);
    el.style.width = w + 'px'; el.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + 'px';
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    btn.setAttribute('aria-expanded', 'true'); pop = { el, btn }; q.focus();
  }
  document.addEventListener('mousedown', (e) => { if (pop && !pop.el.contains(e.target) && !pop.btn.contains(e.target)) closePop(); });
  window.addEventListener('resize', closePop);
  window.addEventListener('scroll', (e) => { if (pop && !pop.el.contains(e.target)) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  function attach(t) {
    const host = t.closest('.tbl-wrap') || t, key = keyOf(t), saved = kept.get(key) ?? { g: '', c: [] }, own = hasOwnFilters(t), heads = headCells(t);
    const el = document.createElement('div'); el.className = 'tf-bar no-print';
    el.innerHTML = `${own ? '' : '<input type="search" class="tf-in" placeholder="فلترة شاملة لكل الأعمدة…" aria-label="فلترة شاملة" autocomplete="off" maxlength="80">'}<button type="button" class="btn sm tf-clear" hidden>إلغاء الفلترة</button><span class="small tf-count"></span>`;
    host.parentNode.insertBefore(el, host);
    const st = { el, g: el.querySelector('.tf-in') || { value: '' }, clear: el.querySelector('.tf-clear'), count: el.querySelector('.tf-count'), cols: [], btns: [] };
    if (st.g.addEventListener) { st.g.value = saved.g; st.g.addEventListener('input', () => apply(t)); st.g.addEventListener('keydown', esc); }
    // زر قائمة منسدلة في عنوان كل عمود (إلا إن وُجدت خلايا مدموجة)
    st.btns = [];
    if (!heads.some((c) => c.colSpan > 1)) {
      heads.forEach((c, i) => {
        const label = c.textContent.trim();
        if (!label) { st.cols.push(null); st.btns.push(null); return; }                // عمود أزرار بلا عنوان
        const sv = saved.c[i]; st.cols.push({ text: sv && typeof sv.text === 'string' ? sv.text : '', set: sv && sv.set ? new Set(sv.set) : null });
        c.classList.add('tf-h');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tf-dd no-print'; b.textContent = '▾'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-label', 'قائمة العمود ' + label);
        b.addEventListener('click', (e) => { e.stopPropagation(); openPop(t, i, b); });
        c.appendChild(b); st.btns.push(b);
      });
    }
    st.clear.addEventListener('click', () => { if (st.g.value !== undefined) st.g.value = ''; st.cols.forEach((c) => { if (c) { c.text = ''; c.set = null; } }); closePop(); apply(t); (st.g.focus ? st.g : st.clear).focus?.(); });
    function esc(e) { if (e.key === 'Escape' && !st.clear.hidden) { e.stopPropagation(); st.clear.click(); } }
    t._tf = st; t.dataset.tf = '1'; apply(t);
  }

  function scan() {
    queued = false;
    for (const t of document.querySelectorAll('#app table, #layer table')) {
      if (t.dataset.tf === '1') {
        if (!t._tf) continue;
        if (t._tfRows !== t.tBodies[0].rows.length) { for (const r of t.rows) { delete r._tfa; delete r._tfc; delete r._tfr; } apply(t); }      // أُعيد رسم الصفوف
        t._tfRows = t.tBodies[0].rows.length; continue;
      }
      if (eligible(t)) { attach(t); t._tfRows = t.tBodies[0].rows.length; }
    }
    for (const b of document.querySelectorAll('.tf-bar')) if (!b.nextElementSibling) b.remove();   // شريط يتيم
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  const mine = (n) => n.nodeType === 3 || (n.nodeType === 1 && (n.classList.contains('tf-bar') || n.classList.contains('tf-none') || n.classList.contains('tf-pop')));
  new MutationObserver((ms) => { if (ms.some((m) => ![...m.addedNodes, ...m.removedNodes].every(mine))) queue(); }).observe(document.documentElement, { childList: true, subtree: true });
  queue();
})();
