import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { PERMISSION_CATALOG, PERMISSIONS, ASSIGNABLE, BUILTIN_ROLES, ROLE_LABEL, ROLE_DESC } from '../permissions.js';

const bad = (m) => new HttpError(400, m, 'validation');
const clean = (v, min, max, what) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max || /[\u0000-\u001f<>]/.test(s)) throw bad(`«${what}» يجب أن يكون بين ${min} و${max} حرفاً بلا رموز غير مسموحة.`);
  return s;
};

/* ---------------- الأدوار ---------------- */
function parsePerms(actor, list) {
  if (!Array.isArray(list) || !list.length) throw bad('اختر صلاحية واحدة على الأقل.');
  const set = [...new Set(list.map(String))];
  for (const p of set) {
    if (!ASSIGNABLE.has(p)) throw bad(`صلاحية غير معروفة: ${p}`);
    if (!actor.can(p)) throw new HttpError(403, 'لا يجوز منح صلاحية لا تملكها أنت.', 'forbidden');
  }
  if (set.includes('request:read_all') && set.includes('request:read_unit')) throw bad('اختر إما «عرض كل الطلبات» أو «عرض طلبات وحدته فقط».');
  return set;
}

export function listRoles(db) {
  const count = (cond, ...a) => db.prepare(`SELECT COUNT(*) n FROM users WHERE ${cond}`).get(...a).n;
  const builtin = BUILTIN_ROLES.map((k) => ({ key: k, label: ROLE_LABEL[k], description: ROLE_DESC[k], permissions: PERMISSIONS[k], builtin: true, active: true,
    users: count('role = ? AND role_key IS NULL AND active = 1', k) }));
  const custom = db.prepare('SELECT * FROM roles ORDER BY created_at, key').all().map((r) => ({
    key: r.key, label: r.label, description: r.description, permissions: JSON.parse(r.permissions_json), builtin: false, active: !!r.active, users: count('role_key = ? AND active = 1', r.key) }));
  return [...builtin, ...custom];
}

export function createRole({ db }, actor, input, ip) {
  const key = String(input?.key ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(key)) throw bad('رمز الدور: 3 إلى 30 حرفاً لاتينياً صغيراً أو أرقاماً أو _ ويبدأ بحرف.');
  if (['student', ...BUILTIN_ROLES].includes(key) || db.prepare('SELECT 1 FROM roles WHERE key = ?').get(key)) throw new HttpError(409, 'رمز الدور مستخدم مسبقاً.', 'conflict');
  const label = clean(input?.label, 2, 60, 'اسم الدور'), description = clean(input?.description ?? '', 0, 200, 'الوصف');
  const perms = parsePerms(actor, input?.permissions);
  tx(db, () => {
    db.prepare('INSERT INTO roles (key, label, description, permissions_json, created_at) VALUES (?,?,?,?,?)').run(key, label, description, JSON.stringify(perms), Date.now());
    audit(db, actor, `إنشاء دور: ${label}`, key, ip);
  });
  return { key };
}

export function updateRole({ db }, actor, key, input, ip) {
  const r = db.prepare('SELECT * FROM roles WHERE key = ?').get(String(key));
  if (!r) throw new HttpError(404, 'الدور غير موجود (الأدوار الأساسية ثابتة).', 'not_found');
  const label = input?.label !== undefined ? clean(input.label, 2, 60, 'اسم الدور') : r.label;
  const description = input?.description !== undefined ? clean(input.description, 0, 200, 'الوصف') : r.description;
  const perms = input?.permissions !== undefined ? parsePerms(actor, input.permissions) : JSON.parse(r.permissions_json);
  const active = input?.active === undefined ? r.active : (input.active ? 1 : 0);
  if (!JSON.parse(r.permissions_json).every((p) => actor.can(p))) throw new HttpError(403, 'لا يجوز تعديل دور أوسع من صلاحياتك.', 'forbidden');
  const permsChanged = JSON.stringify(perms) !== r.permissions_json || active !== r.active;
  tx(db, () => {
    db.prepare('UPDATE roles SET label = ?, description = ?, permissions_json = ?, active = ? WHERE key = ?').run(label, description, JSON.stringify(perms), active, r.key);
    if (permsChanged) db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role_key = ?)').run(r.key);
    audit(db, actor, `تعديل دور: ${label}${active !== r.active ? (active ? ' (تفعيل)' : ' (تعطيل)') : ''}`, r.key, ip);
  });
  return { ok: true };
}

