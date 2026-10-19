import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { log, configureLogger, recentLogs, closeLogger } from '../server/lib/logger.js';

const PW = 'Test#Pass12345';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-log-'));
const read = (dir) => fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));

test('المسجِّل: غير حظري، يكتب JSON لكل سطر، يحترم المستوى، ولا يرمي أبداً', async () => {
  const dir = tmp(); configureLogger({ dir, level: 'warn' });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) log.warn('w' + i, { i });
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200, '2000 سطراً يجب ألا تحجب الحلقة');
  log.info('hidden'); log.error('boom', new Error('x'));
  assert.doesNotThrow(() => log.error('circular', (() => { const o = {}; o.o = o; return o; })()));
  await closeLogger();
  const lines = read(dir);
  assert.equal(lines.filter((l) => l.level === 'warn').length, 2000);
  assert.ok(!lines.some((l) => l.msg === 'hidden'));
  assert.equal(lines.find((l) => l.msg === 'boom').meta.message, 'x');
  assert.equal(recentLogs({ level: 'error', limit: 5 }).every((r) => r.level === 'error'), true);
});

test('خطأ غير متوقع في مسار: 500 عام للعميل + سطر error في السجل بلا بيانات حساسة؛ ويُقرأ عبر /api/admin/logs لمن لديه audit:read فقط', async () => {
  const dir = tmp();
  const app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  const login = async (u) => { app.limiter.hits.clear(); const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) }); return r.headers.get('set-cookie').split(';')[0]; };
  const adm = await login('admin'), stf = await login('staff');
  app.db.exec('DROP TABLE hall_logs');                                        // يكسر قسماً واحداً في السجل الموحّد وطلباً آخر
  await fetch(base + '/api/students', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm }, body: '{bad' });
  const boom = await fetch(base + '/api/attendance?size=5', { headers: { Cookie: adm } });
  assert.equal(boom.status, 500);
  assert.deepEqual(Object.keys(await boom.json()).sort(), ['error', 'message']);   // لا تسريب لتفاصيل داخلية
  const ok = await fetch(base + '/api/admin/logs?level=error', { headers: { Cookie: adm } });
  assert.equal(ok.status, 200);
  const { entries } = await ok.json();
  const e = entries.find((x) => /GET \/api\/attendance/.test(x.msg));
  assert.ok(e, 'سطر الخطأ موجود'); assert.equal(e.level, 'error'); assert.match(e.meta.stack, /no such table|hall_logs/);
  assert.ok(!JSON.stringify(entries).includes(PW));
  assert.equal((await fetch(base + '/api/admin/logs', { headers: { Cookie: stf } })).status, 403);
  assert.equal((await fetch(base + '/api/admin/logs')).status, 401);
  await app.close();
  assert.ok(read(path.join(dir, 'logs')).some((l) => l.level === 'error' && /attendance/.test(l.msg)), 'يصل إلى الملف');
});
