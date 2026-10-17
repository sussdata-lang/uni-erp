import { drainCertificates } from './services/enrollcert.js';
import { drainPush } from './services/push.js';
import { startBackupScheduler } from './services/backup.js';
import http from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { RateLimiter } from './security.js';
import { makeHandler } from './http.js';
import { buildRouter } from './routes.js';
import { sessionUser } from './services/auth.js';

export function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.dbPath);
  const limiter = new RateLimiter();
  const router = buildRouter({ db, cfg, limiter });
  const server = http.createServer(makeHandler({ cfg, router, getUser: (tok) => sessionUser(db, tok) }));
  server.headersTimeout = 15_000; server.requestTimeout = 30_000;
  // تنظيف الجلسات المنتهية كل ساعة
  const timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000);
  timer.unref();
  const stopBackups = startBackupScheduler({ db, cfg });
  return { server, db, cfg, limiter, close: async () => { clearInterval(timer); stopBackups(); await drainCertificates(db); await drainPush(); await new Promise((res) => server.close(() => { db.close(); res(); })); } };
}
