import { createApp } from './app.js';

const app = createApp();
app.server.listen(app.cfg.port, app.cfg.host, () => {
  console.log(`نواة ERP الجامعي تعمل على http://${app.cfg.host}:${app.cfg.port}`);
  if (!app.cfg.cookieSecure) console.warn('تنبيه: COOKIE_SECURE=0 (مقبول للتطوير فقط). شغّل خلف HTTPS واضبطها 1 في الإنتاج.');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
