import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { verifyAuditChain } from '../server/audit.js';
import { ensureCoreAccounts, seedPassword } from '../server/services/bootstrap.js';

const PW = 'Test#Pass12345';
let app, base, admin, auditor, staff;

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
const unitId = (name) => app.db.prepare('SELECT id FROM org_units WHERE name = ?').get(name).id;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-ac-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, n, role] of [['admin', 'مدير', 'admin'], ['staff', 'موظف', 'staff'], ['auditor', 'مدقق', 'auditor']])
    app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, n, h, role, Date.now());
  admin = (await loginAs('admin')).cookie; auditor = (await loginAs('auditor')).cookie; staff = (await loginAs('staff')).cookie;
});
test.after(async () => { await app.close(); });

test('الحسابان الأساسيان: admin وauditor1 بكلمة المرور 1572690 ويعملان فوراً، وإعادة الضبط تفك القفل', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-seed-'));
  const a2 = createApp({ dbPath: path.join(dir, 's.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  await new Promise((r) => a2.server.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${a2.server.address().port}`;
  try {
    const out = await ensureCoreAccounts({ db: a2.db, cfg: a2.cfg });
    assert.deepEqual(out.map((o) => [o.username, o.role, o.action]), [['admin', 'admin', 'أُنشئ'], ['auditor1', 'auditor', 'أُنشئ']]);
    const login = async (u, p) => { a2.limiter.hits.clear(); return fetch(b2 + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }); };
    for (const [u, role] of [['admin', 'admin'], ['auditor1', 'auditor']]) {
      const r = await login(u, '1572690'); assert.equal(r.status, 200);
      const j = await r.json(); assert.equal(j.user.role, role); assert.equal(j.user.mustChange, false);   // يدخل مباشرة دون إلزام بتغيير
    }
    // إعادة الضبط: قفل + كلمة مرور مختلفة ثم استعادة
    a2.db.prepare("UPDATE users SET locked_until = ?, failed_logins = 4, active = 0 WHERE username = 'admin'").run(Date.now() + 1e6);
    const again = await ensureCoreAccounts({ db: a2.db, cfg: a2.cfg });
    assert.equal(again[0].action, 'أُعيد ضبطه');
    assert.equal((await login('admin', '1572690')).status, 200);
    assert.equal(a2.db.prepare("SELECT COUNT(*) c FROM users WHERE username IN ('admin','auditor1')").get().c, 2);   // لا تكرار
  } finally { await a2.close(); }
});

test('الأدوار الأساسية: المدير يرى كل شيء، والمدقق قراءة فقط، وفهرس الصلاحيات مكتمل', async () => {
  const me = (await api('GET', '/api/me', { cookie: admin })).json.user;
  assert.equal(me.roleLabel, 'مدير النظام'); assert.ok(me.permissions.includes('role:manage'));
  const aud = (await api('GET', '/api/me', { cookie: auditor })).json.user;
  assert.ok(aud.permissions.includes('audit:read') && !aud.permissions.some((p) => /manage|decide|forward|register|update|reset/.test(p)));
  const ov = await api('GET', '/api/admin/access', { cookie: admin });
  assert.equal(ov.status, 200);
  assert.deepEqual(ov.json.roles.filter((r) => r.builtin).map((r) => r.key), ['admin', 'staff', 'auditor']);
  assert.ok(ov.json.catalog.flatMap((g) => g.items).every((i) => i.label));
  for (const c of [auditor, staff]) assert.equal((await api('GET', '/api/admin/access', { cookie: c })).status, 403);
});

test('دور مخصّص: ينشئه المدير ويُسنَد لحساب فتعمل صلاحياته وحدها', async () => {
  const mk = (b) => api('POST', '/api/admin/roles', { cookie: admin, body: b });
  assert.equal((await mk({ key: 'x', label: 'قصير', permissions: ['stats:read'] })).status, 400);                                  // رمز قصير
  assert.equal((await mk({ key: 'logistics_officer', label: 'مسؤول لوجستي', permissions: [] })).status, 400);                      // بلا صلاحيات
  assert.equal((await mk({ key: 'logistics_officer', label: 'مسؤول لوجستي', permissions: ['nope:x'] })).status, 400);              // صلاحية غير معرّفة
  assert.equal((await mk({ key: 'logistics_officer', label: 'مسؤول لوجستي', permissions: ['request:read_all', 'request:read_unit'] })).status, 400);
  assert.equal((await mk({ key: 'admin', label: 'مكرر', permissions: ['stats:read'] })).status, 409);                                 // لا يُنتحل رمز أساسي
  const ok = await mk({ key: 'logistics_officer', label: 'مسؤول لوجستي', description: 'يعالج الطلبات المحالة إلى القسم اللوجستي', permissions: ['request:read_unit', 'request:decide', 'request:forward', 'stats:read'] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal((await mk({ key: 'logistics_officer', label: 'آخر', permissions: ['stats:read'] })).status, 409);

  const mkUser = (b) => api('POST', '/api/admin/users', { cookie: admin, body: { password: 'Temp#Pass2026x', ...b } });
  assert.equal((await mkUser({ username: 'log1', displayName: 'أحمد اللوجستي', role: 'logistics_officer', unitId: unitId('القسم اللوجستي') })).status, 201);
  assert.equal((await mkUser({ username: 'log1', displayName: 'مكرر', role: 'staff' })).status, 409);
  assert.equal((await mkUser({ username: 'bad name', displayName: 'ب', role: 'staff' })).status, 400);
  assert.equal((await mkUser({ username: 'weak1', displayName: 'ضعيف', role: 'staff', password: '1234' })).status, 400);
  assert.equal((await mkUser({ username: 'ghost1', displayName: 'شبح', role: 'no_such_role' })).status, 400);
  assert.equal((await mkUser({ username: 'stud1', displayName: 'طالب', role: 'student' })).status, 400);

  const l = await loginAs('log1', 'Temp#Pass2026x');
  assert.equal(l.user.mustChange, true);                                                                  // كلمة مؤقتة: يُلزَم بتغييرها
  assert.equal(l.user.roleLabel, 'مسؤول لوجستي'); assert.equal(l.user.unit.name, 'القسم اللوجستي');
  assert.deepEqual([...l.user.permissions].sort(), ['request:decide', 'request:forward', 'request:read_unit', 'stats:read']);
  assert.equal((await api('POST', '/api/auth/change-password', { cookie: l.cookie, body: { current: 'Temp#Pass2026x', next: 'Fresh#Pass2026y' } })).status, 200);
  const l2 = await loginAs('log1', 'Fresh#Pass2026y');
  for (const [m, u] of [['GET', '/api/admin/access'], ['GET', '/api/students'], ['GET', '/api/audit'], ['GET', '/api/admin/users']]) assert.equal((await api(m, u, { cookie: l2.cookie })).status, 403, u);
  assert.equal((await api('GET', '/api/stats', { cookie: l2.cookie })).status, 200);
});

test('منع رفع الصلاحيات: من يملك «إدارة الحسابات» فقط لا يمنح ولا يعدّل ما فوق صلاحياته', async () => {
  assert.equal((await api('POST', '/api/admin/roles', { cookie: admin, body: { key: 'accounts_clerk', label: 'مسؤول حسابات', permissions: ['user:manage', 'stats:read'] } })).status, 201);
  await api('POST', '/api/admin/users', { cookie: admin, body: { username: 'clerk1', displayName: 'مسؤول حسابات', role: 'accounts_clerk', password: 'Temp#Pass2026x' } });
  await app.db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'clerk1'").run();
  const c = (await loginAs('clerk1', 'Temp#Pass2026x')).cookie;
  const mk = (b) => api('POST', '/api/admin/users', { cookie: c, body: { password: 'Temp#Pass2026x', ...b } });
  assert.equal((await mk({ username: 'esc1', displayName: 'تصعيد', role: 'admin' })).status, 403);                                  // دور المدير أوسع منه
  assert.equal((await mk({ username: 'esc2', displayName: 'تصعيد', role: 'logistics_officer' })).status, 403);                       // يحوي صلاحيات لا يملكها
  assert.equal((await mk({ username: 'ok1', displayName: 'مدقق جديد', role: 'auditor' })).status, 403);                              // المدقق يقرأ التدقيق وهو لا يملكه
  assert.equal((await mk({ username: 'ok2', displayName: 'مثيله', role: 'accounts_clerk' })).status, 201);                            // نفس صلاحياته مسموح
  const adminId = app.db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  assert.equal((await api('POST', `/api/admin/users/${adminId}/reset-password`, { cookie: c, body: {} })).status, 403);               // لا يمسّ حساب المدير
  assert.equal((await api('PUT', `/api/admin/users/${adminId}`, { cookie: c, body: { displayName: 'مخترق' } })).status, 403);
  assert.equal((await api('POST', '/api/admin/roles', { cookie: c, body: { key: 'sneaky_role', label: 'x', permissions: ['stats:read'] } })).status, 403);   // لا role:manage
  // ولا يستطيع المدير نفسه إسناد صلاحية لا يملكها غيره: الدور المخصّص لا يتجاوز فهرس الصلاحيات
  assert.equal((await api('POST', '/api/admin/roles', { cookie: admin, body: { key: 'super_role', label: 'x', permissions: ['student:student'] } })).status, 400);
});

test('الحسابات: تعديل الدور والوحدة، التعطيل، حماية آخر مدير، وإنهاء الجلسات', async () => {
  const users = (await api('GET', '/api/admin/users', { cookie: admin })).json.users;
  const adm = users.find((u) => u.username === 'admin'), log = users.find((u) => u.username === 'log1');
  assert.ok(users.every((u) => u.role !== 'student'));
  assert.equal((await api('PUT', `/api/admin/users/${adm.id}`, { cookie: admin, body: { role: 'staff' } })).status, 400);              // لا يغيّر دوره بنفسه
  assert.equal((await api('POST', `/api/admin/users/${adm.id}/active`, { cookie: admin, body: { active: false } })).status, 400);      // ولا يعطّل نفسه
  const l = await loginAs('log1', 'Fresh#Pass2026y');
  assert.equal((await api('PUT', `/api/admin/users/${log.id}`, { cookie: admin, body: { role: 'staff', unitId: unitId('الشؤون الإدارية') } })).status, 200);
  assert.equal((await api('GET', '/api/me', { cookie: l.cookie })).json.user, null);                                                    // الجلسة القديمة أُنهيت
  const l2 = await loginAs('log1', 'Fresh#Pass2026y');
  assert.equal(l2.user.roleKey, 'staff'); assert.equal(l2.user.unit.name, 'الشؤون الإدارية');
  assert.equal((await api('POST', `/api/admin/users/${log.id}/active`, { cookie: admin, body: { active: false } })).status, 200);
  app.limiter.hits.clear();
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'log1', password: 'Fresh#Pass2026y' } })).status, 401);
  const r = await api('POST', `/api/admin/users/${log.id}/reset-password`, { cookie: admin, body: {} });
  assert.equal(r.status, 200); assert.ok(r.json.credentials.tempPassword.length >= 10);
  await api('POST', `/api/admin/users/${log.id}/active`, { cookie: admin, body: { active: true } });
  // مدير ثانٍ ثم حماية «آخر مدير فعّال»
  await api('POST', '/api/admin/users', { cookie: admin, body: { username: 'admin2', displayName: 'مدير ثانٍ', role: 'admin', password: 'Temp#Pass2026x' } });
  const a2 = app.db.prepare("SELECT id FROM users WHERE username = 'admin2'").get().id;
  app.db.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?").run(a2);
  assert.equal((await api('POST', `/api/admin/users/${a2}/active`, { cookie: admin, body: { active: false } })).status, 200);
  const second = await loginAs('admin2').catch(() => null); assert.equal(second, null);
  await api('POST', `/api/admin/users/${a2}/active`, { cookie: admin, body: { active: true } });
  const c2 = (await loginAs('admin2', 'Temp#Pass2026x')).cookie;
  assert.equal((await api('POST', `/api/admin/users/${adm.id}/active`, { cookie: c2, body: { active: false } })).status, 200);       // الآن يوجد مدير آخر فيجوز
  assert.equal((await api('POST', `/api/admin/users/${a2}/active`, { cookie: c2, body: { active: false } })).status, 400);             // لكن لا تعطيل للأخير (نفسه)
  await api('POST', `/api/admin/users/${adm.id}/active`, { cookie: c2, body: { active: true } });
  admin = (await loginAs('admin')).cookie;                                                                                            // التعطيل أنهى جلسته
});

