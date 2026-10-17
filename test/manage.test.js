import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345';
let app, base, admin, staff, stuId, stu2Id;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function loginAs(username) {
  app.limiter.hits.clear();
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-mg-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['admin', 'مدير', 'admin'], ['staff', 'موظف', 'staff'], ['admin2', 'مدير ثانٍ', 'admin']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  admin = await loginAs('admin'); staff = await loginAs('staff');
  stuId = (await api('POST', '/api/students', { cookie: staff, body: form() })).json.student.id;
  stu2Id = (await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى' }) })).json.student.id;
});
test.after(async () => { await app.close(); });

test('المواد: تعديل يزامن العلامات، والحذف مرفوض مع وجود علامات ومقبول بعد حذفها', async () => {
  const c = await api('POST', '/api/courses', { cookie: staff, body: { programId: 2, level: 2, semester: 1, name: 'أمن الشبكات', hours: 3 } });
  const id = c.json.course.id;
  const g = await api('POST', `/api/students/${stuId}/grades`, { cookie: staff, body: { courseId: id, academicYear: '2025/2026', theory: 50, practical: 20 } });
  assert.equal(g.status, 200, g.text);
  const up = await api('PUT', `/api/courses/${id}`, { cookie: staff, body: { name: 'أمن الشبكات المتقدم', hours: 4, level: 2, semester: 1, code: 'NS1', instructor: 'د. سمير' } });
  assert.equal(up.status, 200, up.text); assert.equal(up.json.course.name, 'أمن الشبكات المتقدم');
  const gr = (await api('GET', `/api/students/${stuId}/grades`, { cookie: staff })).json.grades;
  assert.equal(gr[0].course, 'أمن الشبكات المتقدم'); assert.equal(gr[0].hours, 4);
  assert.equal((await api('PUT', `/api/courses/${id}`, { cookie: staff, body: { level: 9 } })).status, 400);
  assert.equal((await api('DELETE', `/api/courses/${id}`, { cookie: staff })).status, 409);       // له علامات
  const del = await api('DELETE', `/api/students/${stuId}/grades/${gr[0].id}`, { cookie: staff });
  assert.equal(del.status, 200); assert.equal(del.json.grades.length, 0);
  assert.equal((await api('DELETE', `/api/students/${stu2Id}/grades/${gr[0].id}`, { cookie: staff })).status, 404);
  assert.equal((await api('DELETE', `/api/courses/${id}`, { cookie: staff })).status, 200);
  assert.equal((await api('DELETE', `/api/courses/${id}`, { cookie: staff })).status, 404);
});

test('الأخبار والشكاوى: تعديل خبر وحذف شكوى', async () => {
  const n = await api('POST', '/api/news', { cookie: staff, body: { title: 'خبر أول', body: 'نص الخبر الأول' } });
  const up = await api('PUT', `/api/news/${n.json.id}`, { cookie: staff, body: { title: 'خبر معدّل', body: 'نص معدّل', pinned: true } });
  assert.equal(up.status, 200, up.text);
  const list = (await api('GET', '/api/news', { cookie: staff })).json.news;
  assert.equal(list[0].title, 'خبر معدّل'); assert.equal(list[0].pinned, true);
  assert.equal((await api('PUT', `/api/news/${n.json.id}`, { cookie: staff, body: { title: 'x' } })).status, 400);
  app.db.prepare("INSERT INTO complaints (id, no, student_id, subject, body, created_at) VALUES (1, 'CMP-T-1', ?, 'موضوع', 'نص الشكوى الطويل', ?)").run(stuId, Date.now());
  assert.equal((await api('DELETE', '/api/complaints/1', { cookie: staff })).status, 200);
  assert.equal((await api('DELETE', '/api/complaints/1', { cookie: staff })).status, 404);
});

