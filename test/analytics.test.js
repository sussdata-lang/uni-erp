import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { readXlsx } from '../server/lib/xlsx.js';
import { readZip } from '../server/lib/zip.js';
import { jpegSize } from '../server/lib/docx.js';

const PW = 'Test#Pass12345', fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
let app, base, admin, staff, auditor, stu;
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* */ }
  return { status: res.status, json, buf, headers: res.headers };
}
async function loginAs(u, p = PW) { app.limiter.hits.clear(); const r = await api('POST', '/api/auth/login', { body: { username: u, password: p } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.headers.get('set-cookie').split(';')[0]; }
const imp = (kind, f) => api('POST', `/api/import/${kind}`, { cookie: staff, body: { filename: f, data: fx(f).toString('base64'), commit: true } });
const tbl = (a, id) => a.tables.find((t) => t.id === id), kpi = (a, id) => a.kpis.find((k) => k.id === id).value;
// JPEG صغيرة صالحة (1×1) للتجربة
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-an-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff'], ['auditor', 'auditor']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  admin = await loginAs('admin'); staff = await loginAs('staff'); auditor = await loginAs('auditor');
  const r = await imp('students', 'students-filled.xlsx'); assert.equal(r.json.created, 2);
  await imp('courses', 'courses-filled.xlsx');
  const sn = app.db.prepare("SELECT student_no n FROM users WHERE student_no LIKE 'CSS-%'").get().n;
  const stuRow = app.db.prepare('SELECT username FROM users WHERE student_no = ?').get(sn);
  app.db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?").run(h, stuRow.username);
  stu = await loginAs(stuRow.username);
  const g = (course, th, pr) => ({ student_no: sn, course, academic_year: '2025/2026', theory: th, practical: pr });
  for (const x of [g('مدخل إلى العلوم الأمنية', 50, 30), g('القانون الجزائي', 55, 20)]) {
    const st = app.db.prepare('SELECT id FROM users WHERE student_no = ?').get(sn).id, c = app.db.prepare('SELECT id FROM courses WHERE name = ?').get(x.course).id;
    await api('POST', `/api/students/${st}/grades`, { cookie: staff, body: { courseId: c, academicYear: x.academic_year, theory: x.theory, practical: x.practical } });
  }
  await api('POST', '/api/requests', { cookie: stu, body: { service: 'transcript', details: { lang: 'العربية', copies: 1 } } });
  await api('POST', '/api/requests', { cookie: stu, body: { service: 'campus_life', details: {} } });
});
test.after(async () => { await app.close(); });

test('الإحصاءات: المؤشرات والجداول تطابق البيانات، وتعمل للمدقق، وتُرفض للطالب', async () => {
  for (const c of [admin, staff, auditor]) assert.equal((await api('GET', '/api/analytics', { cookie: c })).status, 200);
  assert.equal((await api('GET', '/api/analytics', { cookie: stu })).status, 403);
  assert.equal((await api('GET', '/api/analytics')).status, 401);
  const a = (await api('GET', '/api/analytics', { cookie: auditor })).json;
  assert.equal(kpi(a, 'students'), 2); assert.equal(kpi(a, 'requests'), 2); assert.equal(kpi(a, 'courses'), 3);
  assert.deepEqual(tbl(a, 'byFaculty').rows.map((r) => r[0]).sort(), ['كلية الأمن السيبراني', 'كلية العلوم الأمنية'].sort());
  assert.deepEqual(tbl(a, 'byGender').rows.sort(), [['أنثى', 1], ['ذكر', 1]].sort());
  assert.equal(tbl(a, 'gradeDist').rows.reduce((s, r) => s + r[1], 0), 2);
  assert.equal(tbl(a, 'reqByMonth').rows.length, 12); assert.equal(tbl(a, 'reqByMonth').rows.at(-1)[1], 2);       // هذا الشهر
  assert.equal(kpi(a, 'passRate'), 100); assert.equal(kpi(a, 'avgMark'), 77.5);
  assert.deepEqual(tbl(a, 'reqByService').rows.map((r) => r[0]).sort(), ['طلب حياة جامعية', 'كشف علامات'].sort());
  assert.ok(a.options.faculties.length === 6 && a.options.years.includes(2026));
  assert.ok(a.tables.every((t) => t.rows.every((r) => r.length === t.headers.length)));
});

test('المرشحات: كلية وسنة تعيد حساب كل شيء، وجدول الكليات يبقى كاملاً للتحديد المتقاطع', async () => {
  const fid = app.db.prepare("SELECT id FROM faculties WHERE code = 'CSS'").get().id;
  const a = (await api('GET', `/api/analytics?faculty=${fid}`, { cookie: staff })).json;
  assert.equal(kpi(a, 'students'), 1); assert.equal(kpi(a, 'requests'), 2); assert.equal(kpi(a, 'courses'), 2);
  assert.equal(tbl(a, 'byFaculty').rows.length, 2);                                       // لا يُرشَّح بالكلية نفسها
  const none = (await api('GET', '/api/analytics?year=1999', { cookie: staff })).json;
  assert.equal(kpi(none, 'students'), 0); assert.equal(kpi(none, 'passRate'), null);
  assert.equal((await api('GET', '/api/analytics?faculty=abc&year=;DROP', { cookie: staff })).status, 200);
});

test('التصدير: تقرير Excel سليم، ولا يوجد خيار Power BI', async () => {
  const rep = await api('GET', '/api/analytics/export.xlsx', { cookie: auditor });
  assert.equal(rep.status, 200); assert.match(rep.headers.get('content-type'), /spreadsheetml/); assert.match(rep.headers.get('content-disposition'), /statistics-report\.xlsx/);
  const wb = readXlsx(rep.buf); assert.equal(wb.sheets[0].name, 'ملخص'); assert.ok(wb.sheets.length >= 16);
  assert.ok(wb.sheets[0].rows.some((r) => r[0] === 'الطلاب المقيَّدون' && r[1] === '2'));
  const old = await api('GET', '/api/analytics/export.xlsx?kind=powerbi', { cookie: staff });   // الخيار محذوف: يُعاد تقرير الإحصاءات العادي
  assert.match(old.headers.get('content-disposition'), /statistics-report\.xlsx/);
  assert.equal((await api('GET', '/api/analytics/export.xlsx', { cookie: stu })).status, 403);
});

test('التصدير: تقرير Word يضمّ الأرقام من القاعدة والصور المرسلة، ولا يقبل غير JPEG', async () => {
  assert.deepEqual(jpegSize(JPEG), { w: 1, h: 1 });
  const r = await api('POST', '/api/analytics/export.docx', { cookie: staff, body: { charts: [{ id: 'byFaculty', jpeg: JPEG.toString('base64') }, { id: 'byGender', jpeg: Buffer.from('not a jpeg').toString('base64') }] } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /wordprocessingml/);
  const z = readZip(r.buf), doc = z.get('word/document.xml').toString('utf8');
  assert.match(doc, /تقرير الإحصاءات/); assert.match(doc, /الطلاب المقيَّدون/); assert.match(doc, /كلية الأمن السيبراني/);
  assert.equal([...z.keys()].filter((k) => k.startsWith('word/media/')).length, 1);          // الصورة الفاسدة تُتجاهل
  assert.equal((await api('POST', '/api/analytics/export.docx', { cookie: stu, body: {} })).status, 403);
  assert.equal((await api('POST', '/api/analytics/export.docx', { cookie: staff, body: { faculty: 1 } })).status, 200);
});
