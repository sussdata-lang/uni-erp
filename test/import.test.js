import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { writeXlsx, readXlsx } from '../server/lib/xlsx.js';
import { verifyAuditChain } from '../server/audit.js';

const PW = 'Test#Pass12345', fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
let app, base, admin, staff, auditor;
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(u, p = PW) { app.limiter.hits.clear(); const r = await api('POST', '/api/auth/login', { body: { username: u, password: p } }); assert.equal(r.status, 200, r.text); return r.headers.get('set-cookie').split(';')[0]; }
const up = (kind, filename, buf, commit, cookie = staff) => api('POST', `/api/import/${kind}`, { cookie, body: { filename, data: Buffer.from(buf).toString('base64'), commit } });
const sheet = (rows) => writeXlsx([{ name: 'البيانات', rows }]);
const count = (t) => app.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-imp-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff'], ['auditor', 'auditor']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  admin = await loginAs('admin'); staff = await loginAs('staff'); auditor = await loginAs('auditor');
});
test.after(async () => { await app.close(); });

test('القوالب: تُقدَّم من الموقع وهي ملفات xlsx سليمة بصف عناوين كامل', async () => {
  for (const [f, minCols] of [['students-template.xlsx', 30], ['courses-template.xlsx', 8], ['grades-template.xlsx', 8]]) {
    const r = await fetch(`${base}/templates/${f}`); assert.equal(r.status, 200);
    const wb = readXlsx(Buffer.from(await r.arrayBuffer()));
    assert.ok(wb.sheets[0].rows[0].length >= minCols, f); assert.equal(wb.sheets[0].name, 'البيانات');
  }
});

test('الصلاحيات والأخطاء العامة', async () => {
  assert.equal((await up('students', 'a.xlsx', fx('students-filled.xlsx'), false, auditor)).status, 403);
  assert.equal((await up('nothing', 'a.xlsx', fx('students-filled.xlsx'), false)).status, 403);
  assert.equal((await api('POST', '/api/import/students', { body: { filename: 'a.xlsx', data: 'AA==' } })).status, 401);
  assert.equal((await up('students', 'a.xls', Buffer.from('xx'), false)).status, 400);
  assert.equal((await up('students', 'a.txt', Buffer.from('نص عادي بلا جدول'), false)).status, 400);
  const miss = await up('students', 'a.xlsx', sheet([['الاسم الأول', 'اسم الأب'], ['ليلى', 'أحمد']]), false);
  assert.equal(miss.status, 400); assert.match(miss.json.message, /أعمدة مطلوبة غير موجودة/);
  assert.equal((await up('students', 'a.xlsx', sheet([['كلام', 'آخر'], ['1', '2']]), false)).status, 400);
});

test('الطلاب: الفحص لا يكتب شيئاً ويبلّغ عن الصفوف الخاطئة برقمها', async () => {
  const before = count('users');
  const r = await up('students', 'students.xlsx', fx('students-filled.xlsx'), false);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.total, 4); assert.equal(r.json.valid, 2); assert.equal(r.json.committed, false); assert.equal(r.json.created, 0);
  assert.deepEqual(r.json.errors.map((e) => e.row), [4, 5]);
  assert.match(r.json.errors[0].message, /مكرَّر في الملف/); assert.match(r.json.errors[1].message, /غير معروفة/);
  assert.equal(count('users'), before);
});

test('الطلاب: الاعتماد يسجّل الصحيح بترميز الكلية ويسلّم بيانات الدخول في ملف', async () => {
  const r = await up('students', 'students.xlsx', fx('students-filled.xlsx'), true);
  assert.equal(r.json.created, 2); assert.equal(r.json.errorCount, 2);
  const cred = readXlsx(Buffer.from(r.json.credentialsXlsx, 'base64')).sheets[0].rows;
  assert.deepEqual(cred.slice(1).map((x) => x[0]).sort(), ['CCS-2026-0001', 'CSS-2026-0001']);
  const [u, , , pw] = cred.find((x) => x[0] === 'CCS-2026-0001');
  app.limiter.hits.clear();
  const l = await api('POST', '/api/auth/login', { body: { username: u, password: pw } }); assert.equal(l.status, 200); assert.equal(l.json.user.role, 'student');
  // إعادة الرفع: كل الصفوف مكررة فلا يُنشأ شيء
  const again = await up('students', 'students.xlsx', fx('students-filled.xlsx'), true);
  assert.equal(again.json.created, 0); assert.ok(again.json.errors.some((e) => /مسجَّل مسبقاً/.test(e.message)));
  assert.equal(count('student_profiles'), 2);
});

