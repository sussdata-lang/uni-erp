// npm run check — فحص جاهزية النشر على الإعداد الحالي (.env والمتغيرات). رمز الخروج 1 عند أي fail.
import { createApp } from '../server/app.js';
import { checkReadiness } from '../server/services/readiness.js';

const app = createApp({ backupAuto: false });
const ICON = { ok: '✔', warn: '⚠', fail: '✘' };
const res = checkReadiness(app);
for (const c of res) console.log(`${ICON[c.level]} [${c.id}] ${c.msg}`);
const n = (l) => res.filter((c) => c.level === l).length;
console.log(`\nالنتيجة: ${n('ok')} سليم · ${n('warn')} تحذير · ${n('fail')} إخفاق`);
await app.close();
process.exit(n('fail') ? 1 : 0);
