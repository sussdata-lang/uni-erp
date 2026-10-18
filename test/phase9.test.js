import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';
import { encryptPayload, decryptPayload, endpointOk } from '../server/services/push.js';
import crypto from 'node:crypto';

const PW = 'Test#Pass12345';
let app, base, staff, admin, dir;

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-st-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['admin', 'مدير', 'admin'], ['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  staff = (await loginAs('staff')).cookie; admin = (await loginAs('admin')).cookie;
});
test.after(async () => { await app.close(); });


async function raw(method, url, buf, cookie, type = 'application/octet-stream') {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': type, Cookie: cookie }, body: buf });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let sid, sno;
test('تسجيل طالب بلا اسم الجد/المجموع الأعلى + مرفقات', async () => {
  const r = await api('POST', '/api/students', { cookie: staff, body: form() });
  assert.equal(r.status, 201, r.text); sid = r.json.student.id; sno = r.json.student.studentNo;
  const cols = app.db.prepare('PRAGMA table_info(student_profiles)').all().map((c) => c.name);
  assert.ok(!cols.includes('grandfather_name') && !cols.includes('hs_max'));
  const ph = await raw('POST', `/api/students/${sid}/files?kind=photo&name=p.png`, PNG, staff, 'image/png');
  assert.equal(ph.status, 201, ph.text);
  assert.equal((await raw('POST', `/api/students/${sid}/files?kind=photo&name=p2.png`, PNG, staff, 'image/png')).status, 201);   // تحلّ محل القديمة
  assert.equal((await raw('POST', `/api/students/${sid}/files?kind=identity&name=a.png`, PNG, staff)).status, 201);
  assert.equal((await raw('POST', `/api/students/${sid}/files?kind=other&name=x.exe`, Buffer.from('MZ\x90\x00junk'), staff)).status >= 400, true);
  assert.equal((await raw('POST', `/api/students/${sid}/files?kind=bogus&name=a.png`, PNG, staff)).status >= 400, true);
  const l = await api('GET', `/api/students/${sid}/files`, { cookie: staff });
  assert.equal(l.json.files.length, 2);
  const g = await fetch(base + `/api/student-files/${l.json.files[0].id}`, { headers: { Cookie: staff } });
  assert.equal(g.status, 200); assert.equal(l.json.files.filter((f) => f.kind === 'photo').length, 1); assert.deepEqual(Buffer.from(await g.arrayBuffer()), PNG);
  const d = await api('DELETE', `/api/student-files/${l.json.files[1].id}`, { cookie: staff });
  assert.equal(d.status, 200);
});

test('جدول الطلاب: كل بيانات التسجيل + فلاتر', async () => {
  const r = await api('GET', '/api/students-table?q=' + encodeURIComponent('ليلى'), { cookie: staff });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.rows.length >= 1);
  const row = r.json.rows[0]; assert.ok('mother_name' in row || 'motherName' in row || Object.keys(row).length > 10);
  assert.equal((await api('GET', '/api/students-table?q=zzzzqq', { cookie: staff })).json.rows.length, 0);
});

