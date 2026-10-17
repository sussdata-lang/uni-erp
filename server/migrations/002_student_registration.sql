-- تسجيل الطلاب: ملف الطالب، البرامج الأكاديمية، وإلزام تغيير كلمة المرور المؤقتة

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- البرامج الأكاديمية (يديرها مدير النظام من الواجهة). الأسماء أدناه أمثلة ابتدائية فقط.
CREATE TABLE programs (
  id      INTEGER PRIMARY KEY,
  faculty TEXT NOT NULL,
  name    TEXT NOT NULL,
  degree  TEXT NOT NULL DEFAULT 'بكالوريوس',
  years   INTEGER NOT NULL DEFAULT 4 CHECK (years BETWEEN 1 AND 7),
  active  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (faculty, name, degree)
);
INSERT INTO programs (faculty, name, degree, years) VALUES
('كلية الهندسة المعلوماتية', 'هندسة البرمجيات ونظم المعلومات', 'بكالوريوس', 5),
('كلية الهندسة المعلوماتية', 'الأمن السيبراني', 'بكالوريوس', 4),
('كلية الهندسة المعلوماتية', 'الذكاء الاصطناعي', 'بكالوريوس', 4),
('كلية الاقتصاد', 'إدارة الأعمال', 'بكالوريوس', 4),
('كلية الاقتصاد', 'المحاسبة', 'بكالوريوس', 4),
('كلية العلوم', 'الرياضيات', 'بكالوريوس', 4),
('كلية الحقوق', 'الحقوق', 'بكالوريوس', 4),
('كلية الآداب والعلوم الإنسانية', 'اللغة الإنكليزية وآدابها', 'بكالوريوس', 4);

CREATE TABLE student_profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id),
  -- الهوية
  first_name       TEXT NOT NULL,
  father_name      TEXT NOT NULL,
  grandfather_name TEXT,
  last_name        TEXT NOT NULL,
  mother_name      TEXT NOT NULL,
  name_en          TEXT,
  national_id      TEXT NOT NULL UNIQUE,
  gender           TEXT NOT NULL,
  birth_date       TEXT NOT NULL,
  birth_place      TEXT NOT NULL,
  nationality      TEXT NOT NULL,
  marital_status   TEXT,
  -- الاتصال والسكن
  phone            TEXT NOT NULL,
  email            TEXT,
  governorate      TEXT NOT NULL,
  city             TEXT NOT NULL,
  address          TEXT NOT NULL,
  -- الشهادة الثانوية
  hs_type          TEXT NOT NULL,
  hs_year          INTEGER NOT NULL,
  hs_school        TEXT,
  hs_governorate   TEXT,
  hs_score         REAL NOT NULL,
  hs_max           REAL NOT NULL,
  -- القيد الأكاديمي
  program_id       INTEGER NOT NULL REFERENCES programs(id),
  admission_type   TEXT NOT NULL,
  enroll_year      INTEGER NOT NULL,
  enroll_term      TEXT NOT NULL,
  study_level      INTEGER NOT NULL CHECK (study_level BETWEEN 1 AND 7),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended','withdrawn','transferred','graduated')),
  -- ولي الأمر والطوارئ
  guardian_name     TEXT NOT NULL,
  guardian_relation TEXT NOT NULL,
  guardian_phone    TEXT NOT NULL,
  emergency_phone   TEXT,
  notes             TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_profiles_program ON student_profiles(program_id, enroll_year);
CREATE INDEX idx_profiles_status ON student_profiles(status);

-- توسيع أنواع القواعد (SQLite لا يعدّل قيد CHECK، فنعيد بناء الجدول)
CREATE TABLE rules_new (
  id           INTEGER PRIMARY KEY,
  service_code TEXT REFERENCES service_types(code),
  kind         TEXT NOT NULL CHECK (kind IN ('no_active_hold','attachment_required','max_open_per_service','student_status')),
  params_json  TEXT NOT NULL DEFAULT '{}',
  message      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1
);
INSERT INTO rules_new SELECT * FROM rules;
DROP TABLE rules;
ALTER TABLE rules_new RENAME TO rules;

-- الإفادة والعذر الامتحاني تتطلبان قيداً فعّالاً؛ كشف العلامات متاح لأي حالة (خريجون، منسحبون...)
INSERT INTO rules (service_code, kind, params_json, message) VALUES
('attendance', 'student_status', '{"allowed":["active"]}', 'حالة قيدك الحالية لا تسمح بإصدار إفادة دوام؛ يرجى مراجعة قسم شؤون الطلاب.'),
('excuse', 'student_status', '{"allowed":["active"]}', 'حالة قيدك الحالية لا تسمح بتقديم عذر امتحاني؛ يرجى مراجعة قسم شؤون الطلاب.');
