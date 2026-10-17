import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { drainCertificates } from '../server/services/enrollcert.js';

const PW = 'Test#Pass12345', fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
let app, base, staff, auditor, stu, ccs, css, cCss1, cCss2;
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
async function loginAs(u, p = PW) { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; }
const G = (qs, cookie = staff) => api('GET', '/api/grades' + (qs ? '?' + qs : ''), { cookie });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-tbl-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['staff', 'staff'], ['auditor', 'auditor']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  staff = await loginAs('staff'); auditor = await loginAs('auditor');
  const imp = (k, f) => api('POST', `/api/import/${k}`, { cookie: staff, body: { filename: f, data: fx(f).toString('base64'), commit: true } });
  assert.equal((await imp('students', 'students-filled.xlsx')).json.created, 2); await imp('courses', 'courses-filled.xlsx'); await drainCertificates(app.db);
  ccs = app.db.prepare("SELECT id FROM users WHERE student_no = 'CCS-2026-0001'").get().id; css = app.db.prepare("SELECT id FROM users WHERE student_no = 'CSS-2026-0001'").get().id;
  cCss1 = app.db.prepare("SELECT id FROM courses WHERE code = 'CSS101'").get().id; cCss2 = app.db.prepare("SELECT id FROM courses WHERE code = 'CSS102'").get().id;
  app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(h, css); stu = await loginAs('CSS-2026-0001');
  const put = (sid, cid, y, th, pr) => api('POST', `/api/students/${sid}/grades`, { cookie: staff, body: { courseId: cid, academicYear: y, theory: th, practical: pr } });
  for (const [y, th] of [['2020/2021', 20], ['2021/2022', 35], ['2022/2023', 50], ['2023/2024', 55], ['2024/2025', 70], ['2025/2026', 90]]) assert.equal((await put(css, cCss1, y, th, '')).status, 200);
  assert.equal((await put(css, cCss2, '2025/2026', 40, 30)).status, 200);
});
test.after(async () => { await app.close(); });

test('دليل المواد: الموظف يرى كل المقررات من كل الجهات مع بيانات الكلية، والطالب يرى مقررات برنامجه فقط', async () => {
  const all = (await api('GET', '/api/courses', { cookie: staff })).json.courses;
  assert.equal(all.length, 3);                                                         // مقرر السنة الخامسة رُفض (مدة كلية العلوم الأمنية 3 سنوات)
  assert.deepEqual([...new Set(all.map((c) => c.faculty))].sort(), ['كلية العلوم الأمنية', 'مركز الدراسات والبحوث الأمنية'].sort());
  const c1 = all.find((c) => c.code === 'CSS101'); assert.equal(c1.facultyCode, 'CSS'); assert.equal(c1.grades, 6); assert.ok(c1.program && c1.years >= 3 && c1.programId);
  assert.equal(all.find((c) => c.code === 'CSSR101').grades, 0);
  assert.equal((await api('GET', `/api/courses?program=${c1.programId}`, { cookie: staff })).json.courses.length, 2);
  assert.equal((await api('GET', '/api/courses?level=1&semester=2', { cookie: staff })).json.courses.length, 1);
  const mine = (await api('GET', '/api/courses', { cookie: stu })).json.courses; assert.ok(mine.length >= 2 && mine.every((c) => !('faculty' in c) && c.active));
  assert.equal((await api('GET', '/api/courses', { cookie: auditor })).status, 403);
});

test('جدول العلامات: الصلاحيات والبنية والملخص', async () => {
  assert.equal((await G('', auditor)).status, 403); assert.equal((await G('', stu)).status, 403); assert.equal((await api('GET', '/api/grades')).status, 401);
  const r = (await G('')).json;
  assert.equal(r.total, 7); assert.equal(r.rows.length, 7); assert.equal(r.page, 1); assert.equal(r.pages, 1);
  assert.equal(r.summary.count, 7); assert.equal(r.summary.students, 1); assert.equal(r.summary.average, Math.round(((20 + 35 + 50 + 55 + 70 + 90 + 70) / 7) * 10) / 10); assert.equal(r.summary.passRate, Math.round((3 / 7) * 1000) / 10);
  const row = r.rows.find((x) => x.course === 'القانون الجزائي');
  assert.deepEqual([row.studentNo, row.faculty, row.code, row.theory, row.practical, row.total, row.passed, row.academicYear, row.level, row.semester], ['CSS-2026-0001', 'كلية العلوم الأمنية', 'CSS102', 40, 30, 70, true, '2025/2026', 1, 2]);
  assert.match(row.studentName, /^سعد/); assert.ok(row.studentId === css && row.programId && row.courseId === cCss2);
  assert.equal(r.options.faculties.length, 6); assert.deepEqual(r.options.years, ['2025/2026', '2024/2025', '2023/2024', '2022/2023', '2021/2022', '2020/2021']);
});

