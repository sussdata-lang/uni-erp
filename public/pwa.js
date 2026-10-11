// تسجيل عامل الخدمة. يعمل فقط على HTTPS أو localhost؛ وفي غير ذلك يعمل الموقع عادياً دون تثبيت.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* غير مدعوم في هذا السياق */ });
  });
}
