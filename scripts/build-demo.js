// يبني ملف عرض مستقل (demo/university-portal-demo.html) يُفتح بنقرتين دون خادم.
// الواجهتان (الطالب والموظف) هما نفسهما واجهتا النظام الحقيقي؛ تُبنى البيانات الأولية بمنطق الخادم الحقيقي،
// ويحلّ محل fetch خادم وهمي داخل المتصفح (بيانات خيالية في الذاكرة فقط).
//   node --disable-warning=ExperimentalWarning scripts/build-demo.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { can, PERMISSIONS } from '../server/permissions.js';
import { registrationOptions, registerStudent, getStudent, listPrograms } from '../server/services/students.js';
import { createCourse, enterGrade, createNews, createComplaint, respondComplaint, listNews, listComplaints, listCourses } from '../server/services/academics.js';
import { createRequest, decide, listRequests } from '../server/services/requests.js';
import { getDocument } from '../server/services/documents.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(':memory:');
const cfg = { scryptN: 1024, signingKey: 'demo-key', universityName: 'الجامعة السورية للعلوم الأمنية', uploadDir: '/tmp/demo-up', maxAttachmentBytes: 2e6 };
const mk = (id, role, label, extra = {}) => ({ id, role, label, can: (p) => can(role, p), ...extra });
db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('staff','م. الأحمد','x','staff',?)").run(Date.now());
const staff = mk(1, 'staff', 'م. الأحمد');

const progs = listPrograms(db), P = (n) => progs.find((p) => p.faculty === n).id;
// بيانات خيالية بالكامل (أسماء وأرقام وطنية وهواتف لا تعود لأشخاص حقيقيين)
const base = { nationality: 'سورية', hs_type: 'الثانوية العامة - الفرع العلمي', hs_max: 2400, admission_type: 'القبول العام (المفاضلة)', enroll_term: 'الفصل الأول', status: 'active', hs_governorate: 'دمشق', guardian_relation: 'الأب' };
const people = [
  { first_name: 'سارة', father_name: 'أحمد', grandfather_name: 'محمود', last_name: 'العلي', mother_name: 'ريما', national_id: '01000000011', gender: 'أنثى', birth_date: '2006-03-15', birth_place: 'دمشق', phone: '0933000011', email: 'sara.demo@example.com', governorate: 'دمشق', city: 'المزة', address: 'شارع الجلاء، بناء 4', hs_year: 2024, hs_score: 2100, program: 'كلية الأمن السيبراني', enroll_year: 2024, study_level: 2, guardian_name: 'أحمد العلي', guardian_phone: '0944000011', ministerial_no: '10011' },
  { first_name: 'عمر', father_name: 'خالد', last_name: 'الحمصي', mother_name: 'هدى', national_id: '01000000022', gender: 'ذكر', birth_date: '2005-09-02', birth_place: 'حمص', phone: '0933000022', governorate: 'حمص', city: 'الإنشاءات', address: 'قرب الحديقة العامة', hs_year: 2023, hs_score: 2250, program: 'كلية العلوم الأمنية', enroll_year: 2023, study_level: 3, guardian_name: 'خالد الحمصي', guardian_phone: '0944000022' },
  { first_name: 'نور', father_name: 'سامر', last_name: 'الشامي', mother_name: 'لينا', national_id: '01000000033', gender: 'أنثى', birth_date: '2006-12-20', birth_place: 'حلب', phone: '0933000033', governorate: 'حلب', city: 'الفرقان', address: 'شارع الملعب', hs_year: 2024, hs_score: 1980, program: 'المعهد العالي للعلوم الأمنية', enroll_year: 2024, study_level: 1, guardian_name: 'لينا الشامي', guardian_relation: 'الأم', guardian_phone: '0944000033' },
  { first_name: 'يوسف', father_name: 'مروان', grandfather_name: 'سليم', last_name: 'درويش', mother_name: 'سلمى', national_id: '01000000044', gender: 'ذكر', birth_date: '2004-05-30', birth_place: 'اللاذقية', phone: '0933000044', governorate: 'اللاذقية', city: 'الزراعة', address: 'حي الأميركان', hs_year: 2022, hs_score: 2310, program: 'كلية العلوم الأمنية', enroll_year: 2022, study_level: 4, guardian_name: 'مروان درويش', guardian_phone: '0944000044' },
  { first_name: 'ريم', father_name: 'فادي', last_name: 'الخطيب', mother_name: 'منى', national_id: '01000000055', gender: 'أنثى', birth_date: '2006-01-11', birth_place: 'دمشق', phone: '0933000055', governorate: 'ريف دمشق', city: 'جرمانا', address: 'قرب المشفى الوطني', hs_year: 2024, hs_score: 2050, program: 'المعهد التقاني للأمن السيبراني', enroll_year: 2024, study_level: 2, guardian_name: 'فادي الخطيب', guardian_phone: '0944000055' },
];
for (const { program, ...rest } of people) await registerStudent({ db, cfg }, staff, { ...base, ...rest, program_id: P(program) }, '127.0.0.1');
const sara = getStudent({ db }, 2);

