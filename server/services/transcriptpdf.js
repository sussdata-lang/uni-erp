// رسم كشف العلامات في ملف PDF بنفس القوالب الأربعة المعروضة في الواجهة (classic, modern, academic, royal) ونفس نموذج العرض (transcriptmodel.js).
// يدعم عدة صفحات، وشعاراً شفافاً في خلفية كل صفحة. الخط المضمَّن في PDF هو DejaVu (لا يحوي Cairo)، أما التخطيط والألوان فمن هوية الجامعة.
import { textWidth } from '../lib/pdf.js';
import { PASS } from './transcriptmodel.js';

const W = 595.28, H = 841.89, R = 545, L = 50, TOP = 800, BOT = 48;
const C = { g: '#054239', gd: '#032E28', gm: '#0A5A4D', au: '#C9A24B', au2: '#E6CB84', ink: '#8A6A1B', ln: '#D9E2DF', mu: '#5B6B66', tx: '#10211D', ok: '#0B7A4B', bad: '#B3261E', soft: '#EEF3F1', cream: '#F3EAD2', white: '#FFFFFF' };
const f1 = (n) => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10));
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const fit = (str, font, size, maxW) => { let s = String(str ?? ''); if (textWidth(s, font, size) <= maxW) return s; while (s.length > 1 && textWidth(`${s}…`, font, size) > maxW) s = s.slice(0, -1); return `${s}…`; };
const markColor = (r) => (r.pending ? C.mu : r.mark >= PASS ? C.ok : C.bad);
const ratingOf = (r) => (r.pending ? 'لم تُرصد' : r.mark >= 90 ? 'ممتاز' : r.mark >= 80 ? 'جيد جداً' : r.mark >= 70 ? 'جيد' : r.mark >= PASS ? 'مقبول' : 'راسب');
const ctr = (d, str, cx, y, o = {}) => d.text(str, { x: cx, y, align: 'center', ...o });

// أعمدة جدول المقررات: عرض ثابت لكل عمود (من اليمين)، والمقرر يأخذ الباقي
function columns(defs, left = L, right = R) {
  const fixed = defs.reduce((s, c) => s + (c.w || 0), 0), flex = right - left - fixed; let x = right;
  return defs.map((c) => { const w = c.w || flex, col = { ...c, w, r: x, l: x - w, c: x - w / 2 }; x -= w; return col; });
}

