import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';
import { makeQr } from '../server/qr.js';

const PW = 'Test#Pass12345';
let app, base;
const PDF = Buffer.from('%PDF-1.4\n%test\n').toString('base64');

async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(username, password = PW) {
  const r = await api('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return r.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, program, created_at) VALUES (?,?,?,?,?,?,?)').run(u, n, h, role, no ?? null, no ? 'الأمن السيبراني' : null, Date.now());
  ins('admin', 'مدير', 'admin'); ins('staff', 'موظف', 'staff'); ins('auditor', 'مدقق', 'auditor');
  const s1 = ins('s1', 'ليلى الحسن', 'student', '2024-1087'); ins('s2', 'خالد المصري', 'student', '2023-0452'); ins('s3', 'هبة الدوري', 'student', '2024-0991');
  app.db.prepare('INSERT INTO grades (student_id, term, course, hours, mark) VALUES (?,?,?,?,?)').run(s1.lastInsertRowid, 'خريف', 'أمن الشبكات', 3, 90);
});
test.after(async () => { await app.close(); });

test('QR: يُولَّد لكل الأحجام المدعومة', () => {
  for (const n of [1, 20, 60, 120, 200]) assert.ok(makeQr('x'.repeat(n)).size >= 21);
});

test('الدخول: رفض بيانات خاطئة وقفل الحساب بعد 5 محاولات', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 's2', password: 'خطأ' } })).status, 401);
  app.limiter.hits.clear();
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/login', { body: { username: 's2', password: 'wrong-' + i } });
  app.limiter.hits.clear();
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 's2', password: PW } })).status, 423);
  app.db.prepare("UPDATE users SET locked_until = 0 WHERE username = 's2'").run();
});

test('الجلسة: ملف تعريف محمي بـ HttpOnly وSameSite، وبدونها 401', async () => {
  const r = await api('POST', '/api/auth/login', { body: { username: 'staff', password: PW } });
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.equal((await api('GET', '/api/me')).json.user, null);
  assert.equal((await api('GET', '/api/requests')).status, 401);
});

