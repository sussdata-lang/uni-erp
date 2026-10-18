// تشكيل الحروف العربية (أشكال العرض FE70–FEFC) وترتيب بصري ثنائي الاتجاه مبسّط لأسطر الشهادات القصيرة.
// forms: [معزول، نهائي، ابتدائي، وسطي]
const F = { 0x621: [0xFE80], 0x622: [0xFE81, 0xFE82], 0x623: [0xFE83, 0xFE84], 0x624: [0xFE85, 0xFE86], 0x625: [0xFE87, 0xFE88], 0x626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],
  0x627: [0xFE8D, 0xFE8E], 0x628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92], 0x629: [0xFE93, 0xFE94], 0x62A: [0xFE95, 0xFE96, 0xFE97, 0xFE98], 0x62B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],
  0x62C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], 0x62D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], 0x62E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], 0x62F: [0xFEA9, 0xFEAA], 0x630: [0xFEAB, 0xFEAC],
  0x631: [0xFEAD, 0xFEAE], 0x632: [0xFEAF, 0xFEB0], 0x633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], 0x634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], 0x635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],
  0x636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], 0x637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], 0x638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], 0x639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC],
  0x63A: [0xFECD, 0xFECE, 0xFECF, 0xFED0], 0x641: [0xFED1, 0xFED2, 0xFED3, 0xFED4], 0x642: [0xFED5, 0xFED6, 0xFED7, 0xFED8], 0x643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],
  0x644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], 0x645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], 0x646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], 0x647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],
  0x648: [0xFEED, 0xFEEE], 0x649: [0xFEEF, 0xFEF0], 0x64A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4] };
const LAM_ALEF = { 0x622: [0xFEF5, 0xFEF6], 0x623: [0xFEF7, 0xFEF8], 0x625: [0xFEF9, 0xFEFA], 0x627: [0xFEFB, 0xFEFC] };
const dual = (c) => !!F[c] && F[c].length === 4, joinsPrev = (c) => !!F[c] && F[c].length >= 2;
const isArabic = (c) => (c >= 0x600 && c <= 0x6ff) || (c >= 0xfb50 && c <= 0xfeff);
const isTashkeel = (c) => c >= 0x64b && c <= 0x65f;
const MIRROR = { 0x28: 0x29, 0x29: 0x28, 0x5b: 0x5d, 0x5d: 0x5b, 0x7b: 0x7d, 0x7d: 0x7b, 0x3c: 0x3e, 0x3e: 0x3c };

function shapeRtl(codes) {                                   // أكواد منطقية (حروف عربية وغيرها) ← أكواد عرض بالترتيب المنطقي
  const cs = codes.filter((c) => !isTashkeel(c)), out = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!F[c]) { out.push(MIRROR[c] ?? c); continue; }
    const p = cs[i - 1], n = cs[i + 1], prevConn = !!p && dual(p) && !(F[p] && out.length && false) && joinsPrev(c);
    if (c === 0x644 && LAM_ALEF[n]) { out.push(LAM_ALEF[n][prevConn ? 1 : 0]); i++; continue; }
    const nextConn = dual(c) && !!n && joinsPrev(n);
    const f = F[c]; out.push(f.length === 4 ? f[prevConn && nextConn ? 3 : prevConn ? 1 : nextConn ? 2 : 0] : f[prevConn ? 1 : 0]);
  }
  return out;
}

// يعيد أكواد الأحرف بترتيب العرض من اليسار إلى اليمين
export function visualCodes(str) {
  const cps = [...String(str)].map((ch) => ch.codePointAt(0));
  if (!cps.some(isArabic)) return cps;
  // 1) تصنيف: R عربي، L لاتيني/رقم، N محايد
  const cls = cps.map((c) => (isArabic(c) && !(c >= 0x660 && c <= 0x669) ? 'R' : /[A-Za-z0-9\u0660-\u0669]/.test(String.fromCodePoint(c)) ? 'L' : 'N'));
  // 2) المحايد بين L وL (مع فواصل شائعة داخل الأرقام والروابط) يتبع L، وإلا اتجاه الفقرة (RTL)
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 'N') continue; let j = i; while (j < cls.length && cls[j] === 'N') j++;
    const between = cls[i - 1] === 'L' && cls[j] === 'L', joiner = cps.slice(i, j).every((c) => '-:./_@,%+'.includes(String.fromCodePoint(c)));
    for (let k = i; k < j; k++) cls[k] = between && joiner ? 'L' : 'R'; i = j - 1;
  }
  // 3) مقاطع متتالية
  const runs = []; for (let i = 0; i < cps.length; i++) { const d = cls[i]; if (runs.at(-1)?.d === d) runs.at(-1).c.push(cps[i]); else runs.push({ d, c: [cps[i]] }); }
  // 4) ترتيب العرض: المقاطع بالعكس (فقرة RTL)، المقطع العربي مشكَّل ومعكوس، واللاتيني كما هو
  return runs.reverse().flatMap((r) => (r.d === 'R' ? shapeRtl(r.c).reverse() : r.c));
}