export function deleteRole({ db }, actor, key, ip) {
  const r = db.prepare('SELECT * FROM roles WHERE key = ?').get(String(key));
  if (!r) throw new HttpError(404, 'الدور غير موجود.', 'not_found');
  if (db.prepare('SELECT 1 FROM users WHERE role_key = ?').get(r.key)) throw new HttpError(409, 'لا يمكن حذف دور مرتبط بحسابات؛ انقل الحسابات إلى دور آخر أو عطّل الدور.', 'conflict');
  tx(db, () => { db.prepare('DELETE FROM roles WHERE key = ?').run(r.key); audit(db, actor, `حذف دور: ${r.label}`, r.key, ip); });
  return { ok: true };
}

/* ---------------- الوحدات الإدارية ---------------- */
const KINDS = ['sector', 'college', 'department', 'office'];

export function linkedTargets(db, unitId) {
  return db.prepare(`SELECT DISTINCT o.id, o.name FROM org_units o WHERE o.active = 1 AND o.id IN (
      SELECT to_unit FROM unit_links WHERE from_unit = ? UNION SELECT from_unit FROM unit_links WHERE to_unit = ? AND two_way = 1) ORDER BY o.id`).all(unitId, unitId);
}

export function listUnits(db) {
  const units = db.prepare('SELECT * FROM org_units ORDER BY id').all().map((u) => ({
    id: u.id, name: u.name, kind: u.kind, parentId: u.parent_id, active: !!u.active,
    users: db.prepare('SELECT COUNT(*) n FROM users WHERE unit_id = ? AND active = 1').get(u.id).n,
    pending: db.prepare("SELECT COUNT(*) n FROM requests WHERE assigned_unit_id = ? AND status = 'review'").get(u.id).n }));
  const links = db.prepare('SELECT * FROM unit_links ORDER BY id').all().map((l) => ({ id: l.id, from: l.from_unit, to: l.to_unit, twoWay: !!l.two_way }));
  return { units, links };
}

const unitRow = (db, id) => { const u = db.prepare('SELECT * FROM org_units WHERE id = ?').get(Number(id)); if (!u) throw new HttpError(404, 'الوحدة غير موجودة.', 'not_found'); return u; };

export function createUnit({ db }, actor, input, ip) {
  const name = clean(input?.name, 2, 80, 'اسم الوحدة'), kind = input?.kind ?? 'department';
  if (!KINDS.includes(kind)) throw bad('نوع وحدة غير صالح.');
  const parent = input?.parentId ? unitRow(db, input.parentId).id : null;
  if (db.prepare('SELECT 1 FROM org_units WHERE name = ?').get(name)) throw new HttpError(409, 'يوجد وحدة بهذا الاسم.', 'conflict');
  const id = tx(db, () => {
    const r = Number(db.prepare('INSERT INTO org_units (name, kind, parent_id) VALUES (?,?,?)').run(name, kind, parent).lastInsertRowid);
    audit(db, actor, `إضافة وحدة إدارية: ${name}`, String(r), ip);
    return r;
  });
  return { id };
}