// دليل المواد لبرنامج الأمن السيبراني (أسماء مثال)
const pid = P('كلية الأمن السيبراني');
const plan = {
  '1-1': [['مدخل إلى البرمجة', 'د. هالة سعيد'], ['الرياضيات المتقطعة', 'د. سمير ناصر'], ['مبادئ الحاسوب', 'د. ليلى منصور'], ['اللغة الإنكليزية', 'أ. رنا حداد']],
  '1-2': [['البرمجة الكائنية', 'د. هالة سعيد'], ['الفيزياء العامة', 'د. وائل جبر'], ['قواعد البيانات', 'د. كمال يونس']],
  '2-1': [['هياكل البيانات', 'د. سمير ناصر'], ['نظم التشغيل', 'د. ماهر عيسى'], ['الشبكات الحاسوبية', 'د. نادين صالح']],
  '2-2': [['أمن الشبكات', 'د. نادين صالح'], ['التشفير التطبيقي', 'د. ماهر عيسى'], ['هندسة البرمجيات', 'د. كمال يونس']],
};
const cid = {};
for (const [k, list] of Object.entries(plan)) { const [lv, sm] = k.split('-').map(Number); for (const [name, instructor] of list) cid[name] = createCourse({ db }, staff, { programId: pid, level: lv, semester: sm, name, hours: 3, instructor }, 'x').course.id; }
const G = (course, ay, t, p) => enterGrade({ db }, staff, 2, { courseId: cid[course], academicYear: ay, theory: t, practical: p }, 'x');
for (const [c, t, p] of [['مدخل إلى البرمجة', 55, 30], ['الرياضيات المتقطعة', 25, 20], ['مبادئ الحاسوب', 50, 30], ['اللغة الإنكليزية', 60, 25], ['البرمجة الكائنية', 58, 28], ['الفيزياء العامة', 44, 22], ['قواعد البيانات', 47, 30]]) G(c, '2024/2025', t, p);
G('الرياضيات المتقطعة', '2025/2026', 52, 25);               // إعادة مقرر راسب → تظهر «العلامات السابقة»
G('هياكل البيانات', '2025/2026', 56, 30); G('نظم التشغيل', '2025/2026', 38, 12); G('الشبكات الحاسوبية', '2025/2026', 50, 30);

createNews({ db }, staff, { title: 'بدء التسجيل للفصل الدراسي الأول', body: 'يبدأ التسجيل للفصل الدراسي الأول اعتباراً من الأسبوع القادم.\nيرجى مراجعة قسم شؤون الطلاب لاستكمال الإجراءات.', pinned: true }, 'x');
createNews({ db }, staff, { title: 'تعميم: مواعيد الامتحانات النصفية', body: 'ستُعلَن مواعيد الامتحانات النصفية على بوابة الطالب فور اعتمادها.' }, 'x');
createNews({ db }, staff, { title: 'ورشة تدريبية في أمن المعلومات', body: 'تقيم الكلية ورشة تدريبية مفتوحة لطلاب البرنامج يوم الأربعاء القادم في قاعة المحاضرات الكبرى.' }, 'x');
createNews({ db }, staff, { title: 'إعلان: منح دراسية للمتفوقين', body: 'تُفتح أبواب التقديم لمنح المتفوقين حتى نهاية الشهر الجاري.' }, 'x');

const sU = mk(2, 'student', 'سارة أحمد العلي', { student_no: sara.studentNo });
const cmp = createComplaint({ db }, sU, { subject: 'تأخر إدخال علامة', body: 'لم تظهر علامة مادة الفيزياء العامة بعد انتهاء الامتحان بأسبوعين.' }, 'x').complaint;
respondComplaint({ db }, staff, cmp.id, { response: 'تمت مراجعة الأمر مع الكلية وستظهر العلامة خلال يومين.' }, 'x');

const r1 = createRequest({ db, cfg }, sU, { service: 'attendance', details: { purpose: 'جهة حكومية', copies: 1 } }, 'x');
const svcA = db.prepare('SELECT * FROM service_types WHERE code = ?').get('attendance');
decide({ db, cfg }, staff, r1.id, 'approve', null, 'x');
createRequest({ db, cfg }, sU, { service: 'campus_life', details: { kind: 'السكن الجامعي', reason: 'الإقامة خارج مدينة الجامعة' } }, 'x');

