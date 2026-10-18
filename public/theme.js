/* تبديل المظهر: تلقائي (يتبع الجهاز) ← فاتح ← ليلي. يُحفظ الاختيار في المتصفح ويُطبَّق قبل رسم الصفحة لتجنّب الوميض. */
(function () {
  const K = 'uni-theme', MODES = ['auto', 'light', 'dark'], LABEL = { auto: 'المظهر: تلقائي (حسب الجهاز)', light: 'المظهر: فاتح', dark: 'المظهر: ليلي' };
  let mode = 'auto';
  try { const v = localStorage.getItem(K); if (MODES.includes(v)) mode = v; } catch { /* التخزين غير متاح */ }
  const ICON = {
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    dark: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"/>',
  };
  const svg = (m) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[m]}</svg>`;
  const apply = () => {
    const r = document.documentElement;
    if (mode === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', mode);
    for (const b of document.querySelectorAll('[data-theme-toggle]')) { b.innerHTML = svg(mode); b.title = b.ariaLabel = LABEL[mode]; b.setAttribute('aria-label', LABEL[mode]); }
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = mode === 'dark' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? '#06201C' : '#054239';
  };
  apply();
  window.UAtheme = { get: () => mode, button: () => `<button class="sx-ib" data-theme-toggle type="button" title="${LABEL[mode]}" aria-label="${LABEL[mode]}">${svg(mode)}</button>`,
    set(m) { if (!MODES.includes(m)) return; mode = m; try { localStorage.setItem(K, m); } catch { /* */ } apply(); } };
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('[data-theme-toggle]')) return;
    window.UAtheme.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  });
  document.addEventListener('DOMContentLoaded', apply);
})();
