// الهيكل التنظيمي للجامعة: 16 إدارة، وتفصيل شؤون الطلاب (3 وحدات بمكاتبها + اللجنة التأديبية المستقلة).
// لكل جهة: وحدة إدارية + دور مخصّص (المسؤوليات) + حساب مسؤول + روابط إحالة. التنفيذ إضافي وآمن للتكرار:
// لا يعدّل ما غيّره المدير (اسم الدور وصلاحياته، بيانات الحساب)، ولا يمسّ حساباً موجوداً.
// الحسابات تُنشأ معطّلة بكلمة مرور عشوائية غير معروفة؛ يفعّلها المدير ويصدر لها كلمة مؤقتة من «الحسابات والصلاحيات»
// (أو { activate: true, password } لتفعيلها دفعة واحدة بكلمة مؤقتة تُغيَّر عند أول دخول).
import crypto from 'node:crypto';
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { hashPassword } from '../security.js';
import { ASSIGNABLE } from '../permissions.js';

const U = 'univ';
// مجموعات صلاحيات مشتركة (كلها من فهرس الصلاحيات الفعلي)
const REG = ['student:register', 'student:read', 'student:update', 'student:reset_password'];
const REQ = ['request:read_unit', 'request:decide', 'request:forward'];
const INBOX = ['request:read_unit', 'request:forward'];

