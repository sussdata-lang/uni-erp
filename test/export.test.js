import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';
import { readXlsx } from '../server/lib/xlsx.js';
import { readZip } from '../server/lib/zip.js';

const PW = 'Test#Pass12345';
let app, base, staff, auditor, stu, stuId;

async function raw(url, cookie) { const res = await fetch(base + url, { headers: cookie ? { Cookie: cookie } : {} }); return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers }; }
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: res.status, json, text };
}
async function loginAs(username) {
  app.limiter.hits.clear();
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0];
}
const form = (o = {}) => ({
  first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14',
  birth_place: 'دمشق', nationality: 'سورية', phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء',
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o,
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ex-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = await loginAs('staff'); auditor = await loginAs('auditor');
  const a = await api('POST', '/api/students', { cookie: staff, body: form({ address: '=cmd|calc' }) });      // عنوان يبدأ بـ = لاختبار تحييد الصيغ
  stuId = a.json.student.id;
  await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى', study_level: 1 }) });
  const c = (name, level, semester) => api('POST', '/api/courses', { cookie: staff, body: { programId: 2, level, semester, name, hours: 3 } }).then((r) => r.json.course.id);
  const [c1, c2, c3] = [await c('أمن الشبكات', 2, 1), await c('التشفير', 2, 2), await c('مقرر السنة الأولى', 1, 1)];
  const g = (cid, ay, th) => api('POST', `/api/students/${stuId}/grades`, { cookie: staff, body: { courseId: cid, academicYear: ay, theory: th, practical: 20 } });
  await g(c1, '2025/2026', 50); await g(c2, '2025/2026', 30); await g(c3, '2024/2025', 60);
  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE role = ?').run(h, 'student');
  stu = await loginAs((await api('GET', `/api/students/${stuId}`, { cookie: staff })).json.student.username);
});
test.after(async () => { await app.close(); });

test('الصلاحية: الموظف والمدير يصدّران، والطالب لا', async () => {
  assert.equal((await api('GET', '/api/export/options', { cookie: staff })).status, 200);
  assert.equal((await api('GET', '/api/export/options', { cookie: stu })).status, 403);
  assert.equal((await api('GET', '/api/export/file?dataset=grades&format=csv', { cookie: stu })).status, 403);
  assert.equal((await api('GET', '/api/export/file?dataset=grades&format=csv', { cookie: auditor })).status, 403);   // المدقق للقراءة فقط وليست له الصلاحية
  assert.equal((await api('GET', '/api/export/file?dataset=grades&format=csv')).status, 401);
});

test('المعاينة والمرشحات: السنة والفصل والعام الدراسي', async () => {
  const p = async (qs) => (await api('GET', '/api/export/preview?dataset=grades' + qs, { cookie: staff })).json.sets[0];
  assert.equal((await p('')).total, 3);
  assert.equal((await p('&academicYear=2025/2026')).total, 2);
  assert.equal((await p('&level=1')).total, 1);
  assert.equal((await p('&level=2&semester=2')).total, 1);
  assert.equal((await p('&level=2&semester=2')).rows[0][7], 'التشفير');
  assert.equal((await p('&academicYear=2030/2031')).total, 0);
  assert.equal((await p('&level=99;DROP')).total, 3);                                  // قيمة غير صالحة تُهمَل
  const st = (await api('GET', '/api/export/preview?dataset=students', { cookie: staff })).json.sets[0];
  assert.equal(st.total, 2); assert.ok(st.headers.includes('الاسم الأول'));
  assert.equal((await api('GET', '/api/export/preview?dataset=nope', { cookie: staff })).status, 400);
});

test('الصيغ: xlsx (ورقة لكل سنة وفصل)، csv بـ BOM وتحييد الصيغ، json، docx، وzip لكل البيانات', async () => {
  const x = await raw('/api/export/file?dataset=grades&format=xlsx&layout=terms', staff);
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
  const wb = readXlsx(x.buf); assert.equal(wb.sheets.length, 3, wb.sheets.map((s) => s.name).join('|'));
  assert.ok(wb.sheets.every((s) => s.name.startsWith('علامات')));
  const x1 = readXlsx((await raw('/api/export/file?dataset=grades&format=xlsx', staff)).buf); assert.equal(x1.sheets[0].rows.length, 4);   // ترويسة + 3

  const c = await raw('/api/export/file?dataset=students&format=csv', staff);
  assert.match(c.headers.get('content-type'), /text\/csv/); assert.equal(c.buf.slice(0, 3).toString('hex'), 'efbbbf');
  assert.ok(c.buf.toString('utf8').includes("'=cmd|calc"), 'الخلية التي تبدأ بـ = تُحيَّد');
  assert.ok(!/(^|,)=cmd/.test(c.buf.toString('utf8')));

  const j = JSON.parse((await raw('/api/export/file?dataset=courses&format=json&level=2', staff)).buf.toString('utf8'));
  assert.equal(j.data.length, 2); assert.equal(j.data[0]['المقرر'], 'أمن الشبكات');

  const d = await raw('/api/export/file?dataset=grades&format=docx', staff);
  assert.match(d.headers.get('content-type'), /wordprocessingml/);
  assert.match(readZip(d.buf).get('word/document.xml').toString('utf8'), /التشفير/);

  const z = await raw('/api/export/file?dataset=all&format=csv', staff);
  assert.match(z.headers.get('content-type'), /zip/);
  assert.deepEqual([...readZip(z.buf).keys()].sort(), ['attendance.csv', 'complaints.csv', 'courses.csv', 'grades.csv', 'holds.csv', 'requests.csv', 'students.csv']);
  const all = readXlsx((await raw('/api/export/file?dataset=all&format=xlsx', staff)).buf); assert.equal(all.sheets.length, 7);

  assert.equal((await api('GET', '/api/export/file?dataset=grades&format=exe', { cookie: staff })).status, 400);
});

test('التدقيق: كل تصدير يُسجَّل والسلسلة سليمة', async () => {
  const n = app.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'تصدير بيانات%'").get().c;
  assert.ok(n >= 6, 'عدد سجلات التصدير: ' + n);
  assert.equal(verifyAuditChain(app.db).ok, true);
});