test('تدفق كامل: تقديم، اعتماد، إصدار وثيقة، تحقق عام', async () => {
  const stu = await loginAs('s1'), staff = await loginAs('staff');
  const c = await api('POST', '/api/requests', { cookie: stu, body: { service: 'transcript', details: { lang: 'العربية', copies: 1 } } });
  assert.equal(c.status, 201); assert.equal(c.json.request.status, 'review');
  const id = c.json.request.id;
  // الطالب لا يعتمد
  assert.equal((await api('POST', `/api/requests/${id}/approve`, { cookie: stu })).status, 403);
  const ap = await api('POST', `/api/requests/${id}/approve`, { cookie: staff });
  assert.equal(ap.status, 200); assert.equal(ap.json.request.status, 'approved');
  const code = ap.json.request.document.code;
  assert.match(code, /^UV-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // لا اعتماد مزدوج
  assert.equal((await api('POST', `/api/requests/${id}/approve`, { cookie: staff })).status, 409);
  // الوثيقة تحوي لقطة العلامات
  const doc = await api('GET', `/api/documents/${code}`, { cookie: stu });
  assert.equal(doc.json.document.payload.transcript.average, 90);
  // QR
  const qr = await api('GET', `/api/documents/${code}/qr.svg`, { cookie: stu });
  assert.match(qr.text, /<svg/);
  // تحقق عام بلا جلسة
  const v = await api('GET', `/api/verify/${code}`);
  assert.equal(v.json.valid, true); assert.equal(v.json.student, 'ليلى ا.');
  assert.ok(!('hash' in v.json) || v.json.hashPrefix);
  assert.equal((await api('GET', '/api/verify/UV-AAAA-BBBB')).json.valid, false);
});

test('التلاعب: تعديل الوثيقة مباشرة في القاعدة يمنعه المشغِّل، وتغيير الحمولة يكشفه التحقق', async () => {
  const stu = await loginAs('s1'), staff = await loginAs('staff');
  const c = await api('POST', '/api/requests', { cookie: stu, body: { service: 'attendance', details: { purpose: 'سفارة', copies: 1 } } });
  const ap = await api('POST', `/api/requests/${c.json.request.id}/approve`, { cookie: staff });
  const code = ap.json.request.document.code;
  assert.throws(() => app.db.prepare('UPDATE documents SET payload_json = ? WHERE code = ?').run('{}', code), /immutable/);
  // محاكاة مهاجم يملك الملف: يعطّل المشغِّل ويعدّل ثم يعيده
  app.db.exec('DROP TRIGGER documents_no_update');
  const row = app.db.prepare('SELECT payload_json FROM documents WHERE code = ?').get(code);
  app.db.prepare('UPDATE documents SET payload_json = ? WHERE code = ?').run(row.payload_json.replace('سفارة', 'شركة'), code);
  assert.equal((await api('GET', `/api/verify/${code}`)).json.reason, 'tampered');
  app.db.prepare('UPDATE documents SET payload_json = ? WHERE code = ?').run(row.payload_json, code);
  app.db.exec("CREATE TRIGGER documents_no_update BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'documents are immutable'); END;");
  assert.equal((await api('GET', `/api/verify/${code}`)).json.valid, true);
});

test('الفحص الآلي: ذمة مالية ترفض الطلب فوراً، وتسويتها تفتح الخدمة', async () => {
  const admin = await loginAs('admin'), stu = await loginAs('s3');
  const h = await api('POST', '/api/admin/holds', { cookie: admin, body: { studentNo: '2024-0991', holdType: 'financial', note: 'اختبار' } });
  assert.equal(h.status, 201);
  const r = await api('POST', '/api/requests', { cookie: stu, body: { service: 'attendance', details: { purpose: 'سفارة' } } });
  assert.equal(r.json.request.status, 'rejected'); assert.equal(r.json.request.rejectedBy, 'auto');
  await api('POST', `/api/admin/holds/${h.json.id}/clear`, { cookie: admin, body: {} });
  const r2 = await api('POST', '/api/requests', { cookie: stu, body: { service: 'attendance', details: { purpose: 'سفارة' } } });
  assert.equal(r2.json.request.status, 'review');
});

test('الصلاحيات: الطالب لا يرى طلبات غيره ولا لوحة الموظف ولا الإدارة', async () => {
  const s1 = await loginAs('s1'), s2 = await loginAs('s2'), staff = await loginAs('staff');
  const mine = await api('POST', '/api/requests', { cookie: s1, body: { service: 'attendance', details: { purpose: 'سفارة' } } });
  assert.equal((await api('GET', `/api/requests/${mine.json.request.id}`, { cookie: s2 })).status, 404);
  assert.equal((await api('GET', '/api/stats', { cookie: s2 })).status, 403);
  assert.equal((await api('GET', '/api/admin/users', { cookie: staff })).status, 403);
  assert.equal((await api('GET', '/api/audit', { cookie: staff })).status, 403);
  const list2 = await api('GET', '/api/requests', { cookie: s2 });
  assert.ok(list2.json.requests.every((r) => r.id !== mine.json.request.id));
});

test('الرفض اليدوي يتطلب سبباً', async () => {
  const stu = await loginAs('s2'), staff = await loginAs('staff');
  const c = await api('POST', '/api/requests', { cookie: stu, body: { service: 'attendance', details: { purpose: 'أخرى' } } });
  assert.equal((await api('POST', `/api/requests/${c.json.request.id}/reject`, { cookie: staff, body: {} })).status, 400);
  const ok = await api('POST', `/api/requests/${c.json.request.id}/reject`, { cookie: staff, body: { reason: 'بيانات غير مطابقة' } });
  assert.equal(ok.json.request.status, 'rejected'); assert.equal(ok.json.request.rejectReason, 'بيانات غير مطابقة');
});

test('المرفقات: تُقبل PDF فقط حسب المحتوى الفعلي، والعذر يتطلب مرفقاً', async () => {
  const stu = await loginAs('s1'), staff = await loginAs('staff'), s2 = await loginAs('s2');
  const body = (att) => ({ service: 'excuse', details: { course: 'قواعد البيانات', exam_date: '2026-10-04', reason: 'طبي' }, attachment: att });
  assert.equal((await api('POST', '/api/requests', { cookie: stu, body: body(undefined) })).status, 400);
  assert.equal((await api('POST', '/api/requests', { cookie: stu, body: body({ name: 'x.pdf', data: Buffer.from('MZ-exe').toString('base64') }) })).status, 415);
  const ok = await api('POST', '/api/requests', { cookie: stu, body: body({ name: '../../تقرير.pdf', data: PDF }) });
  assert.equal(ok.status, 201); assert.ok(!ok.json.request.attachment.name.includes('/') && ok.json.request.attachment.name.endsWith('.pdf'));
  const dl = await api('GET', `/api/attachments/${ok.json.request.attachment.id}`, { cookie: staff });
  assert.equal(dl.status, 200); assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await api('GET', `/api/attachments/${ok.json.request.attachment.id}`, { cookie: s2 })).status, 404);
});

test('التدقيق: السلسلة سليمة، ولا حذف ولا تعديل، وكسرها يُكتشف', async () => {
  const aud = await loginAs('auditor');
  const v = await api('GET', '/api/audit/verify', { cookie: aud });
  assert.equal(v.json.ok, true); assert.ok(v.json.checked > 5);
  assert.throws(() => app.db.prepare('DELETE FROM audit_log WHERE id = 1').run(), /append-only/);
  assert.throws(() => app.db.prepare("UPDATE audit_log SET action = 'x' WHERE id = 1").run(), /append-only/);
  app.db.exec('DROP TRIGGER audit_no_update');
  app.db.prepare("UPDATE audit_log SET action = 'مزوَّر' WHERE id = 2").run();
  assert.equal(verifyAuditChain(app.db).ok, false);
  assert.equal(verifyAuditChain(app.db).brokenAtId, 2);
});

test('الأمان: ترويسات CSP، رفض أنواع المحتوى غير JSON، ومنع اجتياز المسارات', async () => {
  const idx = await fetch(base + '/');
  assert.match(idx.headers.get('content-security-policy'), /script-src 'self'/);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(bad.status, 415);
  assert.equal((await fetch(base + '/..%2f..%2fserver/config.js')).status, 404);
  assert.equal((await fetch(base + '/../server/config.js')).status, 404);
});
