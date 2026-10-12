-- المرحلة 1: النواة (الهوية والهيكل) + شؤون الطلاب (طلبات، قواعد، وثائق) + التدقيق

CREATE TABLE org_units (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('university','sector','college','department','office')),
  parent_id  INTEGER REFERENCES org_units(id)
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student','staff','admin','auditor')),
  student_no    TEXT UNIQUE,
  program       TEXT,
  unit_id       INTEGER REFERENCES org_units(id),
  active        INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ذمم وموانع على الطالب (مالية، تأديبية)؛ تقرؤها قواعد الفحص الآلي
CREATE TABLE student_holds (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  hold_type  TEXT NOT NULL CHECK (hold_type IN ('financial','disciplinary','library')),
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  cleared_at INTEGER
);
CREATE INDEX idx_holds_student ON student_holds(student_id, active);

CREATE TABLE grades (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  term       TEXT NOT NULL,
  course     TEXT NOT NULL,
  hours      INTEGER NOT NULL,
  mark       INTEGER NOT NULL CHECK (mark BETWEEN 0 AND 100)
);

CREATE TABLE service_types (
  code                TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  description         TEXT NOT NULL,
  sla_hours           INTEGER NOT NULL,
  requires_attachment INTEGER NOT NULL DEFAULT 0,
  issues_document     INTEGER NOT NULL DEFAULT 1,
  fields_json         TEXT NOT NULL,   -- تعريف الحقول: [{name,label,type,options?,required?}]
  enabled             INTEGER NOT NULL DEFAULT 1
);

-- محرك القواعد: تُعدَّل بالإعدادات لا بالبرمجة
CREATE TABLE rules (
  id           INTEGER PRIMARY KEY,
  service_code TEXT REFERENCES service_types(code),  -- NULL = تنطبق على كل الخدمات
  kind         TEXT NOT NULL CHECK (kind IN ('no_active_hold','attachment_required','max_open_per_service')),
  params_json  TEXT NOT NULL DEFAULT '{}',
  message      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE requests (
  id            INTEGER PRIMARY KEY,
  no            TEXT NOT NULL UNIQUE,
  student_id    INTEGER NOT NULL REFERENCES users(id),
  service_code  TEXT NOT NULL REFERENCES service_types(code),
  details_json  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('review','approved','rejected')),
  reject_reason TEXT,
  rejected_by   TEXT CHECK (rejected_by IN ('auto','staff')),
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    INTEGER REFERENCES users(id)
);
CREATE INDEX idx_requests_student ON requests(student_id, created_at);
CREATE INDEX idx_requests_status ON requests(status, created_at);

CREATE TABLE request_events (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  at          INTEGER NOT NULL,
  actor_label TEXT NOT NULL,
  text        TEXT NOT NULL
);
CREATE INDEX idx_events_request ON request_events(request_id);

CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  orig_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL
);

-- الوثيقة الصادرة: لقطة ثابتة من البيانات وقت الإصدار + بصمة + توقيع
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  request_id   INTEGER NOT NULL UNIQUE REFERENCES requests(id),
  code         TEXT NOT NULL UNIQUE,
  issued_at    INTEGER NOT NULL,
  issued_by    INTEGER REFERENCES users(id),
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature    TEXT NOT NULL
);

-- سجل التدقيق: إضافة فقط، وكل صف يحمل بصمة السابق (سلسلة)
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor_id    INTEGER,
  actor_label TEXT NOT NULL,
  role        TEXT NOT NULL,
  action      TEXT NOT NULL,
  ref         TEXT NOT NULL DEFAULT '',
  ip          TEXT,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER events_no_update BEFORE UPDATE ON request_events
BEGIN SELECT RAISE(ABORT, 'request_events is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON request_events
BEGIN SELECT RAISE(ABORT, 'request_events is append-only'); END;

CREATE TRIGGER documents_no_update BEFORE UPDATE ON documents
BEGIN SELECT RAISE(ABORT, 'documents are immutable'); END;
CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
BEGIN SELECT RAISE(ABORT, 'documents are immutable'); END;

-- بيانات الخدمات والقواعد الافتراضية
INSERT INTO service_types (code,label,description,sla_hours,requires_attachment,issues_document,fields_json) VALUES
('attendance','إفادة دوام','إفادة رسمية بقيد الطالب، موقعة مع رمز تحقق.',4,0,1,
 '[{"name":"purpose","label":"الجهة المقدَّم إليها","type":"select","options":["جهة حكومية","سفارة","شركة أو جهة عمل","أخرى"],"required":true},{"name":"copies","label":"عدد النسخ","type":"number","min":1,"max":5,"default":1}]'),
('transcript','كشف علامات','كشف بمقررات الطالب وعلاماته ومعدله.',4,0,1,
 '[{"name":"lang","label":"اللغة","type":"select","options":["العربية","الإنجليزية"],"required":true},{"name":"copies","label":"عدد النسخ","type":"number","min":1,"max":5,"default":1}]'),
('excuse','عذر امتحاني','رفع عذر مرضي أو طارئ لامتحان فاته الطالب، مع مرفق.',72,1,1,
 '[{"name":"course","label":"المقرر","type":"text","required":true},{"name":"exam_date","label":"تاريخ الامتحان","type":"date","required":true},{"name":"reason","label":"سبب العذر","type":"select","options":["طبي","ظرف طارئ"],"required":true}]');

INSERT INTO rules (service_code,kind,params_json,message) VALUES
(NULL,'no_active_hold','{"hold_type":"financial"}','توجد ذمة مالية غير مسددة؛ يرجى مراجعة الشؤون المالية ثم إعادة التقديم.'),
(NULL,'no_active_hold','{"hold_type":"disciplinary"}','يوجد إجراء تأديبي قائم يمنع هذه الخدمة؛ يرجى مراجعة مكتب التوجيه.'),
('excuse','attachment_required','{}','يجب إرفاق التقرير أو الإثبات.'),
(NULL,'max_open_per_service','{"max":2}','لديك طلبان قيد المراجعة لهذه الخدمة؛ انتظر القرار قبل تقديم طلب جديد.');