test('الكليات والبرامج: تعديل وحذف مع حمايات الطلاب والمقررات', async () => {
  const f = await api('POST', '/api/admin/faculties', { cookie: admin, body: { name: 'كلية تجريبية', nameEn: 'College of Testing', kind: 'college' } });
  assert.equal(f.status, 201, f.text);
  const ed = await api('PUT', `/api/admin/faculties/${f.json.id}`, { cookie: admin, body: { name: 'كلية الاختبار', nameEn: 'College of Testing Arts', code: 'CTA' } });
  assert.equal(ed.status, 200, ed.text);
  const fac = (await api('GET', '/api/faculties', { cookie: admin })).json.faculties.find((x) => x.id === f.json.id);
  assert.equal(fac.name, 'كلية الاختبار'); assert.equal(fac.code, 'CTA');
  const prog = (await api('GET', '/api/programs', { cookie: admin })).json.programs.find((p) => p.facultyId === f.json.id);
  assert.equal(prog.name, 'كلية الاختبار');                                                   // البرنامج الأساسي تبع الاسم الجديد
  const p2 = await api('POST', '/api/admin/programs', { cookie: admin, body: { facultyId: f.json.id, name: 'تخصص أ', degree: 'بكالوريوس', years: 4 } });
  assert.equal((await api('PUT', `/api/admin/programs/${p2.json.id}`, { cookie: admin, body: { name: 'تخصص ب', degree: 'ماجستير', years: 2 } })).status, 200);
  assert.equal((await api('PUT', `/api/admin/programs/${p2.json.id}`, { cookie: admin, body: { years: 9 } })).status, 400);
  await api('POST', '/api/courses', { cookie: admin, body: { programId: p2.json.id, level: 2, semester: 1, name: 'مقرر ما' } });
  assert.equal((await api('PUT', `/api/admin/programs/${p2.json.id}`, { cookie: admin, body: { years: 1 } })).status, 409);   // مقرر في السنة 2
  assert.equal((await api('DELETE', `/api/admin/programs/${p2.json.id}`, { cookie: admin })).status, 409);                    // له مقرر
  assert.equal((await api('DELETE', `/api/admin/faculties/${f.json.id}`, { cookie: admin })).status, 409);
  const cid = (await api('GET', `/api/courses?program=${p2.json.id}`, { cookie: admin })).json.courses[0].id;
  await api('DELETE', `/api/courses/${cid}`, { cookie: admin });
  assert.equal((await api('DELETE', `/api/admin/programs/${p2.json.id}`, { cookie: admin })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/faculties/${f.json.id}`, { cookie: admin })).status, 200);
  // جهة فيها طلاب لا تُحذف ولا يتغير رمزها
  const busy = (await api('GET', '/api/faculties', { cookie: admin })).json.faculties.find((x) => x.students > 0);
  assert.ok(busy);
  assert.equal((await api('DELETE', `/api/admin/faculties/${busy.id}`, { cookie: admin })).status, 409);
  assert.equal((await api('PUT', `/api/admin/faculties/${busy.id}`, { cookie: admin, body: { code: 'ZZZ' } })).status, 409);
  assert.equal((await api('DELETE', `/api/admin/faculties/${busy.id}`, { cookie: staff })).status, 403);
});

test('الطلاب: الحذف لصاحب الصلاحية فقط، ويُرفض لمن لديه طلبات', async () => {
  assert.equal((await api('DELETE', `/api/students/${stu2Id}`, { cookie: staff })).status, 403);   // الموظف لا يملك student:delete
  const stu2No = (await api('GET', `/api/students/${stu2Id}`, { cookie: admin })).json.student.studentNo;
  // طالب لديه طلب: لا يُحذف
  app.db.prepare("INSERT INTO requests (no, student_id, service_code, details_json, status, created_at) VALUES ('REQ-T-1', ?, 'attendance', '{}', 'review', ?)").run(stuId, Date.now());
  const blocked = await api('DELETE', `/api/students/${stuId}`, { cookie: admin });
  assert.equal(blocked.status, 409); assert.match(blocked.json.message, /طلب/);
  // طالب بلا طلبات: يُحذف مع علاماته وذممه وملفه
  app.db.prepare("INSERT INTO student_holds (student_id, hold_type, note, created_at) VALUES (?, 'financial', 'x', ?)").run(stu2Id, Date.now());
  const ok = await api('DELETE', `/api/students/${stu2Id}`, { cookie: admin });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await api('GET', `/api/students/${stu2Id}`, { cookie: admin })).status, 404);
  for (const t of ['student_profiles', 'student_holds', 'sessions', 'student_certs', 'grades']) assert.equal(app.db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${t === 'student_profiles' ? 'user_id' : (t === 'sessions' ? 'user_id' : 'student_id')} = ?`).get(stu2Id).c, 0, t);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM users WHERE student_no = ?').get(stu2No).c, 0);
  assert.equal((await api('DELETE', `/api/students/${stu2Id}`, { cookie: admin })).status, 404);
});

