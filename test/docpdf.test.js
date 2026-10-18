import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyPdf } from '../server/services/pki.js';

const PW = 'Test#Pass12345';
let app, base;
async function api(method, url, { body, cookie, raw } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const loginAs = async (u) => (await api('POST', '/api/auth/login', { body: { username: u, password: PW } })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-pdf-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, no) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, student_no, program, created_at) VALUES (?,?,?,?,?,?,?)').run(u, n, h, role, no ?? null, no ? 'الأمن السيبراني' : null, Date.now());
  ins('staff', 'موظف', 'staff');
  const s2 = ins('s2', 'خالد المصري', 'student', '2023-0452');
  const s1 = ins('s1', 'ليلى الحسن', 'student', '2024-1087');
  const g = app.db.prepare('INSERT INTO grades (student_id, term, course, hours, mark) VALUES (?,?,?,?,?)');
  ['أمن الشبكات', 'التشفير', 'قواعد البيانات', 'مركز العمليات الأمنية SOC', 'الاختراق الأخلاقي'].forEach((c, i) => g.run(s2.lastInsertRowid, i % 2 ? 'ربيع' : 'خريف', c, 3, 70 + i * 4));
  for (let i = 1; i <= 30; i++) g.run(s1.lastInsertRowid, i % 2 ? 'خريف' : 'ربيع', `مقرر تجريبي رقم ${i} في الأمن والحماية`, 3, 60 + (i % 35));
});
test.after(async () => { await app.close(); });

async function approved(service, details, who = 's1') {
  const stu = await loginAs(who), staff = await loginAs('staff');
  const c = await api('POST', '/api/requests', { cookie: stu, body: { service, details } });
  assert.equal(c.status, 201, c.text);
  const ap = await api('POST', `/api/requests/${c.json.request.id}/approve`, { cookie: staff });
  assert.equal(ap.status, 200, ap.text);
  return { stu, staff, code: ap.json.request.document.code };
}
const save = (name, buf) => { if (process.env.DOCPDF_OUT) fs.writeFileSync(path.join(process.env.DOCPDF_OUT, name), buf); };

test('PDF الوثيقة: صاحب الطلب يحمّله، موقَّع وسليم، ومتطابق في كل مرة، ويُتحقق منه ببصمته', async () => {
  const { stu, staff, code } = await approved('attendance', { purpose: 'سفارة', copies: 1 });
  const r = await api('GET', `/api/documents/${code}/pdf`, { cookie: stu, raw: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/); assert.match(r.headers.get('content-disposition'), new RegExp(`${code}\\.pdf`));
  assert.equal(r.buf.subarray(0, 5).toString('latin1'), '%PDF-'); save('attendance.pdf', r.buf);
  const v = verifyPdf(r.buf); assert.equal(v.signed, true); assert.equal(v.intact, true);
  const again = await api('GET', `/api/documents/${code}/pdf`, { cookie: staff, raw: true });      // الموظف أيضاً، والملف نفسه بالبايت
  assert.equal(again.status, 200); assert.ok(again.buf.equals(r.buf));
  const sha = crypto.createHash('sha256').update(r.buf).digest('hex');
  const ver = await api('GET', `/api/verify-hash/${sha}`);
  assert.equal(ver.json.valid, true); assert.equal(ver.json.code, code);
  const fake = await api('GET', `/api/verify-hash/${'0'.repeat(64)}`);
  assert.equal(fake.json.valid, false);
});

test('PDF الوثيقة: طالب آخر 404 وبلا جلسة 401، وكشف علامات بعدد كبير من المقررات يُرسم', async () => {
  const { stu, code } = await approved('transcript', { lang: 'العربية', copies: 1 });
  const other = await loginAs('s2');
  assert.equal((await api('GET', `/api/documents/${code}/pdf`, { cookie: other })).status, 404);
  assert.equal((await api('GET', `/api/documents/${code}/pdf`)).status, 401);
  const r = await api('GET', `/api/documents/${code}/pdf`, { cookie: stu, raw: true });
  assert.equal(r.status, 200); save('transcript.pdf', r.buf);
  assert.equal(verifyPdf(r.buf).intact, true);
});

test('PDF الوثيقة: كشف علامات قصير (عمود واحد) يُرسم ويُوقَّع', async () => {
  const { stu, code } = await approved('transcript', { lang: 'العربية', copies: 1 }, 's2');
  const r = await api('GET', `/api/documents/${code}/pdf`, { cookie: stu, raw: true });
  assert.equal(r.status, 200); save('transcript-short.pdf', r.buf);
  assert.equal(verifyPdf(r.buf).intact, true);
});