export function paintTranscript(d, doc, tpl, ctx) {
  const v = doc.view, p = doc.payload, th = tpl;
  const royal = tpl === 'royal', modern = tpl === 'modern', academic = tpl === 'academic', classic = tpl === 'classic';
  let y = TOP, page = 1;
  const frameR = academic ? R - 38 : R;                         // الشريط الجانبي في «الأكاديمي» يضيّق المحتوى
  const right = frameR, left = L;

  /* ---------- خلفية الصفحة وإطارها (تتكرر في كل صفحة) ---------- */
  const chrome = () => {
    if (royal) { d.fill('#FFFDF8'); d.rect(0, 0, W, H); }
    if (modern) { d.fill('#F6F9F8'); d.rect(0, 0, W, H); }
    d.image(W / 2 - 150, H / 2 - 180, 300, 360, { alpha: 0.07 });                      // شعار شفاف في خلفية الصفحة
    if (classic) {
      d.stroke(C.g); d.lw(3); d.rect(22, 22, W - 44, H - 44, 'S');
      d.stroke(C.au); d.lw(0.8); d.rect(28, 28, W - 56, H - 56, 'S');
      for (const [cx, cy, sx, sy] of [[22, 22, 1, 1], [W - 22, 22, -1, 1], [22, H - 22, 1, -1], [W - 22, H - 22, -1, -1]]) { d.stroke(C.au); d.lw(1.6); d.line(cx, cy + sy * 16, cx, cy, 1.6); d.line(cx, cy, cx + sx * 16, cy, 1.6); }
    }
    if (royal) {
      d.stroke(C.au); d.lw(1.2); d.rect(20, 20, W - 40, H - 40, 'S');
      d.stroke(C.g); d.lw(4); d.rect(27, 27, W - 54, H - 54, 'S');
      d.stroke(C.au); d.lw(0.7); d.rect(33, 33, W - 66, H - 66, 'S');
      for (const [cx, cy] of [[27, 27], [W - 27, 27], [27, H - 27], [W - 27, H - 27]]) { d.fill(C.au); d.poly([[cx, cy + 7], [cx + 7, cy], [cx, cy - 7], [cx - 7, cy]]); d.fill('#FFFDF8'); d.poly([[cx, cy + 3.5], [cx + 3.5, cy], [cx, cy - 3.5], [cx - 3.5, cy]]); }
    }
    if (academic) {
      d.fill(C.g); d.rect(R - 30, 0, 30 + (W - R), H); d.fill(C.au); d.rect(R - 33, 0, 3, H);
      d.image(R - 24, H - 62, 40, 48);
      d.text(`${v.university}`, { x: R - 8, y: H - 90, size: 8, color: C.au2, align: 'right' });
    }
    d.text(`صفحة ${page}`, { x: W / 2, y: 30, size: 8, color: C.mu, align: 'center' });
  };
  const ensure = (h, redo) => { if (y - h < BOT + 4) { d.newPage(); page++; chrome(); y = TOP - 14; slim(); if (redo) redo(); } };
  const slim = () => { if (page > 1) { d.text(`${v.name} — ${v.studentNo}`, { x: right, y: TOP - 4, size: 9, font: 'bold', color: C.g }); d.text(v.university, { x: left, y: TOP - 4, size: 8.5, color: C.mu, align: 'left' }); d.stroke(C.au); d.line(left, TOP - 10, right, TOP - 10, 0.8); y = TOP - 26; } };

  /* ---------- الترويسة (الصفحة الأولى) ---------- */
  chrome();
  if (classic) {
    ctr(d, 'الجمهورية العربية السورية · وزارة الداخلية', W / 2, 790, { size: 8, color: C.mu });
    d.image(W / 2 - 24, 726, 48, 58); ctr(d, v.university, W / 2, 704, { size: 20, font: 'bold', color: C.g });
    if (v.faculty) ctr(d, v.faculty, W / 2, 684, { size: 12, font: 'bold', color: C.ink });
    d.stroke(C.au); d.line(150, 672, 445, 672, 1.2); d.fill(C.au); d.poly([[W / 2, 677], [W / 2 + 5, 672], [W / 2, 667], [W / 2 - 5, 672]]);
    ctr(d, 'كشف علامات', W / 2, 640, { size: 25, font: 'bold', color: C.gd }); ctr(d, 'السجل الأكاديمي الرسمي للطالب', W / 2, 622, { size: 9, color: C.mu });
    y = 604;
  } else if (modern) {
    d.fill(C.gd); d.rect(0, 722, W, 120); d.fill(C.g); d.rect(0, 722, W * 0.62, 120); d.fill(C.au); d.rect(0, 718, W, 4);
    d.image(R - 56, 736, 52, 62); d.text(v.university, { x: R - 66, y: 780, size: 17, font: 'bold', color: C.white }); d.text(v.faculty || 'قسم شؤون الطلاب', { x: R - 66, y: 758, size: 10.5, color: C.au2 });
    d.text('الوثيقة الرسمية', { x: L + 130, y: 790, size: 9, color: C.au2, align: 'left' }); d.text('كشف علامات', { x: L, y: 756, size: 24, font: 'bold', color: C.white, align: 'left' });
    y = 700;
  } else if (academic) {
    d.text(v.faculty || 'قسم شؤون الطلاب', { x: right, y: 796, size: 10, font: 'bold', color: C.ink }); d.text('السجل الأكاديمي', { x: right, y: 770, size: 24, font: 'bold', color: C.g });
    d.text('رمز التحقق', { x: left + 120, y: 796, size: 8, color: C.mu, align: 'left' }); d.text(doc.code, { x: left, y: 782, size: 10, font: 'bold', color: C.gd, align: 'left' });
    d.stroke(C.g); d.line(left, 758, right, 758, 1.5); y = 740;
  } else {
    d.image(W / 2 - 26, 745, 52, 62); ctr(d, v.university, W / 2, 722, { size: 21, font: 'bold', color: C.g });
    if (v.faculty) ctr(d, v.faculty, W / 2, 703, { size: 12, font: 'bold', color: C.ink });
    d.stroke(C.au); d.line(190, 690, 280, 690, 1); d.line(315, 690, 405, 690, 1); d.fill(C.au); d.poly([[W / 2, 695], [W / 2 + 5, 690], [W / 2, 685], [W / 2 - 5, 690]]);
    ctr(d, 'كشف علامات', W / 2, 656, { size: 26, font: 'bold', color: C.gd });
    y = 636;
  }

  /* ---------- بيانات الطالب ---------- */
  if (royal) {
    ctr(d, `تشهد ${v.university} بأن الطالب/ـة`, W / 2, y, { size: 10.5, color: C.mu }); y -= 26;
    ctr(d, v.name, W / 2, y, { size: 21, font: 'bold', color: C.g }); d.stroke(C.au); d.line(W / 2 - 120, y - 6, W / 2 + 120, y - 6, 0.8); y -= 24;
    ctr(d, `الرقم الجامعي ${v.studentNo}${v.program ? ` · برنامج «${v.program}»` : ''}`, W / 2, y, { size: 10, color: C.mu }); y -= 16;
    ctr(d, 'قد أنجز/ت المقررات الآتية بالعلامات المبيَّنة قرين كلٍّ منها:', W / 2, y, { size: 10, color: C.mu }); y -= 22;
  } else {
    if (modern) { d.fill(C.white); d.rect(L, y - 52, right - L, 62); d.fill(C.au); d.rect(L, y + 7, right - L, 3); }
    else if (classic) { d.fill('#F3EDDA'); d.rect(L, y - 24, right - L, 30); d.fill(C.g); d.rect(right - 3, y - 24, 3, 30); }
    const ny = modern ? y - 12 : academic ? y - 2 : y - 12;
    if (!academic) { d.text('اسم الطالب', { x: right - 10, y: ny, size: 9, color: C.mu }); d.text(v.name, { x: right - 70, y: ny - 1, size: 15, font: 'bold', color: C.gd }); }
    else { d.text('اسم الطالب', { x: right, y: ny, size: 8.5, color: C.mu }); d.text(v.name, { x: right, y: ny - 22, size: 19, font: 'bold', color: C.gd }); }
    y = modern ? y - 30 : academic ? y - 40 : y - 40;
    const cw = (right - left) / 3, items = v.info;
    items.forEach(([k, val], i) => { const col = i % 3, row = Math.floor(i / 3), x = right - col * cw - (modern ? 8 : 0), yy = y - row * 26; d.text(k, { x, y: yy, size: 7.5, color: C.mu }); d.text(fit(val, 'bold', 9.5, cw - 12), { x, y: yy - 12, size: 9.5, font: 'bold', color: C.gd }); });
    y -= Math.ceil(items.length / 3) * 26 + 10;
    if (modern) { // مؤشرات المعدل
      const sw = (right - left - 24) / 5, st = [['المعدل التراكمي', f1(v.summary.avg), true], ['المقررات', String(v.summary.courses)], ['الساعات المنجزة', `${v.summary.earned}/${v.summary.hours}`], ['ناجح', String(v.summary.passed)], ['راسب', String(v.summary.failed)]];
      st.forEach(([k, val, hl], i) => { const x = right - i * (sw + 6); d.fill(hl ? C.g : C.white); d.rect(x - sw, y - 40, sw, 44); ctr(d, k, x - sw / 2, y - 12, { size: 8, color: hl ? C.au2 : C.mu }); ctr(d, val, x - sw / 2, y - 31, { size: 16, font: 'bold', color: hl ? C.white : i === 4 && v.summary.failed ? C.bad : i === 3 ? C.ok : C.g }); });
      y -= 56;
    }
  }

  /* ---------- السنوات ---------- */
  const rowH = academic ? 14.5 : 15.5, sz = academic ? 8.5 : 9;
  const cols = classic || royal ? columns([{ k: 'n', w: 22, t: 'م' }, { k: 'course', t: 'المقرر', a: 'right' }, { k: 'hours', w: 40, t: 'الساعات' }, { k: 'theory', w: 36, t: 'نظري' }, { k: 'practical', w: 36, t: 'عملي' }, { k: 'mark', w: 44, t: 'المجموع' }, { k: 'rating', w: 56, t: 'التقدير' }], left, right)
    : modern ? columns([{ k: 'course', t: 'المقرر', a: 'right' }, { k: 'hours', w: 40, t: 'الساعات' }, { k: 'theory', w: 34, t: 'نظري' }, { k: 'practical', w: 34, t: 'عملي' }, { k: 'bar', w: 120, t: 'العلامة' }, { k: 'rating', w: 54, t: 'الحالة' }], left + 10, right - 10) : null;

  const headRow = (cs) => {
    if (royal) { d.fill(C.g); d.rect(cs[cs.length - 1].l, y - 4, cs[0].r - cs[cs.length - 1].l, 16); } else if (!modern) { d.fill(C.soft); d.rect(cs[cs.length - 1].l, y - 4, cs[0].r - cs[cs.length - 1].l, 16); }
    for (const c of cs) { const col = royal ? C.au2 : modern ? C.mu : C.gd; if (c.a === 'right') d.text(c.t, { x: c.r - 5, y, size: 8, font: 'bold', color: col }); else ctr(d, c.t, c.c, y, { size: 8, font: 'bold', color: col }); }
    if (modern) { d.stroke(C.au); d.line(cs[cs.length - 1].l, y - 6, cs[0].r, y - 6, 0.8); }
    y -= 17;
  };
  const rowDraw = (cs, r, idx, n) => {
    if (idx % 2 === 1 && !modern) { d.fill(royal ? '#FBF6E8' : '#F7FAF9'); d.rect(cs[cs.length - 1].l, y - 4, cs[0].r - cs[cs.length - 1].l, rowH); }
    const mc = markColor(r), name = r.prev ? `${r.course} (محاولة سابقة)` : r.course;
    for (const c of cs) {
      let val;
      if (c.k === 'n') val = r.prev || r.pending ? '' : String(n); else if (c.k === 'course') val = fit(name, 'regular', sz, c.w - 10);
      else if (c.k === 'hours') val = String(r.hours); else if (c.k === 'theory') val = r.theory ?? '—'; else if (c.k === 'practical') val = r.practical ?? '—';
      else if (c.k === 'mark') val = r.pending ? '—' : String(r.mark); else if (c.k === 'rating') val = ratingOf(r);
      else if (c.k === 'bar') { d.fill('#E6EEEB'); d.rect(c.l + 22, y + 1, c.w - 30, 5); if (!r.pending) { d.fill(mc); d.rect(c.l + 22, y + 1, Math.max(1, (c.w - 30) * Math.min(100, r.mark) / 100), 5); } ctr(d, r.pending ? '—' : String(r.mark), c.l + 10, y, { size: sz, font: 'bold', color: mc }); continue; }
      const colr = c.k === 'mark' || c.k === 'rating' ? mc : r.prev || r.pending ? C.mu : C.tx, fnt = c.k === 'mark' ? 'bold' : 'regular';
      if (c.a === 'right') d.text(String(val), { x: c.r - 5, y, size: sz, color: colr }); else ctr(d, String(val), c.c, y, { size: sz, font: fnt, color: colr });
    }
    d.stroke(C.ln); d.line(cs[cs.length - 1].l, y - 4, cs[0].r, y - 4, 0.4);
    y -= rowH;
  };
  const yearBar = (yr) => {
    ensure(70);
    if (classic) { d.fill(C.g); d.rect(left, y - 6, right - left, 20); d.fill(C.au); d.rect(left, y - 6, right - left, 1.5); d.text(yr.label, { x: right - 8, y: y, size: 11.5, font: 'bold', color: C.white }); if (yr.ay) d.text(yr.ay, { x: right - 80, y: y, size: 9, color: C.au2 }); d.text(`معدل السنة: ${f1(yr.avg)}`, { x: left + 8, y: y, size: 9, font: 'bold', color: C.au2, align: 'left' }); }
    else if (modern) { d.fill(C.white); d.rect(left, y - 8, right - left, 24); d.fill(C.g); d.circle(right - 14, y + 4, 9); ctr(d, String(yr.level || '·'), right - 14, y, { size: 9, font: 'bold', color: C.au2 }); d.text(`${yr.label}${yr.ay ? ' — ' + yr.ay : ''}`, { x: right - 30, y: y, size: 11.5, font: 'bold', color: C.gd }); d.fill(C.au); d.rect(left + 8, y - 4, 80, 16); ctr(d, `المعدل ${f1(yr.avg)}`, left + 48, y, { size: 8.5, font: 'bold', color: C.gd }); }
    else if (academic) { d.fill(C.au); d.rect(right - 3, y - 4, 3, 16); d.text(`${yr.label}${yr.ay ? ' · ' + yr.ay : ''}`, { x: right - 10, y: y, size: 11.5, font: 'bold', color: C.g }); d.text(`المعدل السنوي ${f1(yr.avg)} · ${yr.hours} ساعة`, { x: left, y: y, size: 8.5, color: C.mu, align: 'left' }); }
    else { d.stroke(C.au); d.line(left + 150, y + 4, W / 2 - 80, y + 4, 0.6); d.line(W / 2 + 80, y + 4, right - 150, y + 4, 0.6); ctr(d, `${yr.label}${yr.ay ? ' — ' + yr.ay : ''}`, W / 2, y, { size: 12, font: 'bold', color: C.g }); }
    y -= 24;
  };
  const termBar = (t) => { ensure(48); d.fill(royal ? '#F3E7C6' : C.cream); d.rect((cols ? cols[cols.length - 1].l : left), y - 4, (cols ? cols[0].r - cols[cols.length - 1].l : right - left), 15); d.text(t.label, { x: (cols ? cols[0].r : right) - 6, y, size: 9, font: 'bold', color: C.ink }); d.text(`${t.hours} ساعة · المعدل ${f1(t.avg)}`, { x: (cols ? cols[cols.length - 1].l : left) + 6, y, size: 8, color: C.mu, align: 'left' }); y -= 18; };

  for (const yr of v.years) {
    yearBar(yr);
    if (yr.empty) { ctr(d, 'لا توجد مقررات مسجلة لهذه السنة.', W / 2, y, { size: 9, color: C.mu }); y -= 22; continue; }
    if (academic) {   // فصلان متجاوران
      const gap = 10, cw = (right - left - gap) / 2, half = [columns([{ k: 'course', t: 'المقرر', a: 'right' }, { k: 'hours', w: 22, t: 'س' }, { k: 'mark', w: 34, t: 'العلامة' }], right - cw, right), columns([{ k: 'course', t: 'المقرر', a: 'right' }, { k: 'hours', w: 22, t: 'س' }, { k: 'mark', w: 34, t: 'العلامة' }], left, left + cw)];
      const need = 20 + Math.max(...yr.terms.map((t) => t.rows.length)) * rowH + 22; ensure(Math.min(need, 330));
      const y0 = y; let lowest = y0;
      yr.terms.slice(0, 2).forEach((t, i) => {
        y = y0; const cs = half[i]; d.fill(C.g); d.rect(cs[cs.length - 1].l, y - 4, cs[0].r - cs[cs.length - 1].l, 15); d.text(t.label, { x: cs[0].r - 6, y, size: 9, font: 'bold', color: C.white }); y -= 17; headRow(cs);
        t.rows.forEach((r, k) => { if (y < BOT + 22) return; rowDraw(cs, r, k, k + 1); });
        d.fill('#F6F9F8'); d.rect(cs[cs.length - 1].l, y - 4, cs[0].r - cs[cs.length - 1].l, 15); d.text(`الساعات ${t.hours}`, { x: cs[0].r - 6, y, size: 8.5, font: 'bold', color: C.gd }); d.text(`المعدل ${f1(t.avg)}`, { x: cs[cs.length - 1].l + 6, y, size: 8.5, font: 'bold', color: C.gd, align: 'left' });
        lowest = Math.min(lowest, y - 18);
      });
      y = lowest - 6; continue;
    }
    let n = 0;
    for (const t of yr.terms) {
      termBar(t); headRow(cols); let idx = 0;
      for (const r of t.rows) { ensure(rowH + 6, () => headRow(cols)); if (!r.prev && !r.pending) n++; rowDraw(cols, r, idx++, n); }
      if (!modern) { d.fill(C.soft); d.rect(cols[cols.length - 1].l, y - 4, cols[0].r - cols[cols.length - 1].l, 15); d.text(`مجموع ${t.label}`, { x: cols[0].r - 6, y, size: 8.5, font: 'bold', color: C.gd }); d.text(`المعدل: ${f1(t.avg)}   ·   ${t.hours} ساعة`, { x: cols[cols.length - 1].l + 6, y, size: 8.5, font: 'bold', color: C.gd, align: 'left' }); y -= 18; } else y -= 8;
    }
    y -= 6;
  }

  /* ---------- ملخص المواد ---------- */
  const sc = columns([{ k: 'a', t: 'السنة الدراسية', a: 'right' }, { w: 52, k: 'b', t: 'المقررات' }, { w: 40, k: 'c', t: 'ناجح' }, { w: 40, k: 'd', t: 'راسب' }, { w: 50, k: 'e', t: 'لم تُرصد' }, { w: 60, k: 'f', t: 'الساعات' }, { w: 56, k: 'g', t: 'المعدل' }], left, right);
  ensure(52 + v.years.length * 16 + 20);
  d.text('ملخص المواد', { x: right, y, size: 11.5, font: 'bold', color: C.g }); y -= 18;
  d.fill(royal ? C.g : C.g); d.rect(sc[sc.length - 1].l, y - 4, right - left, 16);
  for (const c of sc) { if (c.a === 'right') d.text(c.t, { x: c.r - 6, y, size: 8.5, font: 'bold', color: royal ? C.au2 : C.white }); else ctr(d, c.t, c.c, y, { size: 8.5, font: 'bold', color: royal ? C.au2 : C.white }); } y -= 17;
  v.years.forEach((yr, i) => {
    if (i % 2 === 1) { d.fill('#F7FAF9'); d.rect(left, y - 4, right - left, 15); }
    const vals = [yr.label, yr.courses, yr.passed, yr.failed, yr.pending || '—', `${yr.earned}/${yr.hours}`, f1(yr.avg)];
    sc.forEach((c, k) => { const t = String(vals[k]), col = k === 2 ? C.ok : k === 3 && yr.failed ? C.bad : C.tx; if (c.a === 'right') d.text(t, { x: c.r - 6, y, size: 9, font: 'bold', color: col }); else ctr(d, t, c.c, y, { size: 9, font: k === 6 ? 'bold' : 'regular', color: col }); });
    y -= 15;
  });
  d.fill('#F3EAD2'); d.rect(left, y - 4, right - left, 17);
  const tot = ['الإجمالي', v.summary.courses, v.summary.passed, v.summary.failed, v.summary.pending || '—', `${v.summary.earned}/${v.summary.hours}`, `${f1(v.summary.avg)}`];
  sc.forEach((c, k) => { const t = String(tot[k]); if (c.a === 'right') d.text(t, { x: c.r - 6, y, size: 9.5, font: 'bold', color: C.gd }); else ctr(d, t, c.c, y, { size: 9.5, font: 'bold', color: C.gd }); });
  y -= 24;
  // التقدير العام
  ensure(40); d.fill(C.g); d.rect(left, y - 8, right - left, 26); d.text('التقدير العام', { x: right - 10, y: y, size: 10, color: C.au2 }); d.text(`${v.summary.rating} — المعدل التراكمي ${f1(v.summary.avg)} من 100`, { x: right - 90, y, size: 12.5, font: 'bold', color: C.white });
  y -= 38;

  /* ---------- التحقق والتوقيع ---------- */
  ensure(150);
  const by = y - 120;
  d.stroke(C.au); d.line(left, y + 4, right, y + 4, 1);
  d.qr(ctx.qr, left, by + 4, 100); d.text('امسح الرمز للتحقق', { x: left + 50, y: by - 6, size: 8, color: C.mu, align: 'center' });
  const kv = (k, val, yy, o = {}) => { d.text(k, { x: right, y: yy, size: 9, color: C.mu }); d.text(val, { x: right - 120, y: yy, size: o.size ?? 10.5, font: o.font ?? 'bold' }); };
  kv('رمز التحقق', doc.code, y - 14, { size: 13 }); kv('رقم الطلب', p.requestNo, y - 32); kv('وقت الإصدار والتوقيع', utc(ctx.signedAt), y - 50, { size: 10 });
  kv('بصمة المحتوى', doc.hash.slice(0, 32), y - 68, { size: 8.5, font: 'regular' }); d.text(doc.hash.slice(32), { x: right - 120, y: y - 79, size: 8.5 });
  kv('الموقِّع (X.509)', ctx.signer, y - 96, { size: 9.5 }); kv('رابط التحقق', ctx.url, y - 112, { size: 7.5, font: 'regular' });
  y = by - 14; ctr(d, 'وثيقة إلكترونية موقَّعة رقمياً (PDF/A-2b، توقيع CMS). أي تعديل على الملف يُبطل توقيعه. الحدّ الأدنى للنجاح 60 من 100، والمقررات المعادة تُحتسب بأحدث علامة.', W / 2, Math.max(y, 40), { size: 7.5, color: C.mu });
}
