import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

// الخدمات الأساسية لها قوالب وثائق خاصة في الواجهة، لذا تبقى حقولها وإصدارها للوثيقة ثابتين
export const BUILTIN = new Set(['attendance', 'transcript', 'excellence_year', 'campus_life', 'excuse']);
const TYPES = ['text', 'select', 'number', 'date'];
const bad = (m) => new HttpError(400, m, 'validation');

function parseCommon(input) {
  const label = String(input?.label ?? '').replace(/\s+/g, ' ').trim();
  const description = String(input?.description ?? '').replace(/\s+/g, ' ').trim();
  const sla = Number(input?.slaHours);
  if (label.length < 2 || label.length > 80) throw bad('اسم الخدمة يجب أن يكون بين 2 و80 حرفاً.');
  if (description.length < 2 || description.length > 300) throw bad('وصف الخدمة يجب أن يكون بين 2 و300 حرف.');
  if (!Number.isInteger(sla) || sla < 1 || sla > 720) throw bad('مدة الإنجاز: عدد صحيح من 1 إلى 720 ساعة.');
  return { label, description, sla, att: input?.requiresAttachment ? 1 : 0, doc: input?.issuesDocument === false ? 0 : 1 };
}

// أسماء الحقول الموجودة تُحفظ كما هي كي لا تنكسر الطلبات القديمة، وتُولَّد f1، f2… للجديدة
function parseFields(input) {
  if (!Array.isArray(input) || input.length > 10) throw bad('عدد الحقول يجب ألا يتجاوز 10.');
  const used = new Set();
  const out = input.map((raw) => {
    const label = String(raw?.label ?? '').replace(/\s+/g, ' ').trim();
    if (label.length < 1 || label.length > 60) throw bad('تسمية الحقل مطلوبة (حتى 60 حرفاً).');
    if (!TYPES.includes(raw?.type)) throw bad(`نوع الحقل «${label}» غير صالح.`);
    let name = raw.name ?? null;
    if (name !== null) {
      if (!/^[a-z][a-z0-9_]{0,29}$/.test(name) || used.has(name)) throw bad('اسم حقل غير صالح أو مكرر.');
      used.add(name);
    }
    const f = { name, label, type: raw.type };
    if (raw.required) f.required = true;
    if (raw.type === 'select') {
      const opts = Array.isArray(raw.options) ? raw.options.map((o) => String(o).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
      if (opts.length < 2 || opts.length > 12 || opts.some((o) => o.length > 40) || new Set(opts).size !== opts.length) throw bad(`خيارات «${label}»: من 2 إلى 12 خياراً غير مكررة (حتى 40 حرفاً لكل خيار).`);
      f.options = opts;
    }
    return f;
  });
  let n = 1;
  for (const f of out) if (!f.name) { while (used.has('f' + n)) n++; f.name = 'f' + n; used.add(f.name); }
  return out;
}

export function listServices({ db }) {
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM requests r WHERE r.service_code = s.code) AS requests FROM service_types s ORDER BY s.rowid`).all()
    .map((s) => ({
      code: s.code, label: s.label, description: s.description, slaHours: s.sla_hours, requiresAttachment: !!s.requires_attachment,
      issuesDocument: !!s.issues_document, enabled: !!s.enabled, builtin: BUILTIN.has(s.code), requests: s.requests, fields: JSON.parse(s.fields_json),
    }));
}

export function createService({ db }, actor, input, ip) {
  const code = String(input?.code ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(code)) throw bad('رمز الخدمة: 3 إلى 30 حرفاً لاتينياً صغيراً أو أرقاماً أو _ ويبدأ بحرف.');
  if (db.prepare('SELECT 1 FROM service_types WHERE code = ?').get(code)) throw new HttpError(409, 'رمز الخدمة مستخدم مسبقاً.', 'conflict');
  const v = parseCommon(input), fields = parseFields(input?.fields ?? []);
  tx(db, () => {
    db.prepare('INSERT INTO service_types (code, label, description, sla_hours, requires_attachment, issues_document, fields_json, enabled) VALUES (?,?,?,?,?,?,?,?)')
      .run(code, v.label, v.description, v.sla, v.att, v.doc, JSON.stringify(fields), input?.enabled === false ? 0 : 1);
    audit(db, actor, `إضافة خدمة: ${v.label}`, code, ip);
  });
  return { code };
}

export function updateService({ db }, actor, code, input, ip) {
  const s = db.prepare('SELECT * FROM service_types WHERE code = ?').get(String(code));
  if (!s) throw new HttpError(404, 'الخدمة غير موجودة.', 'not_found');
  const builtin = BUILTIN.has(s.code);
  if (builtin && input?.fields !== undefined) throw bad('حقول الخدمات الأساسية ثابتة لارتباطها بقوالب الوثائق.');
  const v = parseCommon(input);
  const fieldsJson = builtin ? s.fields_json : JSON.stringify(parseFields(input?.fields ?? JSON.parse(s.fields_json)));
  const doc = builtin ? s.issues_document : v.doc;
  const enabled = input?.enabled === undefined ? s.enabled : (input.enabled ? 1 : 0);
  tx(db, () => {
    db.prepare('UPDATE service_types SET label = ?, description = ?, sla_hours = ?, requires_attachment = ?, issues_document = ?, fields_json = ?, enabled = ? WHERE code = ?')
      .run(v.label, v.description, v.sla, v.att, doc, fieldsJson, enabled, s.code);
    audit(db, actor, `تعديل خدمة: ${v.label}${enabled !== s.enabled ? (enabled ? ' (تفعيل)' : ' (تعطيل)') : ''}`, s.code, ip);
  });
  return { ok: true };
}