const rows = db.prepare('SELECT s.user_id FROM student_profiles s ORDER BY s.user_id').all();
const students = rows.map((r) => getStudent({ db }, r.user_id));
const requests = listRequests({ db }, staff, {});
const docs = Object.fromEntries(db.prepare('SELECT code FROM documents').all().map((d) => [d.code, getDocument({ db }, staff, d.code)]));
const services = db.prepare('SELECT * FROM service_types WHERE enabled = 1').all()
  .map((s) => ({ code: s.code, label: s.label, description: s.description, slaHours: s.sla_hours, requiresAttachment: !!s.requires_attachment, issuesDocument: !!s.issues_document, fields: JSON.parse(s.fields_json) }));
const gradesRaw = db.prepare('SELECT g.*, c.instructor FROM grades g LEFT JOIN courses c ON c.id = g.course_id').all();
const courses = db.prepare('SELECT id FROM courses').all().map((c) => c.id);
const allCourses = listCourses({ db }, staff, { program: String(pid) }).courses;
const users = {
  student: { id: 2, username: sara.studentNo, name: sara.name.split(' ').slice(0, 1).join('') + ' ' + sara.name.split(' ').slice(1, 2) + ' ' + sara.name.split(' ').slice(-1), role: 'student', studentNo: sara.studentNo, program: null, mustChange: false, permissions: PERMISSIONS.student },
  staff: { id: 1, username: 'staff', name: 'م. الأحمد', role: 'staff', studentNo: null, program: null, mustChange: false, permissions: PERMISSIONS.staff },
};
users.student.name = sara.name;
const state = { options: registrationOptions(db, false), students, programs: listPrograms(db), requests, docs, services, news: listNews({ db }), courses: allCourses, grades: gradesRaw, complaints: listComplaints({ db }, staff, {}).complaints, users, saraId: 2, university: cfg.universityName };

const strip = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/^export /gm, '');
const qr = strip('server/qr.js').replace('[...Buffer.from(text, \'utf8\')]', '[...new TextEncoder().encode(text)]');
const shim = fs.readFileSync(path.join(root, 'scripts/demo-shim.js'), 'utf8');
const data = JSON.stringify(state).replace(/</g, '\\u003c');
const crestUri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'public/brand/crest.svg')).toString('base64');   // الملف المستقل لا يرى /brand/ فيُضمَّن الشعار
// الشعار يُضمَّن مرة واحدة فقط (حجمه كبير): متغير CSS + متغير JS تقرؤه القوالب
const font = (f) => 'data:font/ttf;base64,' + fs.readFileSync(path.join(root, 'public/fonts', f)).toString('base64');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8').replaceAll('url("/brand/crest.svg")', 'var(--crest-url)')
  .replace('url(/fonts/al-mohanad.ttf)', `url(${font('al-mohanad.ttf')})`).replace('url(/fonts/AL-Mohanad-Bold-1.ttf)', `url(${font('AL-Mohanad-Bold-1.ttf')})`);
const js = ['app.js', 'staff.js', 'student.js', 'boot.js'].map((f) => fs.readFileSync(path.join(root, 'public', f), 'utf8').replaceAll('src="/brand/crest.svg"', 'src="${window.__CREST}"').replace(/<\/script/gi, '<\\/script'));
let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="/style.css">', `<style>${css}\n.demo-bar{background:#fff4d6;color:#5b4300;font-size:13px;padding:6px 12px;border-bottom:1px solid #e7cf8a;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}.demo-bar button{font:inherit;border:1px solid #c9a94e;background:#fff;color:#5b4300;border-radius:999px;padding:2px 12px;cursor:pointer}.demo-bar button[aria-pressed=true]{background:#5b4300;color:#fff}</style>`)
  .replace(/<script src="\/[a-z]+\.js" defer><\/script>\s*/g, '')
  .replace('</body>', `<script>window.__CREST='${crestUri}';document.documentElement.style.setProperty('--crest-url','url('+window.__CREST+')');window.__DEMO__=${data};</script>\n<script>${qr}\n${shim}</script>\n<script>${js[0]}</script>\n<script>${js[1]}</script>\n<script>${js[2]}</script>\n<script>${js[3]}</script>\n</body>`);
fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
fs.rmSync(path.join(root, 'demo/registration-demo.html'), { force: true });
fs.writeFileSync(path.join(root, 'demo/university-portal-demo.html'), html);
console.log('OK', (html.length / 1024).toFixed(0) + ' KB', { students: students.length, requests: requests.length, docs: Object.keys(docs).length, courses: allCourses.length, grades: gradesRaw.length });
