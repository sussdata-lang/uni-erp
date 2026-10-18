import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/security.js';
import { drainCertificates, certFor } from '../server/services/enrollcert.js';
import { verifyPdf, sha256 } from '../server/services/pki.js';

const PW = 'Test#Pass12345', fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const hasOpenssl = spawnSync('openssl', ['version']).status === 0, hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
let app, base, dir, admin, staff, auditor, stuCookie, stuNo;
async function api(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* */ }
  return { status: res.status, json, buf, headers: res.headers };
}
async function loginAs(u, p = PW) { app.limiter.hits.clear(); const r = await api('POST', '/api/auth/login', { body: { username: u, password: p } }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; }

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-erp-cert-'));
  app = createApp({ dbPath: path.join(dir, 't.db'), uploadDir: path.join(dir, 'up'), scryptN: 1024, port: 0 });
  app.cfg.publicUrl = 'https://portal.example.sy';
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const h = await hashPassword(PW, 1024);
  for (const [u, role] of [['admin', 'admin'], ['staff', 'staff'], ['auditor', 'auditor']]) app.db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(u, u, h, role, Date.now());
  admin = await loginAs('admin'); staff = await loginAs('staff'); auditor = await loginAs('auditor');
  const r = await api('POST', '/api/import/students', { cookie: staff, body: { filename: 's.xlsx', data: fx('students-filled.xlsx').toString('base64'), commit: true } });
  assert.equal(r.json.created, 2);
  await drainCertificates(app.db);
  stuNo = 'CCS-2026-0001'; app.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE student_no = ?').run(h, stuNo);
  stuCookie = await loginAs(stuNo);
});
test.after(async () => { await app.close(); });

const sid = (no) => app.db.prepare('SELECT id FROM users WHERE student_no = ?').get(no).id;

