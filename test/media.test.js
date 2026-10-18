import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { classifyUrl, sniff } from '../server/services/media.js';

const PW = 'Test#Pass12345';
let app, base, staff, auditor, stu, dir;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2000, 3)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100, 4)]);
async function api(method, url, { body, cookie, raw, headers } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* */ }
  return { status: res.status, json, buf, headers: res.headers };
}
async function loginAs(u, p = PW) { app.limiter.hits.clear(); const r = await api('POST', '/api/auth/login', { body: { username: u, password: p } }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; }

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-media-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['staff', 'staff'], ['auditor', 'auditor'], ['stu', 'student']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  staff = await loginAs('staff'); auditor = await loginAs('auditor'); stu = await loginAs('stu');
});
test.after(async () => { await app.close(); });

test('الروابط: تصنيف يوتيوب وفيميو وصورة وفيديو مباشرين، ورفض غير https والمشبوه', () => {
  assert.deepEqual(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'video', source: 'embed', provider: 'youtube', ref: 'dQw4w9WgXcQ' });
  assert.equal(classifyUrl('https://youtu.be/dQw4w9WgXcQ?t=5').ref, 'dQw4w9WgXcQ');
  assert.equal(classifyUrl('https://m.youtube.com/shorts/dQw4w9WgXcQ').ref, 'dQw4w9WgXcQ');
  assert.deepEqual(classifyUrl('https://vimeo.com/123456789'), { kind: 'video', source: 'embed', provider: 'vimeo', ref: '123456789' });
  assert.equal(classifyUrl('https://cdn.example.com/a/b/photo.JPG?x=1').kind, 'image');
  assert.equal(classifyUrl('https://cdn.example.com/clip.mp4').kind, 'video');
  for (const bad of ['http://example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://user:pw@example.com/a.jpg', 'https://localhost/a.png', 'https://example.com/page.html', 'javascript:alert(1)', 'ftp://x.com/a.png', 'نص', 'https://youtube.com/watch?v=short'])
    assert.throws(() => classifyUrl(bad), /.+/, bad);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
});

