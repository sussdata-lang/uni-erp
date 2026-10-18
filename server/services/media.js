// وسائط الأخبار: رفع مباشر (صور/فيديو، يُتحقق من نوعها من البايتات لا من الامتداد) أو رابط.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const LIMITS = { image: 5 * 1024 * 1024, video: 50 * 1024 * 1024, perNews: 8 };
const bad = (m) => new HttpError(400, m, 'validation');

// نوع الملف من توقيعه (magic bytes). لا SVG عمداً: قد يحمل سكربتاً.
export function sniff(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (b.length > 12 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (b.length > 16 && b.subarray(4, 8).toString('latin1') === 'ftyp') return { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  if (b.length > 16 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  return null;
}

// تصنيف الرابط: يوتيوب/فيميو (تضمين)، صورة مباشرة، فيديو مباشر. https فقط.
export function classifyUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { throw bad('الرابط غير صالح.'); }
  if (u.protocol !== 'https:') throw bad('الروابط المقبولة https فقط.');
  if (u.username || u.password || !u.hostname.includes('.') || /^\d+(\.\d+){3}$/.test(u.hostname) || u.href.length > 500) throw bad('الرابط غير مقبول.');
  const h = u.hostname.replace(/^www\.|^m\./, ''); let m;
  if (h === 'youtu.be' && (m = /^\/([\w-]{11})/.exec(u.pathname))) return { kind: 'video', source: 'embed', provider: 'youtube', ref: m[1] };
  if ((h === 'youtube.com' || h === 'youtube-nocookie.com') && (m = u.searchParams.get('v')?.match(/^[\w-]{11}$/) ?? /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname)))
    return { kind: 'video', source: 'embed', provider: 'youtube', ref: Array.isArray(m) && m[1] ? m[1] : m[0] };
  if ((h === 'vimeo.com' || h === 'player.vimeo.com') && (m = /\/(\d{6,12})(?:\/|$)/.exec(u.pathname))) return { kind: 'video', source: 'embed', provider: 'vimeo', ref: m[1] };
  const ext = path.extname(u.pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext)) return { kind: 'image', source: 'url', url: u.href };
  if (['.mp4', '.webm', '.ogv'].includes(ext)) return { kind: 'video', source: 'url', url: u.href };
  throw bad('رابط غير مدعوم: ضع رابط صورة مباشرة (jpg/png/webp/gif) أو فيديو مباشراً (mp4/webm) أو رابط يوتيوب/فيميو.');
}

const dirOf = (cfg) => path.join(cfg.uploadDir, 'news');
const caption = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); if (s.length > 200 || /[<>]/.test(s)) throw bad('التعليق حتى 200 حرف بلا رموز غير مسموحة.'); return s || null; };