test('سجل القاعات: مسح دخول/خروج، تصدير، استيراد', async () => {
  const s1 = await api('POST', '/api/attendance/scan', { cookie: staff, body: { code: sno, kind: 'exam', subject: 'امتحان نهائي', hall: 'قاعة 1' } });
  assert.equal(s1.status, 200, s1.text); assert.equal(s1.json.action, 'in');
  assert.equal((await api('GET', '/api/attendance/open', { cookie: staff })).json.logs.length, 1);
  const other = await api('POST', '/api/attendance/scan', { cookie: staff, body: { code: sno, kind: 'exam', subject: 'امتحان نهائي', hall: 'قاعة 2' } });
  assert.equal(other.status, 409);
  const s2 = await api('POST', '/api/attendance/scan', { cookie: staff, body: { code: sno, kind: 'exam', subject: 'امتحان نهائي', hall: 'قاعة 1' } });
  assert.equal(s2.json.action, 'out');
  assert.equal((await api('POST', '/api/attendance/scan', { cookie: staff, body: { code: 'NOPE-0000', kind: 'exam', subject: 'x', hall: 'h' } })).status, 404);
  const l = await api('GET', '/api/attendance?hall=' + encodeURIComponent('قاعة 1'), { cookie: staff });
  assert.equal(l.status, 200, l.text); assert.equal((l.json.logs ?? l.json.rows).length, 1);
  const stu = await loginAs(sno, 'x').catch(() => null);
  assert.equal(stu, null);
  const ex = await fetch(base + '/api/export/file?dataset=attendance&format=xlsx', { headers: { Cookie: admin } });
  assert.equal(ex.status, 200); const b = Buffer.from(await ex.arrayBuffer()); assert.equal(b.subarray(0, 2).toString(), 'PK');
  const all = await fetch(base + '/api/export/file?dataset=all&format=xlsx', { headers: { Cookie: admin } });
  assert.equal(all.status, 200); assert.equal(Buffer.from(await all.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await api('GET', '/api/attendance', { cookie: undefined })).status, 401);
});

test('Web Push: تشفير RFC 8291 يُفك بمفاتيح المستلم + حماية endpoint', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  const b64u = (b) => b.toString('base64url');
  const body = encryptPayload('{"title":"مرحبا"}', b64u(ua.getPublicKey()), b64u(auth));
  assert.equal(decryptPayload(body, ua, b64u(auth)).toString(), '{"title":"مرحبا"}');
  assert.equal(endpointOk({}, 'https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(endpointOk({}, 'http://fcm.googleapis.com/x'), false);
  assert.equal(endpointOk({}, 'https://127.0.0.1/x'), false);
  assert.equal(endpointOk({}, 'https://evil.example.com/x'), false);
});

test('Web Push: اشتراك + مفتاح VAPID', async () => {
  const k = await api('GET', '/api/push/key', { cookie: staff }); assert.equal(k.status, 200); assert.ok(k.json.key.length > 60);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.equal((await api('POST', '/api/push/subscribe', { cookie: staff, body: { subscription: sub, ...sub } })).status, 200);
  assert.equal((await api('POST', '/api/push/subscribe', { cookie: staff, body: { endpoint: 'https://evil.com/x', keys: sub.keys } })).status >= 400, true);
});

test('النسخ الاحتياطي: إنشاء، تحقق، استعادة، صلاحية', async () => {
  const { restoreBackup } = await import('../server/services/backup.js');
  const r = await api('POST', '/api/admin/backups', { cookie: admin }); assert.equal(r.status, 201, r.text);
  const name = r.json.backup.name;
  assert.equal((await api('POST', '/api/admin/backups', { cookie: staff })).status, 403);
  const dl = await fetch(base + '/api/admin/backups/' + name, { headers: { Cookie: admin } }); assert.equal(dl.status, 200);
  assert.equal((await api('GET', '/api/admin/backups/..%2F..%2Fetc%2Fpasswd', { cookie: admin })).status, 404);
  const out = path.join(dir, 'restore'); 
  const res = restoreBackup(app.cfg ?? { dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up') }, path.join(dir, 'backups', name), { force: true });
  assert.ok(res);
});

test('PDF كشف العلامات: خطوط القالب (Cairo/Amiri) مضمّنة وليست DejaVu', async () => {
  const { buildPdf } = await import('../server/lib/pdf.js');
  for (const [fam, name] of [['cairo', 'Cairo-Regular'], ['amiri', 'Amiri-Regular'], ['dejavu', 'DejaVuSans']]) {
    const pdf = buildPdf({ family: fam, created: new Date(), title: 't', author: 'a', subject: 's', producer: 'p', signer: { name: 'x', reason: 'r', location: 'SY' } }, (d) => { d.text('الجامعة السورية 123', { x: 500, y: 700 }); });
    assert.ok(pdf.toString('latin1').includes(name), fam);
  }
});
