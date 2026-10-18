-- تطبيق الطالب: دليل المواد، العلامات التفصيلية، الأخبار، الشكاوى، وخدمتان جديدتان

ALTER TABLE student_profiles ADD COLUMN ministerial_no TEXT;

-- دليل المواد لكل برنامج وسنة وفصل دراسي
CREATE TABLE courses (
  id         INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES programs(id),
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 7),
  semester   INTEGER NOT NULL CHECK (semester IN (1, 2)),
  name       TEXT NOT NULL,
  code       TEXT,
  hours      INTEGER NOT NULL DEFAULT 3 CHECK (hours BETWEEN 0 AND 12),
  instructor TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (program_id, level, semester, name)
);
CREATE INDEX idx_courses_program ON courses(program_id, level, semester);

-- العلامات: نوسّع الجدول القائم (يغذّي كشف العلامات) بعلامة نظرية وعملية وربط بالمقرر
ALTER TABLE grades ADD COLUMN course_id INTEGER REFERENCES courses(id);
ALTER TABLE grades ADD COLUMN level INTEGER;
ALTER TABLE grades ADD COLUMN semester INTEGER;
ALTER TABLE grades ADD COLUMN academic_year TEXT;
ALTER TABLE grades ADD COLUMN theory_mark INTEGER;
ALTER TABLE grades ADD COLUMN practical_mark INTEGER;
ALTER TABLE grades ADD COLUMN entered_by INTEGER REFERENCES users(id);
ALTER TABLE grades ADD COLUMN entered_at INTEGER;
CREATE UNIQUE INDEX idx_grades_attempt ON grades(student_id, course_id, academic_year) WHERE course_id IS NOT NULL;

CREATE TABLE news (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX idx_news_date ON news(pinned DESC, published_at DESC);

CREATE TABLE complaints (
  id           INTEGER PRIMARY KEY,
  no           TEXT NOT NULL UNIQUE,
  student_id   INTEGER NOT NULL REFERENCES users(id),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  response     TEXT,
  responded_by INTEGER REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX idx_complaints_student ON complaints(student_id, created_at);
CREATE INDEX idx_complaints_status ON complaints(status, created_at);

-- خدمتان ظهرتا في تطبيق الطلاب: تسجيل سنة امتياز، وحياة جامعية (السكن والخدمات)
INSERT INTO service_types (code,label,description,sla_hours,requires_attachment,issues_document,fields_json) VALUES
('excellence_year','طلب تسجيل سنة امتياز','طلب التسجيل في سنة الامتياز بعد استكمال متطلبات البرنامج.',72,0,1,
 '[{"name":"academic_year","label":"العام الدراسي","type":"text","required":true},{"name":"notes","label":"ملاحظات","type":"text"}]'),
('campus_life','طلب حياة جامعية','طلب الاستفادة من خدمات الحياة الجامعية (السكن الجامعي والتغذية).',72,0,0,
 '[{"name":"kind","label":"نوع الخدمة","type":"select","options":["السكن الجامعي","التغذية","السكن والتغذية"],"required":true},{"name":"reason","label":"سبب الطلب","type":"select","options":["الإقامة خارج مدينة الجامعة","ظرف اجتماعي","أخرى"],"required":true}]');

INSERT INTO rules (service_code, kind, params_json, message) VALUES
('excellence_year', 'student_status', '{"allowed":["active"]}', 'حالة قيدك الحالية لا تسمح بتسجيل سنة امتياز؛ يرجى مراجعة قسم شؤون الطلاب.'),
('campus_life', 'student_status', '{"allowed":["active"]}', 'حالة قيدك الحالية لا تسمح بطلب الحياة الجامعية؛ يرجى مراجعة قسم شؤون الطلاب.');
