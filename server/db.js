import { createApp } from './app.js';

const app = createApp();

// استخدام المنفذ المخصص من المنصة السحابية (Railway) أو المنفذ الافتراضي 3000 محلياً
const port = process.env.PORT || app.cfg.port || 3000;
const host = '0.0.0.0'; // هام جداً لكي يستقبل السيرفر الطلبات الخارجية على Railway

app.server.listen(port, host, () => {
  console.log(`نواة ERP الجامعي تعمل على http://${host}:${port}`);
  if (!app.cfg.cookieSecure) {
    console.warn('تنبيه: COOKIE_SECURE=0 (مقبول للتطوير فقط). شغّل خلف HTTPS واضبطها 1 في الإنتاج.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => app.close().then(() => process.exit(0)));
}
