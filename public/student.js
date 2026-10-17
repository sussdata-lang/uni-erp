import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { sha256 } from '../security.js';
import { HttpError } from '../http.js';
import { runRules } from './rules.js';
import { issueDocument } from './documents.js';
import { linkedTargets } from './access.js';

const pad = (n, w) => String(n).padStart(w, '0');

function detectMime(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

function validateDetails(service, input) {
  const fields = JSON.parse(service.fields_json || '[]'), out = {};
  for (const f of fields) {
    let v = input?.[f.name];
    if (v === undefined || v === null || v === '') v = f.default;
    if (v === undefined || v === '') { if (f.required) throw new HttpError(400, `الحقل «${f.label}» مطلوب.`, 'validation'); continue; }
    if (f.type === 'select') { if (!f.options.includes(v)) throw new HttpError(400, `قيمة غير صالحة في «${f.label}».`, 'validation'); }
    else if (f.type === 'number') { v = Number(v); if (!Number.isInteger(v) || v < (f.min ?? 0) || v > (f.max ?? 1000)) throw new HttpError(400, `قيمة غير صالحة في «${f.label}».`, 'validation'); }
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `تاريخ غير صالح في «${f.label}».`, 'validation'); }
    else { v = String(v).trim(); if (v.length < 1 || v.length > 300) throw new HttpError(400, `«${f.label}» يجب ألا يتجاوز 300 حرف.`, 'validation'); }
    out[f.name] = v;
  }
  return out;
}

export function addEvent(db, requestId, actorLabel, text) {
  db.prepare('INSERT INTO request_events (request_id, at, actor_label, text) VALUES (?,?,?,?)').run(requestId, Date.now(), actorLabel, text);
}

export const scopeOf = (user) => (user.can('request:read_all') ? 'all' : user.can('request:read_unit') ? 'unit' : 'own');
export function visibleTo(user, r) {
  const s = scopeOf(user);
  if (s === 'all') return true;
  if (s === 'unit') return !!user.unit_id && r.assigned_unit_id === user.unit_id;
  return r.student_id === user.id;
}

export function requestView(db, r, { withStudent = false } = {}) {
  const svc = db.prepare('SELECT code, label, sla_hours FROM service_types WHERE code = ?').get(r.service_code);
  const att = db.prepare('SELECT id, orig_name, size, mime FROM attachments WHERE request_id = ?').get(r.id);
  const doc = db.prepare('SELECT code, issued_at FROM documents WHERE request_id = ?').get(r.id);
  let details = {};
  try { details = JSON.parse(r.details_json || '{}'); } catch { /* ignore */ }
  let academicDetails = null;
  try {
    academicDetails = db.prepare('SELECT * FROM academic_request_details WHERE request_id = ?').get(r.id);
  } catch { /* ignore */ }

  const v = {
    id: r.id, no: r.no, service: svc, details, academicDetails, status: r.status,
    rejectReason: r.reject_reason, rejectedBy: r.rejected_by, createdAt: r.created_at, decidedAt: r.decided_at,
    attachment: att ? { id: att.id, name: att.orig_name, size: att.size } : null,
    document: doc ? { code: doc.code, issuedAt: doc.issued_at } : null,
    unit: r.assigned_unit_id ? db.prepare('SELECT id, name FROM org_units WHERE id = ?').get(r.assigned_unit_id) : null,
    events: db.prepare('SELECT at, actor_label AS actor, text FROM request_events WHERE request_id = ? ORDER BY id').all(r.id),
  };
  if (withStudent) {
    const s = db.prepare('SELECT id, display_name, student_no FROM users WHERE id = ?').get(r.student_id);
    v.student = s ? { id: s.id, name: s.display_name, studentNo: s.student_no } : null;
  }
  return v;
}