// code: اسم المستخدم ورمز الدور (head_<code>)، parent: رمز الأب أو univ، perms: المسؤوليات
export const STRUCTURE = [
  // ---- الإدارات الست عشرة ----
  { code: 'affairs', name: 'شؤون الطلاب', kind: 'department', parent: U, module: 'وحدة شؤون الطلاب والخدمات', label: 'مدير شؤون الطلاب',
    desc: 'الوثائق، الأعذار، السكن، الإجازات، الإرشاد، الأنشطة، التوجيه والتظلمات، الخريجون. يتبعه ثلاث وحدات ولجنة تأديبية مستقلة تنسّق معه.',
    perms: [...REG, 'request:read_all', 'request:decide', 'request:forward', 'document:read_all', 'stats:read', 'holds:manage', 'course:manage', 'grade:manage', 'attendance:manage', 'news:manage', 'complaint:manage', 'data:export'] },
  { code: 'admission', name: 'القبول والتسجيل', kind: 'department', parent: U, module: 'وحدة القبول والتسجيل', label: 'مسؤول القبول والتسجيل',
    desc: 'استقبال الطلبات، التدقيق، التسجيل، التحويل، إعادة القيد.', perms: [...REG, ...REQ, 'data:export'] },
  { code: 'exams', name: 'الامتحانات والعلامات', kind: 'department', parent: U, module: 'وحدة الامتحانات', label: 'مسؤول الامتحانات والعلامات',
    desc: 'جداول الامتحانات، القاعات، رصد وتدقيق العلامات، النتائج.', perms: ['grade:manage', 'grade:approve', 'attendance:manage', 'student:read', 'stats:read', 'request:read_unit', 'request:forward'] },
  { code: 'academic', name: 'الشؤون الأكاديمية', kind: 'department', parent: U, module: 'وحدة الشؤون الأكاديمية', label: 'مسؤول الشؤون الأكاديمية',
    desc: 'الخطط والمقررات والجداول والعبء التدريسي.', perms: ['course:manage', 'program:manage', 'student:read', 'stats:read', ...INBOX] },
  { code: 'hr', name: 'الموارد البشرية', kind: 'department', parent: U, module: 'وحدة الموارد البشرية', label: 'مسؤول الموارد البشرية',
    desc: 'التوظيف، العقود، الحضور، الإجازات، الرواتب، الأداء، التدريب.', perms: INBOX },
  { code: 'finance', name: 'المالية والحسابات', kind: 'department', parent: U, module: 'وحدة المالية', label: 'مسؤول المالية والحسابات',
    desc: 'الرسوم، التحصيل، الصرف، الميزانية، المحاسبة.', perms: ['holds:manage', 'student:read', 'stats:read', ...INBOX] },
  { code: 'procure', name: 'المشتريات والمخازن', kind: 'department', parent: U, module: 'وحدة المشتريات والأصول', label: 'مسؤول المشتريات والمخازن',
    desc: 'طلبات الشراء، العقود، الموردون، المخزون.', perms: INBOX },
  { code: 'admin_aff', name: 'الشؤون الإدارية', kind: 'department', parent: U, module: 'وحدة الشؤون الإدارية', label: 'مسؤول الشؤون الإدارية',
    desc: 'المراسلات، الأرشيف، المجالس واللجان، الصيانة والمرافق، النقل، الخدمات العامة.', perms: [...INBOX, 'news:manage'] },
  { code: 'it_sec', name: 'تقنية المعلومات والأمن السيبراني', kind: 'department', parent: U, module: 'وحدة الإدارة التقنية والأمن', label: 'مسؤول تقنية المعلومات والأمن السيبراني',
    desc: 'تشغيل المنظومة، الأمن، الدعم الفني، الشبكات.', perms: ['backup:manage', 'audit:read', 'rules:manage', 'student:reset_password', 'stats:read', ...INBOX] },
  { code: 'library', name: 'المكتبة', kind: 'department', parent: U, module: 'وحدة المكتبة والتعلم', label: 'مسؤول المكتبة',
    desc: 'الإعارة، الاشتراكات الرقمية، حجز الغرف.', perms: ['holds:manage', 'student:read', ...INBOX] },
  { code: 'quality', name: 'الجودة والتخطيط', kind: 'department', parent: U, module: 'وحدة الجودة', label: 'مسؤول الجودة والتخطيط',
    desc: 'الاعتماد الأكاديمي، التقييمات، الخطط والمؤشرات.', perms: ['request:read_all', 'document:read_all', 'stats:read', 'audit:read', 'data:export'] },
  { code: 'research', name: 'البحث العلمي والدراسات العليا', kind: 'department', parent: U, module: 'وحدة البحث والدراسات العليا', label: 'مسؤول البحث العلمي والدراسات العليا',
    desc: 'المشاريع البحثية، الإشراف، الرسائل العلمية.', perms: ['student:read', ...INBOX] },
  { code: 'legal', name: 'الشؤون القانونية', kind: 'department', parent: U, module: 'وحدة اللجان والقرارات (ومراجع قانونية)', label: 'مسؤول الشؤون القانونية',
    desc: 'اللوائح، التحقيق، العقود، القضايا.', perms: ['holds:manage', 'student:read', 'audit:read', ...INBOX] },
  { code: 'media', name: 'العلاقات العامة والإعلام', kind: 'department', parent: U, module: 'وحدة التواصل والإعلانات', label: 'مسؤول العلاقات العامة والإعلام',
    desc: 'الإعلانات، الفعاليات، التواصل المؤسسي.', perms: ['news:manage', 'complaint:manage', 'request:read_unit'] },
  { code: 'safety', name: 'الأمن والسلامة', kind: 'department', parent: U, module: 'وحدة الدخول والبطاقة', label: 'مسؤول الأمن والسلامة',
    desc: 'الدخول، الحراسة، الطوارئ.', perms: ['attendance:manage', 'student:read', 'request:read_unit'] },
  { code: 'alumni', name: 'الخريجون والتوظيف', kind: 'department', parent: U, module: 'وحدة الخريجين والتوظيف', label: 'مسؤول الخريجين والتوظيف',
    desc: 'التخرج، متابعة الخريجين، معارض التوظيف.', perms: ['student:read', 'news:manage', ...INBOX] },

  // ---- شؤون الطلاب: ثلاث وحدات ----
  { code: 'sa_registry', name: 'التسجيل والتوثيق الجامعي', kind: 'department', parent: 'affairs', module: 'وحدة القبول والتسجيل', label: 'رئيس وحدة التسجيل والتوثيق الجامعي',
    desc: 'القبول والتسجيل؛ شؤون الدراسة والامتحانات؛ الوثائق والشهادات؛ الأرشيف؛ الدعم التقني للنظام.', perms: [...REG, ...REQ, 'document:read_all', 'data:export'] },
  { code: 'sa_services', name: 'الخدمات الطلابية والمالية', kind: 'department', parent: 'affairs', module: 'وحدة شؤون الطلاب والخدمات', label: 'رئيس وحدة الخدمات الطلابية والمالية',
    desc: 'الإجازات الطلابية؛ السكن والخدمات؛ المكتب المالي (صرف رواتب ومكافآت الطلاب).', perms: [...REQ, 'student:read', 'holds:manage'] },
  { code: 'sa_care', name: 'رعاية الخريجين والدعم الطلابي', kind: 'department', parent: 'affairs', module: 'وحدة الخريجين والتوظيف', label: 'رئيس وحدة رعاية الخريجين والدعم الطلابي',
    desc: 'الخريجون؛ الإرشاد الصحي والنفسي؛ التوجيه والتظلمات؛ الأنشطة الطلابية؛ ذوو الاحتياجات الإضافية.', perms: [...REQ, 'student:read', 'news:manage', 'complaint:manage'] },

  // ---- مكاتب التسجيل والتوثيق ----
  { code: 'of_admission', name: 'مكتب القبول والتسجيل', kind: 'office', parent: 'sa_registry', label: 'مسؤول مكتب القبول والتسجيل', desc: 'استقبال طلبات القبول وتسجيل الطلاب وإعادة القيد.', perms: [...REG, ...REQ] },
  { code: 'of_studies', name: 'مكتب شؤون الدراسة والامتحانات', kind: 'office', parent: 'sa_registry', label: 'مسؤول مكتب شؤون الدراسة والامتحانات', desc: 'متابعة الدوام والعلامات والامتحانات.', perms: ['course:manage', 'grade:manage', 'attendance:manage', 'student:read', 'request:read_unit'] },
  { code: 'of_docs', name: 'مكتب الوثائق والشهادات', kind: 'office', parent: 'sa_registry', label: 'مسؤول مكتب الوثائق والشهادات', desc: 'إصدار الوثائق والشهادات واعتماد طلباتها.', perms: ['request:read_unit', 'request:decide', 'document:read_all', 'student:read'] },
  { code: 'of_archive', name: 'مكتب الأرشيف', kind: 'office', parent: 'sa_registry', label: 'مسؤول مكتب الأرشيف', desc: 'حفظ ملفات الطلاب والوثائق الصادرة.', perms: ['document:read_all', 'student:read', 'request:read_unit'] },
  { code: 'of_support', name: 'مكتب الدعم التقني للنظام', kind: 'office', parent: 'sa_registry', label: 'مسؤول الدعم التقني للنظام', desc: 'دعم مستخدمي المنظومة وإعادة تعيين كلمات المرور.', perms: ['student:reset_password', 'student:read', 'request:read_unit'] },
  // ---- مكاتب الخدمات الطلابية والمالية ----
  { code: 'of_leaves', name: 'مكتب الإجازات الطلابية', kind: 'office', parent: 'sa_services', label: 'مسؤول مكتب الإجازات الطلابية', desc: 'طلبات الإجازات والأعذار الطلابية.', perms: ['request:read_unit', 'request:decide', 'student:read'] },
  { code: 'of_housing', name: 'مكتب السكن والخدمات', kind: 'office', parent: 'sa_services', label: 'مسؤول مكتب السكن والخدمات', desc: 'السكن الجامعي والخدمات الطلابية.', perms: ['request:read_unit', 'request:decide', 'student:read'] },
  { code: 'of_finance', name: 'المكتب المالي', kind: 'office', parent: 'sa_services', label: 'مسؤول المكتب المالي', desc: 'صرف رواتب ومكافآت الطلاب والموانع المالية.', perms: ['holds:manage', 'student:read', 'request:read_unit'] },
  // ---- مكاتب رعاية الخريجين والدعم الطلابي ----
  { code: 'of_alumni', name: 'مكتب الخريجين', kind: 'office', parent: 'sa_care', label: 'مسؤول مكتب الخريجين', desc: 'متابعة الخريجين وسجلاتهم.', perms: ['student:read', 'news:manage', 'request:read_unit'] },
  { code: 'of_counsel', name: 'مكتب الإرشاد الصحي والنفسي', kind: 'office', parent: 'sa_care', label: 'مسؤول الإرشاد الصحي والنفسي', desc: 'الإرشاد الصحي والنفسي للطلاب.', perms: ['student:read', 'request:read_unit', 'request:decide'] },
  { code: 'of_grievance', name: 'مكتب التوجيه والتظلمات', kind: 'office', parent: 'sa_care', label: 'أمين مكتب التوجيه والتظلمات', desc: 'التوجيه والتظلمات، وهو أمانة اللجان التأديبية.', perms: ['complaint:manage', 'holds:manage', 'student:read', 'request:read_unit', 'request:decide'] },
  { code: 'of_activities', name: 'مكتب الأنشطة الطلابية', kind: 'office', parent: 'sa_care', label: 'مسؤول مكتب الأنشطة الطلابية', desc: 'الأنشطة والفعاليات الطلابية.', perms: ['news:manage', 'student:read', 'request:read_unit'] },
  { code: 'of_special', name: 'مكتب ذوي الاحتياجات الإضافية', kind: 'office', parent: 'sa_care', label: 'مسؤول مكتب ذوي الاحتياجات الإضافية', desc: 'دعم الطلاب ذوي الاحتياجات الإضافية.', perms: ['student:read', 'request:read_unit', 'request:decide'] },

  // ---- جهة مستقلة ----
  { code: 'discipline', name: 'اللجنة التأديبية', kind: 'department', parent: U, module: 'وحدة اللجان والقرارات', label: 'أمين اللجنة التأديبية',
    desc: 'جهة مستقلة تُشكَّل بقرار رئيس الجامعة أو العميد، ويحضر ممثل شؤون الطلاب أميناً دون تصويت، ويُستبعد من كان طرفاً في الواقعة.',
    perms: ['holds:manage', 'student:read', 'request:read_unit'] },
];