test('نشر خبر بروابط: الصحيحة تُحفظ، وأي رابط فاسد يُلغي النشر كله', async () => {
  const before = app.db.prepare('SELECT COUNT(*) c FROM news').get().c;
  const badRes = await api('POST', '/api/news', { cookie: staff, body: { title: 'خبر فاسد', body: 'نص الخبر', links: ['https://youtu.be/dQw4w9WgXcQ', 'http://insecure.com/a.jpg'] } });
  assert.equal(badRes.status, 400); assert.equal(app.db.prepare('SELECT COUNT(*) c FROM news').get().c, before);
  const ok = await api('POST', '/api/news', { cookie: staff, body: { title: 'خبر بوسائط', body: 'نص الخبر', links: ['https://youtu.be/dQw4w9WgXcQ', 'https://cdn.example.com/p.png'] } });
  assert.equal(ok.status, 201, ok.buf.toString());
  const list = (await api('GET', '/api/news', { cookie: stu })).json.news.find((n) => n.id === ok.json.id);
  assert.deepEqual(list.media.map((m) => [m.kind, m.source]), [['video', 'embed'], ['image', 'url']]);
  assert.equal(list.media[0].src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});

test('الرفع المباشر: الصور والفيديو من البايتات، مع رفض الأنواع الأخرى والأحجام الكبيرة والصلاحيات', async () => {
  const id = (await api('POST', '/api/news', { cookie: staff, body: { title: 'رفع', body: 'نص الخبر' } })).json.id;
  const up = (buf, cookie = staff) => api('POST', `/api/news/${id}/media?caption=${encodeURIComponent('تعليق')}`, { cookie, raw: buf });
  for (const [buf, kind] of [[PNG, 'image'], [JPG, 'image'], [MP4, 'video'], [WEBM, 'video']]) { const r = await up(buf); assert.equal(r.status, 201, r.buf.toString()); assert.equal(r.json.kind, kind); }
  assert.equal((await up(Buffer.from('هذا نص وليس صورة.jpg'))).status, 400);
  assert.equal((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status, 400);
  assert.equal((await up(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);        // صورة > 5MB
  assert.equal((await up(PNG, stu)).status, 403); assert.equal((await up(PNG, auditor)).status, 403);
  assert.equal((await api('POST', `/api/news/${id}/media`, { raw: PNG })).status, 401);
  assert.equal((await api('POST', '/api/news/99999/media', { cookie: staff, raw: PNG })).status, 404);
  for (let i = 0; i < 4; i++) assert.equal((await up(PNG)).status, 201);                              // الإجمالي 8
  assert.equal((await up(PNG)).status, 400);                                                           // التاسع مرفوض
  const m = (await api('GET', '/api/news', { cookie: stu })).json.news.find((n) => n.id === id).media;
  assert.equal(m.length, 8); assert.equal(m[0].caption, 'تعليق'); assert.match(m[0].src, /^\/api\/media\/\d+$/);
  assert.equal(fs.readdirSync(path.join(dir, 'up', 'news')).length >= 8, true);
});

test('البثّ: يلزم تسجيل الدخول، النوع صحيح، Range يعمل، والرؤوس آمنة', async () => {
  const id = (await api('POST', '/api/news', { cookie: staff, body: { title: 'بث الفيديو', body: 'نص الخبر' } })).json.id;
  await api('POST', `/api/news/${id}/media`, { cookie: staff, raw: MP4 });
  const mid = app.db.prepare('SELECT id FROM news_media WHERE news_id = ?').get(id).id;
  assert.equal((await api('GET', `/api/media/${mid}`)).status, 401);
  const full = await api('GET', `/api/media/${mid}`, { cookie: stu });
  assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); assert.equal(full.buf.length, MP4.length);
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff'); assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const part = await api('GET', `/api/media/${mid}`, { cookie: stu, headers: { Range: 'bytes=10-99' } });
  assert.equal(part.status, 206); assert.equal(part.buf.length, 90); assert.equal(part.headers.get('content-range'), `bytes 10-99/${MP4.length}`);
  assert.deepEqual(part.buf, MP4.subarray(10, 100));
  assert.equal((await api('GET', `/api/media/${mid}`, { cookie: stu, headers: { Range: 'bytes=99999-' } })).status, 416);
  assert.equal((await api('GET', '/api/media/424242', { cookie: stu })).status, 404);
  const csp = full.headers.get('content-security-policy'); assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com/); assert.match(csp, /img-src 'self' data: https:/);
});

test('الحذف: حذف وسيط وحذف الخبر يزيلان الملفات والصفوف', async () => {
  const id = (await api('POST', '/api/news', { cookie: staff, body: { title: 'حذف', body: 'نص الخبر' } })).json.id;
  await api('POST', `/api/news/${id}/media`, { cookie: staff, raw: PNG }); await api('POST', `/api/news/${id}/media`, { cookie: staff, raw: JPG });
  const rows = app.db.prepare('SELECT id, file FROM news_media WHERE news_id = ?').all(id), f = (r) => path.join(dir, 'up', 'news', r.file);
  assert.equal((await api('DELETE', `/api/news/media/${rows[0].id}`, { cookie: stu })).status, 403);
  assert.equal((await api('DELETE', `/api/news/media/${rows[0].id}`, { cookie: staff })).status, 200); assert.ok(!fs.existsSync(f(rows[0])));
  assert.equal((await api('DELETE', `/api/news/${id}`, { cookie: staff })).status, 200);
  assert.ok(!fs.existsSync(f(rows[1]))); assert.equal(app.db.prepare('SELECT COUNT(*) c FROM news_media WHERE news_id = ?').get(id).c, 0);
});
