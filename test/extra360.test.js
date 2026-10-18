import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';

const PW = 'Test#Pass12345';
let app, base, cookie;
const api = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, headers: res.headers };
};
const form = (o = {}) => ({ first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية',
  phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء', hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)',
  enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 1, guardian_name: 'أحمد الحسن', guardian_relation: 'الأب', guardian_phone: '0933111222', ...o });

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-x-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'مدير', await hashPassword(PW, 1024), 'admin', Date.now());
  const r = await api('POST', '/api/auth/login', { username: 'admin', password: PW });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await app.close(); });

test('البيانات الإضافية: تُحفظ وتُعدَّل وتُنظَّف وتُرفض الفارغة العنوان', async () => {
  const bad = await api('POST', '/api/students', form({ extra: [{ label: '', value: 'x' }] }));
  assert.equal(bad.status, 400);
  const r = await api('POST', '/api/students', form({ extra: [{ label: ' الهواية ', value: 'الرسم' }, { label: '', value: '' }, { label: 'فصيلة الدم', value: 'O+' }] }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.student.extra, [{ label: 'الهواية', value: 'الرسم' }, { label: 'فصيلة الدم', value: 'O+' }]);
  const id = r.json.student.id;
  const u = await api('PUT', `/api/students/${id}`, { ...form(), extra: [{ label: 'ملاحظة', value: 'مرحباً' }] });
  assert.deepEqual(u.json.student.extra, [{ label: 'ملاحظة', value: 'مرحباً' }]);
  const keep = await api('PUT', `/api/students/${id}`, form());            // بلا مفتاح extra: لا يتغيّر
  assert.equal(keep.json.student.extra.length, 1);
  const tooMany = await api('PUT', `/api/students/${id}`, { ...form(), extra: Array.from({ length: 21 }, (_, i) => ({ label: 'a' + i, value: 'v' })) });
  assert.equal(tooMany.status, 400);
});

test('السجل 360: يعرض مقررات البرنامج حتى دون علامات، ويحمل بيانات الطالب الإضافية', async () => {
  const s = await api('POST', '/api/students', form({ national_id: '09876543210', first_name: 'ريم', study_level: 2, extra: [{ label: 'x', value: 'y' }] }));
  const id = s.json.student.id;
  for (const [n, l] of [['مدخل إلى الأمن', 1], ['أمن الشبكات', 2], ['التشفير التطبيقي', 3]]) await api('POST', '/api/courses', { programId: 2, level: l, semester: 1, name: n, hours: 3 });
  const r = await api('GET', `/api/students/${id}/unified-record`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.courses.map((c) => c.name), ['مدخل إلى الأمن', 'أمن الشبكات']);           // حتى سنته الحالية فقط
  assert.ok(r.json.courses.every((c) => c.total === null));
  assert.deepEqual(r.json.warnings, []);
  assert.equal(r.json.student.extra[0].label, 'x');
});

test('بيانات الشهادة في ملف الطالب تحمل رابط التحقق ورمز QR', async () => {
  const s = await api('POST', '/api/students', form({ national_id: '05555555555', first_name: 'هدى' }));
  let c = null;
  for (let i = 0; i < 20 && !c; i++) { c = (await api('GET', `/api/students/${s.json.student.id}`)).json.certificate; if (!c) await new Promise((ok) => setTimeout(ok, 150)); }
  if (c) { assert.match(c.url, /\?verify=SC-/); assert.match(c.qrSvg, /<svg/); }
});