test('البحث: بالاسم والرقم الجامعي والكلية/المعهد والمادة ورمزها، ولا تُفسَّر الرموز الخاصة', async () => {
  const n = async (qs) => (await G(qs)).json.total;
  assert.equal(await n('q=' + encodeURIComponent('سعد')), 7);                         // الاسم
  assert.equal(await n('q=' + encodeURIComponent('ليلى')), 0);                         // طالبة أخرى لا علامات لها
  assert.equal(await n('q=' + encodeURIComponent('أحمد الحسن')), 7);                   // اسم مركّب (الاسم + الأب + الكنية)
  assert.equal(await n('q=css-2026'), 7); assert.equal(await n('q=CSS-2026-0001'), 7); assert.equal(await n('q=ccs-2026'), 0);   // الرقم الجامعي (غير حساس للحالة)
  assert.equal(await n('q=' + encodeURIComponent('العلوم الأمنية')), 7);              // الكلية
  assert.equal(await n('q=' + encodeURIComponent('السيبراني')), 0);
  assert.equal(await n('q=' + encodeURIComponent('الجزائي')), 1);                      // المادة
  assert.equal(await n('q=CSS102'), 1);                                                // رمز المادة
  assert.equal(await n('q=' + encodeURIComponent('  القانون   الجزائي ')), 1);          // مسافات زائدة
  assert.equal(await n('q=%25'), 0); assert.equal(await n('q=_'), 0); assert.equal(await n('q=' + encodeURIComponent("' OR 1=1 --")), 0);   // LIKE وSQL
  assert.equal((await G('q=' + 'x'.repeat(500))).status, 200);
});

test('الفلاتر: كلية، مقرر، سنة دراسية، فصل، عام، حالة', async () => {
  const n = async (qs) => (await G(qs)).json.total, fid = app.db.prepare("SELECT id FROM faculties WHERE code = 'CSS'").get().id;
  assert.equal(await n(`faculty=${fid}`), 7); assert.equal(await n('faculty=3'), 0);
  assert.equal(await n(`course=${cCss1}`), 6); assert.equal(await n(`course=${cCss2}`), 1);
  assert.equal(await n('level=1'), 7); assert.equal(await n('level=2'), 0); assert.equal(await n('semester=2'), 1);
  assert.equal(await n('year=2025/2026'), 2); assert.equal(await n('year=bad'), 7);
  assert.equal(await n('status=pass'), 3); assert.equal(await n('status=fail'), 4);
  assert.equal(await n(`faculty=${fid}&status=pass&year=2025/2026&q=${encodeURIComponent('مدخل')}`), 1);
  const f = (await G('status=fail')).json; assert.equal(f.summary.passRate, 0); assert.ok(f.rows.every((r) => !r.passed));
});

test('الترتيب والصفحات', async () => {
  const col = async (qs, k) => (await G(qs)).json.rows.map((r) => r[k]);
  assert.deepEqual(await col('sort=total&dir=asc', 'total'), [20, 35, 50, 55, 70, 70, 90]);
  assert.deepEqual(await col('sort=total&dir=desc', 'total'), [90, 70, 70, 55, 50, 35, 20]);
  assert.deepEqual((await col('sort=academicYear&dir=asc', 'academicYear'))[0], '2020/2021');
  assert.equal((await col('sort=course&dir=asc', 'course'))[0], 'القانون الجزائي');
  assert.equal((await G('sort=DROP;TABLE&dir=sideways')).status, 200);                        // قيم غير معروفة تُهمل
  const p1 = (await G('size=5&page=1&sort=total&dir=asc')).json, p2 = (await G('size=5&page=2&sort=total&dir=asc')).json;
  assert.deepEqual([p1.rows.length, p2.rows.length, p1.pages, p1.total], [5, 2, 2, 7]);
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size, 7);                    // بلا تكرار بين الصفحات
  assert.equal((await G('size=5&page=99')).json.page, 2);                                      // الصفحة تُقصّ إلى الأخيرة
  assert.equal((await G('size=1000')).json.size, 100);
});

test('التعديل والحذف من الجدول: إعادة الإدخال تعدّل، والحذف يحدّث الجدول والملخص', async () => {
  const r0 = (await G(`course=${cCss2}`)).json.rows[0];
  assert.equal((await api('POST', `/api/students/${r0.studentId}/grades`, { cookie: staff, body: { courseId: r0.courseId, academicYear: r0.academicYear, theory: 95, practical: 5 } })).status, 200);
  const r1 = (await G(`course=${cCss2}`)).json.rows[0]; assert.equal(r1.id, r0.id); assert.equal(r1.total, 100);
  assert.equal((await api('DELETE', `/api/students/${r0.studentId}/grades/${r0.id}`, { cookie: staff })).status, 200);
  const after = (await G('')).json; assert.equal(after.total, 6); assert.equal((await G(`course=${cCss2}`)).json.total, 0);
  assert.equal((await api('DELETE', `/api/students/${css}/grades/${r0.id}`, { cookie: staff })).status, 404);
});
