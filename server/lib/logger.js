// مسجِّل بسيط غير حظري: سطر JSON لكل حدث في ملف يومي (WriteStream: الكتابة في الخلفية)، وذاكرة حلقية للأحداث الأخيرة تُقرأ من واجهة المدير.
// مستويات: error < warn < info. لا يرمي أبداً، ولا يسجّل أجسام الطلبات ولا كلمات المرور (يُمرَّر له الوصف والبيانات الوصفية الصغيرة فقط).
import fs from 'node:fs';
import path from 'node:path';

const LV = { error: 0, warn: 1, info: 2 }, RING = 300, KEEP_DAYS = 14;
const ring = [];
let dir = null, min = LV.info, stream = null, day = '';

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
function clean(m) {
  if (m instanceof Error) return { name: m.name, message: clip(m.message, 300), stack: clip(m.stack || '', 1500) };
  if (m === undefined || m === null) return undefined;
  if (typeof m !== 'object') return { detail: clip(m, 1500) };
  try { return JSON.parse(clip(JSON.stringify(m), 1500).replace(/…$/, '') || '{}'); } catch { return { detail: '[غير قابل للتسلسل]' }; }
}
function open() {
  const today = new Date().toISOString().slice(0, 10);
  if (stream && day === today) return stream;
  if (stream) stream.end();
  day = today;
  stream = fs.createWriteStream(path.join(dir, `app-${today}.log`), { flags: 'a' });
  stream.on('error', () => { stream = null; dir = null; });                       // فشل القرص يعطّل الملف فقط، لا التطبيق
  for (const f of fs.readdirSync(dir)) {                                           // تدوير: حذف ما تجاوز 14 يوماً عند تبدّل اليوم
    const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
    if (m && Date.now() - Date.parse(m[1]) > KEEP_DAYS * 864e5) fs.unlink(path.join(dir, f), () => {});
  }
  return stream;
}
function emit(level, msg, meta) {
  try {
    if (LV[level] > min) return;
    const rec = { t: Date.now(), level, msg: clip(msg, 500) }, c = clean(meta);
    if (c) rec.meta = c;
    ring.push(rec); if (ring.length > RING) ring.shift();
    if (dir) open().write(JSON.stringify(rec) + '\n');
    if (level !== 'info') (level === 'error' ? console.error : console.warn)(`[${level}] ${rec.msg}`, c && (c.stack || c.detail) || '');
  } catch { /* التسجيل لا يُسقط التطبيق */ }
}

export const log = { error: (m, x) => emit('error', m, x), warn: (m, x) => emit('warn', m, x), info: (m, x) => emit('info', m, x) };

export function configureLogger({ dir: d = null, level = 'info' } = {}) {
  if (stream) { stream.end(); stream = null; }
  min = LV[level] ?? LV.info; dir = d; day = '';
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch { dir = null; } }
}
export const recentLogs = ({ level = '', limit = 100 } = {}) =>
  ring.filter((r) => !(level in LV) || r.level === level).slice(-Math.min(Math.max(Number(limit) || 100, 1), RING)).reverse();
export const closeLogger = () => new Promise((res) => { if (!stream) return res(); const s = stream; stream = null; s.end(res); });