// روابط الإحالة: [من, إلى, في الاتجاهين]
const LINKS = [
  ...STRUCTURE.filter((n) => n.parent === U && !['affairs', 'discipline'].includes(n.code)).map((n) => [n.code, U, true]),
  ['affairs', U, true], ['discipline', U, true],
  ['affairs', 'sa_registry', true], ['affairs', 'sa_services', true], ['affairs', 'sa_care', true],
  ['discipline', 'affairs', true], ['discipline', 'of_grievance', true],
  ...STRUCTURE.filter((n) => n.kind === 'office').map((n) => [n.parent, n.code, true]),
  ['affairs', 'admission', true], ['affairs', 'exams', true], ['affairs', 'academic', true], ['affairs', 'finance', true], ['affairs', 'library', true],
  ['affairs', 'alumni', true], ['affairs', 'legal', true], ['affairs', 'it_sec', true], ['affairs', 'safety', true], ['affairs', 'admin_aff', true],
  ['admission', 'exams', true], ['admission', 'finance', true], ['legal', 'discipline', true], ['quality', 'academic', true],
];

export async function ensureStructure({ db, cfg }, { activate = false, password } = {}) {
  for (const n of STRUCTURE) for (const p of n.perms) if (!ASSIGNABLE.has(p)) throw new Error(`صلاحية غير معروفة في الهيكل: ${p} (${n.code})`);
  const hash = await hashPassword(activate && password ? password : crypto.randomBytes(24).toString('base64url'), cfg.scryptN);
  const out = { units: 0, roles: 0, accounts: 0, links: 0, activated: 0 };
  const ids = new Map();
  tx(db, () => {
    const univ = db.prepare("SELECT id FROM org_units WHERE kind = 'university' ORDER BY id LIMIT 1").get()?.id ?? null;
    ids.set(U, univ);
    for (const n of STRUCTURE) {   // الآباء قبل الأبناء بحسب ترتيب المصفوفة
      let row = db.prepare('SELECT id FROM org_units WHERE code = ?').get(n.code) ?? db.prepare('SELECT id FROM org_units WHERE name = ?').get(n.name);
      if (row) {
        db.prepare('UPDATE org_units SET code = COALESCE(code, ?), description = CASE WHEN description = \'\' THEN ? ELSE description END, module = COALESCE(module, ?) WHERE id = ?').run(n.code, n.desc, n.module ?? null, row.id);
      } else {
        const r = db.prepare('INSERT INTO org_units (name, kind, parent_id, code, description, module) VALUES (?,?,?,?,?,?)').run(n.name, n.kind, ids.get(n.parent) ?? null, n.code, n.desc, n.module ?? null);
        row = { id: Number(r.lastInsertRowid) }; out.units++;
      }
      ids.set(n.code, row.id);
      if (!db.prepare('SELECT 1 FROM roles WHERE key = ?').get('head_' + n.code)) {
        db.prepare('INSERT INTO roles (key, label, description, permissions_json, created_at) VALUES (?,?,?,?,?)').run('head_' + n.code, n.label, `مسؤوليات ${n.name}: ${n.desc}`, JSON.stringify(n.perms), Date.now());
        out.roles++;
      }
      if (!n.noAccount) {
        const u = db.prepare('SELECT id, active, must_change_password mc, role_key FROM users WHERE username = ?').get(n.code);
        if (u && activate && password && !u.active && u.mc && u.role_key === 'head_' + n.code) {   // حساب هيكلي لم يُستخدم بعد: يُفعَّل بالكلمة المؤقتة
          db.prepare('UPDATE users SET active = 1, password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(hash, u.id);
          out.activated++;
        }
        if (!u) {
          db.prepare("INSERT INTO users (username, display_name, password_hash, role, role_key, unit_id, active, must_change_password, created_at) VALUES (?,?,?,'staff',?,?,?,1,?)")
            .run(n.code, n.label, hash, 'head_' + n.code, row.id, activate ? 1 : 0, Date.now());
          out.accounts++; if (activate) out.activated++;
        }
      }
    }
    for (const [a, b, two] of LINKS) {
      const from = ids.get(a), to = ids.get(b);
      if (!from || !to || from === to) continue;
      if (db.prepare('SELECT 1 FROM unit_links WHERE (from_unit = ? AND to_unit = ?) OR (from_unit = ? AND to_unit = ?)').get(from, to, to, from)) continue;
      db.prepare('INSERT INTO unit_links (from_unit, to_unit, two_way, created_at) VALUES (?,?,?,?)').run(from, to, two ? 1 : 0, Date.now());
      out.links++;
    }
    if (out.units || out.roles || out.accounts || out.links || out.activated) audit(db, null, 'تهيئة الهيكل التنظيمي', `وحدات ${out.units} · أدوار ${out.roles} · حسابات ${out.accounts} · روابط ${out.links} · مفعّلة ${out.activated}`);
  });
  return out;
}
