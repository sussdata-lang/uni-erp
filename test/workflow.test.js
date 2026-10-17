import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345';
let app, base, staff, admin, auditor, stu, stu2, stuId, stu2Id, courseId;

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
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 2, guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o,
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ac-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['staff', 'موظف', 'staff'], ['admin', 'مدير', 'admin'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = await loginAs('staff'); admin = await loginAs('admin'); auditor = await loginAs('auditor');
  // طالبان بكلمة مرور معروفة (نتجاوز الإجبار على التغيير لتبسيط الاختبار)
  const a = await api('POST', '/api/students', { cookie: staff, body: form() });
  const b = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى', program_id: 3 }) });
  stuId = a.json.student.id; stu2Id = b.json.student.id;
  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE role = ?').run(h, 'student');
  stu = await loginAs(a.json.student.username); stu2 = await loginAs(b.json.student.username);
});
test.after(async () => { await app.close(); });


let c1, c2, c3, gid;
const addCourse = async (o) => (await api('POST', '/api/courses', { cookie: staff, body: { programId: 2, level: 2, semester: 1, hours: 3, ...o } })).json.course.id;
const enter = (o = {}, id = stuId) => api('POST', `/api/students/${id}/grades`, { cookie: staff, body: { courseId: c1, academicYear: '2025/2026', theory: 50, practical: 20, ...o } });

test('مراحل الاعتماد: الطالب لا يرى المسودة، والاعتماد بصلاحيته فقط، وتعديل المعتمد بتبرير', async () => {
  c1 = await addCourse({ name: 'أمن الشبكات' }); c2 = await addCourse({ name: 'التشفير' }); c3 = await addCourse({ name: 'قواعد البيانات' });
  const r = await enter(); assert.equal(r.status, 200, r.text);
  const row = (await api('GET', '/api/grades', { cookie: staff })).json.rows[0];
  assert.equal(row.workflowStatus, 'draft'); gid = row.id;
  assert.equal((await api('GET', '/api/me/grades', { cookie: stu })).json.grades.length, 0, 'المسودة مخفية عن الطالب');
  assert.equal((await api('GET', `/api/students/${stuId}/grades`, { cookie: staff })).json.grades.length, 1);
  // مراجعة بصلاحية الموظف، لكن الاعتماد لا
  const wf = (cookie, stage, extra = {}) => api('POST', '/api/grades/workflow', { cookie, body: { gradeIds: [gid], stage, ...extra } });
  assert.equal((await wf(staff, 'approved')).status, 403);   // الموظف بلا صلاحية الاعتماد
  assert.equal((await wf(staff, 'reviewed')).json.updated, 1);
  assert.equal((await wf(staff, 'approved')).status, 403);
  assert.equal((await wf(stu, 'reviewed')).status, 403);
  assert.equal((await wf(admin, 'approved')).json.updated, 1);
  const g = await api('GET', '/api/me/grades', { cookie: stu });
  assert.equal(g.json.grades.length, 1); assert.equal(g.json.grades[0].total, 70);
  // كشف العلامات يتضمن المعتمدة فقط
  const rq = await api('POST', '/api/requests', { cookie: stu, body: { service: 'transcript', details: { lang: 'العربية' } } });
  assert.equal(rq.status, 201, rq.text);
  // مقفلة: الموظف لا يعدّل، والمدير بتبرير فقط
  assert.equal((await enter({ theory: 60 })).status, 403);
  assert.equal((await api('POST', `/api/students/${stuId}/grades`, { cookie: admin, body: { courseId: c1, academicYear: '2025/2026', theory: 60, practical: 20 } })).status, 400, 'تبرير مطلوب');
  const ok = await api('POST', `/api/students/${stuId}/grades`, { cookie: admin, body: { courseId: c1, academicYear: '2025/2026', theory: 60, practical: 20, justification: 'تصحيح خطأ رصد' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await api('GET', '/api/me/grades', { cookie: stu })).json.grades[0].total, 80);
  const h = (await api('GET', `/api/grades/${gid}/history`, { cookie: staff })).json.history;
  assert.ok(h.some((x) => x.justification === 'تصحيح خطأ رصد' && x.oldTotal === 70 && x.newTotal === 80));
  // إعادة فتح معتمدة تتطلب تبريراً وصلاحية
  assert.equal((await wf(admin, 'reviewed')).status, 400);
  assert.equal((await wf(admin, 'reviewed', { justification: 'مراجعة إضافية' })).json.updated, 1);
  assert.equal((await api('GET', '/api/me/grades', { cookie: stu })).json.grades.length, 0);
  // الحذف: مراجَعة (غير معتمدة) يحذفها الموظف
  assert.equal((await api('DELETE', `/api/students/${stuId}/grades/${gid}`, { cookie: staff })).status, 200);
  assert.ok(app.db.prepare('SELECT 1 FROM grade_changes WHERE grade_id = ? AND action = ?').get(gid, 'حذف علامة'));
  assert.throws(() => app.db.prepare('DELETE FROM grade_changes').run(), /append-only/);
});

test('إيقاف مراحل الاعتماد: العلامات الجديدة معتمدة فوراً', async () => {
  assert.equal((await api('POST', '/api/grades/workflow-setting', { cookie: staff, body: { enabled: false } })).status, 403);
  assert.equal((await api('POST', '/api/grades/workflow-setting', { cookie: admin, body: { enabled: false } })).status, 200);
  assert.equal((await enter({ courseId: c2 })).status, 200);
  assert.equal((await api('GET', '/api/me/grades', { cookie: stu })).json.grades.length, 1);
  await api('POST', '/api/grades/workflow-setting', { cookie: admin, body: { enabled: true } });
});

test('جدول المحاضرات وكشف التعارض', async () => {
  const put = (id, slots, cookie = staff) => api('PUT', `/api/courses/${id}/schedule`, { cookie, body: { slots } });
  assert.equal((await put(c1, [{ day: 0, start: '09:00', end: '11:00', hall: 'ق1' }], stu)).status, 403);
  assert.equal((await put(c1, [{ day: 9, start: '09:00', end: '11:00' }])).status, 400);
  assert.equal((await put(c1, [{ day: 0, start: '11:00', end: '09:00' }])).status, 400);
  assert.equal((await put(c1, [{ day: 0, start: '09:00', end: '11:00', hall: 'ق1' }])).status, 200);
  assert.equal((await put(c3, [{ day: 0, start: '10:30', end: '12:00', hall: 'ق2' }])).status, 200);
  const c = (await api('GET', `/api/students/${stuId}/schedule-conflicts`, { cookie: staff })).json;
  assert.equal(c.conflicts.length, 1); assert.equal(c.conflicts[0].overlapMinutes, 30); assert.equal(c.conflicts[0].dayLabel, 'السبت');
  assert.equal((await api('GET', `/api/students/${stuId}/schedule-conflicts`, { cookie: stu })).status, 200, 'الطالب يرى تعارضه');
  assert.equal((await api('GET', `/api/students/${stu2Id}/schedule-conflicts`, { cookie: stu })).status, 403);
  await put(c3, [{ day: 0, start: '11:00', end: '12:00' }]);                                  // تلامس بلا تداخل
  assert.equal((await api('GET', `/api/students/${stuId}/schedule-conflicts`, { cookie: staff })).json.conflicts.length, 0);
});

test('سجل الطالب 360°', async () => {
  const r = await api('GET', `/api/students/${stuId}/unified-record`, { cookie: staff });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.student.id, stuId); assert.ok('academicSummary' in r.json && Array.isArray(r.json.requests) && r.json.scheduleConflicts);
  assert.equal(r.json.academicSummary.gpa, 70);                       // علامة التشفير المعتمدة فقط (التي رُصدت بعد إيقاف المراحل)
  assert.equal(r.json.academicSummary.cohortRank, 1);
  assert.equal((await api('GET', `/api/students/${stuId}/unified-record`, { cookie: stu })).status, 403);
});

