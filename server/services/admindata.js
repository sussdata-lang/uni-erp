// تعديل وحذف الذمم وقواعد الفحص الآلي (كانت تُنشأ وتُعطَّل فقط)
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';
import { STATUS_LABEL } from './students.js';

const HOLD_TYPES = ['financial', 'disciplinary', 'library'];
const bad = (m) => new HttpError(400, m, 'validation');

export function updateHold({ db }, actor, id, b, ip) {
  const h = db.prepare('SELECT h.*, u.student_no FROM student_holds h JOIN users u ON u.id = h.student_id WHERE h.id = ?').get(Number(id));
  if (!h) throw new HttpError(404, 'الذمة غير موجودة.', 'not_found');
  const type = b?.holdType ?? h.hold_type;
  if (!HOLD_TYPES.includes(type)) throw bad('نوع الذمة غير صالح.');
  const note = b?.note === undefined ? (h.note ?? '') : String(b.note).replace(/\s+/g, ' ').trim().slice(0, 200);
  tx(db, () => { db.prepare('UPDATE student_holds SET hold_type = ?, note = ? WHERE id = ?').run(type, note, h.id); audit(db, actor, `تعديل ذمة (${type})`, h.student_no, ip); });
}

export function deleteHold({ db }, actor, id, ip) {
  const h = db.prepare('SELECT h.id, u.student_no FROM student_holds h JOIN users u ON u.id = h.student_id WHERE h.id = ?').get(Number(id));
  if (!h) throw new HttpError(404, 'الذمة غير موجودة.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM student_holds WHERE id = ?').run(h.id); audit(db, actor, 'حذف ذمة', h.student_no, ip); });
}

// المعاملات تُتحقَّق حسب نوع القاعدة كي لا تُكسَر الفحوص عند الطلب (يقرأها rules.js دون تحقق)
function parseParams(kind, p) {
  if (kind === 'attachment_required') return {};
  if (kind === 'no_active_hold') { if (!HOLD_TYPES.includes(p?.hold_type)) throw bad('نوع الذمة في القاعدة غير صالح.'); return { hold_type: p.hold_type }; }
  if (kind === 'max_open_per_service') { const n = Number(p?.max); if (!Number.isInteger(n) || n < 1 || n > 20) throw bad('الحد الأقصى للطلبات المفتوحة: عدد صحيح من 1 إلى 20.'); return { max: n }; }
  if (kind === 'student_status') {
    const a = Array.isArray(p?.allowed) ? [...new Set(p.allowed.map(String))] : [];
    if (!a.length || a.some((x) => !STATUS_LABEL[x])) throw bad('حالات القيد المسموحة غير صالحة.');
    return { allowed: a };
  }
  throw bad('نوع قاعدة غير معروف.');
}

export function updateRule({ db }, actor, id, b, ip) {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
  const message = b?.message === undefined ? r.message : String(b.message).replace(/\s+/g, ' ').trim();
  if (message.length < 3 || message.length > 300) throw bad('رسالة الرفض بين 3 و300 حرف.');
  let params = r.params_json;
  if (b?.params !== undefined) {
    let obj = b.params; if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { throw bad('معاملات القاعدة ليست JSON صالحاً.'); } }
    params = JSON.stringify(parseParams(r.kind, obj));
  }
  tx(db, () => { db.prepare('UPDATE rules SET message = ?, params_json = ? WHERE id = ?').run(message, params, r.id); audit(db, actor, `تعديل قاعدة فحص (${r.kind})`, String(r.id), ip); });
}

export function deleteRule({ db }, actor, id, ip) {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'القاعدة غير موجودة.', 'not_found');
  tx(db, () => { db.prepare('DELETE FROM rules WHERE id = ?').run(r.id); audit(db, actor, `حذف قاعدة فحص (${r.kind})`, String(r.id), ip); });
}