export function updateUnit({ db }, actor, id, input, ip) {
  const u = unitRow(db, id);
  const name = input?.name !== undefined ? clean(input.name, 2, 80, 'اسم الوحدة') : u.name;
  let parent = u.parent_id;
  if (input?.parentId !== undefined) {
    parent = input.parentId ? unitRow(db, input.parentId).id : null;
    for (let p = parent; p; p = db.prepare('SELECT parent_id FROM org_units WHERE id = ?').get(p)?.parent_id) if (p === u.id) throw bad('لا يمكن جعل الوحدة تابعة لنفسها أو لأحد فروعها.');
  }
  const active = input?.active === undefined ? u.active : (input.active ? 1 : 0);
  if (!active && u.active) {
    if (db.prepare('SELECT 1 FROM users WHERE unit_id = ? AND active = 1').get(u.id)) throw new HttpError(409, 'لا يمكن تعطيل وحدة فيها حسابات فعّالة.', 'conflict');
    if (db.prepare("SELECT 1 FROM requests WHERE assigned_unit_id = ? AND status = 'review'").get(u.id)) throw new HttpError(409, 'لا يمكن تعطيل وحدة لديها طلبات قيد المراجعة.', 'conflict');
  }
  if (name !== u.name && db.prepare('SELECT 1 FROM org_units WHERE name = ? AND id != ?').get(name, u.id)) throw new HttpError(409, 'يوجد وحدة بهذا الاسم.', 'conflict');
  tx(db, () => {
    db.prepare('UPDATE org_units SET name = ?, parent_id = ?, active = ? WHERE id = ?').run(name, parent, active, u.id);
    audit(db, actor, `تعديل وحدة إدارية: ${name}${active !== u.active ? (active ? ' (تفعيل)' : ' (تعطيل)') : ''}`, String(u.id), ip);
  });
  return { ok: true };
}

export function deleteUnit({ db }, actor, id, ip) {
  const u = unitRow(db, id);
  if (db.prepare('SELECT 1 FROM users WHERE unit_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة فيها حسابات؛ انقل الحسابات أولاً.', 'conflict');
  if (db.prepare('SELECT 1 FROM org_units WHERE parent_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة لها وحدات فرعية.', 'conflict');
  if (db.prepare('SELECT 1 FROM requests WHERE assigned_unit_id = ?').get(u.id)) throw new HttpError(409, 'لا يمكن حذف وحدة أُحيلت إليها طلبات؛ عطّلها بدلاً من حذفها.', 'conflict');
  tx(db, () => {
    db.prepare('DELETE FROM unit_links WHERE from_unit = ? OR to_unit = ?').run(u.id, u.id);
    db.prepare('DELETE FROM org_units WHERE id = ?').run(u.id);
    audit(db, actor, `حذف وحدة إدارية: ${u.name}`, String(u.id), ip);
  });
  return { ok: true };
}

export function createLink({ db }, actor, input, ip) {
  const a = unitRow(db, input?.from), b = unitRow(db, input?.to);
  if (a.id === b.id) throw bad('لا يمكن ربط الوحدة بنفسها.');
  if (!a.active || !b.active) throw bad('لا يمكن الربط بوحدة معطَّلة.');
  if (db.prepare('SELECT 1 FROM unit_links WHERE (from_unit = ? AND to_unit = ?) OR (from_unit = ? AND to_unit = ?)').get(a.id, b.id, b.id, a.id)) throw new HttpError(409, 'يوجد رابط بين الوحدتين مسبقاً؛ احذفه ثم أنشئ الجديد.', 'conflict');
  const id = tx(db, () => {
    const r = Number(db.prepare('INSERT INTO unit_links (from_unit, to_unit, two_way, created_at) VALUES (?,?,?,?)').run(a.id, b.id, input?.twoWay ? 1 : 0, Date.now()).lastInsertRowid);
    audit(db, actor, `ربط وحدتين: ${a.name} ${input?.twoWay ? '↔' : '←'} ${b.name}`, String(r), ip);
    return r;
  });
  return { id };
}

export function deleteLink({ db }, actor, id, ip) {
  const l = db.prepare('SELECT * FROM unit_links WHERE id = ?').get(Number(id));
  if (!l) throw new HttpError(404, 'الرابط غير موجود.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM unit_links WHERE id = ?').run(l.id); audit(db, actor, 'حذف رابط بين وحدتين', `${l.from_unit}-${l.to_unit}`, ip); });
  return { ok: true };
}