test('الوحدات والروابط: إنشاء وربط ومنع الحلقات والتكرار والتعطيل المعلّق', async () => {
  const units = (await api('GET', '/api/admin/access', { cookie: admin })).json;
  assert.deepEqual(units.units.slice(0, 4).map((u) => u.name), ['إدارة الجامعة', 'الشؤون الإدارية', 'القسم اللوجستي', 'شؤون الطلاب']);
  assert.equal(units.links.length, 3);
  const mk = await api('POST', '/api/admin/units', { cookie: admin, body: { name: 'الشؤون القانونية', kind: 'department', parentId: unitId('إدارة الجامعة') } });
  assert.equal(mk.status, 201, mk.text);
  assert.equal((await api('POST', '/api/admin/units', { cookie: admin, body: { name: 'الشؤون القانونية' } })).status, 409);
  assert.equal((await api('POST', '/api/admin/units', { cookie: admin, body: { name: 'وحدة', kind: 'bogus' } })).status, 400);
  assert.equal((await api('PUT', `/api/admin/units/${unitId('إدارة الجامعة')}`, { cookie: admin, body: { parentId: mk.json.id } })).status, 400);   // حلقة
  const link = await api('POST', '/api/admin/links', { cookie: admin, body: { from: mk.json.id, to: unitId('الشؤون الإدارية'), twoWay: true } });
  assert.equal(link.status, 201, link.text);
  assert.equal((await api('POST', '/api/admin/links', { cookie: admin, body: { from: unitId('الشؤون الإدارية'), to: mk.json.id } })).status, 409);   // يوجد رابط عكسي
  assert.equal((await api('POST', '/api/admin/links', { cookie: admin, body: { from: mk.json.id, to: mk.json.id } })).status, 400);
  assert.equal((await api('DELETE', `/api/admin/links/${link.json.id}`, { cookie: admin })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/links/${link.json.id}`, { cookie: admin })).status, 404);
  assert.equal((await api('PUT', `/api/admin/units/${mk.json.id}`, { cookie: admin, body: { active: false } })).status, 200);
  assert.equal((await api('POST', '/api/admin/links', { cookie: admin, body: { from: mk.json.id, to: unitId('القسم اللوجستي') } })).status, 400);       // وحدة معطَّلة
  assert.equal((await api('PUT', `/api/admin/units/${unitId('القسم اللوجستي')}`, { cookie: staff, body: { active: false } })).status, 403);
});

test('الإحالة بين الوحدات المرتبطة: تُحال الطلبات، ويرى كل طرف ما يخصه، ولا يتخطى الروابط', async () => {
  const h = await hashPassword(PW, 1024);
  const ins = (u, n, role, key, unit) => app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, role_key, unit_id, created_at) VALUES (?,?,?,?,?,?,?)').run(u, n, h, role, key, unit, Date.now());
  ins('aff1', 'مشرف الشؤون الإدارية', 'staff', 'logistics_officer', unitId('الشؤون الإدارية'));
  ins('log2', 'مسؤول لوجستي', 'staff', 'logistics_officer', unitId('القسم اللوجستي'));
  ins('uni1', 'مكتب رئيس الجامعة', 'staff', 'logistics_officer', unitId('إدارة الجامعة'));
  ins('stu_aff', 'موظف شؤون الطلاب', 'staff', 'logistics_officer', unitId('شؤون الطلاب'));
  ins('s_a', 'طالب تجريبي', 'student', null, null); app.db.prepare("UPDATE users SET student_no = 'CSS-2024-0001' WHERE username = 's_a'").run();
  const sa = (await loginAs('s_a')).cookie;
  const req = (await api('POST', '/api/requests', { cookie: sa, body: { service: 'transcript', details: { lang: 'العربية', copies: 1 } } })).json.request;
  assert.equal(req.unit, null);

  const aff = await loginAs('aff1'), log = await loginAs('log2'), uni = await loginAs('uni1');
  // قبل الإحالة: أصحاب النطاق «الوحدة» لا يرون شيئاً
  for (const u of [aff, log, uni]) assert.equal((await api('GET', '/api/requests', { cookie: u.cookie })).json.requests.length, 0);
  assert.equal((await api('GET', `/api/requests/${req.id}`, { cookie: aff.cookie })).status, 404);
  // المدير (بلا وحدة) يحيل إلى أي وحدة
  assert.equal((await api('GET', '/api/units/targets', { cookie: admin })).json.targets.length >= 4, true);
  const fw = await api('POST', `/api/requests/${req.id}/forward`, { cookie: admin, body: { unitId: unitId('الشؤون الإدارية'), note: 'للمراجعة الإدارية' } });
  assert.equal(fw.status, 200, fw.text); assert.equal(fw.json.request.unit.name, 'الشؤون الإدارية');
  assert.match(fw.json.request.events.at(-1).text, /إحالة الطلب إلى «الشؤون الإدارية»: للمراجعة الإدارية/);

  // الشؤون الإدارية ترى الطلب وغيرها لا
  assert.equal((await api('GET', '/api/requests', { cookie: aff.cookie })).json.requests.length, 1);
  assert.equal((await api('GET', `/api/requests/${req.id}`, { cookie: log.cookie })).status, 404);
  assert.equal((await api('POST', `/api/requests/${req.id}/approve`, { cookie: log.cookie, body: {} })).status, 404);                 // لا يبتّ فيما لا يخصه
  // أهداف الإحالة تتبع الروابط: الشؤون الإدارية ↔ الجامعة ↔ اللوجستي، وليست مرتبطة بشؤون الطلاب باتجاه الصادر
  const t = (await api('GET', '/api/units/targets', { cookie: aff.cookie })).json.targets.map((x) => x.name).sort();
  assert.deepEqual(t, ['القسم اللوجستي', 'إدارة الجامعة'].sort());
  assert.equal((await api('POST', `/api/requests/${req.id}/forward`, { cookie: aff.cookie, body: { unitId: unitId('شؤون الطلاب') } })).status, 403);   // الرابط باتجاه واحد (شؤون الطلاب ← الإدارية)
  assert.equal((await api('POST', `/api/requests/${req.id}/forward`, { cookie: aff.cookie, body: { unitId: unitId('الشؤون الإدارية') } })).status, 409);   // عندها أصلاً
  const fw2 = await api('POST', `/api/requests/${req.id}/forward`, { cookie: aff.cookie, body: { unitId: unitId('القسم اللوجستي') } });
  assert.equal(fw2.status, 200, fw2.text);
  assert.equal((await api('GET', '/api/requests', { cookie: aff.cookie })).json.requests.length, 0);                                   // خرج من نطاقها
  assert.equal((await api('GET', '/api/requests', { cookie: log.cookie })).json.requests.length, 1);
  assert.equal((await api('POST', `/api/requests/${req.id}/forward`, { cookie: log.cookie, body: { unitId: unitId('القسم اللوجستي') } })).status, 409);   // عنده أصلاً
  // شؤون الطلاب تحيل إلى الإدارية (اتجاه الرابط) لكن لا ترى الطلب الآن
  assert.deepEqual((await api('GET', '/api/units/targets', { cookie: (await loginAs('stu_aff')).cookie })).json.targets.map((x) => x.name), ['الشؤون الإدارية']);

  // اللوجستي يبتّ، والطالب يرى الأحداث كاملة
  const ap = await api('POST', `/api/requests/${req.id}/approve`, { cookie: log.cookie, body: {} });
  assert.equal(ap.status, 200, ap.text); assert.equal(ap.json.request.status, 'approved');
  assert.equal((await api('POST', `/api/requests/${req.id}/forward`, { cookie: log.cookie, body: { unitId: unitId('إدارة الجامعة') } })).status, 409);   // لا إحالة بعد البتّ
  const mine = (await api('GET', `/api/requests/${req.id}`, { cookie: sa })).json.request;
  assert.ok(mine.events.some((e) => /إحالة الطلب إلى «القسم اللوجستي»/.test(e.text)));
  // من لا صلاحية إحالة له
  assert.equal((await api('POST', `/api/requests/${req.id}/forward`, { cookie: auditor, body: { unitId: 1 } })).status, 403);
});

test('تعديل الدور المخصّص يُنهي جلسات أصحابه، وحذفه ممنوع ما دام مرتبطاً بحسابات', async () => {
  const l = await loginAs('log2');
  assert.equal((await api('PUT', '/api/admin/roles/logistics_officer', { cookie: admin, body: { permissions: ['request:read_unit', 'stats:read'] } })).status, 200);
  assert.equal((await api('GET', '/api/me', { cookie: l.cookie })).json.user, null);
  const l2 = await loginAs('log2');
  assert.ok(!l2.user.permissions.includes('request:decide'));
  assert.equal((await api('DELETE', '/api/admin/roles/logistics_officer', { cookie: admin })).status, 409);
  assert.equal((await api('PUT', '/api/admin/roles/logistics_officer', { cookie: admin, body: { active: false } })).status, 200);
  assert.deepEqual((await loginAs('log2')).user.permissions, []);                                                                     // دور معطَّل = بلا صلاحيات
  assert.equal((await api('PUT', '/api/admin/roles/admin', { cookie: admin, body: { label: 'x' } })).status, 404);                    // الأساسية ثابتة
  assert.equal((await api('POST', '/api/admin/roles', { cookie: admin, body: { key: 'empty_role', label: 'فارغ', permissions: ['stats:read'] } })).status, 201);
  assert.equal((await api('DELETE', '/api/admin/roles/empty_role', { cookie: admin })).status, 200);
});

test('التدقيق: كل عملية إدارية مسجَّلة والسلسلة سليمة', () => {
  const acts = app.db.prepare('SELECT action FROM audit_log').all().map((r) => r.action).join('\n');
  for (const k of ['إنشاء دور', 'إنشاء حساب إداري', 'إضافة وحدة إدارية', 'ربط وحدتين', 'إحالة طلب إلى', 'تعديل دور', 'حذف رابط']) assert.ok(acts.includes(k), k);
  assert.equal(verifyAuditChain(app.db).ok, true);
});

test('الدخول: اسم المستخدم لا يتأثر بحالة الأحرف أو المسافات، وكلمة المرور من البيئة تُنظَّف', async () => {
  for (const u of ['ADMIN', ' Admin ', 'admin']) {
    app.limiter.hits.clear();
    assert.equal((await api('POST', '/api/auth/login', { body: { username: u, password: PW } })).status, 200, u);
  }
  app.limiter.hits.clear();
  assert.equal((await api('POST', '/api/auth/login', { body: { username: 'admin', password: PW + ' ' } })).status, 401);   // كلمة المرور نفسها لا تُقصّ
  assert.equal(seedPassword({}), '1572690');
  assert.equal(seedPassword({ SEED_PASSWORD: '  1572690 ' }), '1572690');
  assert.equal(seedPassword({ SEED_PASSWORD: '"Strong#Pass2026"' }), 'Strong#Pass2026');
  assert.equal(seedPassword({ SEED_PASSWORD: '' }), '1572690');
});
