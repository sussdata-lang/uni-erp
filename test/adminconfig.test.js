import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { payloadFor } from '../server/services/enrollcert.js';

const PW = 'Test#Pass12345';
let app, base, adm, stf;
const api = async (m, u, { body, cookie } = {}) => {
  const r = await fetch(base + u, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { s: r.status, j };
};
const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-cfg-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  adm = await login('admin'); stf = await login('staff');
});
test.after(async () => { await app.close(); });

const svc = (o = {}) => ({ code: 'lib_card', label: 'بطاقة المكتبة', description: 'طلب إصدار بطاقة استعارة من المكتبة', slaHours: 48, requiresAttachment: false, issuesDocument: true,
  fields: [{ label: 'سبب الطلب', type: 'text', required: true }, { label: 'النوع', type: 'select', options: ['جديدة', 'بدل ضائع'] }], ...o });

test('محرر الخدمات: إنشاء خدمة مخصصة تظهر للطلاب، وتعطيلها يخفيها، والأساسية محمية', async () => {
  assert.equal((await api('GET', '/api/admin/services', { cookie: stf })).s, 403);
  assert.equal((await api('GET', '/api/admin/services')).s, 401);
  const c = await api('POST', '/api/admin/services', { cookie: adm, body: svc() });
  assert.equal(c.s, 201 === c.s ? 201 : 200);
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc() })).s, 409);          // رمز مكرر
  assert.equal((await api('POST', '/api/admin/services', { cookie: adm, body: svc({ code: 'Bad Code' }) })).s, 400);
  const list = (await api('GET', '/api/admin/services', { cookie: adm })).j.services;
  const mine = list.find((x) => x.code === 'lib_card');
  assert.deepEqual(mine.fields.map((f) => f.name), ['f1', 'f2']); assert.equal(mine.builtin, false);
  assert.ok((await api('GET', '/api/services', { cookie: adm })).j.services.some((x) => x.code === 'lib_card'));
  assert.equal((await api('PUT', '/api/admin/services/lib_card', { cookie: adm, body: { ...svc(), enabled: false } })).s, 200);
  assert.ok(!(await api('GET', '/api/services', { cookie: adm })).j.services.some((x) => x.code === 'lib_card'));
  const bi = list.find((x) => x.builtin);
  assert.equal((await api('PUT', `/api/admin/services/${bi.code}`, { cookie: adm, body: { label: 'x', description: 'وصف الخدمة', slaHours: 5, fields: [] } })).s, 400);   // حقول الأساسية ثابتة
  const audit = (await api('GET', '/api/audit?limit=20', { cookie: adm })).j.entries;
  assert.ok(audit.some((e) => /إضافة خدمة/.test(e.action)));
});

test('هوية الموقع: اسم الجامعة يجب أن يحوي حروفاً عربية ويسري على الواجهة والشهادات', async () => {
  assert.equal((await api('GET', '/api/admin/settings', { cookie: stf })).s, 403);
  assert.equal((await api('PUT', '/api/admin/settings', { cookie: adm, body: { university: 'SUSSEDU' } })).s, 400);
  const ok = await api('PUT', '/api/admin/settings', { cookie: adm, body: { university: 'الجامعة السورية للعلوم الأمنية — دمشق' } });
  assert.equal(ok.s, 200); assert.equal(ok.j.site.university, 'الجامعة السورية للعلوم الأمنية — دمشق');
  assert.equal((await api('GET', '/api/me')).j.university, 'الجامعة السورية للعلوم الأمنية — دمشق');
  const st = await api('POST', '/api/students', { cookie: adm, body: { first_name: 'ليلى', father_name: 'أحمد', last_name: 'الحسن', mother_name: 'سعاد الخطيب', national_id: '01234567890', gender: 'أنثى', birth_date: '2006-03-14', birth_place: 'دمشق', nationality: 'سورية',
    phone: '0944123456', governorate: 'دمشق', city: 'المزة', address: 'شارع', hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2100, program_id: 2, admission_type: 'القبول العام (المفاضلة)', enroll_year: 2024, enroll_term: 'الفصل الأول', study_level: 1, guardian_name: 'أحمد', guardian_relation: 'الأب', guardian_phone: '0933111222' } });
  assert.equal(payloadFor(app.db, app.cfg, st.j.student.id).university, 'الجامعة السورية للعلوم الأمنية — دمشق');
});
