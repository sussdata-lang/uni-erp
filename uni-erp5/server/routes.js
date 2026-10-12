import { Router, HttpError, sendRaw } from './http.js';
import { login, logout, publicUser, changePassword } from './services/auth.js';
import { listStaff, createUser, updateUser, setUserActive, resetUserPassword } from './services/useradmin.js';
import { overview, createRole, updateRole, deleteRole, createUnit, updateUnit, createLink, deleteLink, linkedTargets } from './services/access.js';
import { registrationOptions, registerStudent, listStudents, getStudent, updateStudent, resetStudentPassword, myProfile, updateOwnContact, listPrograms, addProgram, toggleProgram, listFaculties, addFaculty, toggleFaculty } from './services/students.js';
import { listCourses, createCourse, toggleCourse, myGrades, gradesFor, enterGrade, listNews, createNews, deleteNews, createComplaint, listComplaints, respondComplaint } from './services/academics.js';
import { createRequest, listRequests, getRequest, decide, forwardRequest, stats, readAttachment } from './services/requests.js';
import { getDocument, verifyPublic } from './services/documents.js';
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
  r.add('GET', '/api/me', (c) => c.json(200, { user: c.user ? publicUser(db, c.user) : null, university: cfg.universityName }), { auth: false });

  r.add('GET', '/api/me/profile', (c) => { need(c, 'profile:read_own'); c.json(200, { profile: myProfile(deps, c.user) }); });

  r.add('PUT', '/api/me/profile', (c) => { need(c, 'profile:update_own'); c.json(200, { profile: updateOwnContact(deps, c.user, c.body, c.ip) }); });

  // ---- تطبيق الطالب: المواد والعلامات والأخبار والشكاوى ----
  r.add('GET', '/api/courses', (c) => {
    if (!c.user.can('course:read_own') && !c.user.can('course:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listCourses(deps, c.user, c.query));
  });
  r.add('POST', '/api/courses', (c) => { need(c, 'course:manage'); c.json(201, createCourse(deps, c.user, c.body, c.ip)); });
  r.add('POST', '/api/courses/:id/toggle', (c) => { need(c, 'course:manage'); toggleCourse(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('GET', '/api/me/grades', (c) => { need(c, 'grade:read_own'); c.json(200, myGrades(deps, c.user, c.query)); });
  r.add('GET', '/api/students/:id/grades', (c) => { need(c, 'student:read'); getStudent(deps, c.params.id); c.json(200, gradesFor(db, Number(c.params.id), null)); });
  r.add('POST', '/api/students/:id/grades', (c) => { need(c, 'grade:manage'); c.json(200, enterGrade(deps, c.user, c.params.id, c.body, c.ip)); });
  r.add('GET', '/api/news', (c) => c.json(200, { news: listNews(deps) }));
  r.add('POST', '/api/news', (c) => { need(c, 'news:manage'); c.json(201, createNews(deps, c.user, c.body, c.ip)); });
  r.add('DELETE', '/api/news/:id', (c) => { need(c, 'news:manage'); deleteNews(deps, c.user, c.params.id, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/complaints', (c) => { need(c, 'complaint:create'); c.json(201, createComplaint(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/complaints', (c) => {
    if (!c.user.can('complaint:create') && !c.user.can('complaint:manage')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, listComplaints(deps, c.user, c.query));
  });
  r.add('POST', '/api/complaints/:id/respond', (c) => { need(c, 'complaint:manage'); c.json(200, respondComplaint(deps, c.user, c.params.id, c.body, c.ip)); });

  // ---- تسجيل الطلاب (شؤون الطلاب) ----
  r.add('GET', '/api/registration/options', (c) => { need(c, 'student:register'); c.json(200, registrationOptions(db, c.user.can('program:manage'))); });
  r.add('POST', '/api/students', async (c) => { need(c, 'student:register'); c.json(201, await registerStudent(deps, c.user, c.body, c.ip)); });
  r.add('GET', '/api/students', (c) => { need(c, 'student:read'); c.json(200, listStudents(deps, c.query)); });
  r.add('GET', '/api/students/:id', (c) => {
    need(c, 'student:read');
    const s = getStudent(deps, c.params.id);
    audit(db, c.user, 'عرض ملف طالب', s.studentNo, c.ip);   // الملف يحوي بيانات شخصية: القراءة نفسها تُدقَّق
    c.json(200, { student: s });
  });
  r.add('PUT', '/api/students/:id', (c) => { need(c, 'student:update'); c.json(200, { student: updateStudent(deps, c.user, c.params.id, c.body, c.ip) }); });
  r.add('POST', '/api/students/:id/reset-password', async (c) => { need(c, 'student:reset_password'); c.json(200, await resetStudentPassword(deps, c.user, c.params.id, c.ip)); });
  r.add('GET', '/api/programs', (c) => { need(c, 'student:read'); c.json(200, { programs: listPrograms(db) }); });
  r.add('GET', '/api/faculties', (c) => { need(c, 'student:read'); c.json(200, { faculties: listFaculties(db) }); });
  r.add('POST', '/api/admin/faculties', (c) => { need(c, 'program:manage'); c.json(201, addFaculty(deps, c.user, c.body, c.ip)); });
  r.add('POST', '/api/admin/faculties/:id/toggle', (c) => { need(c, 'program:manage'); toggleFaculty(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });
  r.add('POST', '/api/admin/programs', (c) => { need(c, 'program:manage'); c.json(201, addProgram(deps, c.user, c.body, c.ip)); });
  r.add('POST', '/api/admin/programs/:id/toggle', (c) => { need(c, 'program:manage'); toggleProgram(deps, c.user, c.params.id, !!c.body.enabled, c.ip); c.json(200, { ok: true }); });

  // ---- الخدمات والطلبات ----
  r.add('GET', '/api/services', (c) => c.json(200, { services: db.prepare('SELECT * FROM service_types WHERE enabled = 1').all()
    .map((s) => ({ code: s.code, label: s.label, description: s.description, slaHours: s.sla_hours, requiresAttachment: !!s.requires_attachment, fields: JSON.parse(s.fields_json) })) }));
  r.add('POST', '/api/requests', (c) => { need(c, 'request:create'); c.json(201, { request: createRequest(deps, c.user, c.body, c.ip) }); }, { maxBody: 3.2 * 1024 * 1024 });
  r.add('GET', '/api/requests', (c) => {
    if (!c.user.can('request:read_own') && !c.user.can('request:read_all') && !c.user.can('request:read_unit')) throw new HttpError(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
    c.json(200, { requests: listRequests(deps, c.user, c.query) });
  });
  r.add('GET', '/api/requests/:id', (c) => c.json(200, { request: getRequest(deps, c.user, c.params.id) }));
  r.add('POST', '/api/requests/:id/approve', (c) => { need(c, 'request:decide'); c.json(200, { request: decide(deps, c.user, c.params.id, 'approve', null, c.ip) }); });
  r.add('POST', '/api/requests/:id/reject', (c) => { need(c, 'request:decide'); c.json(200, { request: decide(deps, c.user, c.params.id, 'reject', c.body.reason, c.ip) }); });
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
  r.add('GET', '/api/stats', (c) => { need(c, 'stats:read'); c.json(200, { stats: stats(deps) }); });

  // ---- الوثائق والتحقق ----
  r.add('GET', '/api/documents/:code', (c) => c.json(200, { document: getDocument(deps, c.user, c.params.code) }));
  r.add('GET', '/api/documents/:code/qr.svg', (c) => {
    getDocument(deps, c.user, c.params.code);            // يتحقق من حق الوصول
    const base = cfg.publicUrl ?? `http://${c.req.headers.host}`;
    sendRaw(c.res, 200, { 'Content-Type': 'image/svg+xml' }, qrSvg(`${base}/?verify=${c.params.code.toUpperCase()}`));
  });
  r.add('GET', '/api/verify/:code', (c) => {
    if (!limiter.check(`verify:${c.ip}`, 30, 60_000)) throw new HttpError(429, 'محاولات تحقق كثيرة؛ حاول بعد دقيقة.', 'rate_limited');
    const res = verifyPublic(deps, c.params.code);
    audit(db, { label: 'جهة خارجية', role: 'public' }, `تحقق من وثيقة: ${res.valid ? 'صحيحة' : res.reason}`, c.params.code.slice(0, 20), c.ip);
    c.json(200, res);
  }, { auth: false });

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
  return r;
}