/* ---------------- البند 10 و11: جدول الدوام والامتحانات، كشف التعارض، وسجل دخول وخروج القاعات بالباركود ---------------- */
const overlap = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function detectScheduleConflicts(db, studentId) {
  const sp = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(Number(studentId));
  if (!sp) return { schedules: [], conflicts: [] };
  let schedules = [];
  try {
    schedules = db.prepare(`
      SELECT cs.*, c.name AS course_name, c.code AS course_code
      FROM course_schedules cs JOIN courses c ON c.id = cs.course_id
      WHERE cs.program_id = ? AND cs.level <= ?
      ORDER BY cs.session_type, cs.exam_date, cs.day_of_week, cs.start_time
    `).all(sp.program_id, sp.study_level);
  } catch { return { schedules: [], conflicts: [] }; }

  const conflicts = [];
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i], b = schedules[j];
      if (a.course_id === b.course_id || a.session_type !== b.session_type) continue;
      if (a.session_type === 'lecture' && a.day_of_week === b.day_of_week && overlap(a.start_time, a.end_time, b.start_time, b.end_time)) {
        conflicts.push({
          type: 'lecture',
          day: DAYS_AR[a.day_of_week] || a.day_of_week,
          courseA: a.course_name, courseB: b.course_name,
          time: `${a.start_time} - ${a.end_time}`,
          message: `تعارض في جدول الدوام (${DAYS_AR[a.day_of_week] || ''}) بين «${a.course_name}» و«${b.course_name}» (${a.start_time}–${a.end_time})`,
        });
      }
      if (a.session_type === 'exam' && a.exam_date && a.exam_date === b.exam_date && overlap(a.start_time, a.end_time, b.start_time, b.end_time)) {
        conflicts.push({
          type: 'exam',
          date: a.exam_date,
          courseA: a.course_name, courseB: b.course_name,
          time: `${a.start_time} - ${a.end_time}`,
          message: `تعارض امتحاني بتاريخ ${a.exam_date} بين «${a.course_name}» و«${b.course_name}» (${a.start_time}–${a.end_time})`,
        });
      }
    }
  }
  return { schedules, conflicts };
}

export function getStudentAttendanceSummary(db, studentId) {
  const sp = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(Number(studentId));
  if (!sp) return [];
  const courses = db.prepare('SELECT id, name, code, level, semester FROM courses WHERE program_id = ? AND level = ? AND active = 1').all(sp.program_id, sp.study_level);
  return courses.map((c) => {
    let planned = 15, minPct = 75.0, attended = 0;
    try {
      const sch = db.prepare("SELECT MAX(total_planned_sessions) p, MAX(min_attendance_pct) m FROM course_schedules WHERE course_id = ? AND session_type = 'lecture'").get(c.id);
      if (sch?.p) planned = sch.p;
      if (sch?.m) minPct = sch.m;
      attended = db.prepare("SELECT COUNT(DISTINCT log_date) n FROM hall_attendance_logs WHERE student_id = ? AND course_id = ? AND session_type = 'lecture'").get(Number(studentId), c.id)?.n || 0;
    } catch { /* ignore */ }
    const pct = Math.min(100, Math.round((attended / Math.max(1, planned)) * 1000) / 10);
    const allowed = pct >= minPct;
    return {
      courseId: c.id, courseName: c.name, courseCode: c.code,
      attendedSessions: attended, plannedSessions: planned, absentSessions: Math.max(0, planned - attended),
      attendancePct: pct, requiredPct: minPct, allowedToEnterExam: allowed,
      statusLabel: allowed ? 'مسموح بدخول الامتحان' : 'محروم من الامتحان لتجاوز نسبة الغياب',
    };
  });
}