test('الطلبات الأكاديمية: قوائم مرتبطة بالطالب، وحفظ التفاصيل', async () => {
  const sv = (await api('GET', '/api/services', { cookie: stu })).json.services;
  for (const code of ['postponement', 'withdrawal', 'program_transfer', 'grade_appeal', 'violation_report']) assert.ok(sv.find((s) => s.code === code), code);
  const tf = sv.find((s) => s.code === 'program_transfer'), prog = tf.fields[0];
  assert.equal(prog.type, 'select'); assert.ok(prog.options.length >= 1 && prog.options.every((o) => /\[#\d+\]$/.test(o)));
  assert.ok(!prog.options.some((o) => o.endsWith('[#2]')), 'لا يُعرض برنامجه الحالي');
  assert.equal((await api('POST', '/api/requests', { cookie: stu, body: { service: 'program_transfer', details: { target_program_id: 'برنامج وهمي [#99]', justification: 'x' } } })).status, 400);
  const ok = await api('POST', '/api/requests', { cookie: stu, body: { service: 'program_transfer', details: { target_program_id: prog.options[0], justification: 'رغبة في التخصص' } } });
  assert.equal(ok.status, 201, ok.text);
  const row = app.db.prepare('SELECT * FROM academic_request_details WHERE request_id = ?').get(ok.json.request.id);
  assert.equal(row.request_category, 'program_transfer'); assert.equal(row.target_program_id, Number(/\[#(\d+)\]$/.exec(prog.options[0])[1]));
  assert.ok(!Object.keys(ok.json.request.details).some((k) => k.endsWith('__id')));
  const ap = sv.find((s) => s.code === 'grade_appeal');
  assert.ok(ap.fields[0].options.length >= 1, 'علاماته المعتمدة فقط');
  const a2 = await api('POST', '/api/requests', { cookie: stu, body: { service: 'grade_appeal', details: { target_grade_id: ap.fields[0].options[0], claimed_mark: 85, justification: 'خطأ في الجمع' } } });
  assert.equal(a2.status, 201, a2.text);
  assert.equal(app.db.prepare('SELECT claimed_mark FROM academic_request_details WHERE request_id = ?').get(a2.json.request.id).claimed_mark, 85);
  const v = await api('POST', '/api/requests', { cookie: stu, body: { service: 'violation_report', details: { violation_type: 'سلوك مخالف', justification: 'وصف' } } });
  assert.equal(v.status, 201, v.text);
});
