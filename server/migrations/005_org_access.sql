-- المرحلة 2: الكليات والمعاهد، الأدوار المخصّصة، الوحدات الإدارية وترابطها، وإحالة الطلبات

-- ========== الكليات والمعاهد والمراكز ==========
-- code: الأحرف الأولى من الاسم الإنكليزي، وهي بادئة اسم المستخدم/الرقم الجامعي للطلاب الجدد
CREATE TABLE faculties (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  code    TEXT NOT NULL UNIQUE CHECK (code GLOB '[A-Z]*' AND length(code) BETWEEN 2 AND 8 AND code NOT GLOB '*[^A-Z]*'),
  kind    TEXT NOT NULL CHECK (kind IN ('college','institute','center')),
  active  INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE programs ADD COLUMN faculty_id INTEGER REFERENCES faculties(id);

-- البرامج الأولية القديمة كانت أمثلة: تُحذف إن لم يرتبط بها طلاب أو مقررات، وتُعطَّل إن ارتبطت
DELETE FROM programs WHERE id NOT IN (SELECT program_id FROM student_profiles) AND id NOT IN (SELECT program_id FROM courses);
UPDATE programs SET active = 0;

INSERT INTO faculties (name, name_en, code, kind) VALUES
('المعهد العالي للعلوم الأمنية',      'Higher Institute for Security Sciences',      'HISS', 'institute'),
('كلية العلوم الأمنية',               'College of Security Sciences',               'CSS',  'college'),
('كلية الأمن السيبراني',              'College of Cyber Security',                  'CCS',  'college'),
('مركز الدراسات والبحوث الأمنية',     'Center for Security Studies and Research',   'CSSR', 'center'),
('المعهد التقاني للعلوم الأمنية',     'Technical Institute for Security Sciences',  'TISS', 'institute'),
('المعهد التقاني للأمن السيبراني',    'Technical Institute for Cyber Security',     'TICS', 'institute');

-- لكل جهة برنامج أساسي يحمل اسمها (قيم مبدئية للدرجة والمدة، تُعدَّل أو تُضاف برامج أخرى من شاشة البرامج)
INSERT INTO programs (faculty, name, degree, years, faculty_id)
SELECT f.name, f.name,
  CASE f.code WHEN 'HISS' THEN 'دراسات عليا' WHEN 'CSS' THEN 'بكالوريوس' WHEN 'CCS' THEN 'بكالوريوس' WHEN 'CSSR' THEN 'برنامج بحثي' ELSE 'دبلوم تقاني' END,
  CASE f.code WHEN 'CSS' THEN 4 WHEN 'CCS' THEN 4 ELSE 2 END,
  f.id
FROM faculties f ORDER BY f.id;

-- ========== الأدوار المخصّصة ==========
-- الأدوار الأساسية (student, staff, auditor, admin) معرَّفة في الكود وثابتة؛ هنا ما ينشئه المدير
CREATE TABLE roles (
  key              TEXT PRIMARY KEY CHECK (key GLOB '[a-z]*' AND length(key) BETWEEN 3 AND 30 AND key NOT GLOB '*[^a-z0-9_]*'),
  label            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  permissions_json TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);
ALTER TABLE users ADD COLUMN role_key TEXT REFERENCES roles(key);   -- NULL = صلاحيات الدور الأساسي في عمود role

-- ========== الوحدات الإدارية وترابطها ==========
ALTER TABLE org_units ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

INSERT INTO org_units (id, name, kind, parent_id) VALUES
(1, 'إدارة الجامعة',    'university', NULL),
(2, 'الشؤون الإدارية',  'department', 1),
(3, 'القسم اللوجستي',   'department', 1),
(4, 'شؤون الطلاب',      'department', 1);

-- رابط من وحدة إلى وحدة: يتيح إحالة الطلبات بينهما (two_way = 1 يجعله في الاتجاهين)
CREATE TABLE unit_links (
  id         INTEGER PRIMARY KEY,
  from_unit  INTEGER NOT NULL REFERENCES org_units(id),
  to_unit    INTEGER NOT NULL REFERENCES org_units(id),
  two_way    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK (from_unit != to_unit),
  UNIQUE (from_unit, to_unit)
);
INSERT INTO unit_links (from_unit, to_unit, two_way, created_at) VALUES
(2, 1, 1, 0),   -- الشؤون الإدارية ↔ إدارة الجامعة
(2, 3, 1, 0),   -- الشؤون الإدارية ↔ القسم اللوجستي
(4, 2, 0, 0);   -- شؤون الطلاب ← الشؤون الإدارية (إحالة باتجاه واحد)

-- الطلب المحال: الوحدة المسؤولة عنه حالياً (NULL = لم يُحَل بعد)
ALTER TABLE requests ADD COLUMN assigned_unit_id INTEGER REFERENCES org_units(id);
CREATE INDEX idx_requests_unit ON requests(assigned_unit_id, status);
