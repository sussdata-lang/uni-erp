import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345';
let app, base, staff, admin;

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(username, password = PW) {
  app.limiter.hits.clear();
  const r = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return { cookie: r.headers.get('set-cookie').split(';')[0], user: r.json.user };
}
const form = (o = {}) => ({
  first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', name_en: 'Layla Alhasan',
  national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية', marital_status: 'عازب/عزباء',
  phone: '0944 123 456', email: 'Layla@Example.com', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء، بناء 4',
  hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_school: 'ثانوية الأمل', hs_governorate: 'دمشق', hs_score: 2100,
  program_id: 2, admission_type: 'القبول العام (المفاضلة)', enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 1,
  guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', notes: 'ملاحظة داخلية', ...o,
});

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-st-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['admin', 'مدير', 'admin'], ['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = (await loginAs('staff')).cookie; admin = (await loginAs('admin')).cookie;
});
test.after(async () => { await app.close(); });

test('التسجيل: ينشئ ملفاً كاملاً ورقماً جامعياً وكلمة مؤقتة تُجبر على التغيير', async () => {
  const r = await api('POST', '/api/students', { cookie: staff, body: form() });
  assert.equal(r.status, 201, r.text);
  const { student, credentials } = r.json;
  assert.match(student.studentNo, /^CSS-2024-0001$/);          // CSS = كلية العلوم الأمنية
  assert.equal(credentials.username, student.studentNo);
  assert.equal(student.profile.phone, '0944123456');          // تنظيف الفراغات
  assert.equal(student.profile.email, 'layla@example.com');
  assert.equal(student.profile.status, 'active');
  // أرقام متسلسلة داخل السنة نفسها
  const r2 = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '01234567891', first_name: 'سامر', mother_name: 'هدى' }) });
  assert.equal(r2.json.student.studentNo, 'CSS-2024-0002');

  // دخول الطالب بكلمة مؤقتة: كل شيء محجوب حتى يغيّرها
  const s = await loginAs(credentials.username, credentials.tempPassword);
  assert.equal(s.user.mustChange, true);
  const blocked = await api('GET', '/api/services', { cookie: s.cookie });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.error, 'password_change_required');
  assert.equal((await api('POST', '/api/auth/change-password', { cookie: s.cookie, body: { current: credentials.tempPassword, next: 'short' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/change-password', { cookie: s.cookie, body: { current: 'wrong-pass-123', next: 'NewPass#2026ok' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/change-password', { cookie: s.cookie, body: { current: credentials.tempPassword, next: 'NewPass#2026ok' } })).status, 200);
  assert.equal((await api('GET', '/api/services', { cookie: s.cookie })).status, 200);

  // ملف الطالب لنفسه بلا ملاحظات الموظف
  const mine = await api('GET', '/api/me/profile', { cookie: s.cookie });
  assert.equal(mine.json.profile.profile.notes, undefined);
  assert.equal(mine.json.profile.profile.mother_name, 'سعاد الخطيب');
  assert.equal((await api('POST', '/api/auth/login', { body: { username: credentials.username, password: credentials.tempPassword } })).status, 401);
});

test('التحقق: يرفض النواقص والقيم غير المنطقية ويحدد الحقل', async () => {
  const bad = async (over, field, status = 400) => {
    const r = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '99999999999', ...over }) });
    assert.equal(r.status, status, JSON.stringify(over) + r.text); assert.equal(r.json.field, field, r.text);
  };
  await bad({ first_name: '' }, 'first_name');
  await bad({ first_name: '<script>' }, 'first_name');
  await bad({ national_id: '12' }, 'national_id');
  await bad({ phone: 'abc' }, 'phone');
  await bad({ email: 'x@y' }, 'email');
  await bad({ gender: 'غير ذلك' }, 'gender');
  await bad({ birth_date: '2030-01-01' }, 'birth_date');
  await bad({ birth_date: '2006-02-31' }, 'birth_date');
  await bad({ hs_score: -5 }, 'hs_score');
  await bad({ hs_year: 2030 }, 'hs_year');
  await bad({ program_id: 9999 }, 'program_id');
  await bad({ study_level: 7 }, 'study_level');                // البرنامج 2 مدته 4 سنوات
  await bad({ name_en: 'ليلى' }, 'name_en');
  await bad({ guardian_phone: '' }, 'guardian_phone');
  // تكرار الرقم الوطني وتكرار الهوية الاسمية
  await bad({ national_id: '01234567890' }, 'national_id', 409);
  await bad({ national_id: '55555555555' }, 'first_name', 409);
});