const NAMES = ['سعد', 'ماهر', 'نادر', 'باسل', 'وائل', 'ياسر'];
test('الطلاب من ملف SQL (أعمدة إنكليزية) ومن CSV', async () => {
  const q = (s) => `'${s}'`;
  const sql = `-- dump\nCREATE TABLE students (id int, first_name text);\nINSERT INTO \`students\` (first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, faculty, admission_type, enroll_year, enroll_term, study_level, guardian_name, guardian_relation, guardian_phone) VALUES\n` +
    [1, 2].map((i) => `(${[NAMES[i], 'علي', 'الخطيب', 'هدى ' + NAMES[i], '3000000000' + i, 'ذكر', '14/03/2005', 'حمص', 'سورية', '944000000' + i, 'حمص', 'الوعر', 'شارع 1', fx('students-filled.xlsx') && 'الثانوية العامة - الفرع العلمي', '2024', '2000', 'TICS', 'القبول العام (المفاضلة)', '2026', 'الفصل الأول', '1', 'علي الخطيب', 'الأب', '933000000' + i].map((v) => q(v)).join(',')})`).join(',\n') + ';\nDROP TABLE x;';
  const r = await up('students', 'dump.sql', Buffer.from(sql), false);
  assert.equal(r.status, 200, r.text);
  if (r.json.valid !== 2) console.log(JSON.stringify(r.json.errors));
  assert.equal(r.json.valid, 2);                                                                            // التاريخ 14/03/2005 والهاتف بلا صفر أول يُصحَّحان
  const c = await up('students', 'dump.sql', Buffer.from(sql), true);
  assert.deepEqual(c.json.created, 2); assert.ok(app.db.prepare("SELECT 1 FROM users WHERE student_no = 'TICS-2026-0001'").get());
  const csv = 'الكلية;اسم المقرر;السنة الدراسية;الفصل\nTICS;مقرر تجريبي;1;1\n';
  const cr = await up('courses', 'c.csv', Buffer.from('\uFEFF' + csv), true); assert.equal(cr.json.created, 1, cr.text);
});

test('المقررات: فحص ثم اعتماد ثم تحديث دون تكرار، ومدة البرنامج مُراعاة', async () => {
  const dry = await up('courses', 'courses.xlsx', fx('courses-filled.xlsx'), false);
  assert.equal(dry.json.valid, 3); assert.equal(dry.json.errors[0].row, 4); assert.match(dry.json.errors[0].message, /السنة الدراسية/);
  const before = count('courses'); assert.equal(count('courses'), before);
  const ok = await up('courses', 'courses.xlsx', fx('courses-filled.xlsx'), true);
  assert.equal(ok.json.created, 3); assert.equal(count('courses'), before + 3);
  const again = await up('courses', 'courses.xlsx', fx('courses-filled.xlsx'), true);
  assert.equal(again.json.created, 0); assert.equal(again.json.updated, 3); assert.equal(count('courses'), before + 3);
  assert.equal(app.db.prepare("SELECT instructor FROM courses WHERE code = 'CSS101'").get().instructor, 'د. سامر العلي');
});

test('العلامات: مطابقة المقرر بالاسم أو الرمز، تحديث، وأخطاء بالصف', async () => {
  const rows = [['الرقم الجامعي', 'اسم المقرر', 'رمز المقرر', 'العام الدراسي', 'العلامة النظرية', 'العلامة العملية'],
    ['CSS-2026-0001', 'مدخل إلى العلوم الأمنية', '', '2025-2026', 50, 30],
    ['css-2026-0001', '', 'CSS102', '2025/2026', 61, ''],
    ['CSS-2026-0001', 'مدخل إلى العلوم الأمنية', '', '2025/2026', 80, 40],         // المجموع > 100
    ['NOPE-1', 'مدخل إلى العلوم الأمنية', '', '2025/2026', 50, 10],
    ['CSS-2026-0001', 'مقرر غير موجود', '', '2025/2026', 50, 10],
    ['CSS-2026-0001', 'القانون الجزائي', '', '2025', 50, 10]];
  const dry = await up('grades', 'g.xlsx', sheet(rows), false);
  assert.equal(dry.status, 200, dry.text); assert.equal(dry.json.valid, 2); assert.deepEqual(dry.json.errors.map((e) => e.row), [4, 5, 6, 7]);
  assert.equal(count('grades'), 0);
  const ok = await up('grades', 'g.xlsx', sheet(rows), true);
  assert.equal(ok.json.created, 2); assert.equal(count('grades'), 2);
  rows.splice(3, 4); rows[1][4] = 55;
  const upd = await up('grades', 'g.xlsx', sheet(rows), true);
  assert.equal(upd.json.updated, 2); assert.equal(count('grades'), 2);
  assert.equal(app.db.prepare("SELECT mark FROM grades WHERE course = 'مدخل إلى العلوم الأمنية'").get().mark, 85);
  const sql = "INSERT INTO grades (student_no, course, academic_year, theory_mark, practical_mark) VALUES ('CSS-2026-0001','القانون الجزائي','2024/2025',70,'');";
  const s = await up('grades', 'g.sql', Buffer.from(sql), true); assert.equal(s.json.created, 1, s.text);
});

test('التدقيق: الاستيراد مسجَّل والسلسلة سليمة', () => {
  const acts = app.db.prepare('SELECT action FROM audit_log').all().map((r) => r.action).join('\n');
  for (const k of ['استيراد طلاب', 'استيراد مقررات', 'استيراد علامات']) assert.ok(acts.includes(k), k);
  assert.equal(verifyAuditChain(app.db).ok, true);
});