export function scanHallBarcode({ db }, actor, input, ip) {
  const barcode = clean(input?.barcode, 2, 40, 'الباركود / الرقم الجامعي');
  const courseId = Number(input?.courseId);
  const hallName = clean(input?.hallName, 1, 60, 'اسم القاعة');
  const sessionType = input?.sessionType === 'exam' ? 'exam' : 'lecture';
  const st = db.prepare(`SELECT u.id, u.student_no, sp.first_name, sp.father_name, sp.last_name FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.student_no = ? COLLATE NOCASE OR sp.barcode = ? COLLATE NOCASE`).get(barcode, barcode);
  if (!st) throw new HttpError(404, `لا يوجد طالب مسجل بالباركود أو الرقم الجامعي «${barcode}».`, 'not_found');
  const course = db.prepare('SELECT id, name, code FROM courses WHERE id = ?').get(courseId);
  if (!course) throw bad('المقرر المحدد غير موجود.');

  // البند 11: منع دخول الامتحان تلقائياً إذا كانت نسبة الحضور أقل من الحد الأدنى المسموح
  if (sessionType === 'exam' && !input?.forceAllow) {
    const sum = getStudentAttendanceSummary(db, st.id).find((x) => x.courseId === course.id);
    if (sum && !sum.allowedToEnterExam) {
      throw new HttpError(403, `منع دخول القاعة الامتحانية: الطالب «${st.first_name} ${st.last_name}» محروم في مقرر «${course.name}» لأن نسبة حضوره (${sum.attendancePct}%) أقل من الحد الأدنى المطلوب (${sum.requiredPct}%).`, 'exam_banned_by_attendance');
    }
  }

  const logDate = input?.logDate && /^\d{4}-\d{2}-\d{2}$/.test(input.logDate) ? input.logDate : new Date().toISOString().slice(0, 10);
  const now = Date.now();
  return tx(db, () => {
    const open = db.prepare('SELECT * FROM hall_attendance_logs WHERE student_id = ? AND course_id = ? AND log_date = ? AND exit_time IS NULL').get(st.id, course.id, logDate);
    if (open) {
      const mins = Math.max(1, Math.round((now - open.entry_time) / 60000));
      db.prepare('UPDATE hall_attendance_logs SET exit_time = ?, duration_minutes = ? WHERE id = ?').run(now, mins, open.id);
      audit(db, actor, `خروج طالب من قاعة (${hallName})`, `${st.student_no} / ${course.name}`, ip);
      return { action: 'exit', studentNo: st.student_no, studentName: `${st.first_name} ${st.father_name} ${st.last_name}`, course: course.name, hallName, durationMinutes: mins, timestamp: now };
    }
    const id = Number(db.prepare(`INSERT INTO hall_attendance_logs (student_id, student_no, barcode, course_id, hall_name, session_type, log_date, entry_time, recorded_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(st.id, st.student_no, barcode, course.id, hallName, sessionType, logDate, now, actor?.id ?? null).lastInsertRowid);
    audit(db, actor, `دخول طالب إلى قاعة (${hallName})`, `${st.student_no} / ${course.name}`, ip);
    return { id, action: 'entry', studentNo: st.student_no, studentName: `${st.first_name} ${st.father_name} ${st.last_name}`, course: course.name, hallName, timestamp: now };
  });
}

export function listAttendanceLogs({ db }, q = {}) {
  const where = [], args = [];
  if (q.q) {
    const l = `%${String(q.q).trim()}%`;
    where.push('(l.student_no LIKE ? OR l.barcode LIKE ? OR l.hall_name LIKE ? OR c.name LIKE ?)');
    args.push(l, l, l, l);
  }
  if (Number(q.courseId) > 0) { where.push('l.course_id = ?'); args.push(Number(q.courseId)); }
  if (q.sessionType === 'lecture' || q.sessionType === 'exam') { where.push('l.session_type = ?'); args.push(q.sessionType); }
  if (q.fromDate) { where.push('l.log_date >= ?'); args.push(String(q.fromDate)); }
  if (q.toDate) { where.push('l.log_date <= ?'); args.push(String(q.toDate)); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT l.*, sp.first_name, sp.father_name, sp.last_name, c.name AS course_name, c.code AS course_code
    FROM hall_attendance_logs l
    LEFT JOIN student_profiles sp ON sp.user_id = l.student_id
    LEFT JOIN courses c ON c.id = l.course_id
    ${W} ORDER BY l.log_date DESC, l.entry_time DESC LIMIT 500
  `).all(...args);
  return {
    logs: rows.map((r) => ({
      id: r.id, studentId: r.student_id, studentNo: r.student_no, barcode: r.barcode,
      studentName: [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ') || r.student_no,
      courseId: r.course_id, courseName: r.course_name || '—', courseCode: r.course_code || '',
      hallName: r.hall_name, sessionType: r.session_type, sessionLabel: r.session_type === 'exam' ? 'امتحان' : 'محاضرة',
      logDate: r.log_date, entryTime: r.entry_time, exitTime: r.exit_time, durationMinutes: r.duration_minutes,
    })),
  };
}

export const overview = (db) => ({ catalog: PERMISSION_CATALOG, roles: listRoles(db), ...listUnits(db) });