test('الذمم والقواعد: تعديل وحذف مع التحقق من المعاملات', async () => {
  app.db.prepare("INSERT INTO student_holds (id, student_id, hold_type, note, created_at) VALUES (900, ?, 'financial', 'a', ?)").run(stuId, Date.now());
  assert.equal((await api('PUT', '/api/admin/holds/900', { cookie: admin, body: { holdType: 'library', note: 'كتاب متأخر' } })).status, 200);
  assert.equal(app.db.prepare('SELECT hold_type, note FROM student_holds WHERE id = 900').get().hold_type, 'library');
  assert.equal((await api('PUT', '/api/admin/holds/900', { cookie: admin, body: { holdType: 'bogus' } })).status, 400);
  assert.equal((await api('DELETE', '/api/admin/holds/900', { cookie: admin })).status, 200);
  assert.equal((await api('DELETE', '/api/admin/holds/900', { cookie: admin })).status, 404);
  assert.equal((await api('DELETE', '/api/admin/holds/900', { cookie: staff })).status, 403);

  const rules = (await api('GET', '/api/admin/rules', { cookie: admin })).json.rules, mx = rules.find((r) => r.kind === 'max_open_per_service');
  assert.equal((await api('PUT', `/api/admin/rules/${mx.id}`, { cookie: admin, body: { message: 'رسالة جديدة للطالب', params: '{"max":3}' } })).status, 200);
  assert.equal(JSON.parse(app.db.prepare('SELECT params_json FROM rules WHERE id = ?').get(mx.id).params_json).max, 3);
  assert.equal((await api('PUT', `/api/admin/rules/${mx.id}`, { cookie: admin, body: { params: '{"max":-5}' } })).status, 400);
  assert.equal((await api('PUT', `/api/admin/rules/${mx.id}`, { cookie: admin, body: { params: 'not json' } })).status, 400);
  assert.equal((await api('DELETE', `/api/admin/rules/${mx.id}`, { cookie: admin })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/rules/${mx.id}`, { cookie: admin })).status, 404);
});

test('الحسابات والوحدات: حذف مع حمايات (النفس، آخر مدير، السجلات المرتبطة)', async () => {
  const mk = async (u) => (await api('POST', '/api/admin/users', { cookie: admin, body: { username: u, displayName: 'حساب ' + u, role: 'staff', password: 'Aa1234567890x' } })).json.id;
  const id = await mk('tmpuser');
  assert.equal((await api('DELETE', `/api/admin/users/${id}`, { cookie: staff })).status, 403);
  assert.equal((await api('DELETE', `/api/admin/users/${id}`, { cookie: admin })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/users/${id}`, { cookie: admin })).status, 404);
  const adminId = app.db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  assert.equal((await api('DELETE', `/api/admin/users/${adminId}`, { cookie: admin })).status, 400);        // نفسه
  const busy = await mk('busyuser'); app.db.prepare('INSERT INTO news (title, body, published_at, created_by) VALUES (?,?,?,?)').run('t', 'tt', Date.now(), busy);
  const r = await api('DELETE', `/api/admin/users/${busy}`, { cookie: admin }); assert.equal(r.status, 409, r.text);
  assert.ok(app.db.prepare('SELECT 1 FROM users WHERE id = ?').get(busy));                                   // لم يُحذف (تراجعت المعاملة)

  const u = await api('POST', '/api/admin/units', { cookie: admin, body: { name: 'وحدة مؤقتة', kind: 'office' } });
  const u2 = await api('POST', '/api/admin/units', { cookie: admin, body: { name: 'وحدة أخرى', kind: 'office' } });
  await api('POST', '/api/admin/links', { cookie: admin, body: { from: u.json.id, to: u2.json.id, twoWay: true } });
  assert.equal((await api('DELETE', `/api/admin/units/${u.json.id}`, { cookie: admin })).status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM unit_links WHERE from_unit = ? OR to_unit = ?').get(u.json.id, u.json.id).c, 0);   // رابطها حُذف معها
  assert.equal((await api('DELETE', `/api/admin/units/${u.json.id}`, { cookie: admin })).status, 404);
});

test('التصدير: لا خيار Power BI، والتدقيق سليم بعد كل ما سبق', async () => {
  const rep = await api('GET', '/api/analytics/export.xlsx?kind=powerbi', { cookie: admin });
  assert.equal(rep.status, 200);
  const html = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  assert.ok(!/power ?bi/i.test(html));
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.ok(!/(^|\n)\s*body \*\{visibility:hidden\}/.test(css), 'قاعدة إخفاء الصفحة يجب أن تكون محصورة بـ body.print-cred');
  assert.equal(verifyAuditChain(app.db).ok, true);
});

test('مدة الدراسة: كلية العلوم الأمنية 3 سنوات والأمن السيبراني 4', async () => {
  const yrs = Object.fromEntries(app.db.prepare('SELECT f.code, g.years FROM programs g JOIN faculties f ON f.id = g.faculty_id').all().map((r) => [r.code, r.years]));
  assert.equal(yrs.CSS, 3); assert.equal(yrs.CCS, 4);
  const css = app.db.prepare("SELECT g.id FROM programs g JOIN faculties f ON f.id = g.faculty_id WHERE f.code = 'CSS'").get().id;
  const ccs = app.db.prepare("SELECT g.id FROM programs g JOIN faculties f ON f.id = g.faculty_id WHERE f.code = 'CCS'").get().id;
  const add = (pid, level) => api('POST', '/api/courses', { cookie: staff, body: { programId: pid, level, semester: 1, name: `م${pid}-${level}`, hours: 3 } });
  assert.equal((await add(css, 3)).status, 201); assert.equal((await add(css, 4)).status, 400);
  assert.equal((await add(ccs, 4)).status, 201);
});
