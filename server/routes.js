import fs from 'node:fs';
import { Router, HttpError, sendRaw, SECURITY_HEADERS as SEC } from './http.js';
import { login, logout, publicUser, changePassword } from './services/auth.js';
import { listStaff, createUser, updateUser, setUserActive, resetUserPassword, deleteUser } from './services/useradmin.js';
import { getTranscriptTemplate, setTranscriptTemplate } from './services/site.js';
import { updateHold, deleteHold, updateRule, deleteRule } from './services/admindata.js';
import { runImport, IMPORT_PERM } from './services/importer.js';
import { addStudentFile, listStudentFiles, deleteStudentFile, streamStudentFile } from './services/studentfiles.js';
import { createBackup, backupInfo, backupPath, deleteBackup } from './services/backup.js';
import { vapidKeys, subscribe as pushSubscribe, unsubscribe as pushUnsubscribe, subscriptionCount, notify, notifyNews, notifyGrade, notifyRequest, notifyComplaint } from './services/push.js';
import { scan as hallScan, addManual as hallAdd, updateLog as hallUpdate, deleteLog as hallDelete, listLogs, openLogs, findStudent } from './services/attendance.js';
import { addUpload, addLink, deleteMedia, streamMedia } from './services/media.js';
import { analytics, filterOptions } from './services/analytics.js';
import { buildReportXlsx, buildReportDocx } from './services/reports.js';
import { documentPdf } from './services/docpdf.js';
import { issueEnrollmentCertificate, certFor, certSummary, readCertPdf, verifyEnrollment, verifyByHash } from './services/enrollcert.js';
import { overview, createRole, updateRole, deleteRole, createUnit, updateUnit, deleteUnit, createLink, deleteLink, linkedTargets } from './services/access.js';
import { registrationOptions, registerStudent, listStudents, listStudentsTable, getStudent, updateStudent, resetStudentPassword, myProfile, updateOwnContact, listPrograms, addProgram, toggleProgram, listFaculties, addFaculty, toggleFaculty, updateFaculty, deleteFaculty, updateProgram, deleteProgram, deleteStudent } from './services/students.js';
import { listCourses, listGradesTable, createCourse, toggleCourse, updateCourse, deleteCourse, myGrades, gradesFor, enterGrade, deleteGrade, listNews, createNews, updateNews, deleteNews, createComplaint, listComplaints, respondComplaint, deleteComplaint } from './services/academics.js';
import { transitionGrades, gradeHistory, workflowOn, setWorkflow } from './services/workflow.js';
import { getSlots, setSlots, detectScheduleConflicts, DAYS } from './services/schedule.js';
import { getUnifiedStudentRecord } from './services/record360.js';
import { expandFields, createRequest, listRequests, getRequest, decide, forwardRequest, stats, readAttachment } from './services/requests.js';
import { getDocument, verifyPublic } from './services/documents.js';
import { exportOptions, preview as exportPreview, renderExport } from './services/dataexport.js';
import { audit, verifyAuditChain } from './audit.js';
import { qrSvg } from './qr.js';

