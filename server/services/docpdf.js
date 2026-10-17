// وثيقة الطلب المعتمدة (إفادة دوام، كشف علامات، طلبات أكاديمية…) كملف PDF/A-2b موقَّع رقمياً (CMS/X.509، SHA-256) برمز QR إلى بوابة التحقق.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from './documents.js';
import { makeQr } from '../qr.js';
import { buildPdf, prepareSigning, textWidth } from '../lib/pdf.js';
import { signDetached, sha256 } from './pki.js';
import { identityOf, publicBase } from './enrollcert.js';

const G = '#054239', GOLD = '#C9A24B', MUTE = '#566660', R = 545, L = 50;
const THEMES = {
  classic: { headerBg: '#054239', accent: '#C9A24B', rowAlt: '#F2F5F2', border: true },
  modern: { headerBg: '#0A5A4D', accent: '#E6CB84', rowAlt: '#EAF4F0', border: false },
  academic: { headerBg: '#032E28', accent: '#054239', rowAlt: '#F6F8F5', border: true },
  royal: { headerBg: '#10211D', accent: '#C9A24B', rowAlt: '#FAF6EB', border: true },
};
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const ratingLabel = (m) => (m === null || m === undefined ? '—' : m >= 90 ? 'ممتاز (مرتبة الشرف)' : m >= 80 ? 'جيد جداً' : m >= 70 ? 'جيد' : m >= 60 ? 'مقبول' : 'راسب');