test('الصلاحيات: الطالب والمدقق ممنوعان، والموظف والمدير مسموحان', async () => {
  const st = (await api('GET', '/api/students?q=ليلى', { cookie: staff })).json.students[0];
  const s = await loginAs(st.studentNo, 'NewPass#2026ok'); const a = await loginAs('auditor');
  for (const c of [s.cookie, a.cookie]) {
    assert.equal((await api('GET', '/api/students', { cookie: c })).status, 403);
    assert.equal((await api('GET', `/api/students/${st.id}`, { cookie: c })).status, 403);
    assert.equal((await api('POST', '/api/students', { cookie: c, body: form() })).status, 403);
    assert.equal((await api('PUT', `/api/students/${st.id}`, { cookie: c, body: form() })).status, 403);
    assert.equal((await api('GET', '/api/registration/options', { cookie: c })).status, 403);
  }
  assert.equal((await api('GET', '/api/students')).status, 401);
  assert.equal((await api('GET', '/api/students', { cookie: admin })).status, 200);
});

test('القائمة: بحث بالاسم والرقم والهاتف، والرقم الوطني مقنَّع، وفتح الملف يُدقَّق', async () => {
  for (const q of ['ليلى', '2024-0001', '0944123456', '01234567890']) {
    const r = await api('GET', '/api/students?q=' + encodeURIComponent(q), { cookie: staff });
    assert.ok(r.json.total >= 1, q);
    assert.ok(r.json.students[0].nationalId.includes('•'));
    assert.ok(!r.text.includes('01234567890'));
  }
  assert.equal((await api('GET', '/api/students?q=%25', { cookie: staff })).json.total, 0);   // % حرفي لا شاملة
  assert.equal((await api('GET', '/api/students?status=withdrawn', { cookie: staff })).json.total, 0);
  const id = (await api('GET', '/api/students?q=ليلى', { cookie: staff })).json.students[0].id;
  const d = await api('GET', `/api/students/${id}`, { cookie: staff });
  assert.equal(d.json.student.profile.national_id, '01234567890');
  assert.equal(d.json.student.profile.notes, 'ملاحظة داخلية');
  assert.ok(app.db.prepare("SELECT 1 FROM audit_log WHERE action = 'عرض ملف طالب'").get());
});

test('التعديل: يحدّث الاسم والبرنامج، وحالة غير مقيَّد توقف إفادة الدوام فقط', async () => {
  const id = (await api('GET', '/api/students?q=ليلى', { cookie: staff })).json.students[0].id;
  const u = await api('PUT', `/api/students/${id}`, { cookie: staff, body: form({ study_level: 2, phone: '0955000111', program_id: 1 }) });
  assert.equal(u.status, 200, u.text);
  const row = app.db.prepare('SELECT display_name, program FROM users WHERE id = ?').get(id);
  assert.equal(row.display_name, 'ليلى أحمد الحسن');
  assert.match(row.program, /المعهد العالي للعلوم الأمنية - السنة الثانية/);
  // تعديل رقم وطني إلى رقم طالب آخر مرفوض
  assert.equal((await api('PUT', `/api/students/${id}`, { cookie: staff, body: form({ national_id: '01234567891' }) })).status, 409);

  const w = await api('PUT', `/api/students/${id}`, { cookie: staff, body: form({ study_level: 2, program_id: 1, status: 'withdrawn' }) });
  assert.equal(w.json.student.status, 'withdrawn');
  const s = await loginAs('CSS-2024-0001', 'NewPass#2026ok');
  const att = await api('POST', '/api/requests', { cookie: s.cookie, body: { service: 'attendance', details: { purpose: 'سفارة', copies: 1 } } });
  assert.equal(att.json.request.status, 'rejected'); assert.equal(att.json.request.rejectedBy, 'auto');
  const tr = await api('POST', '/api/requests', { cookie: s.cookie, body: { service: 'transcript', details: { lang: 'العربية', copies: 1 } } });
  assert.equal(tr.json.request.status, 'review');
  await api('PUT', `/api/students/${id}`, { cookie: staff, body: form({ study_level: 2, program_id: 1, status: 'active' }) });
  assert.equal((await api('POST', '/api/requests', { cookie: s.cookie, body: { service: 'attendance', details: { purpose: 'سفارة', copies: 1 } } })).json.request.status, 'review');
});