const need = (ctx, perm) => { if (!ctx.user.can(perm)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };

export function buildRouter(deps) {
  const { db, cfg, limiter } = deps;
  const r = new Router();
  const cookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;

  // ---- الهوية ----
  r.add('POST', '/api/auth/login', async (c) => {
    const out = await login(deps, { username: c.body.username, password: c.body.password, ip: c.ip, ua: c.req.headers['user-agent'] });
    c.json(200, { user: out.user }, { 'Set-Cookie': cookie(out.token, out.maxAge) });
  }, { auth: false });
  r.add('POST', '/api/auth/logout', (c) => { logout(deps, c.cookies.sid, c.user, c.ip); c.json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); }, { allowMustChange: true });
  r.add('POST', '/api/auth/change-password', async (c) => { await changePassword(deps, c.user, c.cookies.sid, c.body, c.ip); c.json(200, { ok: true }); }, { allowMustChange: true });
  // بلا جلسة يعيد user:null بحالة 200 (لا ضجيج 401 في المتصفح عند أول فتح)
  r.add('GET', '/api/health', (c) => { db.prepare('SELECT 1').get(); c.json(200, { ok: true }); }, { auth: false });   // فحص صحة للاستضافة
  r.add('GET', '/api/me', (c) => c.json(200, { user: c.user ? publicUser(db, c.user) : null, university: cfg.universityName, transcriptTemplate: getTranscriptTemplate(db) }), { auth: false });
  r.add('PUT', '/api/transcript-template', (c) => { if (!c.user.can('program:manage') && !c.user.can('request:decide')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); c.json(200, { transcriptTemplate: setTranscriptTemplate(deps, c.user, c.body?.template, c.ip) }); });

  r.add('GET', '/api/me/profile', (c) => { need(c, 'profile:read_own'); c.json(200, { profile: myProfile(deps, c.user) }); });

  r.add('PUT', '/api/me/profile', (c) => { need(c, 'profile:update_own'); c.json(200, { profile: updateOwnContact(deps, c.user, c.body, c.ip) }); });

  // ---- تطبيق الطالب: المواد والعلامات والأخبار والشكاوى ----
  r.add('GET', '/api/courses', (c) => {
    if (!c.user.can('course:read_own') && !c.user.can('course:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listCourses(deps, c.user, c.query));
  });
  r.add('POST', '/api/courses', (c) => { need(c, 'course:manage'); c.json(201, createCourse(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/courses/:id', (c) => { need(c, 'course:manage'); c.json(200, updateCourse(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/courses/:id', (c) => { need(c, 'course:manage'); deleteCourse(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/courses/:id/toggle', (c) => { need(c, 'course:manage'); toggleCourse(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/grades', (c) => {                               // جدول العلامات الكامل (بحث/ترتيب/صفحات)
    if (!c.user.can('grade:manage') && !c.user.can('student:read')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listGradesTable(deps, c.query));
  });
  r.add('GET', '/api/me/grades', (c) => { need(c, 'grade:read_own'); c.json(200, myGrades(deps, c.user, c.query)); });
  r.add('GET', '/api/students/:id/grades', (c) => { need(c, 'student:read'); getStudent(deps, c.params.id); c.json(200, gradesFor(db, Number(c.params.id), null)); });
  r.add('POST', '/api/students/:id/grades', (c) => {
    need(c, 'grade:manage'); const out = enterGrade(deps, c.user, c.params.id, c.body, c.ip);
    if (!workflowOn(db)) notifyGrade(deps, Number(c.params.id), db.prepare('SELECT name FROM courses WHERE id = ?').get(Number(c.body?.courseId))?.name);
    c.json(200, out);
  });
  r.add('DELETE', '/api/students/:id/grades/:gid', (c) => { need(c, 'grade:manage'); c.json(200, deleteGrade(deps, c.user, c.params.id, c.params.gid, c.ip, c.query.justification)); });
  // ---- مراحل اعتماد العلامات، جدول المحاضرات، السجل الموحّد ----
  r.add('POST', '/api/grades/workflow', (c) => {
    need(c, 'grade:manage'); const out = transitionGrades(deps, c.user, c.body, c.ip);
    for (const a of out.approvedNow) notifyGrade(deps, a.studentId, a.course);
    c.json(200, { updated: out.updated, skipped: out.skipped, stage: out.stage });
  });
  r.add('GET', '/api/grades/:id/history', (c) => { need(c, 'grade:manage'); c.json(200, { history: gradeHistory(db, c.params.id) }); });
  r.add('POST', '/api/grades/workflow-setting', (c) => { need(c, 'grade:approve'); c.json(200, setWorkflow(deps, c.user, !!c.body?.enabled, c.ip)); });
  r.add('GET', '/api/courses/:id/schedule', (c) => { need(c, 'course:manage'); c.json(200, { slots: getSlots(db, c.params.id), days: DAYS }); });
  r.add('PUT', '/api/courses/:id/schedule', (c) => { need(c, 'course:manage'); c.json(200, setSlots(deps, c.user, c.params.id, c.body?.slots, c.ip)); });
  r.add('GET', '/api/students/:id/schedule-conflicts', (c) => {
    if (!c.user.can('student:read') && c.params.id !== String(c.user.id)) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, detectScheduleConflicts(db, c.params.id));
  });
  r.add('GET', '/api/students/:id/unified-record', (c) => { need(c, 'student:read'); c.json(200, getUnifiedStudentRecord(deps, c.params.id)); });
  r.add('GET', '/api/news', (c) => c.json(200, { news: listNews(deps) }));
  r.add('POST', '/api/news', (c) => { need(c, 'news:manage'); const out = createNews(deps, c.user, c.body, c.ip); notifyNews(deps, String(c.body?.title ?? 'خبر جديد')); c.json(201, out); });
  r.add('PUT', '/api/news/:id', (c) => { need(c, 'news:manage'); c.json(200, updateNews(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/news/:id', (c) => { need(c, 'news:manage'); deleteNews(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  // وسائط الأخبار: رفع مباشر (جسم خام، النوع من البايتات)، رابط، حذف، وبثّ الملف مع Range
  r.add('POST', '/api/news/:id/media', (c) => { need(c, 'news:manage'); c.json(201, addUpload(deps, c.user, c.params.id, c.body, c.query.caption, c.ip)); }, { raw: true, maxBody: 51 * 1024 * 1024 });
  r.add('POST', '/api/news/:id/links', (c) => { need(c, 'news:manage'); c.json(201, addLink(deps, c.user, c.params.id, c.body.url, c.body.caption, c.ip)); });
  r.add('DELETE', '/api/news/media/:id', (c) => { need(c, 'news:manage'); deleteMedia(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/media/:id', (c) => { streamMedia(deps, c.req, c.res, c.params.id, SEC); });
  r.add('POST', '/api/complaints', (c) => { need(c, 'complaint:create'); c.json(201, createComplaint(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/complaints', (c) => {
    if (!c.user.can('complaint:create') && !c.user.can('complaint:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listComplaints(deps, c.user, c.query));
  });
  r.add('DELETE', '/api/complaints/:id', (c) => { need(c, 'complaint:manage'); deleteComplaint(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/complaints/:id/respond', (c) => { need(c, 'complaint:manage'); const out = respondComplaint(deps, c.user, c.params.id, c.body, c.ip); notifyComplaint(deps, c.params.id); c.json(200, out); });

  // ---- تسجيل الطلاب (شؤون الطلاب) ----
  r.add('GET', '/api/registration/options', (c) => { need(c, 'student:register'); c.json(200, registrationOptions(db, c.user.can('program:manage'))); });
  r.add('POST', '/api/students', async (c) => { need(c, 'student:register'); c.json(201, await registerStudent(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/students', (c) => { need(c, 'student:read'); c.json(200, listStudents(deps, c.query)); });
  r.add('POST', '/api/attendance/scan', (c) => { need(c, 'attendance:manage'); c.json(200, hallScan(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/attendance', (c) => { need(c, 'attendance:manage'); c.json(200, listLogs(deps, c.query)); });
  r.add('GET', '/api/attendance/open', (c) => { need(c, 'attendance:manage'); c.json(200, { logs: openLogs(deps) }); });
  r.add('POST', '/api/attendance', (c) => { need(c, 'attendance:manage'); c.json(201, { log: hallAdd(deps, c.user, c.body, c.ip) }); });
  r.add('PUT', '/api/attendance/:id', (c) => { need(c, 'attendance:manage'); c.json(200, { log: hallUpdate(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('DELETE', '/api/attendance/:id', (c) => { need(c, 'attendance:manage'); hallDelete(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/push/key', (c) => c.json(200, { key: vapidKeys(deps).pub, subscribed: subscriptionCount(db, c.user.id) }));
  r.add('POST', '/api/push/subscribe', (c) => c.json(200, pushSubscribe(deps, c.user, c.body)));
  r.add('POST', '/api/push/unsubscribe', (c) => c.json(200, pushUnsubscribe(deps, c.user, c.body?.endpoint)));
  r.add('POST', '/api/push/test', (c) => { notify(deps, [c.user.id], { title: 'تنبيه تجريبي', body: 'التنبيهات تعمل على هذا الجهاز.', url: '/', tag: 'test' }); c.json(200, { ok: true }); });
  r.add('GET', '/api/admin/backups', (c) => { need(c, 'backup:manage'); c.json(200, backupInfo(deps)); });
  r.add('POST', '/api/admin/backups', async (c) => { need(c, 'backup:manage'); c.json(201, { backup: await createBackup(deps, { reason: 'manual', actor: c.user, ip: c.ip }) }); });
  r.add('GET', '/api/admin/backups/:name', (c) => {
    need(c, 'backup:manage'); const f = backupPath(cfg, c.params.name);
    audit(db, c.user, 'تنزيل نسخة احتياطية', c.params.name, c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${c.params.name}"` }, fs.readFileSync(f));
  });
  r.add('DELETE', '/api/admin/backups/:name', (c) => { need(c, 'backup:manage'); deleteBackup(deps, c.user, c.params.name, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/students-table', (c) => { need(c, 'student:read'); c.json(200, listStudentsTable(deps, c.query)); });
  r.add('GET', '/api/students/:id/files', (c) => { need(c, 'student:read'); getStudent(deps, c.params.id); c.json(200, { files: listStudentFiles(db, c.params.id) }); });
  r.add('POST', '/api/students/:id/files', (c) => {
    if (!c.user.can('student:register') && !c.user.can('student:update')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(201, { file: addStudentFile(deps, c.user, c.params.id, c.query.kind, c.query.name, c.body, c.ip) });
  }, { raw: true, maxBody: 9 * 1024 * 1024 });
  r.add('GET', '/api/student-files/:fid', (c) => { streamStudentFile(deps, c.user, c.res, c.params.fid, SEC); });
  r.add('DELETE', '/api/student-files/:fid', (c) => {
    if (!c.user.can('student:register') && !c.user.can('student:update')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    deleteStudentFile(deps, c.user, c.params.fid, c.ip); c.json(200, { ok: true });
  });
  r.add('GET', '/api/students/:id', (c) => {
    need(c, 'student:read');
    const s = getStudent(deps, c.params.id);
    audit(db, c.user, 'عرض ملف طالب', s.studentNo, c.ip);   // الملف يحوي بيانات شخصية: القراءة نفسها تُدقَّق
    c.json(200, { student: s, certificate: certSummary(certFor(db, s.id)) });
  });
  r.add('PUT', '/api/students/:id', (c) => { need(c, 'student:update'); c.json(200, { student: updateStudent(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('DELETE', '/api/students/:id', (c) => { need(c, 'student:delete'); deleteStudent(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/students/:id/reset-password', async (c) => { need(c, 'student:reset_password'); c.json(200, await resetStudentPassword(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/programs', (c) => { need(c, 'student:read'); c.json(200, { programs: listPrograms(db) }); });
  // استيراد من Excel/CSV/SQL: commit=false فحص بلا كتابة، commit=true اعتماد
  r.add('POST', '/api/import/:kind', async (c) => { const k = c.params.kind; need(c, IMPORT_PERM[k] ?? 'role:manage'); c.json(200, await runImport(deps, c.user, k, c.body, c.ip)); }, { maxBody: 15 * 1024 * 1024 });
  r.add('GET', '/api/faculties', (c) => { need(c, 'student:read'); c.json(200, { faculties: listFaculties(db) }); });
  r.add('POST', '/api/admin/faculties', (c) => { need(c, 'program:manage'); c.json(201, addFaculty(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/faculties/:id', (c) => { need(c, 'program:manage'); updateFaculty(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/faculties/:id', (c) => { need(c, 'program:manage'); deleteFaculty(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/faculties/:id/toggle', (c) => { need(c, 'program:manage'); toggleFaculty(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/programs', (c) => { need(c, 'program:manage'); c.json(201, addProgram(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/programs/:id', (c) => { need(c, 'program:manage'); updateProgram(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/programs/:id', (c) => { need(c, 'program:manage'); deleteProgram(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/programs/:id/toggle', (c) => { need(c, 'program:manage'); toggleProgram(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });

  // ---- الخدمات والطلبات ----
  r.add('GET', '/api/services', (c) => c.json(200, { services: db.prepare('SELECT * FROM service_types WHERE enabled = 1').all()
    .map((s) => ({ code: s.code, label: s.label, description: s.description, slaHours: s.sla_hours, requiresAttachment: !!s.requires_attachment, fields: expandFields(db, c.user?.id ?? 0, s.fields_json) })) }));
  r.add('POST', '/api/requests', (c) => { need(c, 'request:create'); c.json(201, { request: createRequest(deps, c.user, c.body, c.ip) }); }, { maxBody: 3.2 * 1024 * 1024 });
  r.add('GET', '/api/requests', (c) => {
    if (!c.user.can('request:read_own') && !c.user.can('request:read_all') && !c.user.can('request:read_unit')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { requests: listRequests(deps, c.user, c.query) });
  });
  r.add('GET', '/api/requests/:id', (c) => c.json(200, { request: getRequest(deps, c.user, c.params.id) }));
  r.add('POST', '/api/requests/:id/approve', (c) => { need(c, 'request:decide'); const out = decide(deps, c.user, c.params.id, 'approve', null, c.ip); notifyRequest(deps, c.params.id); c.json(200, { request: out }); });
  r.add('POST', '/api/requests/:id/reject', (c) => { need(c, 'request:decide'); const out = decide(deps, c.user, c.params.id, 'reject', c.body.reason, c.ip); notifyRequest(deps, c.params.id); c.json(200, { request: out }); });
  r.add('POST', '/api/requests/:id/forward', (c) => { need(c, 'request:forward'); c.json(200, { request: forwardRequest(deps, c.user, c.params.id, c.body, c.ip) }); });
  // الوحدات التي يستطيع المستخدم الإحالة إليها (حسب ارتباط وحدته)
  r.add('GET', '/api/units/targets', (c) => {
    need(c, 'request:forward');
    const targets = c.user.unit_id ? linkedTargets(db, c.user.unit_id)
      : (c.user.role === 'admin' && !c.user.role_key ? db.prepare('SELECT id, name FROM org_units WHERE active = 1 ORDER BY id').all() : []);
    c.json(200, { targets });
  });
  r.add('GET', '/api/attachments/:id', (c) => {
    const a = readAttachment(deps, c.user, c.params.id);
    sendRaw(c.res, 200, { 'Content-Type': a.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}` }, a.buf);
  });
  // ---- لوحة الإحصاءات والتصدير ----
  r.add('GET', '/api/analytics', (c) => { need(c, 'stats:read'); c.json(200, { options: filterOptions(db), ...analytics(db, c.query) }); });
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  r.add('GET', '/api/analytics/export.xlsx', (c) => {
    need(c, 'stats:read');
    sendRaw(c.res, 200, { 'Content-Type': XLSX_MIME, 'Content-Disposition': 'attachment; filename="statistics-report.xlsx"' }, buildReportXlsx(db, c.query));
  });
  r.add('POST', '/api/analytics/export.docx', (c) => {
    need(c, 'stats:read');
    sendRaw(c.res, 200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="statistics-report.docx"' }, buildReportDocx(db, c.body));
  }, { maxBody: 14 * 1024 * 1024 });
  r.add('GET', '/api/stats', (c) => { need(c, 'stats:read'); c.json(200, { stats: stats(deps) }); });

  // ---- تصدير البيانات (طلاب، مواد، علامات...) ----
  r.add('GET', '/api/export/options', (c) => { need(c, 'data:export'); c.json(200, exportOptions(db)); });
  r.add('GET', '/api/export/preview', (c) => { need(c, 'data:export'); c.json(200, exportPreview(db, String(c.query.dataset ?? ''), c.query)); });
  r.add('GET', '/api/export/file', (c) => {
    need(c, 'data:export');
    const out = renderExport(db, { dataset: String(c.query.dataset ?? ''), format: String(c.query.format ?? ''), layout: c.query.layout }, c.query);
    audit(db, c.user, `تصدير بيانات (${c.query.dataset}، ${c.query.format}، ${out.total} صفاً)`, out.name.slice(0, 80), c.ip);
    sendRaw(c.res, 200, { 'Content-Type': out.mime, 'Content-Disposition': `attachment; filename="${out.name}"` }, out.buf);
  });

  // ---- الوثائق والتحقق ----
  r.add('GET', '/api/documents/:code', (c) => c.json(200, { document: getDocument(deps, c.user, c.params.code) }));
  r.add('GET', '/api/documents/:code/pdf', (c) => {
    const { pdf, filename } = documentPdf(deps, c.user, c.params.code, c.query.template);       // يتحقق من حق الوصول ثم يوقّع الملف
    audit(db, c.user, 'تنزيل وثيقة بصيغة PDF', c.params.code.slice(0, 20), c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` }, pdf);
  });
  r.add('GET', '/api/documents/:code/qr.svg', (c) => {
    getDocument(deps, c.user, c.params.code);            // يتحقق من حق الوصول
    const base = cfg.publicUrl ?? `http://${c.req.headers.host}`;
    sendRaw(c.res, 200, { 'Content-Type': 'image/svg+xml' }, qrSvg(`${base}/?verify=${c.params.code.toUpperCase()}`));
  });
  r.add('GET', '/api/verify/:code', (c) => {
    if (!limiter.check(`verify:${c.ip}`, 30, 60_000)) throw new HttpError(429, 'محاولات تحقق كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    const res = verifyEnrollment(deps, c.params.code) ?? verifyPublic(deps, c.params.code);      // SC-… شهادة تسجيل، UV-… وثيقة طلب
    audit(db, { label: 'جهة خارجية', role: 'public' }, `تحقق من وثيقة: ${res.valid ? 'صحيحة' : res.reason}`, c.params.code.slice(0, 20), c.ip);
    c.json(200, res);
  }, { auth: false });
  // التحقق ببصمة الملف: يحسب المتصفح SHA-256 للملف ولا يرفعه
  r.add('GET', '/api/verify-hash/:sha', (c) => {
    if (!limiter.check(`verify:${c.ip}`, 30, 60_000)) throw new HttpError(429, 'محاولات تحقق كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    let res = verifyByHash(deps, c.params.sha);
    if (res.reason === 'not_found') {                      // ملف PDF لوثيقة طلب؟
      const h = db.prepare('SELECT code FROM document_pdfs WHERE pdf_sha256 = ?').get(String(c.params.sha).trim().toLowerCase());
      if (h) res = verifyPublic(deps, h.code);
    }
    audit(db, { label: 'جهة خارجية', role: 'public' }, `تحقق ببصمة ملف: ${res.valid ? 'صحيحة' : res.reason}`, String(c.params.sha).slice(0, 16), c.ip);
    c.json(200, res);
  }, { auth: false });
  // شهادة التسجيل الموقَّعة: تُصدَر عند الطلب إن لم تكن قد صدرت بعد (مثلاً طلاب قدامى)
  const sendCert = async (c, studentId, studentNo) => {
    const row = await issueEnrollmentCertificate(deps, studentId);
    audit(db, c.user, 'تنزيل شهادة تسجيل موقَّعة', studentNo, c.ip);
    sendRaw(c.res, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="enrollment-${studentNo}.pdf"` }, readCertPdf(cfg, row));
  };
  r.add('GET', '/api/me/certificate', (c) => { need(c, 'profile:read_own'); c.json(200, { certificate: certSummary(certFor(db, c.user.id)) }); });
  r.add('GET', '/api/me/certificate.pdf', async (c) => { need(c, 'profile:read_own'); await sendCert(c, c.user.id, c.user.student_no); });
  r.add('GET', '/api/students/:id/certificate.pdf', async (c) => {
    need(c, 'student:read'); const s = getStudent(deps, c.params.id); await sendCert(c, s.id, s.studentNo);
  });

  // ---- التدقيق ----
  r.add('GET', '/api/audit', (c) => {
    need(c, 'audit:read');
    const limit = Math.min(Number(c.query.limit) || 50, 500);
    c.json(200, { entries: db.prepare('SELECT id, at, actor_label AS actor, role, action, ref, ip FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
  });
  r.add('GET', '/api/audit/verify', (c) => { need(c, 'audit:read'); c.json(200, verifyAuditChain(db)); });

  // ---- الإدارة ----
  r.add('GET', '/api/admin/users', (c) => { need(c, 'user:manage'); c.json(200, { users: listStaff(db) }); });
  r.add('POST', '/api/admin/users', async (c) => { need(c, 'user:manage'); c.json(201, await createUser(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/users/:id', (c) => { need(c, 'user:manage'); c.json(200, updateUser(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/users/:id', (c) => { need(c, 'user:manage'); c.json(200, deleteUser(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/admin/users/:id/active', (c) => { need(c, 'user:manage'); c.json(200, setUserActive(deps, c.user, c.params.id, !!c.body.active, c.ip)); });
  r.add('POST', '/api/admin/users/:id/reset-password', async (c) => { need(c, 'user:manage'); c.json(200, await resetUserPassword(deps, c.user, c.params.id, c.ip)); });

  // ---- الأدوار والوحدات وروابطها ----
  r.add('GET', '/api/admin/access', (c) => {
    if (!c.user.can('user:manage') && !c.user.can('role:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { ...overview(db), users: listStaff(db), canManageRoles: c.user.can('role:manage'), canManageUsers: c.user.can('user:manage') });
  });
  r.add('POST', '/api/admin/roles', (c) => { need(c, 'role:manage'); c.json(201, createRole(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/roles/:key', (c) => { need(c, 'role:manage'); c.json(200, updateRole(deps, c.user, c.params.key, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/roles/:key', (c) => { need(c, 'role:manage'); c.json(200, deleteRole(deps, c.user, c.params.key, c.ip)); });
  r.add('POST', '/api/admin/units', (c) => { need(c, 'role:manage'); c.json(201, createUnit(deps, c.user, c.body, c.ip)); });
  r.add('PUT', '/api/admin/units/:id', (c) => { need(c, 'role:manage'); c.json(200, updateUnit(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/units/:id', (c) => { need(c, 'role:manage'); c.json(200, deleteUnit(deps, c.user, c.params.id, c.ip)); });
  r.add('POST', '/api/admin/links', (c) => { need(c, 'role:manage'); c.json(201, createLink(deps, c.user, c.body, c.ip)); });
  r.add('DELETE', '/api/admin/links/:id', (c) => { need(c, 'role:manage'); c.json(200, deleteLink(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/admin/holds', (c) => {
    need(c, 'holds:manage');
    c.json(200, { holds: db.prepare(`SELECT h.id, h.hold_type AS holdType, h.note, h.active, h.created_at AS createdAt, u.display_name AS student, u.student_no AS studentNo
                                     FROM student_holds h JOIN users u ON u.id = h.student_id ORDER BY h.id DESC LIMIT 200`).all() });
  });
  r.add('POST', '/api/admin/holds', (c) => {
    need(c, 'holds:manage');
    const s = db.prepare("SELECT id FROM users WHERE student_no = ? COLLATE NOCASE AND role = 'student'").get(String(c.body.studentNo ?? '').trim());
    if (!s) throw new HttpError(404, 'لا يوجد طالب بهذا الرقم الجامعي.', 'not_found');
    if (!['financial', 'disciplinary', 'library'].includes(c.body.holdType)) throw new HttpError(400, 'نوع الذمة غير صالح.', 'validation');
    const res = db.prepare('INSERT INTO student_holds (student_id, hold_type, note, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(s.id, c.body.holdType, String(c.body.note ?? '').slice(0, 200), c.user.id, Date.now());
    audit(db, c.user, `تسجيل ذمة (${c.body.holdType})`, c.body.studentNo, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });
  r.add('PUT', '/api/admin/holds/:id', (c) => { need(c, 'holds:manage'); updateHold(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/holds/:id', (c) => { need(c, 'holds:manage'); deleteHold(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/holds/:id/clear', (c) => {
    need(c, 'holds:manage');
    const res = db.prepare('UPDATE student_holds SET active = 0, cleared_at = ? WHERE id = ? AND active = 1').run(Date.now(), Number(c.params.id));
    if (!res.changes) throw new HttpError(404, 'الذمة غير موجودة أو مسددة مسبقاً.', 'not_found');
    audit(db, c.user, 'تسوية ذمة', c.params.id, c.ip);
    c.json(200, { ok: true });
  });
  r.add('GET', '/api/admin/rules', (c) => {
    need(c, 'rules:manage');
    c.json(200, { rules: db.prepare('SELECT id, service_code AS service, kind, params_json AS params, message, enabled FROM rules ORDER BY id').all() });
  });
  r.add('POST', '/api/admin/rules/:id/toggle', (c) => {
    need(c, 'rules:manage');
    const res = db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(c.body.enabled ? 1 : 0, Number(c.params.id));
    if (!res.changes) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
    audit(db, c.user, `${c.body.enabled ? 'تفعيل' : 'تعطيل'} قاعدة`, c.params.id, c.ip);
    c.json(200, { ok: true });
  });
  r.add('PUT', '/api/admin/rules/:id', (c) => { need(c, 'rules:manage'); updateRule(deps, c.user, c.params.id, c.body, c.ip); c.json(200, { ok: true }); });
  r.add('DELETE', '/api/admin/rules/:id', (c) => { need(c, 'rules:manage'); deleteRule(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });

  return r;
}
