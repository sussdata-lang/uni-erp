// عامل الخدمة: يجعل التطبيق قابلاً للتثبيت ويسرّع تحميل الملفات الثابتة.
// قاعدة أمنية: لا تُخزَّن أي استجابة من /api/ إطلاقاً (بيانات الطلاب لا تُحفظ في ذاكرة الجهاز).
const VERSION = 'v23';
const CACHE = `uni-erp-static-${VERSION}`;
const PRECACHE = ['/offline.html', '/style.css', '/fonts/tr-cairo-arabic-400.woff2', '/fonts/tr-cairo-arabic-600.woff2', '/fonts/tr-cairo-arabic-700.woff2', '/fonts/tr-cairo-arabic-800.woff2', '/transcript.css', '/transcript.js', '/stable.js', '/idcard.js', '/exchange.js', '/record360.js', '/tablefilter.js', '/attendance.js', '/push.js', '/icons/icon-192.png', '/brand/crest.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('uni-erp-static-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // الشبكة مباشرة، دون تخزين

  // التنقل بين الصفحات: الشبكة أولاً، وعند انقطاع الاتصال صفحة «لا يوجد اتصال»
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // الملفات الثابتة: الشبكة أولاً (لتصل التحديثات فوراً)، والنسخة المخزّنة عند انقطاع الاتصال
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// تنبيهات الجوال (Web Push): الحمولة مشفَّرة من الخادم وتصل JSON: { title, body, url, tag }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'إشعار جديد', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'إشعار جديد'), {
    body: String(d.body || ''), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.tag || 'uni', renotify: true, dir: 'rtl', lang: 'ar', data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return null; }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'push-resubscribe' }))));
});