export function createRequest({ db, cfg }, user, input, ip) {
  const service = db.prepare('SELECT * FROM service_types WHERE code = ? AND enabled = 1').get(input?.service);
  if (!service) throw new HttpError(400, 'خدمة غير معروفة.', 'validation');
  const details = validateDetails(service, input.details);

  let att = null;
  if (input.attachment) {
    const a = input.attachment;
    if (typeof a.data !== 'string' || typeof a.name !== 'string') throw new HttpError(400, 'مرفق غير صالح.', 'validation');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > cfg.maxAttachmentBytes) throw new HttpError(413, 'حجم المرفق يجب ألا يتجاوز 2 ميغابايت.', 'too_large');
    const mime = detectMime(buf);
    if (!mime) throw new HttpError(415, 'المرفقات المسموحة: PDF أو PNG أو JPG.', 'bad_type');
    att = { buf, mime, name: path.basename(a.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'attachment' };
  }
  if (service.requires_attachment && !att) throw new HttpError(400, 'هذه الخدمة تتطلب مرفقاً.', 'validation');

  let storedPath = null;
  try {
    const result = tx(db, () => {
      const check = runRules(db, { studentId: user.id, serviceCode: service.code, hasAttachment: !!att });
      const nextId = (db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM requests').get().n);
      const no = `REQ-${new Date().getFullYear()}-${pad(nextId, 5)}`;
      const now = Date.now();
      const rejected = !check.ok;

      db.prepare(`INSERT INTO requests (id, no, student_id, service_code, details_json, status, reject_reason, rejected_by, created_at, decided_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(nextId, no, user.id, service.code, JSON.stringify(details), rejected ? 'rejected' : 'review', rejected ? check.message : null, rejected ? 'auto' : null, now, rejected ? now : null);

      // حفظ التفاصيل الأكاديمية الإضافية إن وجدت (تأجيل، انسحاب، تحويل، تظلم، مخالفة)
      if (['postponement', 'withdrawal', 'program_transfer', 'grade_appeal', 'violation_report'].includes(service.code)) {
        try {
          db.prepare(`INSERT INTO academic_request_details (request_id, request_category, target_program_id, target_course_id, target_grade_id, claimed_mark, violation_type, justification, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?)`).run(
            nextId, service.code,
            Number(details.target_program_id) || null,
            Number(details.target_course_id) || null,
            Number(details.target_grade_id) || null,
            Number(details.claimed_mark) || null,
            details.violation_type || null,
            details.justification || details.reason || null,
            now
          );
        } catch { /* table may not exist yet */ }
      }

      addEvent(db, nextId, user.label, 'تقديم الطلب الأكاديمي');
      if (att) {
        const stored = crypto.randomBytes(16).toString('hex');
        fs.mkdirSync(cfg.uploadDir, { recursive: true });
        storedPath = path.join(cfg.uploadDir, stored);
        fs.writeFileSync(storedPath, att.buf, { mode: 0o600 });
        db.prepare('INSERT INTO attachments (request_id, orig_name, stored_name, mime, size, sha256) VALUES (?,?,?,?,?,?)')
          .run(nextId, att.name, stored, att.mime, att.buf.length, sha256(att.buf));
      }
      addEvent(db, nextId, 'النظام', rejected ? `الفحص الآلي: رُفض الطلب تلقائياً (${check.message})` : 'الفحص الآلي: اجتاز القواعد، أُحيل لمراجعة شؤون الطلاب');
      audit(db, user, `تقديم طلب: ${service.label}${rejected ? ' (رفض آلي)' : ''}`, no, ip);
      return nextId;
    });
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(result));
  } catch (e) {
    if (storedPath) fs.rmSync(storedPath, { force: true });
    throw e;
  }
}

export function listRequests({ db }, user, query) {
  const scope = scopeOf(user), own = scope === 'own';
  const where = [], args = [];
  if (scope === 'own') { where.push('student_id = ?'); args.push(user.id); }
  if (scope === 'unit') { where.push('assigned_unit_id = ?'); args.push(user.unit_id ?? -1); }
  if (['review', 'approved', 'rejected'].includes(query.status)) { where.push('status = ?'); args.push(query.status); }
  const rows = db.prepare(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args);
  return rows.map((r) => requestView(db, r, { withStudent: !own }));
}

export function getRequest({ db }, user, id) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
  if (!r || !visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
  return requestView(db, r, { withStudent: scopeOf(user) !== 'own' });
}

export function decide({ db, cfg }, user, id, action, reason, ip) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
    if (!r) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (!visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (r.status !== 'review') throw new HttpError(409, 'تم البت في هذا الطلب مسبقاً.', 'conflict');
    if (r.student_id === user.id) throw new HttpError(403, 'لا يجوز البت في طلبك الخاص.', 'forbidden');
    const now = Date.now();
    if (action === 'approve') {
      const svc = db.prepare('SELECT * FROM service_types WHERE code = ?').get(r.service_code);
      let code = null;
      if (svc.issues_document) code = issueDocument({ db, cfg }, r, user, now).code;
      db.prepare("UPDATE requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?").run(now, user.id, r.id);
      addEvent(db, r.id, user.label, code ? `اعتماد الطلب وإصدار وثيقة موقعة برمز ${code}` : 'اعتماد الطلب');
      audit(db, user, 'اعتماد طلب', r.no, ip);
    } else {
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 300) throw new HttpError(400, 'سبب الرفض مطلوب (3-300 حرفاً).', 'validation');
      db.prepare("UPDATE requests SET status = 'rejected', rejected_by = 'staff', reject_reason = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(reason.trim(), now, user.id, r.id);
      addEvent(db, r.id, user.label, `رفض الطلب: ${reason.trim()}`);
      audit(db, user, 'رفض طلب', r.no, ip);
    }
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id), { withStudent: true });
  });
}

export function forwardRequest({ db }, user, id, input, ip) {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(id));
    if (!r || !visibleTo(user, r)) throw new HttpError(404, 'الطلب غير موجود.', 'not_found');
    if (r.status !== 'review') throw new HttpError(409, 'لا تُحال إلا الطلبات قيد المراجعة.', 'conflict');
    const t = db.prepare('SELECT id, name, active FROM org_units WHERE id = ?').get(Number(input?.unitId));
    if (!t || !t.active) throw new HttpError(400, 'الوحدة المطلوبة غير موجودة أو معطَّلة.', 'validation');
    if (r.assigned_unit_id === t.id) throw new HttpError(409, 'الطلب عند هذه الوحدة أصلاً.', 'conflict');
    if (user.unit_id) {
      if (!linkedTargets(db, user.unit_id).some((x) => x.id === t.id)) throw new HttpError(403, 'وحدتك غير مرتبطة بهذه الوحدة.', 'forbidden');
    } else if (user.role !== 'admin' || user.role_key) {
      throw new HttpError(403, 'حسابك غير مرتبط بوحدة إدارية.', 'forbidden');
    }
    const note = String(input?.note ?? '').replace(/\s+/g, ' ').trim();
    db.prepare('UPDATE requests SET assigned_unit_id = ? WHERE id = ?').run(t.id, r.id);
    addEvent(db, r.id, user.label, `إحالة الطلب إلى «${t.name}»${note ? `: ${note}` : ''}`);
    audit(db, user, `إحالة طلب إلى ${t.name}`, r.no, ip);
    return requestView(db, db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id), { withStudent: true });
  });
}

export function stats({ db }) {
  const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM requests GROUP BY status').all().map((r) => [r.status, r.c]));
  const avg = db.prepare("SELECT AVG(decided_at - created_at) a FROM requests WHERE status = 'approved'").get().a;
  const late = db.prepare(`SELECT COUNT(*) c FROM requests r JOIN service_types s ON s.code = r.service_code
                           WHERE r.status = 'review' AND (? - r.created_at) > s.sla_hours * 3600000`).get(Date.now()).c;
  return { review: by.review ?? 0, approved: by.approved ?? 0, rejected: by.rejected ?? 0, avgApprovalMs: avg ? Math.round(avg) : null, slaBreaches: late };
}

export function readAttachment({ db, cfg }, user, id) {
  const a = db.prepare('SELECT a.*, r.student_id FROM attachments a JOIN requests r ON r.id = a.request_id WHERE a.id = ?').get(Number(id));
  if (!a || !visibleTo(user, db.prepare('SELECT * FROM requests WHERE id = ?').get(a.request_id))) throw new HttpError(404, 'غير موجود.', 'not_found');
  const file = path.join(cfg.uploadDir, a.stored_name);
  const buf = fs.readFileSync(file);
  if (sha256(buf) !== a.sha256) throw new HttpError(500, 'سلامة المرفق مخالفة.', 'integrity');
  return { buf, mime: a.mime, name: a.orig_name };
}