function wrap(str, font, size, maxW) {
  const words = String(str ?? '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (cur && textWidth(t, font, size) > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function fit(str, font, size, maxW) {
  let s = String(str ?? ''); if (textWidth(s, font, size) <= maxW) return s;
  while (s.length > 1 && textWidth(`${s}…`, font, size) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function paragraphs(p) {
  const st = p.student, who = `${st.name} (الرقم الجامعي ${st.studentNo})`;
  switch (p.service.code) {
    case 'attendance': return [`تشهد ${p.university} بأن الطالب/ـة ${who} مقيَّد/ـة في برنامج "${st.program}"، وهو/هي على رأس دراسته/ا حتى تاريخ إصدار هذه الإفادة.`, `أُعطيت هذه الإفادة بناءً على طلبه/ا لتقديمها إلى: ${p.details.purpose}.`];
    case 'excellence_year': return [`تشهد ${p.university} بأنه تقرر قبول تسجيل الطالب/ـة ${who}، المقيَّد/ـة في برنامج "${st.program}"، في سنة الامتياز للعام الدراسي ${p.details.academic_year}.`, ...(p.details.notes ? [`ملاحظات: ${p.details.notes}`] : [])];
    case 'excuse': return [`بعد مراجعة المرفقات والتحقق من استيفائها للمدة النظامية، تقرر قبول العذر المقدَّم من الطالب/ـة ${who} عن امتحان مقرر "${p.details.course}" بتاريخ ${p.details.exam_date} (السبب: ${p.details.reason})، وتحديد موعد امتحان بديل.`];
    case 'postponement': return [`تشهد ${p.university} بالموافقة على طلب التأجيل الدراسي المقدَّم من الطالب/ـة ${who}، المقيَّد/ـة في برنامج "${st.program}"، وذلك لمدة (${p.details.duration || 'فصل دراسي'}) للأسباب المبيَّنة في الطلب.`];
    case 'withdrawal': return [`تشهد ${p.university} بإتمام إجراءات براءة الذمة والموافقة على طلب الانسحاب وترقين القيد المقدَّم من الطالب/ـة ${who} من برنامج "${st.program}".`];
    case 'program_transfer': return [`تشهد ${p.university} بالموافقة على تحويل قيد الطالب/ـة ${who} من برنامج "${st.program}" إلى البرنامج المطلوب (${p.details.target_program || ''}) وفق قواعد التحويل المعتمدة.`];
    case 'grade_appeal': return [`تشهد ${p.university} بأنه تمت مراجعة وتدقيق ورقة الإجابة لمقرر "${p.details.course || ''}" بناءً على طلب التظلّم المقدَّم من الطالب/ـة ${who}، واعتماد النتيجة النهائية.`];
    default: return [`وثيقة رسمية صادرة عن قسم شؤون الطلاب للطالب/ـة ${who}.`];
  }
}

function transcriptTable(d, p, top, bottom, theme) {
  const tr = p.transcript || { grades: [] }, gr = (tr.grades || []).filter((g) => !g.previous), MAX = 90, shown = gr.slice(0, MAX);
  const sm = tr.summary || {};
  const avg = tr.average ?? null, rate = ratingLabel(avg);
  const rankTxt = tr.cohortRank ? `${tr.cohortRank} من ${tr.cohortTotal || tr.cohortRank}` : '—';

  // شريط "ملخص المواد" العلوي + الترتيب في الدفعة + التقدير
  d.fill(theme.rowAlt); d.rect(L - 10, top - 16, R - L + 20, 22);
  d.text(`ملخص المواد: ${sm.courses ?? shown.length} مقرر (ناجح: ${sm.passed ?? 0} | راسب: ${sm.failed ?? 0}) — الساعات: ${sm.earnedHours ?? 0}/${sm.hours ?? 0} — الترتيب في الدفعة: ${rankTxt}`, { x: R, y: top - 10, size: 9.5, font: 'bold', color: theme.headerBg });
  top -= 26;

  // التنبيه التلقائي للإنذار الأكاديمي إن وجد
  if (tr.warning) {
    d.fill('#FBEBD0'); d.rect(L - 10, top - 14, R - L + 20, 18);
    d.text(`تنبيه أكاديمي (${tr.warning.label}): ${fit(tr.warning.text, 'regular', 8.5, R - L - 90)}`, { x: R, y: top - 9, size: 8.5, font: 'bold', color: '#9A5600' });
    top -= 22;
  }

  const cols = themeId(theme) === 'academic' ? 2 : (shown.length > 50 ? 3 : shown.length > 24 ? 2 : 1);
  const rowH = shown.length > 50 ? Math.max(9.5, Math.min(12, (top - bottom - 30) / Math.ceil(shown.length / cols))) : 13.5, size = cols === 3 ? 8 : cols === 2 ? 8.8 : 9.8;
  const per = Math.max(1, Math.ceil(shown.length / cols)), gap = 14, colW = (R - L - gap * (cols - 1)) / cols;
  for (let c = 0; c < cols; c++) {
    const right = R - c * (colW + gap), left = right - colW;
    d.fill(theme.headerBg); d.rect(left, top - 4, colW, 18);
    d.text('المقرر', { x: right - 6, y: top, size, font: 'bold', color: '#FFFFFF' });
    d.text('العلامة', { x: left + 6 + textWidth('العلامة', 'bold', size), y: top, size, font: 'bold', color: '#FFFFFF', align: 'right' });
    if (cols === 1) {
      d.text('الساعات', { x: left + 90, y: top, size, font: 'bold', color: '#FFFFFF', align: 'right' });
      d.text('السنة / الفصل', { x: right - 280, y: top, size, font: 'bold', color: '#FFFFFF' });
    }
    shown.slice(c * per, (c + 1) * per).forEach((g, i) => {
      const y = top - 20 - (i + 1) * rowH + rowH - 4;
      if (i % 2 === 0) { d.fill(theme.rowAlt); d.rect(left, y - 4, colW, rowH); }
      const nameW = cols === 1 ? 250 : colW - 62;
      d.text(fit(g.course, 'regular', size, nameW), { x: right - 6, y, size });
      d.text(String(g.mark), { x: left + 38, y, size, font: 'bold', align: 'right' });
      if (cols === 1) {
        d.text(String(g.hours), { x: left + 100, y, size, align: 'right' });
        const termLbl = g.level ? `السنة ${g.level} - ف${g.semester || 1}` : (g.term || 'ملخص المواد');
        d.text(fit(termLbl, 'regular', size, 150), { x: right - 280, y, size });
      }
    });
  }
  const endY = Math.max(bottom + 8, top - 20 - per * rowH - 8);
  d.text(`المعدل التراكمي المرجَّح: ${avg ?? '-'}% — التقدير العام: ${rate} — الترتيب: ${rankTxt}`, { x: R, y: endY - 4, size: 10.5, font: 'bold', color: theme.headerBg });
}
const themeId = (th) => Object.keys(THEMES).find((k) => THEMES[k] === th) || 'classic';

function paint(d, doc, url, qr, ident, signedAt, tplKey) {
  const theme = THEMES[tplKey] || THEMES.classic;
  const p = doc.payload, cn = ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? ident.leaf.subject;
  if (theme.border) { d.stroke(theme.accent); d.line(25, 25, 570, 25, 1); d.line(25, 817, 570, 817, 1); }
  d.fill(theme.headerBg); d.rect(0, 742, 595.28, 100); d.fill(theme.accent); d.rect(0, 738, 595.28, 4);
  d.image(478, 752, 68, 82);
  d.text(p.university, { x: 465, y: 800, size: 21, font: 'bold', color: '#FFFFFF' });
  d.text(`وزارة الداخلية — ${p.student.faculty || 'قسم شؤون الطلاب'}`, { x: 465, y: 774, size: 12, color: '#E6CB84' });
  d.text(p.service.label, { x: 297.6, y: 700, size: 22, font: 'bold', color: theme.headerBg, align: 'center' });
  d.stroke(theme.accent); d.line(190, 688, 405, 688, 1.5);
  const rows = [['اسم الطالب', p.student.name], ['الرقم الجامعي', p.student.studentNo], ['البرنامج', p.student.program], ['رقم الطلب', p.requestNo], ['تاريخ الإصدار', utc(p.issuedAt)]];
  let y = 662;
  rows.forEach(([k, v], i) => { if (i % 2 === 0) { d.fill(theme.rowAlt); d.rect(L - 10, y - 8, R - L + 20, 22); } d.text(k, { x: R, y, size: 10.5, color: MUTE }); d.text(fit(v, 'bold', 12, 360), { x: 400, y, size: 12, font: 'bold' }); y -= 22; });
  const top = y - 12, bottom = 196;
  if (p.service.code === 'transcript') transcriptTable(d, p, top, bottom, theme);
  else { let yy = top; for (const para of paragraphs(p)) { for (const line of wrap(para, 'regular', 13, R - L)) { d.text(line, { x: R, y: yy, size: 13 }); yy -= 23; } yy -= 8; } }
  // كتلة التحقق والتوقيع
  d.fill(theme.headerBg); d.rect(L - 10, 168, R - L + 20, 22); d.text('التحقق والتوقيع الرقمي', { x: R, y: 174, size: 12, font: 'bold', color: '#FFFFFF' });
  d.qr(qr, L - 6, 52, 104); d.text('امسح الرمز للتحقق', { x: L + 46, y: 40, size: 8.5, color: MUTE, align: 'center' });
  const kv = (k, v, yy, o = {}) => { d.text(k, { x: R, y: yy, size: 9.5, color: MUTE }); d.text(v, { x: R - 128, y: yy, size: o.size ?? 11, font: o.font ?? 'bold' }); };
  kv('رمز التحقق', doc.code, 148, { size: 13 });
  kv('بصمة المحتوى', doc.hash.slice(0, 32), 128, { size: 8.5, font: 'regular' }); d.text(doc.hash.slice(32), { x: R - 128, y: 117, size: 8.5 });
  kv('وقت الإصدار والتوقيع', utc(signedAt), 98, { size: 10.5 });
  kv('الموقِّع (X.509)', cn, 78, { size: 10 });
  kv('رابط التحقق', url, 58, { size: 8, font: 'regular' });
  d.stroke(theme.accent); d.line(L - 10, 34, R + 10, 34, 1);
  d.text('وثيقة إلكترونية موقَّعة رقمياً (PDF/A-2b، توقيع CMS). أي تعديل على الملف يُبطل توقيعه. للتحقق أدخل رمز التحقق أو افحص بصمة الملف في بوابة التحقق.', { x: R + 10, y: 20, size: 7.5, color: MUTE });
}

export function documentPdf(deps, user, rawCode, query = {}) {
  const { db, cfg } = deps, doc = getDocument(deps, user, rawCode), created = new Date(doc.issuedAt);
  let tplKey = query?.template || doc.payload?.template || 'classic';
  if (!THEMES[tplKey]) tplKey = 'classic';
  const suffix = tplKey === 'classic' ? '' : `-${tplKey}`;
  const dir = path.join(cfg.uploadDir, 'docs'), file = path.join(dir, `${doc.code}${suffix}.pdf`);
  try { return { pdf: fs.readFileSync(file), filename: `${doc.code}${suffix}.pdf` }; } catch { /* لم يُنشأ بهذا القالب بعد */ }
  const ident = identityOf(cfg), url = `${publicBase(cfg)}/?verify=${doc.code}`, qr = makeQr(url);
  const raw = buildPdf({ title: `${doc.payload.service.label} — ${doc.payload.student.name}`, author: doc.payload.university, subject: `${doc.payload.service.label} — ${doc.payload.requestNo}`, producer: 'Uni ERP Core — SUSS', created,
    signer: { name: ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? 'signer', reason: 'Approved student document', location: 'SY' } }, (d) => paint(d, doc, url, qr, ident, created, tplKey));
  const prep = prepareSigning(raw), { cms } = signDetached(ident, prep.digest, { signingTime: created }), pdf = prep.finish(cms);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, pdf);
  db.prepare('INSERT OR IGNORE INTO document_pdfs (pdf_sha256, code, created_at) VALUES (?, ?, ?)').run(sha256(pdf).toString('hex'), doc.code, Date.now());
  return { pdf: pdf, filename: `${doc.code}${suffix}.pdf` };
}
