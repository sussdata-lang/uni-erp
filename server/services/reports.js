// بناء ملفات التصدير من نفس جداول لوحة الإحصاءات.
import { writeXlsx } from '../lib/xlsx.js';
import { writeDocx } from '../lib/docx.js';
import { HttpError } from '../http.js';
import { analytics, filterOptions } from './analytics.js';

const fmtKpi = (k) => (k.value === null || k.value === undefined ? '—' : `${k.value}${k.unit ? ` ${k.unit}` : ''}`);
function filterText(db, a) {
  const o = filterOptions(db), parts = [];
  if (a.filter.faculty) parts.push(`الجهة: ${o.faculties.find((f) => f.id === a.filter.faculty)?.name ?? a.filter.faculty}`);
  if (a.filter.year) parts.push(`سنة القيد: ${a.filter.year}`);
  return parts.length ? parts.join(' — ') : 'بلا مرشحات (كل البيانات)';
}
const stamp = (a) => new Date(a.generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// تقرير Excel: ورقة ملخص + ورقة لكل جدول
export function buildReportXlsx(db, query) {
  const a = analytics(db, query);
  const sheets = [{ name: 'ملخص', rows: [['المؤشر', 'القيمة', 'ملاحظة'], ...a.kpis.map((k) => [k.label, k.value ?? '', k.hint ?? k.unit ?? '']), [], ['المرشحات', filterText(db, a)], ['وقت الإنشاء', stamp(a)]], widths: [34, 18, 36] }];
  const used = new Set(['ملخص']);
  a.tables.forEach((t, i) => {
    let name = t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28); if (used.has(name)) name = `${name.slice(0, 25)} ${i}`; used.add(name);
    sheets.push({ name, rows: [t.headers, ...t.rows], widths: [34, ...t.headers.slice(1).map(() => 18)] });
  });
  return writeXlsx(sheets, { title: 'تقرير الإحصاءات' });
}

// تقرير Word: الصور (JPEG) تُرسَل من المتصفح، والأرقام تُحسب هنا من القاعدة (لا يُوثَق برقم من العميل)
export function buildReportDocx(db, body) {
  const a = analytics(db, body ?? {}), imgs = new Map();
  for (const c of Array.isArray(body?.charts) ? body.charts.slice(0, 30) : []) {
    const buf = Buffer.from(String(c?.jpeg ?? ''), 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'صورة مخطط كبيرة.', 'too_large');
    if (buf[0] === 0xff && buf[1] === 0xd8) imgs.set(String(c.id), buf);
  }
  const blocks = [{ t: 'title', text: 'تقرير الإحصاءات' }, { t: 'note', text: 'الجامعة السورية للعلوم الأمنية — بوابة خدمات الطلاب' }, { t: 'note', text: `${filterText(db, a)} · ${stamp(a)}` },
    { t: 'h1', text: 'المؤشرات الرئيسية' }, { t: 'table', headers: ['المؤشر', 'القيمة'], rows: a.kpis.map((k) => [k.label, fmtKpi(k)]) }];
  for (const t of a.tables) {
    blocks.push({ t: 'h1', text: t.title });
    if (imgs.has(t.id)) blocks.push({ t: 'image', data: imgs.get(t.id), alt: t.title });
    blocks.push({ t: 'table', headers: t.headers, rows: t.rows.length ? t.rows : [['لا بيانات', ...t.headers.slice(1).map(() => '—')]] });
  }
  return writeDocx(blocks, { title: 'تقرير الإحصاءات' });
}
