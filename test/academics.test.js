import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345';
let app, base, staff, auditor, stu, stu2, stuId, stu2Id, courseId;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function loginAs(username, password = PW) {
  app.limiter.hits.clear();
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
const form = (o = {}) => ({
  first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14',
  birth_place: 'دمشق', nationality: 'سورية', phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء',
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, hs_max: 2400, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o,
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ac-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = await loginAs('staff'); auditor = await loginAs('auditor');
  // طالبان بكلمة مرور معروفة (نتجاوز الإجبار على التغيير لتبسيط الاختبار)
  const a = await api('POST', '/api/students', { cookie: staff, body: form() });
  const b = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى', program_id: 3 }) });
  stuId = a.json.student.id; stu2Id = b.json.student.id;
  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE role = ?').run(h, 'student');
  stu = await loginAs(a.json.student.username); stu2 = await loginAs(b.json.student.username);
});
test.after(async () => { await app.close(); });

test('المواد: الموظف يضيف، والطالب يرى مواد برنامجه وسنته فقط', async () => {
  const add = (o) => api('POST', '/api/courses', { cookie: staff, body: { programId: 2, level: 2, semester: 1, name: 'أمن الشبكات', hours: 3, instructor: 'د. سمير', ...o } });
  const r = await add({}); assert.equal(r.status, 201, r.text); courseId = r.json.course.id;
  await add({ name: 'التشفير', semester: 2 }); await add({ name: 'مقرر السنة الأولى', level: 1 });
  await api('POST', '/api/courses', { cookie: staff, body: { programId: 3, level: 2, semester: 1, name: 'مقرر برنامج آخر' } });
  assert.equal((await add({})).status, 409);                                   // تكرار
  assert.equal((await add({ level: 9, name: 'x1' })).status, 400);              // سنة أعلى من مدة البرنامج
  assert.equal((await api('POST', '/api/courses', { cookie: stu, body: { programId: 2, level: 1, semester: 1, name: 'مقرر' } })).status, 403);

  const mine = await api('GET', '/api/courses', { cookie: stu });              // السنة الحالية للطالب = 2
  assert.deepEqual(mine.json.courses.map((c) => c.name).sort(), ['أمن الشبكات', 'التشفير'].sort());
  const y1 = await api('GET', '/api/courses?level=1', { cookie: stu });
  assert.deepEqual(y1.json.courses.map((c) => c.name), ['مقرر السنة الأولى']);
  const s1 = await api('GET', '/api/courses?semester=2', { cookie: stu });
  assert.deepEqual(s1.json.courses.map((c) => c.name), ['التشفير']);
  const other = await api('GET', '/api/courses', { cookie: stu2 });
  assert.deepEqual(other.json.courses.map((c) => c.name), ['مقرر برنامج آخر']);
});

test('العلامات: الإدخال بقيود، والنجاح/الرسوب، والمحاولات السابقة، وعدم رؤية الغير', async () => {
  const enter = (o, id = stuId) => api('POST', `/api/students/${id}/grades`, { cookie: staff, body: { courseId, academicYear: '2024/2025', theory: 60, practical: 10, ...o } });
  assert.equal((await enter({ theory: 70, practical: 40 })).status, 400, 'المجموع فوق 100');
  assert.equal((await enter({ academicYear: '2024-2025' })).status, 400);
  assert.equal((await enter({ academicYear: '2024/2026' })).status, 400);
  assert.equal((await enter({ courseId: 999 })).status, 400);
  assert.equal((await enter({}, stu2Id)).status, 400, 'مقرر من برنامج آخر');
  assert.equal((await api('POST', `/api/students/${stuId}/grades`, { cookie: stu, body: { courseId, academicYear: '2024/2025', theory: 90 } })).status, 403);
  assert.equal((await enter({ theory: 20, practical: 5 })).status, 200);                      // رسوب (25)
  assert.equal((await enter({ theory: 20, practical: 10 })).status, 200);                     // تعديل نفس المحاولة
  const r = await enter({ academicYear: '2025/2026', theory: 55, practical: 15 });             // محاولة ثانية: نجاح (70)
  assert.equal(r.status, 200, r.text);

  const g = await api('GET', '/api/me/grades', { cookie: stu });
  assert.equal(g.json.level, 2); assert.equal(g.json.grades.length, 1);
  const row = g.json.grades[0];
  assert.equal(row.total, 70); assert.equal(row.passed, true); assert.equal(row.theory, 55); assert.equal(row.practical, 15);
  assert.equal(row.instructor, 'د. سمير');
  assert.equal(row.previous.length, 1); assert.equal(row.previous[0].total, 30); assert.equal(row.previous[0].passed, false);
  assert.equal(g.json.summary.average, 70);
  assert.equal((await api('GET', '/api/me/grades?level=1', { cookie: stu })).json.grades.length, 0);
  assert.equal((await api('GET', '/api/me/grades', { cookie: stu2 })).json.grades.length, 0);   // لا يرى علامات الغير
  assert.equal((await api('GET', `/api/students/${stuId}/grades`, { cookie: stu })).status, 403);
  assert.equal((await api('GET', `/api/students/${stuId}/grades`, { cookie: staff })).json.grades.length, 1);

  // كشف العلامات (الوثيقة) يعتمد على الجدول نفسه
  const rq = await api('POST', '/api/requests', { cookie: stu, body: { service: 'transcript', details: { lang: 'العربية' } } });
  assert.equal(rq.status, 201, rq.text);
});

test('الأخبار: الجميع يقرأ، والموظف فقط ينشر ويحذف', async () => {
  assert.equal((await api('POST', '/api/news', { cookie: stu, body: { title: 'خبر', body: 'نص الخبر' } })).status, 403);
  assert.equal((await api('POST', '/api/news', { cookie: auditor, body: { title: 'خبر', body: 'نص الخبر' } })).status, 403);
  assert.equal((await api('POST', '/api/news', { cookie: staff, body: { title: 'x', body: 'نص' } })).status, 400);
  const a = await api('POST', '/api/news', { cookie: staff, body: { title: 'بدء التسجيل للفصل الثاني', body: 'يبدأ التسجيل الأحد.' } });
  const b = await api('POST', '/api/news', { cookie: staff, body: { title: 'خبر مثبّت', body: 'نص الخبر المثبّت', pinned: true } });
  assert.equal(a.status, 201);
  const list = await api('GET', '/api/news', { cookie: stu });
  assert.equal(list.json.news[0].title, 'خبر مثبّت');                              // المثبّت أولاً
  assert.equal((await api('DELETE', `/api/news/${b.json.id}`, { cookie: stu })).status, 403);
  assert.equal((await api('DELETE', `/api/news/${b.json.id}`, { cookie: staff })).status, 200);
  assert.equal((await api('GET', '/api/news', { cookie: stu })).json.news.length, 1);
  assert.equal((await api('GET', '/api/news')).status, 401);
});

test('الشكاوى: الطالب يقدّم ويرى شكاواه فقط، والموظف يرد', async () => {
  assert.equal((await api('POST', '/api/complaints', { cookie: stu, body: { subject: 'خطأ', body: 'قصير' } })).status, 400);
  const c = await api('POST', '/api/complaints', { cookie: stu, body: { subject: 'خطأ في علامة', body: 'علامة مقرر أمن الشبكات غير صحيحة، أرجو المراجعة.' } });
  assert.equal(c.status, 201, c.text); assert.match(c.json.complaint.no, /^CMP-\d{4}-\d{5}$/);
  assert.equal((await api('GET', '/api/complaints', { cookie: stu2 })).json.complaints.length, 0);
  assert.equal((await api('GET', '/api/complaints', { cookie: stu })).json.complaints.length, 1);
  assert.equal((await api('GET', '/api/complaints', { cookie: staff })).json.complaints[0].student.name.length > 0, true);
  assert.equal((await api('POST', `/api/complaints/${c.json.complaint.id}/respond`, { cookie: stu, body: { response: 'رد' } })).status, 403);
  const r = await api('POST', `/api/complaints/${c.json.complaint.id}/respond`, { cookie: staff, body: { response: 'تمت المراجعة وتصحيح العلامة.', close: true } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.complaint.status, 'closed');
  assert.equal((await api('GET', '/api/complaints', { cookie: stu })).json.complaints[0].response, 'تمت المراجعة وتصحيح العلامة.');
  for (let i = 0; i < 5; i++) await api('POST', '/api/complaints', { cookie: stu, body: { subject: 'شكوى ' + i, body: 'نص الشكوى الطويل ' + i } });
  assert.equal((await api('POST', '/api/complaints', { cookie: stu, body: { subject: 'سادسة', body: 'نص الشكوى السادسة' } })).status, 429);
});

test('تعديل الطالب لبيانات الاتصال فقط، والخدمات الجديدة تعمل', async () => {
  const r = await api('PUT', '/api/me/profile', { cookie: stu, body: { phone: '0955 000 111', email: 'new@example.com', governorate: 'حلب', city: 'الفرقان', address: 'شارع جديد', first_name: 'تلاعب', status: 'graduated' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.profile.profile.phone, '0955000111'); assert.equal(r.json.profile.profile.city, 'الفرقان');
  assert.equal(r.json.profile.profile.first_name, 'ليلى'); assert.equal(r.json.profile.status, 'active');   // الحقول الأخرى لا تُمس
  assert.equal((await api('PUT', '/api/me/profile', { cookie: stu, body: { phone: 'abc', governorate: 'حلب', city: 'x', address: 'y' } })).status, 400);
  assert.equal((await api('PUT', '/api/me/profile', { cookie: staff, body: { phone: '0955000111' } })).status, 403);

  // «سنة الامتياز» محذوفة، و«الحياة الجامعية» بلا خيارات، و«طلب احتياج» يحمل الخيارات القديمة + «أخرى» والتوصيف
  const svcs = (await api('GET', '/api/services', { cookie: stu })).json.services;
  assert.ok(!svcs.some((s) => s.code === 'excellence_year'));
  assert.deepEqual(svcs.find((s) => s.code === 'campus_life').fields, []);
  const needs = svcs.find((s) => s.code === 'needs_request');
  assert.equal(needs.label, 'طلب احتياج'); assert.ok(needs.fields.find((f) => f.name === 'need_type').options.includes('أخرى'));
  assert.equal((await api('POST', '/api/requests', { cookie: stu, body: { service: 'excellence_year', details: { academic_year: '2026/2027' } } })).status, 400);
  const cl = await api('POST', '/api/requests', { cookie: stu, body: { service: 'campus_life', details: {} } });
  assert.equal(cl.status, 201, cl.text);
  const ap = await api('POST', `/api/requests/${cl.json.request.id}/approve`, { cookie: staff });
  assert.equal(ap.status, 200); assert.equal(ap.json.request.document, null);               // الحياة الجامعية بلا وثيقة
  const nr = await api('POST', '/api/requests', { cookie: stu, body: { service: 'needs_request', details: { need_type: 'أخرى', reason: 'ظرف اجتماعي', description: 'أحتاج مقعداً في حافلة الجامعة' } } });
  assert.equal(nr.status, 201, nr.text);
  assert.equal((await api('POST', '/api/requests', { cookie: stu, body: { service: 'needs_request', details: { need_type: 'غير موجود', reason: 'ظرف اجتماعي', description: 'x' } } })).status, 400);
  assert.equal(verifyAuditChain(app.db).ok, true);
});

test('/api/me يعيد المستخدم عند وجود جلسة (إعادة تحميل الصفحة لا تُخرج المستخدم)', async () => {
  const me = await api('GET', '/api/me', { cookie: stu });
  assert.equal(me.status, 200); assert.equal(me.json.user.role, 'student'); assert.equal(me.json.user.mustChange, false);
  assert.equal((await api('GET', '/api/me')).json.user, null);
  // طالب بكلمة مؤقتة: يرى الواجهة أنه ملزَم بالتغيير بدل أن يُعامل كزائر
  const r = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567899', first_name: 'هبة', mother_name: 'دعاء' }) });
  const c = await loginAs(r.json.credentials.username, r.json.credentials.tempPassword);
  const m2 = await api('GET', '/api/me', { cookie: c });
  assert.equal(m2.json.user.mustChange, true);
});
