import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { ensureStructure, STRUCTURE } from '../server/services/structure.js';
import { ASSIGNABLE } from '../server/permissions.js';

const PW = 'Test#Pass12345';
let app, base, adm;
const api = async (m, u, cookie) => { const r = await fetch(base + u, { method: m, headers: cookie ? { Cookie: cookie } : {} }); return { s: r.status, j: await r.json().catch(() => null) }; };
const login = async (u, p = PW) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }); return { s: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const unit = (n) => app.db.prepare('SELECT * FROM org_units WHERE name = ?').get(n);

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-str-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run('admin', 'admin', await hashPassword(PW, 1024), 'admin', Date.now());
  adm = (await login('admin')).cookie;
});
test.after(async () => { await app.close(); });

test('الهيكل: 16 إدارة، 3 وحدات لشؤون الطلاب بمكاتبها، واللجنة التأديبية جهة مستقلة', async () => {
  const r = await ensureStructure(app, {});
  assert.ok(r.units > 30 && r.roles > 30 && r.accounts > 30 && r.links > 15);
  const univ = unit('إدارة الجامعة').id;
  const depts = app.db.prepare("SELECT name FROM org_units WHERE parent_id = ? AND kind = 'department'").all(univ).map((x) => x.name);
  for (const n of ['شؤون الطلاب', 'القبول والتسجيل', 'الامتحانات والعلامات', 'الشؤون الأكاديمية', 'الموارد البشرية', 'المالية والحسابات', 'المشتريات والمخازن', 'الشؤون الإدارية',
    'تقنية المعلومات والأمن السيبراني', 'المكتبة', 'الجودة والتخطيط', 'البحث العلمي والدراسات العليا', 'الشؤون القانونية', 'العلاقات العامة والإعلام', 'الأمن والسلامة', 'الخريجون والتوظيف']) assert.ok(depts.includes(n), n);
  const sa = unit('شؤون الطلاب').id;
  const kids = app.db.prepare('SELECT * FROM org_units WHERE parent_id = ?').all(sa);
  assert.deepEqual(kids.map((k) => k.name).sort(), ['الخدمات الطلابية والمالية', 'رعاية الخريجين والدعم الطلابي', 'التسجيل والتوثيق الجامعي'].sort());
  const offices = (n) => app.db.prepare("SELECT name FROM org_units WHERE parent_id = ? AND kind = 'office'").all(unit(n).id).length;
  assert.deepEqual([offices('التسجيل والتوثيق الجامعي'), offices('الخدمات الطلابية والمالية'), offices('رعاية الخريجين والدعم الطلابي')], [5, 3, 5]);
  const cm = unit('اللجنة التأديبية');
  assert.equal(cm.parent_id, univ);                                   // مستقلة: ليست تحت شؤون الطلاب
  assert.match(cm.description, /أميناً دون تصويت/);
  const linked = app.db.prepare('SELECT 1 FROM unit_links WHERE (from_unit=? AND to_unit=?) OR (from_unit=? AND to_unit=?)').get(cm.id, sa, sa, cm.id);
  assert.ok(linked);
});

test('المسؤوليات: لكل جهة دور وحساب مسؤول، والصلاحيات من الفهرس فقط، والحسابات معطّلة افتراضياً', async () => {
  for (const n of STRUCTURE) {
    const role = app.db.prepare('SELECT * FROM roles WHERE key = ?').get('head_' + n.code);
    assert.ok(role, n.code);
    const perms = JSON.parse(role.permissions_json);
    assert.ok(perms.length && perms.every((p) => ASSIGNABLE.has(p)), n.code);
    assert.ok(!(perms.includes('request:read_all') && perms.includes('request:read_unit')), n.code);
    if (!n.noAccount) {
      const u = app.db.prepare('SELECT * FROM users WHERE username = ?').get(n.code);
      assert.equal(u.role_key, 'head_' + n.code); assert.equal(u.unit_id, unit(n.name).id); assert.equal(u.active, 0);
    }
  }
  assert.equal((await login('admission')).s, 401);                    // لا دخول قبل التفعيل
  const ov = (await api('GET', '/api/admin/access', adm)).j;
  assert.ok(ov.units.find((u) => u.name === 'اللجنة التأديبية').description.length > 20);
});

test('التكرار آمن ولا يمسّ ما عدّله المدير؛ والتفعيل يمنح كلمة مؤقتة تُغيَّر عند أول دخول', async () => {
  app.db.prepare("UPDATE roles SET label = 'اسم مخصص', permissions_json = '[\"stats:read\"]' WHERE key = 'head_finance'").run();
  const r2 = await ensureStructure(app, {});
  assert.deepEqual([r2.units, r2.roles, r2.accounts, r2.links], [0, 0, 0, 0]);
  const fin = app.db.prepare("SELECT * FROM roles WHERE key = 'head_finance'").get();
  assert.equal(fin.label, 'اسم مخصص'); assert.equal(fin.permissions_json, '["stats:read"]');
  const r3 = await ensureStructure(app, { activate: true, password: PW });
  assert.ok(r3.activated > 30);
  const l = await login('admission');
  assert.equal(l.s, 200);
  const me = (await api('GET', '/api/me', l.cookie)).j.user;
  assert.ok(me.permissions.includes('student:register'));
  assert.equal(me.mustChangePassword ?? me.must_change_password ?? true, true);
});
