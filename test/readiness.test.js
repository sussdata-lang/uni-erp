import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { checkReadiness } from '../server/services/readiness.js';

const mk = async (over = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-rd-'));
  const app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), logDir: path.join(dir, 'logs'), scryptN: 1024, port: 0, backupAuto: false, ...over });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { app, dir };
};
const by = (list, id) => list.find((c) => c.id === id);

test('الجاهزية: إعداد تطوير → تحذيرات HTTPS والنسخ الاحتياطي لا إخفاقات', async () => {
  const { app } = await mk({ cookieSecure: false, publicUrl: 'http://localhost:3000', universityName: 'SUSSEDU' });
  const r = checkReadiness(app);
  assert.equal(by(r, 'https').level, 'warn');
  assert.equal(by(r, 'public-url').level, 'warn');
  assert.equal(by(r, 'university').level, 'warn');
  assert.equal(by(r, 'backup').level, 'warn');             // لا نسخة بعد
  assert.equal(by(r, 'db').level, 'ok');
  assert.equal(by(r, 'audit-chain').level, 'ok');
  assert.equal(by(r, 'dirs').level, 'ok');
  assert.ok(!r.some((c) => c.level === 'fail'));
  await app.close();
});

test('الجاهزية: إعداد إنتاج سليم + نسخة حديثة → كل البنود ok عدا الختم الزمني الاختياري', async () => {
  const { app } = await mk({ cookieSecure: true, trustProxy: true, publicUrl: 'https://uni.example.sy', backupPutUrl: 'https://backup.example/put' });
  fs.mkdirSync(path.join(path.dirname(app.cfg.dbPath), 'backups'), { recursive: true });
  const { createBackup } = await import('../server/services/backup.js');
  await createBackup(app, { reason: 'test' });
  const r = checkReadiness(app);
  for (const id of ['https', 'public-url', 'proxy', 'university', 'db', 'audit-chain', 'dirs', 'backup', 'offsite']) assert.equal(by(r, id).level, 'ok', id + ': ' + by(r, id).msg);
  assert.ok(!r.some((c) => c.level === 'fail'));
  await app.close();
});

test('الجاهزية: مجلد رفع غير قابل للكتابة → fail', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-rd-')), 'not-a-dir');
  fs.writeFileSync(file, 'x');                                  // مسار «داخل ملف»: لا يمكن إنشاؤه (ENOTDIR)
  const { app } = await mk({ uploadDir: path.join(file, 'up') });
  const c = by(checkReadiness(app), 'dirs');
  assert.equal(c.level, 'fail'); assert.match(c.msg, /not-a-dir/);
  await app.close();
});
