import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  ensureSchema(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    tx(db, () => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

// يكمّل مخطط الميزات التي يستخدمها الكود (اعتماد العلامات بمراحل، سجل تعديل العلامات، جداول المحاضرات والامتحانات،
// سجل حضور القاعات بالباركود، تفاصيل الطلبات الأكاديمية) ولا تعرّفها ملفات الهجرة. آمن للتكرار: لا يغيّر شيئاً موجوداً.
function ensureSchema(db) {
  const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);
  const addCol = (t, c, def) => { if (hasCol(t, c)) return false; db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); return true; };
  tx(db, () => {
    // العلامات الموجودة قبل إضافة مراحل الاعتماد تُعدّ معتمدة (كانت ظاهرة للطلاب أصلاً)؛ والإدخالات الجديدة تبدأ «مسودة»
    if (addCol('grades', 'workflow_status', "TEXT NOT NULL DEFAULT 'draft'")) db.exec("UPDATE grades SET workflow_status = 'approved'");
    addCol('grades', 'reviewed_by', 'INTEGER REFERENCES users(id)');
    addCol('grades', 'reviewed_at', 'INTEGER');
    addCol('grades', 'approved_by', 'INTEGER REFERENCES users(id)');
    addCol('grades', 'approved_at', 'INTEGER');
    db.exec(`
      CREATE TABLE IF NOT EXISTS grade_modification_logs (
        id            INTEGER PRIMARY KEY,
        grade_id      INTEGER,
        student_id    INTEGER NOT NULL,
        course_id     INTEGER,
        old_theory    INTEGER, new_theory    INTEGER,
        old_practical INTEGER, new_practical INTEGER,
        old_mark      INTEGER, new_mark      INTEGER,
        justification TEXT,
        modified_by   INTEGER,
        modified_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gml_student ON grade_modification_logs (student_id);
      CREATE TABLE IF NOT EXISTS course_schedules (
        id                     INTEGER PRIMARY KEY,
        course_id              INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        program_id             INTEGER,
        level                  INTEGER,
        session_type           TEXT NOT NULL DEFAULT 'lecture',
        day_of_week            INTEGER,
        exam_date              TEXT,
        start_time             TEXT,
        end_time               TEXT,
        hall_name              TEXT,
        total_planned_sessions INTEGER,
        min_attendance_pct     REAL
      );
      CREATE INDEX IF NOT EXISTS idx_cs_program ON course_schedules (program_id, level);
      CREATE TABLE IF NOT EXISTS hall_attendance_logs (
        id               INTEGER PRIMARY KEY,
        student_id       INTEGER NOT NULL REFERENCES users(id),
        student_no       TEXT,
        barcode          TEXT,
        course_id        INTEGER REFERENCES courses(id),
        hall_name        TEXT,
        session_type     TEXT NOT NULL DEFAULT 'lecture',
        log_date         TEXT NOT NULL,
        entry_time       INTEGER,
        exit_time        INTEGER,
        duration_minutes INTEGER,
        recorded_by      INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_hal_student ON hall_attendance_logs (student_id, course_id, log_date);
      CREATE TABLE IF NOT EXISTS academic_request_details (
        request_id        INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
        request_category  TEXT,
        target_program_id INTEGER,
        target_course_id  INTEGER,
        target_grade_id   INTEGER,
        claimed_mark      REAL,
        violation_type    TEXT,
        justification     TEXT,
        updated_at        INTEGER
      );
    `);
  });
}

const depth = new WeakMap();
export function tx(db, fn) {
  const d = depth.get(db) ?? 0, sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const r = fn();
    depth.set(db, d);
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth.set(db, d);
    try { db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch { /* already rolled back */ }
    throw e;
  }
}