test('عند إنشاء كل حساب طالب تُصدَر شهادة موقَّعة تلقائياً (بما فيها الاستيراد الجماعي)', async () => {
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM student_certs').get().c, 2);
  const c = certFor(app.db, sid(stuNo));
  assert.match(c.code, /^SC-[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.equal(c.tsa_status, 'local'); assert.equal(c.cert_self_signed, 1); assert.match(c.pdf_sha256, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(c.created_at - Date.now()) < 60_000 && c.signed_at >= c.created_at);
  assert.equal(JSON.parse(c.payload_json).student.studentNo, stuNo);
});

test('الملف: PDF/A-2b بتوقيع CMS صالح، بصمة SHA-256، وQR/رابط التحقق في المحتوى', async () => {
  const r = await api('GET', `/api/students/${sid(stuNo)}/certificate.pdf`, { cookie: staff });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf'); assert.match(r.headers.get('content-disposition'), /enrollment-CCS-2026-0001\.pdf/);
  const pdf = r.buf, txt = pdf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.7'));
  for (const k of ['<pdfaid:part>2</pdfaid:part>', '<pdfaid:conformance>B</pdfaid:conformance>', '/GTS_PDFA1', '/DestOutputProfile', '/FontFile2', '/ToUnicode', '/adbe.pkcs7.detached', '/SigFlags 3']) assert.ok(txt.includes(k), k);
  assert.ok(!/\/Encrypt|\/JavaScript|\/JS\b/.test(txt));
  const v = verifyPdf(pdf);
  assert.equal(v.signed, true); assert.equal(v.intact, true); assert.equal(v.digestOk, true); assert.equal(v.signatureOk, true); assert.equal(v.covers, true); assert.equal(v.selfSigned, true);
  assert.equal(v.pdfSha256, certFor(app.db, sid(stuNo)).pdf_sha256); assert.equal(v.pdfSha256, sha256(pdf).toString('hex'));
  // أي بايت يتغير يُبطل التحقق
  const bad = Buffer.from(pdf); bad[bad.indexOf('/Type /Page ') + 2] ^= 1; assert.equal(verifyPdf(bad).intact, false);
  if (hasOpenssl) {            // مرجع مستقل: OpenSSL يتحقق من CMS على نفس المقاطع
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(txt).slice(1).map(Number), hex = /\/Contents\s*<([0-9A-F]+)>/.exec(txt)[1].replace(/(00)+$/, '');
    fs.writeFileSync(path.join(dir, 'c.bin'), Buffer.concat([pdf.subarray(m[0], m[0] + m[1]), pdf.subarray(m[2], m[2] + m[3])])); fs.writeFileSync(path.join(dir, 'c.p7s'), Buffer.from(hex, 'hex'));
    execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', path.join(dir, 'c.p7s'), '-content', path.join(dir, 'c.bin'), '-binary', '-noverify', '-out', '/dev/null'], { stdio: 'pipe' });
  }
  if (hasQpdf) assert.equal(spawnSync('qpdf', ['--check', path.join(dir, 'up', 'certs', certFor(app.db, sid(stuNo)).file)]).status, 0);
});

test('التنزيل: الطالب يحمّل شهادته وحدها، والمدقق والطالب لا يحمّلان شهادات غيرهما', async () => {
  const mine = await api('GET', '/api/me/certificate.pdf', { cookie: stuCookie }); assert.equal(mine.status, 200); assert.ok(verifyPdf(mine.buf).intact);
  const info = (await api('GET', '/api/me/certificate', { cookie: stuCookie })).json.certificate; assert.equal(info.selfSigned, true); assert.equal(info.tsaStatus, 'local');
  assert.equal((await api('GET', `/api/students/${sid('CSS-2026-0001')}/certificate.pdf`, { cookie: stuCookie })).status, 403);
  assert.equal((await api('GET', `/api/students/${sid(stuNo)}/certificate.pdf`, { cookie: auditor })).status, 403);
  assert.equal((await api('GET', '/api/me/certificate.pdf', { cookie: staff })).status, 403);
  assert.equal((await api('GET', `/api/students/${sid(stuNo)}/certificate.pdf`)).status, 401);
  const detail = (await api('GET', `/api/students/${sid(stuNo)}`, { cookie: staff })).json; assert.equal(detail.certificate.code, certFor(app.db, sid(stuNo)).code);
});

test('بوابة التحقق: الرمز والبصمة يعطيان نتيجة صحيحة بلا كشف بيانات كاملة، والتلاعب يُكتشف', async () => {
  const c = certFor(app.db, sid(stuNo));
  const v = (await api('GET', `/api/verify/${c.code}`)).json;                       // بلا تسجيل دخول
  assert.equal(v.valid, true); assert.equal(v.kind, 'enrollment'); assert.equal(v.student, 'ليلى أ.'); assert.equal(v.faculty, 'كلية الأمن السيبراني');
  assert.equal(v.signature.intact, true); assert.equal(v.signature.selfSigned, true); assert.equal(v.signature.timestamp.status, 'local'); assert.match(v.signature.signer, /SUSS Student Records Signing/);
  assert.ok(!JSON.stringify(v).includes('01234567890') && !JSON.stringify(v).includes('0944123456'));
  assert.equal((await api('GET', `/api/verify/${c.code.toLowerCase()}`)).json.valid, true);
  const byHash = (await api('GET', `/api/verify-hash/${c.pdf_sha256}`)).json; assert.equal(byHash.valid, true); assert.equal(byHash.code, c.code);
  assert.equal((await api('GET', `/api/verify-hash/${'0'.repeat(64)}`)).json.reason, 'not_found'); assert.equal((await api('GET', '/api/verify-hash/xyz')).json.reason, 'malformed');
  assert.equal((await api('GET', '/api/verify/SC-ZZZZ-ZZZZ')).json.reason, 'not_found');
  // رموز الطلبات القديمة (UV-) تعمل كما كانت
  assert.equal((await api('GET', '/api/verify/UV-ABCD-EFGH')).json.reason, 'not_found');
  // تعديل الملف المخزَّن يُكتشف
  const f = path.join(dir, 'up', 'certs', c.file), orig = fs.readFileSync(f), mod = Buffer.from(orig); mod[100] ^= 0xff; fs.writeFileSync(f, mod);
  assert.equal((await api('GET', `/api/verify/${c.code}`)).json.reason, 'tampered');
  fs.writeFileSync(f, orig); assert.equal((await api('GET', `/api/verify/${c.code}`)).json.valid, true);
  fs.unlinkSync(f); assert.equal((await api('GET', `/api/verify/${c.code}`)).json.reason, 'file_missing'); fs.writeFileSync(f, orig);
});

test('الإصدار عند الطلب: طالب قديم بلا شهادة تُصدَر له عند أول تنزيل', async () => {
  const h = await hashPassword(PW, 1024);
  const prog = app.db.prepare('SELECT id FROM programs WHERE faculty_id = 2').get().id;
  const uid = Number(app.db.prepare("INSERT INTO users (username, display_name, password_hash, role, student_no, program, created_at) VALUES ('2023-0007','قديم',?, 'student','2023-0007','x',?)").run(h, Date.now()).lastInsertRowid);
  app.db.prepare(`INSERT INTO student_profiles (user_id, first_name, father_name, last_name, mother_name, national_id, gender, birth_date, birth_place, nationality, phone, governorate, city, address, hs_type, hs_year, hs_score, program_id, admission_type, enroll_year, enroll_term, study_level, guardian_name, guardian_relation, guardian_phone, status, created_at, updated_at)
    VALUES (?, 'قديم','الأب','الطالب','الأم','11111111111','ذكر','2003-01-01','دمشق','سورية','0944000000','دمشق','المزة','x','x',2021,100,?,'x',2023,'الفصل الأول',3,'ولي','الأب','0933000000','active',?,?)`).run(uid, prog, Date.now(), Date.now());
  assert.equal(certFor(app.db, uid), null);
  const r = await api('GET', `/api/students/${uid}/certificate.pdf`, { cookie: admin }); assert.equal(r.status, 200); assert.ok(verifyPdf(r.buf).intact);
  assert.ok(certFor(app.db, uid)); assert.equal((await api('GET', `/api/students/${uid}/certificate.pdf`, { cookie: admin })).buf.equals(r.buf), true);   // لا تُصدَر ثانيةً
});

test('الختم الزمني RFC 3161: يُدمج في التوقيع ويُتحقق منه، وتعثّره لا يُبطل الشهادة', { skip: !hasOpenssl && 'يتطلب openssl' }, async () => {
  const t = path.join(dir, 'tsa'); fs.mkdirSync(t);
  const sh = (...a) => execFileSync('openssl', a, { cwd: t, stdio: 'pipe' });
  fs.writeFileSync(path.join(t, 'tsa.cnf'), `[tsa]\ndefault_tsa=tsa_def\n[tsa_def]\nserial=${t}/serial\nsigner_cert=${t}/tsa.crt\nsigner_key=${t}/tsa.key\ndefault_policy=1.2.3.4.1\ndigests=sha256\nsigner_digest=sha256\naccuracy=secs:1\nordering=no\ntsa_name=no\ness_cert_id_chain=no\ness_cert_id_alg=sha256\n`);
  fs.writeFileSync(path.join(t, 'serial'), '01\n');
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tsa.key', '-out', 'tsa.crt', '-subj', '/CN=Test TSA', '-days', '2', '-addext', 'extendedKeyUsage=critical,timeStamping', '-addext', 'keyUsage=critical,digitalSignature');
  let hits = 0;
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      hits++; if (req.url === '/down') { res.writeHead(500); return res.end(); }
      fs.writeFileSync(path.join(t, 'q.tsq'), Buffer.concat(chunks));
      try { sh('ts', '-reply', '-config', 'tsa.cnf', '-queryfile', 'q.tsq', '-out', 'r.tsr'); res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' }); res.end(fs.readFileSync(path.join(t, 'r.tsr'))); } catch (e) { res.writeHead(500); res.end(String(e.stderr)); }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    app.cfg.tsaUrl = `http://127.0.0.1:${srv.address().port}/tsa`;
    const dm = await api('POST', '/api/students', { cookie: staff, body: formFor('77777777771', 'نادر') }); assert.equal(dm.status, 201, dm.buf.toString());
    await drainCertificates(app.db);
    const c = certFor(app.db, dm.json.student.id); assert.equal(c.tsa_status, 'rfc3161'); assert.ok(hits >= 1); assert.equal(c.tsa_url, app.cfg.tsaUrl);
    const pdf = fs.readFileSync(path.join(dir, 'up', 'certs', c.file)), v = verifyPdf(pdf);
    assert.equal(v.intact, true); assert.equal(v.timestamp.present, true); assert.equal(v.timestamp.imprintOk, true); assert.ok(Math.abs(v.timestamp.time - Date.now()) < 120_000);
    const pub = (await api('GET', `/api/verify/${c.code}`)).json; assert.equal(pub.signature.timestamp.status, 'rfc3161'); assert.equal(pub.signature.timestamp.embedded, true); assert.equal(pub.signature.timestamp.imprintOk, true);
    // جهة ختم معطّلة: تُصدَر الشهادة بوقت محلي وتبقى صالحة
    app.cfg.tsaUrl = `http://127.0.0.1:${srv.address().port}/down`;
    const d2 = await api('POST', '/api/students', { cookie: staff, body: formFor('77777777772', 'ماهر') }); await drainCertificates(app.db);
    const c2 = certFor(app.db, d2.json.student.id); assert.equal(c2.tsa_status, 'failed'); assert.equal(verifyPdf(fs.readFileSync(path.join(dir, 'up', 'certs', c2.file))).intact, true);
    assert.equal((await api('GET', `/api/verify/${c2.code}`)).json.valid, true);
    // جهة ختم خارج الخدمة كلياً (اتصال مرفوض)
    app.cfg.tsaUrl = 'http://127.0.0.1:1/none'; const d3 = await api('POST', '/api/students', { cookie: staff, body: formFor('77777777773', 'باسل') }); await drainCertificates(app.db);
    assert.equal(certFor(app.db, d3.json.student.id).tsa_status, 'failed');
  } finally { app.cfg.tsaUrl = null; srv.close(); }
});

function formFor(nid, first) {
  return { first_name: first, father_name: 'علي', last_name: 'الخطيب', mother_name: 'هدى', national_id: nid, gender: 'ذكر', birth_date: '2005-11-02', birth_place: 'حمص', nationality: 'سورية', phone: '0944000001', governorate: 'حمص', city: 'الوعر', address: 'شارع 1',
    hs_type: 'الثانوية العامة - الفرع العلمي', hs_year: 2024, hs_score: 2000, program_id: app.db.prepare("SELECT g.id FROM programs g JOIN faculties f ON f.id = g.faculty_id WHERE f.code = 'CSS'").get().id,
    admission_type: 'القبول العام (المفاضلة)', enroll_year: 2026, enroll_term: 'الفصل الأول', study_level: 1, guardian_name: 'علي الخطيب', guardian_relation: 'الأب', guardian_phone: '0933000001' };
}
