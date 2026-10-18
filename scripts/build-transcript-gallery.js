// يبني demo/transcript-templates.html: معرض مستقل للنماذج الأربعة ببيانات وهمية (خطوط وشعار مضمَّنة، يعمل دون خادم).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { qrSvg } from '../server/qr.js';
import { buildView } from '../server/services/transcriptmodel.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = path.join(root, 'public');
const rd = (f) => fs.readFileSync(path.join(pub, f));
let css = rd('transcript.css').toString().replace(/url\(\/fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${rd('fonts/' + f).toString('base64')})`);
const crest = 'data:image/svg+xml;base64,' + rd('brand/crest.svg').toString('base64');
const qr = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg('https://example.edu/verify/DEMO-7QK2-M9XA')).toString('base64');
const c = (course, code, hours, th, pr, mark, level, semester, ay, previous = false) => ({ course, code, hours, theory: th, practical: pr, mark, level, semester, academicYear: ay, previous, term: `${ay}-${semester}` });
const grades = [
  c('مدخل إلى الأمن السيبراني', 'CYB101', 3, 42, 40, 82, 1, 1, '2023/2024'), c('البرمجة 1', 'CS101', 4, 36, 45, 91, 1, 1, '2023/2024'), c('الرياضيات المتقطعة', 'MA102', 3, 55, null, 74, 1, 1, '2023/2024'), c('اللغة العربية', 'AR101', 2, 70, null, 88, 1, 1, '2023/2024'), c('مهارات الاتصال', 'EN101', 2, 62, null, 55, 1, 1, '2023/2024', true), c('مهارات الاتصال', 'EN101', 2, 66, null, 68, 1, 1, '2023/2024'),
  c('هياكل البيانات', 'CS102', 4, 38, 44, 85, 1, 2, '2023/2024'), c('شبكات الحاسوب', 'NET110', 3, 40, 42, 79, 1, 2, '2023/2024'), c('الإحصاء والاحتمالات', 'MA104', 3, 58, null, 93, 1, 2, '2023/2024'), c('الثقافة الوطنية', 'NA102', 2, 77, null, 90, 1, 2, '2023/2024'),
  c('نظم التشغيل', 'CS201', 4, 40, 41, 76, 2, 1, '2024/2025'), c('التشفير التطبيقي', 'CYB201', 3, 45, 38, 87, 2, 1, '2024/2025'), c('قواعد البيانات', 'CS203', 3, 44, 40, 81, 2, 1, '2024/2025'), c('أمن الشبكات', 'CYB202', 3, 47, 40, 94, 2, 1, '2024/2025'),
  c('الاستجابة للحوادث', 'CYB210', 3, 41, 36, 72, 2, 2, '2024/2025'), c('اختبار الاختراق', 'CYB220', 4, 38, 46, 89, 2, 2, '2024/2025'), c('هندسة البرمجيات', 'CS210', 3, 43, 39, 83, 2, 2, '2024/2025'), c('القانون الرقمي', 'LAW201', 2, 66, null, 92, 2, 2, '2024/2025'),
];
for (const [n, code, h, sem] of [['الأمن السحابي', 'CYB301', 3, 1], ['التحليل الجنائي الرقمي', 'CYB310', 3, 1], ['مشروع التخرج 1', 'CYB399', 4, 2]]) grades.push({ course: n, code, hours: h, theory: null, practical: null, mark: null, level: 3, semester: sem, academicYear: null, previous: false, pending: true, term: '' });
const cur = grades.filter((g) => !g.previous && !g.pending), H = cur.reduce((s, g) => s + g.hours, 0);
const doc = { code: 'DEMO-7QK2-M9XA', hash: 'a3f9c2d17be4408f9d62e1c07755ab3c91fe20d84b6a1c33', logo: crest,
  payload: { university: 'الجامعة السورية للعلوم الأمنية', requestNo: 'REQ-2026-000417', issuedAt: '2026-10-15T09:30:00Z',
    student: { name: 'سارة أحمد العلي', studentNo: '2023-04817', faculty: 'كلية الأمن السيبراني', facultyCode: 'CYB', programName: 'الأمن السيبراني', degree: 'الإجازة', years: 4, level: 3, enrollYear: 2023, status: 'active' },
    transcript: { grades, average: cur.reduce((s, g) => s + g.hours * g.mark, 0) / H, summary: { courses: cur.length, passed: cur.length, failed: 0, hours: H, earnedHours: H } } } };
doc.view = buildView(doc.payload);
const js = rd('transcript.js').toString();
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>نماذج كشف العلامات</title><style>${css}
body{margin:0;background:#e9efed;font-family:'TRCairo',sans-serif;color:#14211e}
.gbar{position:sticky;top:0;z-index:50;background:#032E28;color:#fff;padding:.7rem 1rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.gbar b{margin-left:auto;color:#E6CB84}.gbar button{font:inherit;border:1px solid rgba(230,203,132,.5);background:transparent;color:#fff;padding:.4rem .9rem;border-radius:2rem;cursor:pointer}
.gbar button.on{background:#C9A24B;color:#032E28;border-color:#C9A24B;font-weight:700}
.desc{max-width:210mm;margin:1rem auto .6rem;padding:0 1rem;color:#5b6b66;font-size:.95rem}
.wrap{padding:0 .6rem 3rem}
@media print{.gbar,.desc{display:none}body{background:#fff}.wrap{padding:0}}
</style></head><body><div class="gbar"><b>نماذج كشف العلامات — بيانات وهمية</b><span id="tabs"></span><button id="pr">طباعة / PDF</button></div><div class="desc" id="desc"></div><div class="wrap" id="out"></div>
<script>window.TR_CREST=${JSON.stringify(crest)};window.TR_QR=${JSON.stringify(qr)};</script><script>${js}</script>
<script>const D=${JSON.stringify(doc)};const T=UA.transcript;const tabs=document.getElementById('tabs');
function show(id){history.replaceState(null,'','#'+id);document.getElementById('out').innerHTML=T.render(D,id);document.getElementById('desc').textContent=T.templates.find(t=>t.id===id).desc;[...tabs.children].forEach(b=>b.classList.toggle('on',b.dataset.id===id));}
T.templates.forEach((t,i)=>{const b=document.createElement('button');b.dataset.id=t.id;b.textContent=(i+1)+' · '+t.name;b.onclick=()=>show(t.id);tabs.appendChild(b)});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(T.ids.includes(h))show(h)});document.getElementById('pr').onclick=()=>print();show(T.ids.includes(location.hash.slice(1))?location.hash.slice(1):'classic');</script></body></html>`;
fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
fs.writeFileSync(path.join(root, 'demo/transcript-templates.html'), html);
console.log('ok', (html.length / 1024) | 0, 'KB');
