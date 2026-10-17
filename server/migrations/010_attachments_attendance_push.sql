-- حذف «اسم الجد» و«المجموع الأعلى للشهادة» من ملف الطالب (لم يعودا مطلوبين)
ALTER TABLE student_profiles DROP COLUMN grandfather_name;
ALTER TABLE student_profiles DROP COLUMN hs_max;

-- مرفقات الطالب: الثبوتيات الشخصية، الصورة الشخصية، مرفقات أخرى (الملفات على القرص، والصف هو الفهرس)
CREATE TABLE student_files (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('identity','photo','other')),
  file       TEXT NOT NULL,
  orig_name  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_student_files_student ON student_files(student_id, kind);

-- سجل دخول وخروج الطلاب من القاعات (حضور مادة أو فحص) بمسح الباركود
CREATE TABLE hall_logs (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('course','exam')),
  course_id   INTEGER REFERENCES courses(id),
  subject     TEXT NOT NULL,
  hall        TEXT NOT NULL,
  entered_at  INTEGER NOT NULL,
  exited_at   INTEGER,
  method      TEXT NOT NULL DEFAULT 'barcode' CHECK (method IN ('barcode','manual','import')),
  recorded_by INTEGER REFERENCES users(id),
  note        TEXT,
  CHECK (exited_at IS NULL OR exited_at >= entered_at)
);
CREATE INDEX idx_hall_logs_student ON hall_logs(student_id, entered_at);
CREATE INDEX idx_hall_logs_time ON hall_logs(entered_at);
CREATE INDEX idx_hall_logs_open ON hall_logs(student_id) WHERE exited_at IS NULL;

-- اشتراكات تنبيهات الجوال (Web Push)
CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  ua         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);
