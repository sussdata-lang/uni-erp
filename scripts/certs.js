// يصدر شهادة تسجيل موقَّعة لكل طالب ليس لديه شهادة (للطلاب المسجَّلين قبل تفعيل الميزة). npm run certs
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { issueEnrollmentCertificate } from '../server/services/enrollcert.js';

const cfg = loadConfig(), db = openDb(cfg.dbPath);
const todo = db.prepare("SELECT u.id, u.student_no FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.role = 'student' AND NOT EXISTS (SELECT 1 FROM student_certs c WHERE c.student_id = u.id) ORDER BY u.id").all();
console.log(`طلاب بلا شهادة: ${todo.length}${cfg.tsaUrl ? ` · جهة الختم الزمني: ${cfg.tsaUrl}` : ' · ختم زمني محلي (لم يُضبط TSA_URL)'}`);
let ok = 0, failed = 0;
for (const s of todo) { try { const r = await issueEnrollmentCertificate({ db, cfg }, s.id); ok++; if (r.tsa_status === 'failed') failed++; } catch (e) { console.error(`  ${s.student_no}: ${e.message}`); } }
console.log(`صدرت ${ok} شهادة${failed ? `، منها ${failed} بلا ختم موثوق (تعذّرت جهة الختم)` : ''}.`);
