// عامل الخدمة: يجعل التطبيق قابلاً للتثبيت ويسرّع تحميل الملفات الثابتة.
// قاعدة أمنية: لا تُخزَّن أي استجابة من /api/ إطلاقاً (بيانات الطلاب لا تُحفظ في ذاكرة الجهاز).
const VERSION = 'v7';
const CACHE = `uni-erp-static-${VERSION}`;
const PRECACHE = ['/offline.html', '/style.css', '/icons/icon-192.png', '/brand/crest.svg'];

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
