/* لوحة الإحصاءات: مؤشرات ومخططات SVG تفاعلية بنمط لوحات المعلومات، تحديث دوري، مرشحات (تحديد متقاطع)، وتصدير PDF / Word / Excel */
(function () {
  const UA = window.UA, { S, api, esc, toast } = UA;
  const PAL = ['#054239', '#C9A24B', '#0A8F7A', '#7A5C12', '#4DB6A0', '#2F6F9F', '#8C9A94', '#B3261E'];
  const D = { data: null, faculty: '', year: '', timer: null, paused: false, loading: false, err: '', exporting: '' };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); stop(); Object.assign(D, { data: null, faculty: '', year: '', paused: false, err: '', exporting: '' }); };
  const nf = new Intl.NumberFormat('en-US');
  const fmt = (v) => (v === null || v === undefined ? '—' : nf.format(v));
  const short = (s, n = 22) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  /* ---------- رسم المخططات (SVG) ---------- */
  const W = 520, H = 280;
  const tip = (t) => `<title>${esc(t)}</title>`;
  const empty = (msg = 'لا بيانات ضمن المرشحات الحالية') => `<svg viewBox="0 0 ${W} 120" role="img" aria-label="${msg}"><text x="${W / 2}" y="64" text-anchor="middle" class="ch-empty">${msg}</text></svg>`;
  const niceMax = (m) => { const raw = Math.max(m / 4, 0.25), p = 10 ** Math.floor(Math.log10(raw)), n = raw / p, step = Math.max((n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p, m <= 400 && Number.isInteger(m) ? 1 : 0); return step * 4; };

  function axisY(max, left, top, h, width) {
    return [0, 0.25, 0.5, 0.75, 1].map((f) => { const y = top + h - f * h; return `<line x1="${left}" x2="${width}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" class="ch-ax">${fmt(Math.round(max * f * 10) / 10)}</text>`; }).join('');
  }

  function barChart(t, sel) {
    const rows = t.rows; if (!rows.length || rows.every((r) => !r[1])) return empty();
    const L = 40, T = 14, B = 54, h = H - T - B, w = W - L - 8, max = niceMax(Math.max(...rows.map((r) => r[1]))), bw = Math.min(54, (w / rows.length) * 0.62);
    const bars = rows.map((r, i) => {
      const x = L + (w / rows.length) * (i + 0.5) - bw / 2, bh = (r[1] / max) * h, y = T + h - bh, id = t.ids ? t.ids[i] : null;
      const act = t.selectable ? ` data-act="dsel" data-t="${t.id}" data-v="${t.selectable === 'year' ? esc(r[0]) : id ?? ''}" tabindex="0" role="button"` : '';
      const on = (t.selectable === 'year' && String(D.year) === r[0]) || (t.selectable === true && id && String(D.faculty) === String(id));
      const dim = (D.faculty && t.selectable === true && !on) || (D.year && t.selectable === 'year' && !on);
      return `<g${act} class="ch-bar${dim ? ' dim' : ''}">${tip(`${r[0]}: ${fmt(r[1])}`)}<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(bh, 1)}" rx="4" fill="${on ? PAL[1] : PAL[0]}"/><text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="ch-val">${fmt(r[1])}</text>
        <text x="${x + bw / 2}" y="${T + h + 16}" text-anchor="middle" class="ch-ax">${esc(short(t.codes ? t.codes[i] : r[0], 9))}</text>${t.codes ? `<text x="${x + bw / 2}" y="${T + h + 30}" text-anchor="middle" class="ch-ax sm">${esc(short(r[0], 14))}</text>` : ''}</g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.title)}">${axisY(max, L, T, h, W - 8)}${bars}</svg>`;
  }

  function hbarChart(t) {
    const rows = t.rows; if (!rows.length) return empty();
    const multi = t.headers.length > 2, rowH = 30, L = 150, hh = rows.length * rowH + 14, w = W - L - 56;
    const max = niceMax(Math.max(...rows.flatMap((r) => (multi ? [r[1], r[2]] : [r[1]])).map(Number), 1));
    const out = rows.map((r, i) => {
      const y = 8 + i * rowH, bars = (multi ? [[r[1], PAL[0]], [r[2], PAL[1]]] : [[r[1], PAL[0]]]).map(([v, c], k) => {
        const bw = (Number(v ?? 0) / (t.id === 'gradeByFaculty' ? 100 : max)) * w, bh = multi ? 10 : 18, yy = y + (multi ? k * 12 : 2);
        return `<rect x="${L}" y="${yy}" width="${Math.max(bw, 1)}" height="${bh}" rx="3" fill="${c}"/><text x="${L + bw + 6}" y="${yy + bh - 2}" class="ch-val" text-anchor="start">${v === null ? '—' : fmt(v)}</text>`;
      }).join('');
      return `<g class="ch-bar">${tip(`${r[0]}: ${r.slice(1).map(fmt).join(' / ')}`)}<text x="${L - 8}" y="${y + 15}" text-anchor="end" class="ch-ax lg">${esc(short(r[0], 24))}</text>${bars}</g>`;
    }).join('');
    const legend = multi ? `<g transform="translate(${W - 6},${hh + 4})" text-anchor="end"><rect x="-10" y="-9" width="10" height="10" fill="${PAL[0]}" rx="2"/><text x="-16" y="0" class="ch-ax" text-anchor="end">${esc(t.headers[1])}</text><rect x="-130" y="-9" width="10" height="10" fill="${PAL[1]}" rx="2"/><text x="-136" y="0" class="ch-ax" text-anchor="end">${esc(t.headers[2])}</text></g>` : '';
    return `<svg viewBox="0 0 ${W} ${hh + (multi ? 18 : 0)}" role="img" aria-label="${esc(t.title)}">${out}${legend}</svg>`;
  }

  function donutChart(t) {
    const rows = t.rows.filter((r) => r[1] > 0), total = rows.reduce((s, r) => s + r[1], 0); if (!total) return empty();
    const cx = 120, cy = 128, R = 92, r0 = 56; let a0 = -Math.PI / 2;
    const arcs = rows.map((r, i) => {
      const a1 = a0 + (r[1] / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, c = PAL[i % PAL.length];
      const p = (a, rad) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`, full = rows.length === 1;
      const d = full ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx + r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx - r0} ${cy} Z` : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`;
      a0 = a1; return `<path d="${d}" fill="${c}" fill-rule="evenodd" class="ch-seg">${tip(`${r[0]}: ${fmt(r[1])} (${Math.round((r[1] / total) * 1000) / 10}%)`)}</path>`;
    }).join('');
    const legend = rows.map((r, i) => `<g transform="translate(262,${30 + i * 26})"><rect width="12" height="12" rx="3" fill="${PAL[i % PAL.length]}"/><text x="-8" y="11" text-anchor="end" class="ch-ax lg" transform="translate(240,0)">${esc(short(r[0], 18))}</text><text x="22" y="11" class="ch-val" text-anchor="start">${fmt(r[1])} · ${Math.round((r[1] / total) * 100)}%</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} 256" role="img" aria-label="${esc(t.title)}">${arcs}<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="ch-big">${fmt(total)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="ch-ax">الإجمالي</text>${legend}</svg>`;
  }

  function lineChart(t) {
    const rows = t.rows, ser = t.headers.length - 1; if (!rows.length || rows.every((r) => r.slice(1).every((v) => !v))) return empty();
    const L = 40, T = 16, B = 44, h = H - T - B, w = W - L - 14, max = niceMax(Math.max(...rows.flatMap((r) => r.slice(1).map(Number)), 1)), step = w / Math.max(rows.length - 1, 1);
    const X = (i) => L + step * i, Y = (v) => T + h - (v / max) * h;
    const lines = Array.from({ length: ser }, (_, s) => {
      const pts = rows.map((r, i) => `${X(i)},${Y(r[s + 1] ?? 0)}`), c = PAL[s];
      const area = s === 0 ? `<path d="M ${X(0)},${T + h} L ${pts.join(' L ')} L ${X(rows.length - 1)},${T + h} Z" fill="${c}" opacity=".10"/>` : '';
      return `${area}<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" ${s ? 'stroke-dasharray="6 4"' : ''}/>${rows.map((r, i) => `<circle cx="${X(i)}" cy="${Y(r[s + 1] ?? 0)}" r="4" fill="#fff" stroke="${c}" stroke-width="2" class="ch-dot">${tip(`${r[0]} — ${t.headers[s + 1]}: ${fmt(r[s + 1])}`)}</circle>`).join('')}`;
    }).join('');
    const xs = rows.map((r, i) => (i % 2 === 0 || rows.length < 8 ? `<text x="${X(i)}" y="${T + h + 16}" text-anchor="middle" class="ch-ax sm">${esc(short(r[0], 12))}</text>` : '')).join('');
    const legend = ser > 1 ? t.headers.slice(1).map((hd, s) => `<g transform="translate(${W - 10 - s * 130},${H - 8})"><rect x="-10" y="-9" width="10" height="10" rx="2" fill="${PAL[s]}"/><text x="-16" class="ch-ax" text-anchor="end">${esc(hd)}</text></g>`).join('') : '';
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.title)}">${axisY(max, L, T, h, W - 14)}${lines}${xs}${legend}</svg>`;
  }

  function stackChart(t) {
    const rows = t.rows; if (!rows.length) return empty();
    const L = 150, rowH = 30, hh = rows.length * rowH + 34, w = W - L - 44, max = niceMax(Math.max(...rows.map((r) => r[1] + r[2] + r[3]), 1)), cols = [PAL[1], PAL[0], PAL[7]];
    const body = rows.map((r, i) => {
      let x = L; const y = 8 + i * rowH;
      const segs = [1, 2, 3].map((k) => { const sw = (r[k] / max) * w, s = r[k] ? `<rect x="${x}" y="${y + 2}" width="${sw}" height="18" fill="${cols[k - 1]}" ${k === 1 ? 'rx="3"' : ''}>${tip(`${r[0]} — ${t.headers[k]}: ${fmt(r[k])}`)}</rect>` : ''; x += sw; return s; }).join('');
      return `<g class="ch-bar"><text x="${L - 8}" y="${y + 16}" text-anchor="end" class="ch-ax lg">${esc(short(r[0], 24))}</text>${segs}<text x="${x + 6}" y="${y + 16}" class="ch-val" text-anchor="start">${fmt(r[1] + r[2] + r[3])}</text></g>`;
    }).join('');
    const legend = [1, 2, 3].map((k, i) => `<g transform="translate(${W - 10 - i * 110},${hh - 6})"><rect x="-10" y="-9" width="10" height="10" rx="2" fill="${cols[k - 1]}"/><text x="-16" class="ch-ax" text-anchor="end">${esc(t.headers[k])}</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${hh}" role="img" aria-label="${esc(t.title)}">${body}${legend}</svg>`;
  }

  const DRAW = { bar: barChart, hbar: hbarChart, donut: donutChart, line: lineChart, stack: stackChart };
  const chart = (t) => (DRAW[t.type] || barChart)(t);

  /* ---------- مؤشرات ---------- */
  function spark(v) {
    if (!v || v.length < 2 || !Math.max(...v)) return '';
    const m = Math.max(...v), pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${26 - (x / m) * 24}`).join(' ');
    return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const kpiTile = (k) => `<div class="kpi ${k.tone || ''}"><small>${esc(k.label)}</small><b>${fmt(k.value)}${k.value !== null && k.unit ? `<span>${esc(k.unit)}</span>` : ''}</b>${k.hint ? `<em>${esc(k.hint)}</em>` : '<em>&nbsp;</em>'}${spark(k.spark)}</div>`;

  /* ---------- الصفحة ---------- */
  const SPAN = { byFaculty: 'w2', reqByService: 'w2', reqByMonth: 'w2', regByMonth: 'w2', gradeByFaculty: 'w2', byGovernorate: '' };
  function view() {
    const a = D.data;
    if (!a) return `<div class="empty">${D.err ? esc(D.err) : 'جارٍ تحميل الإحصاءات…'}</div>`;
    const fo = a.options.faculties.map((f) => `<option value="${f.id}"${String(D.faculty) === String(f.id) ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const yo = a.options.years.map((y) => `<option value="${y}"${String(D.year) === String(y) ? ' selected' : ''}>${y}</option>`).join('');
    const upd = new Date(a.generatedAt).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const exp = (k, label) => `<button class="btn sm" data-act="dexp" data-k="${k}"${D.exporting ? ' disabled' : ''}>${D.exporting === k ? 'جارٍ التجهيز…' : label}</button>`;
    return `<div class="dash" id="dash">
      <div class="dash-bar no-print"><div class="slicers"><label>الكلية / المعهد<select id="d-fac" data-chg="dfilter"><option value="">الكل</option>${fo}</select></label><label>سنة القيد<select id="d-year" data-chg="dfilter"><option value="">الكل</option>${yo}</select></label>
          ${D.faculty || D.year ? '<button class="btn sm" data-act="dclear">مسح المرشحات</button>' : ''}</div>
        <div class="dash-live"><span class="live-dot${D.paused ? ' off' : ''}"></span><span>${D.paused ? 'التحديث متوقف' : 'تحديث تلقائي كل دقيقة'} · آخر تحديث ${upd}</span><button class="btn sm" data-act="dpause">${D.paused ? 'استئناف' : 'إيقاف'}</button><button class="btn sm" data-act="drefresh">تحديث الآن</button></div></div>
      <div class="dash-bar no-print"><div class="exports"><b>تصدير:</b>${exp('pdf', 'PDF')}${exp('docx', 'Word')}${exp('xlsx', 'Excel')}</div><span class="small">PDF: تُفتح نافذة الطباعة فاختر «حفظ كـ PDF».</span></div>
      <div class="print-head"><b>تقرير الإحصاءات — الجامعة السورية للعلوم الأمنية</b><span>${esc(D.faculty ? (a.options.faculties.find((f) => String(f.id) === String(D.faculty)) || {}).name || '' : 'كل الجهات')}${D.year ? ' · سنة القيد ' + esc(D.year) : ''} · ${new Date(a.generatedAt).toLocaleString('ar-SY')}</span></div>
      <div class="kpis">${a.kpis.map(kpiTile).join('')}</div>
      <div class="vis-grid">${a.tables.map((t) => `<section class="vis ${SPAN[t.id] || ''}" data-vis="${t.id}"><header><h3>${esc(t.title)}</h3>${t.selectable ? '<span class="small no-print">انقر عموداً لتصفية اللوحة</span>' : ''}</header><div class="vis-body">${chart(t)}</div></section>`).join('')}</div></div>`;
  }

  /* ---------- التحميل والتحديث الدوري ---------- */
  const qs = () => new URLSearchParams({ ...(D.faculty ? { faculty: D.faculty } : {}), ...(D.year ? { year: D.year } : {}) }).toString();
  async function load(silent) {
    if (D.loading) return; D.loading = true;
    try { D.data = await api('GET', '/api/analytics?' + qs()); D.err = ''; }
    catch (e) { if (!e.status) throw e; D.err = e.message; }
    finally { D.loading = false; }
    if (S.view === 'dashboard' && !silent) UA.render(); else if (S.view === 'dashboard') softRender();
  }
  // التحديث الصامت يستبدل اللوحة فقط (لا يقطع تفاعل المستخدم مع القوائم)
  function softRender() { const el = document.getElementById('dash'); if (!el || document.activeElement?.closest?.('.slicers')) return; const t = document.createElement('div'); t.innerHTML = view(); el.replaceWith(t.firstElementChild); }
  function start() { stop(); D.timer = setInterval(() => { if (!D.paused && S.view === 'dashboard' && !document.hidden) load(true); }, 60000); }
  function stop() { if (D.timer) clearInterval(D.timer); D.timer = null; }

  UA.views.dashboard = () => view();
  UA.loaders.dashboard = async () => { await load(true); start(); };

  /* ---------- التصدير ---------- */
  const fontFace = async () => '';        // خط الموقع النظامي يُستخدم؛ خط AL Mohanad المرفق لا يحوي حروف Unicode العربية (انظر docs/PHASE2.md)
  const CSS = '.ch-grid{stroke:#DCE3DD;stroke-width:1}.ch-ax{fill:#566660;font:12px Cairo,Tahoma,"Noto Sans Arabic",sans-serif}.ch-ax.sm{font-size:11px}.ch-ax.lg{font-size:13px;fill:#10211D}.ch-val{fill:#10211D;font:700 12px Cairo,Tahoma,"Noto Sans Arabic",sans-serif}.ch-big{fill:#054239;font:700 26px Cairo,Tahoma,"Noto Sans Arabic",sans-serif}.ch-empty{fill:#566660;font:14px Cairo,Tahoma,"Noto Sans Arabic",sans-serif}.dim{opacity:.35}';
  async function chartJpeg(svgEl) {                       // SVG ← JPEG (خلفية بيضاء) لتضمينه في Word
    const clone = svgEl.cloneNode(true), vb = svgEl.viewBox.baseVal, w = 1040, h = Math.round((w * vb.height) / vb.width);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('direction', 'ltr');
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = (await fontFace()) + CSS; clone.insertBefore(st, clone.firstChild);
    // data: وليس blob: لأن سياسة الأمان (CSP) تسمح بـ data: للصور فقط
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.9).split(',')[1];
  }
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function download(url, opt, name) {
    const res = await fetch(url, { credentials: 'same-origin', ...opt });
    if (!res.ok) { let m = 'تعذّر التصدير.'; try { m = (await res.json()).message || m; } catch { /* */ } throw Object.assign(new Error(m), { status: res.status }); }
    saveBlob(await res.blob(), name);
  }

  Object.assign(UA.actions, {
    dsel: async (el, d) => { const v = d.v; if (d.t === 'byYear') D.year = String(D.year) === v ? '' : v; else D.faculty = String(D.faculty) === String(v) ? '' : v; await load(false); },
    dclear: async () => { D.faculty = ''; D.year = ''; await load(false); },
    dpause: async () => { D.paused = !D.paused; UA.render(); },
    drefresh: async () => { await load(false); toast('تم التحديث'); },
    dexp: async (el, d) => {
      D.exporting = d.k; UA.render();
      try {
        const q = qs();
        if (d.k === 'pdf') { D.exporting = ''; UA.render(); setTimeout(() => window.print(), 80); return; }
        if (d.k === 'xlsx') await download('/api/analytics/export.xlsx?' + q, {}, 'statistics-report.xlsx');
        else if (d.k === 'docx') {
          const charts = []; for (const v of document.querySelectorAll('.vis[data-vis]')) { const svg = v.querySelector('svg'); if (svg) { try { charts.push({ id: v.dataset.vis, jpeg: await chartJpeg(svg) }); } catch { /* مخطط تعذّر تحويله: يبقى جدوله */ } } }
          await download('/api/analytics/export.docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faculty: D.faculty || null, year: D.year || null, charts }) }, 'statistics-report.docx');
        }
        toast('تم التصدير');
      } catch (e) { if (!e.status) throw e; toast(e.message); } finally { D.exporting = ''; UA.render(); }
    },
  });
  window.addEventListener('change', async (e) => { if (e.target && e.target.dataset && e.target.dataset.chg === 'dfilter') { D.faculty = document.getElementById('d-fac').value; D.year = document.getElementById('d-year').value; await load(false); } });
})();
