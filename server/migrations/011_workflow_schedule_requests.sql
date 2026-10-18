-- مراحل اعتماد العلامات (مدخلة ← مراجَعة ← معتمدة). العلامات القائمة تُعدّ معتمدة كي لا يتغير ما يراه الطلاب.
ALTER TABLE grades ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'approved' CHECK (workflow_status IN ('draft','reviewed','approved'));
ALTER TABLE grades ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE grades ADD COLUMN reviewed_at INTEGER;
ALTER TABLE grades ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE grades ADD COLUMN approved_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_grades_workflow ON grades(workflow_status);

-- سجل تغييرات العلامات (إضافة فقط): من غيّر ماذا ولماذا
CREATE TABLE IF NOT EXISTS grade_changes (
  id          INTEGER PRIMARY KEY,
  grade_id    INTEGER NOT NULL,
  student_id  INTEGER NOT NULL,
  course      TEXT NOT NULL,
  action      TEXT NOT NULL,
  old_total   INTEGER, new_total INTEGER,
  old_theory  INTEGER, new_theory INTEGER,
  old_practical INTEGER, new_practical INTEGER,
  old_status  TEXT, new_status TEXT,
  justification TEXT,
  actor_id    INTEGER REFERENCES users(id),
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_changes_grade ON grade_changes(grade_id);
CREATE INDEX IF NOT EXISTS idx_grade_changes_student ON grade_changes(student_id, at);
CREATE TRIGGER IF NOT EXISTS grade_changes_no_update BEFORE UPDATE ON grade_changes BEGIN SELECT RAISE(ABORT, 'grade_changes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS grade_changes_no_delete BEFORE DELETE ON grade_changes BEGIN SELECT RAISE(ABORT, 'grade_changes is append-only'); END;

-- جدول المحاضرات: يُستعمل لكشف تعارض مقررات الطالب (day: 0=السبت … 6=الجمعة، الدقائق من منتصف الليل)
CREATE TABLE IF NOT EXISTS course_schedules (
  id        INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day       INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min   INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  hall      TEXT,
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS idx_course_schedules_course ON course_schedules(course_id);

-- تفاصيل الطلبات الأكاديمية
CREATE TABLE IF NOT EXISTS academic_request_details (
  request_id        INTEGER PRIMARY KEY REFERENCES requests(id),
  request_category TEXT NOT NULL,
  target_program_id INTEGER REFERENCES programs(id),
  target_course_id  INTEGER REFERENCES courses(id),
  target_grade_id   INTEGER,
  claimed_mark      INTEGER,
  violation_type    TEXT,
  justification     TEXT,
  updated_at        INTEGER NOT NULL
);

INSERT OR IGNORE INTO service_types (code,label,description,sla_hours,requires_attachment,issues_document,fields_json) VALUES
('postponement','طلب تأجيل دراسة','طلب تأجيل الدراسة لفصل أو أكثر لظرف يقبله المجلس.',120,0,0,
 '[{"name":"term","label":"مدة التأجيل","type":"select","options":["فصل واحد","فصلان","سنة دراسية"],"required":true},{"name":"reason","label":"سبب التأجيل","type":"select","options":["ظرف صحي","ظرف عائلي","سفر","أخرى"],"required":true},{"name":"justification","label":"التبرير","type":"text","required":true}]'),
('withdrawal','طلب انسحاب','طلب الانسحاب من الدراسة.',120,0,0,
 '[{"name":"reason","label":"سبب الانسحاب","type":"select","options":["ظرف صحي","ظرف عائلي","سفر","انتقال لجهة أخرى","أخرى"],"required":true},{"name":"justification","label":"التبرير","type":"text","required":true}]'),
('program_transfer','طلب تحويل برنامج','طلب التحويل إلى برنامج دراسي آخر.',168,0,0,
 '[{"name":"target_program_id","label":"البرنامج المطلوب","type":"ref","ref":"program","required":true},{"name":"justification","label":"التبرير","type":"text","required":true}]'),
('grade_appeal','تظلّم على علامة','تظلّم على علامة مقرر، مع ذكر العلامة التي يطالب بها الطالب.',168,0,0,
 '[{"name":"target_grade_id","label":"المقرر (العلامة)","type":"ref","ref":"my_grade","required":true},{"name":"claimed_mark","label":"العلامة المطالَب بها","type":"number","min":0,"max":100},{"name":"justification","label":"سبب التظلّم","type":"text","required":true}]'),
('violation_report','تقرير مخالفة','إبلاغ عن مخالفة (غش، سلوك، استخدام غير مشروع…) لعرضها على الجهة المختصة.',72,0,0,
 '[{"name":"violation_type","label":"نوع المخالفة","type":"select","options":["غش أو شروع فيه","سلوك مخالف","إتلاف ممتلكات","استخدام غير مشروع للأجهزة","أخرى"],"required":true},{"name":"justification","label":"وصف الواقعة","type":"text","required":true}]');
