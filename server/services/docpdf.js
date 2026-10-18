// وثيقة الطلب المعتمدة (إفادة دوام، كشف علامات، …) كملف PDF/A-2b موقَّع رقمياً (CMS/X.509، SHA-256) برمز QR إلى بوابة التحقق.
// يُولَّد الملف عند أول طلب ويُحفظ، فيكون للوثيقة ملف واحد ثابت يعاد تقديمه في كل تنزيل، وتُسجَّل بصمته ليُتحقَّق منه بفحص الملف نفسه.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from './documents.js';
import { makeQr } from '../qr.js';
import { buildPdf, prepareSigning, textWidth } from '../lib/pdf.js';
import { signDetached, sha256 } from './pki.js';
import { identityOf, publicBase } from './enrollcert.js';
import { paintTranscript } from './transcriptpdf.js';
import { getTranscriptTemplate, TRANSCRIPT_TEMPLATES } from './site.js';

const G = '#054239', GOLD = '#C9A24B', MUTE = '#566660', R = 545, L = 50;
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

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

// نص الوثيقة بحسب نوع الخدمة (مطابق لما تعرضه الواجهة)
function paragraphs(p) {
  const st = p.student, who = `${st.name} (الرقم الجامعي ${st.studentNo})`;
  switch (p.service.code) {
    case 'attendance': return [`تشهد ${p.university} بأن الطالب/ـة ${who} مقيَّد/ـة في برنامج "${st.program}"، وهو/هي على رأس دراسته/ا حتى تاريخ إصدار هذه الإفادة.`, `أُعطيت هذه الإفادة بناءً على طلبه/ا لتقديمها إلى: ${p.details.purpose}.`];
    case 'excellence_year': return [`تشهد ${p.university} بأنه تقرر قبول تسجيل الطالب/ـة ${who}، المقيَّد/ـة في برنامج "${st.program}"، في سنة الامتياز للعام الدراسي ${p.details.academic_year}.`, ...(p.details.notes ? [`ملاحظات: ${p.details.notes}`] : [])];
    case 'excuse': return [`بعد مراجعة المرفقات والتحقق من استيفائها للمدة النظامية، تقرر قبول العذر المقدَّم من الطالب/ـة ${who} عن امتحان مقرر "${p.details.course}" بتاريخ ${p.details.exam_date} (السبب: ${p.details.reason})، وتحديد موعد امتحان بديل.`];
    default: return [`وثيقة صادرة عن قسم شؤون الطلاب للطالب/ـة ${who}.`];
  }
}

function transcriptTable(d, p, top, bottom) {
  const gr = p.transcript.grades, MAX = 90, shown = gr.slice(0, MAX);
  const cols = shown.length > 50 ? 3 : shown.length > 24 ? 2 : 1;
  const rowH = shown.length > 50 ? Math.max(9.5, Math.min(12, (top - bottom - 30) / Math.ceil(shown.length / 3))) : 14, size = cols === 3 ? 8 : cols === 2 ? 9 : 10;
  const per = Math.ceil(shown.length / cols), gap = 14, colW = (R - L - gap * (cols - 1)) / cols;
  for (let c = 0; c < cols; c++) {
    const right = R - c * (colW + gap), left = right - colW;
    d.fill(G); d.rect(left, top - 4, colW, 18);
    d.text('المقرر', { x: right - 6, y: top, size, font: 'bold', color: '#FFFFFF' });
    d.text('العلامة', { x: left + 6 + textWidth('العلامة', 'bold', size) , y: top, size, font: 'bold', color: '#FFFFFF', align: 'right' });
    if (cols === 1) d.text('الساعات', { x: left + 90, y: top, size, font: 'bold', color: '#FFFFFF', align: 'right' }), d.text('الفصل', { x: right - 280, y: top, size, font: 'bold', color: '#FFFFFF' });
    shown.slice(c * per, (c + 1) * per).forEach((g, i) => {
      const y = top - 20 - (i + 1) * rowH + rowH - 4;
      if (i % 2 === 0) { d.fill('#F2F5F2'); d.rect(left, y - 4, colW, rowH); }
      const nameW = cols === 1 ? 250 : colW - 62;
      d.text(fit(g.course, 'regular', size, nameW), { x: right - 6, y, size });
      d.text(String(g.mark), { x: left + 38, y, size, font: 'bold', align: 'right' });
      if (cols === 1) { d.text(String(g.hours), { x: left + 100, y, size, align: 'right' }); d.text(fit(g.term, 'regular', size, 150), { x: right - 280, y, size }); }
    });
  }
  const endY = top - 20 - per * rowH - 8;
  d.text(`المعدل المرجَّح: ${p.transcript.average ?? '-'} من 100${gr.length > MAX ? ` — عُرض أول ${MAX} مقرراً من ${gr.length}` : ''}`, { x: R, y: endY - 8, size: 11, font: 'bold', color: G });
}

