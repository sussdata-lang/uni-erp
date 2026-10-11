// مصفوفة الصلاحيات (RBAC). الصلاحيات تُسند للأدوار لا للأشخاص.
export const PERMISSIONS = {
  student: ['request:create', 'request:read_own', 'document:read_own', 'profile:read_own', 'profile:update_own', 'course:read_own', 'grade:read_own', 'complaint:create'],
  staff:   ['request:read_all', 'request:decide', 'document:read_all', 'stats:read',
            'student:register', 'student:read', 'student:update', 'student:reset_password',
            'course:manage', 'grade:manage', 'news:manage', 'complaint:manage'],
  auditor: ['request:read_all', 'document:read_all', 'audit:read', 'stats:read'],
  admin:   ['request:read_all', 'request:decide', 'document:read_all', 'stats:read', 'audit:read',
            'user:manage', 'rules:manage', 'holds:manage',
            'student:register', 'student:read', 'student:update', 'student:reset_password', 'program:manage',
            'course:manage', 'grade:manage', 'news:manage', 'complaint:manage'],
};
export const can = (role, perm) => (PERMISSIONS[role] ?? []).includes(perm);
