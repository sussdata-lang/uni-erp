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
  return { server, db, cfg, limiter, close: () => new Promise((res) => { clearInterval(timer); server.close(() => { db.close(); res(); }); }) };
}