function paint(d, doc, url, qr, ident, signedAt) {
  const p = doc.payload, cn = ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? ident.leaf.subject;
  d.fill(G); d.rect(0, 742, 595.28, 100); d.fill(GOLD); d.rect(0, 738, 595.28, 4);
  d.image(478, 752, 68, 82);
  d.text(p.university, { x: 465, y: 800, size: 21, font: 'bold', color: '#FFFFFF' });
  d.text('وزارة الداخلية — قسم شؤون الطلاب', { x: 465, y: 774, size: 12, color: '#E6CB84' });
  d.text(p.service.label, { x: 297.6, y: 700, size: 24, font: 'bold', color: G, align: 'center' });
  d.stroke(GOLD); d.line(190, 688, 405, 688, 1.5);
  const rows = [['اسم الطالب', p.student.name], ['الرقم الجامعي', p.student.studentNo], ['البرنامج', p.student.program], ['رقم الطلب', p.requestNo], ['تاريخ الإصدار', utc(p.issuedAt)]];
  let y = 660;
  rows.forEach(([k, v], i) => { if (i % 2 === 0) { d.fill('#F2F5F2'); d.rect(L - 10, y - 8, R - L + 20, 24); } d.text(k, { x: R, y, size: 11, color: MUTE }); d.text(fit(v, 'bold', 12.5, 360), { x: 400, y, size: 12.5, font: 'bold' }); y -= 24; });
  const top = y - 18, bottom = 196;
  if (p.service.code === 'transcript') transcriptTable(d, p, top, bottom);
  else { let yy = top; for (const para of paragraphs(p)) { for (const line of wrap(para, 'regular', 13, R - L)) { d.text(line, { x: R, y: yy, size: 13 }); yy -= 23; } yy -= 8; } }
  // كتلة التحقق والتوقيع
  d.fill(G); d.rect(L - 10, 168, R - L + 20, 22); d.text('التحقق والتوقيع الرقمي', { x: R, y: 174, size: 12, font: 'bold', color: '#FFFFFF' });
  d.qr(qr, L - 6, 52, 104); d.text('امسح الرمز للتحقق', { x: L + 46, y: 40, size: 8.5, color: MUTE, align: 'center' });
  const kv = (k, v, yy, o = {}) => { d.text(k, { x: R, y: yy, size: 9.5, color: MUTE }); d.text(v, { x: R - 128, y: yy, size: o.size ?? 11, font: o.font ?? 'bold' }); };
  kv('رمز التحقق', doc.code, 148, { size: 13 });
  kv('بصمة المحتوى', doc.hash.slice(0, 32), 128, { size: 8.5, font: 'regular' }); d.text(doc.hash.slice(32), { x: R - 128, y: 117, size: 8.5 });
  kv('وقت الإصدار والتوقيع', utc(signedAt), 98, { size: 10.5 });
  kv('الموقِّع (X.509)', cn, 78, { size: 10 });
  kv('رابط التحقق', url, 58, { size: 8, font: 'regular' });
  d.stroke(GOLD); d.line(L - 10, 34, R + 10, 34, 1);
  d.text('وثيقة إلكترونية موقَّعة رقمياً (PDF/A-2b، توقيع CMS). أي تعديل على الملف يُبطل توقيعه. للتحقق أدخل رمز التحقق أو افحص بصمة الملف في بوابة التحقق.', { x: R + 10, y: 20, size: 7.5, color: MUTE });
}

// يُنشئ ملف PDF الوثيقة. getDocument يتحقق من حق الوصول (الطالب صاحب الطلب أو موظف بصلاحية قراءة الوثائق).
// كشف العلامات يُرسم بالنموذج المطلوب (وإلا النموذج الافتراضي المعتمد)، ولكل نموذج ملف محفوظ مستقل.
export function documentPdf(deps, user, rawCode, template) {
  const { db, cfg } = deps, doc = getDocument(deps, user, rawCode), created = new Date(doc.issuedAt);
  const isTr = doc.payload.service.code === 'transcript', tpl = isTr ? (TRANSCRIPT_TEMPLATES.includes(template) ? template : getTranscriptTemplate(db)) : null;
  const dir = path.join(cfg.uploadDir, 'docs'), file = path.join(dir, `${doc.code}${tpl ? '.' + tpl + '.v2' : ''}.pdf`);
  try { return { pdf: fs.readFileSync(file), filename: `${doc.code}${tpl ? '-' + tpl : ''}.pdf` }; } catch { /* لم يُنشأ بعد */ }
  const ident = identityOf(cfg), url = `${publicBase(cfg)}/?verify=${doc.code}`, qr = makeQr(url);
  const raw = buildPdf({ family: tpl ? (tpl === 'academic' || tpl === 'royal' ? 'amiri' : 'cairo') : 'dejavu', title: `${doc.payload.service.label} — ${doc.payload.student.name}`, author: doc.payload.university, subject: `${doc.payload.service.label} — ${doc.payload.requestNo}`, producer: 'الجامعة السورية للعلوم الأمنية', created,
    signer: { name: ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? 'signer', reason: 'Approved student document', location: 'SY' } }, (d) => (tpl ? paintTranscript(d, doc, tpl, { url, qr, signedAt: created, signer: ident.leaf.subject.match(/CN=([^,]+)/)?.[1] ?? ident.leaf.subject }) : paint(d, doc, url, qr, ident, created)));
  const prep = prepareSigning(raw), { cms } = signDetached(ident, prep.digest, { signingTime: created }), pdf = prep.finish(cms);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, pdf);
  db.prepare('INSERT OR IGNORE INTO document_pdfs (pdf_sha256, code, created_at) VALUES (?, ?, ?)').run(sha256(pdf).toString('hex'), doc.code, Date.now());
  return { pdf, filename: `${doc.code}${tpl ? '-' + tpl : ''}.pdf` };
}