test('إعادة تعيين كلمة المرور: تنهي الجلسات وتفرض التغيير', async () => {
  const id = (await api('GET', '/api/students?q=ليلى', { cookie: staff })).json.students[0].id;
  const old = await loginAs('CSS-2024-0001', 'NewPass#2026ok');
  const r = await api('POST', `/api/students/${id}/reset-password`, { cookie: staff, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/api/me', { cookie: old.cookie })).json.user, null);
  const n = await loginAs('CSS-2024-0001', r.json.credentials.tempPassword);
  assert.equal(n.user.mustChange, true);
});

test('البرامج: المدير يضيف ويعطّل، والموظف لا، والمعطَّل لا يقبل تسجيلاً جديداً', async () => {
  assert.equal((await api('POST', '/api/admin/programs', { cookie: staff, body: { facultyId: 2, name: 'ب', years: 4 } })).status, 403);
  assert.equal((await api('POST', '/api/admin/programs', { cookie: admin, body: { facultyId: 2, name: 'ب', years: 9 } })).status, 400);
  assert.equal((await api('POST', '/api/admin/programs', { cookie: admin, body: { facultyId: 999, name: 'ب', years: 4 } })).status, 400);   // الكلية من القائمة المعتمدة فقط
  const add = await api('POST', '/api/admin/programs', { cookie: admin, body: { facultyId: 3, name: 'أمن الشبكات', degree: 'بكالوريوس', years: 4 } });
  assert.equal(add.status, 201, add.text);
  assert.equal((await api('POST', '/api/admin/programs', { cookie: admin, body: { facultyId: 3, name: 'أمن الشبكات', years: 4 } })).status, 409);
  const opt = await api('GET', '/api/registration/options', { cookie: staff });
  const options = opt.json.sections.flatMap((s) => s.fields).find((f) => f.name === 'program_id').options;
  assert.ok(options.some((o) => o.v === add.json.id && /كلية الأمن السيبراني — بكالوريوس أمن الشبكات/.test(o.l)));
  assert.ok(options.some((o) => o.l === 'كلية العلوم الأمنية'));                       // البرنامج الأساسي يحمل اسم الجهة فيُعرض باسمها فقط
  await api('POST', `/api/admin/programs/${add.json.id}/toggle`, { cookie: admin, body: { enabled: false } });
  const r = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '77777777777', first_name: 'عمر', mother_name: 'رنا', program_id: add.json.id, study_level: 1 }) });
  assert.equal(r.status, 400); assert.equal(r.json.field, 'program_id');
});

test('الكليات: الجهات الست المعتمدة ورموزها الإنكليزية', async () => {
  const f = (await api('GET', '/api/faculties', { cookie: staff })).json.faculties.filter((x) => x.active);
  assert.deepEqual(f.map((x) => [x.name, x.code]), [
    ['المعهد العالي للعلوم الأمنية', 'HISS'], ['كلية العلوم الأمنية', 'CSS'], ['كلية الأمن السيبراني', 'CCS'],
    ['مركز الدراسات والبحوث الأمنية', 'CSSR'], ['المعهد التقاني للعلوم الأمنية', 'TISS'], ['المعهد التقاني للأمن السيبراني', 'TICS']]);
  const progs = (await api('GET', '/api/programs', { cookie: staff })).json.programs.filter((p) => p.active);
  assert.equal(progs.length, 6);                                                         // لا بقايا من البرامج التجريبية القديمة
  assert.ok(!app.db.prepare("SELECT 1 FROM programs WHERE name LIKE '%هندسة%' OR faculty LIKE '%الاقتصاد%'").get());
});

