// مصفوفة الصلاحيات (RBAC). الصلاحيات تُسند للأدوار لا للأشخاص.
// الأدوار الأساسية ثابتة هنا في الكود؛ والمدير ينشئ أدواراً مخصّصة تُخزَّن في جدول roles وتتركّب من هذا الفهرس فقط.

// فهرس الصلاحيات القابلة للإسناد (الأساس الوحيد لما يجوز وضعه في دور مخصّص)
export const PERMISSION_CATALOG = [
  { group: 'الطلبات والوثائق', items: [
    ['request:read_all',  'عرض كل طلبات الطلاب'],
    ['request:read_unit', 'عرض الطلبات المحالة إلى وحدته فقط'],
    ['request:decide',    'اعتماد الطلبات أو رفضها'],
    ['request:forward',   'إحالة الطلبات إلى وحدات مرتبطة'],
    ['document:read_all', 'عرض الوثائق الصادرة'],
    ['stats:read',        'عرض إحصاءات الطلبات'],
  ] },
  { group: 'شؤون الطلاب', items: [
    ['student:register',       'تسجيل طلاب جدد'],
    ['student:read',           'عرض ملفات الطلاب'],
    ['student:update',         'تعديل ملفات الطلاب'],
    ['student:reset_password', 'إعادة تعيين كلمة مرور طالب'],
    ['student:delete',         'حذف طالب وبياناته'],
    ['holds:manage',           'إدارة الذمم والموانع'],
    ['program:manage',         'إدارة الكليات والبرامج'],
  ] },
  { group: 'الشؤون الأكاديمية', items: [
    ['course:manage', 'إدارة دليل المواد'],
    ['grade:manage',  'إدخال العلامات ومراجعتها'],
    ['grade:approve', 'اعتماد العلامات وقفلها (وتعديل المعتمد منها بتبرير)'],
    ['attendance:manage', 'سجل دخول وخروج القاعات (مسح الباركود)'],
  ] },
  { group: 'التواصل', items: [
    ['news:manage',      'نشر الأخبار'],
    ['complaint:manage', 'الرد على الشكاوى'],
  ] },
  { group: 'الإدارة والرقابة', items: [
    ['data:export',  'تصدير البيانات (طلاب، مواد، علامات...)'],
    ['audit:read',   'قراءة سجل التدقيق'],
    ['rules:manage', 'إدارة قواعد الفحص الآلي'],
    ['user:manage',  'إدارة الحسابات الإدارية'],
    ['role:manage',  'إدارة الأدوار والوحدات وروابطها'],
    ['backup:manage', 'النسخ الاحتياطي: إنشاء وتنزيل وحذف النسخ'],
  ] },
].map((g) => ({ group: g.group, items: g.items.map(([key, label]) => ({ key, label })) }));

export const ASSIGNABLE = new Set(PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key)));
export const PERMISSION_LABEL = Object.fromEntries(PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => [i.key, i.label])));

export const ROLE_LABEL = { student: 'طالب', staff: 'موظف شؤون الطلاب', admin: 'مدير النظام', auditor: 'مدقق' };
export const ROLE_DESC = {
  admin: 'صلاحيات كاملة على النظام، بما فيها إدارة الحسابات والأدوار والوحدات. لا يمكن تعطيل آخر مدير فعّال.',
  auditor: 'اطّلاع فقط: يقرأ الطلبات والوثائق والإحصاءات وسجل التدقيق، ولا يغيّر شيئاً.',
  staff: 'يعالج طلبات الطلاب ويسجّل الطلاب ويدير ملفاتهم والمواد والعلامات والأخبار والشكاوى.',
  student: 'يقدّم طلباته ويطّلع على ملفه وعلاماته وأخباره ويرسل شكاواه.',
};

const STUDENT = ['request:create', 'request:read_own', 'document:read_own', 'profile:read_own', 'profile:update_own', 'course:read_own', 'grade:read_own', 'complaint:create'];
export const PERMISSIONS = {
  student: STUDENT,
  staff:   ['request:read_all', 'request:decide', 'request:forward', 'document:read_all', 'stats:read',
            'student:register', 'student:read', 'student:update', 'student:reset_password',
            'course:manage', 'grade:manage', 'attendance:manage', 'news:manage', 'complaint:manage', 'data:export'],
  auditor: ['request:read_all', 'document:read_all', 'audit:read', 'stats:read'],
  admin:   [...ASSIGNABLE],            // المدير يملك كل الصلاحيات القابلة للإسناد (ومنها ما يُضاف مستقبلاً للفهرس)
};
export const BUILTIN_ROLES = ['admin', 'staff', 'auditor'];

export const can = (role, perm) => (PERMISSIONS[role] ?? []).includes(perm);

// الصلاحيات الفعلية لمستخدم: دوره المخصّص إن وُجد وكان فعّالاً، وإلا دوره الأساسي
export function effective(db, u) {
  if (u.role_key) {
    const r = db.prepare('SELECT permissions_json, active FROM roles WHERE key = ?').get(u.role_key);
    if (!r || !r.active) return [];
    return JSON.parse(r.permissions_json).filter((p) => ASSIGNABLE.has(p));
  }
  return PERMISSIONS[u.role] ?? [];
}

export function roleLabel(db, u) {
  if (u.role_key) return db.prepare('SELECT label FROM roles WHERE key = ?').get(u.role_key)?.label ?? u.role_key;
  return ROLE_LABEL[u.role] ?? u.role;
}