export function mediaView(m) {
  const base = { id: m.id, kind: m.kind, source: m.source, caption: m.caption };
  if (m.source === 'upload') return { ...base, src: `/api/media/${m.id}`, mime: m.mime };
  if (m.source === 'url') return { ...base, src: m.url };
  return { ...base, provider: m.provider, src: m.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${m.ref}` : `https://player.vimeo.com/video/${m.ref}` };
}
export const mediaFor = (db, newsIds) => {
  if (!newsIds.length) return new Map();
  const map = new Map();
  for (const m of db.prepare(`SELECT * FROM news_media WHERE news_id IN (${newsIds.map(() => '?').join(',')}) ORDER BY id`).all(...newsIds)) (map.get(m.news_id) ?? map.set(m.news_id, []).get(m.news_id)).push(mediaView(m));
  return map;
};

function guard(db, newsId) {
  const n = db.prepare('SELECT id, title FROM news WHERE id = ?').get(Number(newsId));
  if (!n) throw new HttpError(404, 'الخبر غير موجود.', 'not_found');
  if (db.prepare('SELECT COUNT(*) c FROM news_media WHERE news_id = ?').get(n.id).c >= LIMITS.perNews) throw bad(`الحد الأقصى ${LIMITS.perNews} وسائط للخبر الواحد.`);
  return n;
}

export function addUpload({ db, cfg }, actor, newsId, buf, cap, ip) {
  const n = guard(db, newsId), t = sniff(buf);
  if (!t) throw bad('نوع الملف غير مدعوم: الصور jpg/png/webp/gif والفيديو mp4/webm فقط.');
  if (buf.length > LIMITS[t.kind]) throw new HttpError(413, `حجم ${t.kind === 'image' ? 'الصورة' : 'الفيديو'} يتجاوز ${LIMITS[t.kind] / 1048576} ميغابايت.`, 'too_large');
  fs.mkdirSync(dirOf(cfg), { recursive: true });
  const file = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(dirOf(cfg), file), buf);
  const id = Number(db.prepare('INSERT INTO news_media (news_id, kind, source, file, mime, size, caption, created_at) VALUES (?,?,?,?,?,?,?,?)').run(n.id, t.kind, 'upload', file, t.mime, buf.length, caption(cap), Date.now()).lastInsertRowid);
  audit(db, actor, `إرفاق ${t.kind === 'image' ? 'صورة' : 'فيديو'} بخبر`, n.title.slice(0, 80), ip);
  return { id, kind: t.kind };
}

export function addLink({ db }, actor, newsId, url, cap, ip) {
  const n = guard(db, newsId), c = classifyUrl(url);
  const id = Number(db.prepare('INSERT INTO news_media (news_id, kind, source, url, provider, ref, caption, created_at) VALUES (?,?,?,?,?,?,?,?)').run(n.id, c.kind, c.source, c.url ?? null, c.provider ?? null, c.ref ?? null, caption(cap), Date.now()).lastInsertRowid);
  audit(db, actor, `إرفاق رابط ${c.kind === 'image' ? 'صورة' : 'فيديو'} بخبر`, n.title.slice(0, 80), ip);
  return { id, kind: c.kind };
}

export function removeFiles(db, cfg, newsIdOrNull, mediaId = null) {   // يحذف ملفات الوسائط المرفوعة (قبل حذف الصفوف)
  const rows = mediaId ? db.prepare("SELECT file FROM news_media WHERE id = ? AND source = 'upload'").all(mediaId) : db.prepare("SELECT file FROM news_media WHERE news_id = ? AND source = 'upload'").all(newsIdOrNull);
  for (const r of rows) try { fs.unlinkSync(path.join(dirOf(cfg), r.file)); } catch { /* غير موجود */ }
}
export function deleteMedia({ db, cfg }, actor, id, ip) {
  const m = db.prepare('SELECT m.id, n.title FROM news_media m JOIN news n ON n.id = m.news_id WHERE m.id = ?').get(Number(id));
  if (!m) throw new HttpError(404, 'الوسيط غير موجود.', 'not_found');
  removeFiles(db, cfg, null, m.id); db.prepare('DELETE FROM news_media WHERE id = ?').run(m.id);
  audit(db, actor, 'حذف وسيط من خبر', m.title.slice(0, 80), ip);
}

// بثّ ملف مرفوع مع دعم Range (ضروري لتقديم/تأخير الفيديو)
export function streamMedia({ db, cfg }, req, res, id, headers) {
  const m = db.prepare("SELECT * FROM news_media WHERE id = ? AND source = 'upload'").get(Number(id));
  const file = m && path.join(dirOf(cfg), m.file);
  if (!m || !fs.existsSync(file)) throw new HttpError(404, 'غير موجود.', 'not_found');
  const size = fs.statSync(file).size, h = { 'Content-Type': m.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline', ...headers };
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (r && (r[1] || r[2])) {
    let a = r[1] ? Number(r[1]) : size - Number(r[2]), b = r[1] && r[2] ? Number(r[2]) : size - 1; b = Math.min(b, size - 1);
    if (a < 0 || a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...headers }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
    return fs.createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { ...h, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}