test('الترميز: اسم المستخدم يبدأ برمز الكلية، والتسلسل مستقل لكل كلية وسنة', async () => {
  const NAMES = ['', 'سعد', 'ماهر', 'نادر', 'باسل', 'وائل'];
  const reg = async (programId, nid, year) => (await api('POST', '/api/students', { cookie: staff, body: form({ national_id: nid, first_name: NAMES[Number(nid.slice(-1))], mother_name: 'أم ' + NAMES[Number(nid.slice(-1))], program_id: programId, enroll_year: year, hs_year: Math.min(year, 2024), study_level: 1 }) })).json;
  const a = await reg(3, '31000000001', 2025), b = await reg(3, '31000000002', 2025), c = await reg(3, '31000000003', 2026), d = await reg(4, '31000000004', 2025);
  assert.equal(a.student.studentNo, 'CCS-2025-0001'); assert.equal(b.student.studentNo, 'CCS-2025-0002');
  assert.equal(c.student.studentNo, 'CCS-2026-0001');                                    // سنة جديدة تبدأ من 1
  assert.equal(d.student.studentNo, 'CSSR-2025-0001');                                   // كلية أخرى تبدأ من 1
  assert.equal(a.credentials.username, a.student.studentNo);                            // اسم المستخدم = الرقم الجامعي
  const login = await loginAs(a.credentials.username, a.credentials.tempPassword);
  assert.equal(login.user.role, 'student');
  // رمز CSS لا يختلط مع CSSR عند حساب التسلسل
  const e = await reg(2, '31000000005', 2025);
  assert.equal(e.student.studentNo, 'CSS-2025-0001');
});

test('الكليات: إضافة جهة جديدة تولّد رمزاً من اسمها الإنكليزي وتمنع التكرار', async () => {
  assert.equal((await api('POST', '/api/admin/faculties', { cookie: staff, body: { name: 'كلية الاستخبارات', nameEn: 'College of Intelligence Studies' } })).status, 403);
  const ok = await api('POST', '/api/admin/faculties', { cookie: admin, body: { name: 'كلية الاستخبارات', nameEn: 'College of Intelligence Studies', kind: 'college' } });
  assert.equal(ok.status, 201, ok.text); assert.equal(ok.json.code, 'CIS');
  assert.equal((await api('POST', '/api/admin/faculties', { cookie: admin, body: { name: 'كلية أخرى', nameEn: 'Common Intelligence School', code: 'CIS' } })).status, 409);
  assert.equal((await api('POST', '/api/admin/faculties', { cookie: admin, body: { name: 'كلية الاستخبارات', nameEn: 'Another Name' } })).status, 409);
  assert.equal((await api('POST', '/api/admin/faculties', { cookie: admin, body: { name: 'جهة', nameEn: 'عربي' } })).status, 400);
  const prog = app.db.prepare('SELECT id FROM programs WHERE faculty_id = ?').get(ok.json.id);
  const r = await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '32000000001', program_id: prog.id, first_name: 'سهى', mother_name: 'منى' }) });
  assert.match(r.json.student.studentNo, /^CIS-2024-0001$/);
  await api('POST', `/api/admin/faculties/${ok.json.id}/toggle`, { cookie: admin, body: { enabled: false } });
  assert.equal((await api('POST', '/api/students', { cookie: staff, body: form({ national_id: '32000000002', program_id: prog.id, first_name: 'ريم', mother_name: 'هبة' }) })).status, 400);   // الجهة المعطَّلة لا تسجّل طلاباً
});

test('التدقيق: السلسلة سليمة ولا تحوي بيانات شخصية', () => {
  assert.equal(verifyAuditChain(app.db).ok, true);
  const all = JSON.stringify(app.db.prepare('SELECT action, ref FROM audit_log').all());
  for (const secret of ['01234567890', '0944123456', 'سعاد']) assert.ok(!all.includes(secret), secret);
});
