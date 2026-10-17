// سجل الطالب الموحّد 360°: ملف الطالب + الخلاصة الأكاديمية + العلامات + الطلبات + العقوبات + حضور القاعات + تعارض الجداول
import { getStudent } from './students.js';
import { gradesFor, PASS_MARK } from './academics.js';
import { detectScheduleConflicts } from './schedule.js';

// المعدل التراكمي: متوسط أحدث محاولة معتمدة لكل مقرر موزونة بالساعات
function gpaOf(db, studentId) {
  const g = gradesFor(db, studentId, null, { onlyApproved: true });
  const hrs = g.grades.reduce((s, x) => s + x.hours, 0);
  return { gpa: g.summary.average, grades: g.grades, summary: g.summary, totalHours: hrs, earnedHours: g.grades.filter((x) => x.passed).reduce((s, x) => s + x.hours, 0) };
}

export function getUnifiedStudentRecord(deps, id) {
  const { db } = deps, student = getStudent(deps, id), sid = Number(id);
  const me = gpaOf(db, sid), prof = db.prepare('SELECT program_id, enroll_year FROM student_profiles WHERE user_id = ?').get(sid);
  // الترتيب ضمن الدفعة: الطلاب الفعّالون في البرنامج نفسه وسنة القيد نفسها، ممن لهم علامات معتمدة
  const cohort = prof ? db.prepare(`SELECT sp.user_id uid FROM student_profiles sp WHERE sp.program_id = ? AND sp.enroll_year = ? AND sp.status = 'active'`).all(prof.program_id, prof.enroll_year) : [];
  const scored = cohort.map((c) => ({ uid: c.uid, gpa: c.uid === sid ? me.gpa : gpaOf(db, c.uid).gpa })).filter((x) => x.gpa !== null).sort((a, b) => b.gpa - a.gpa);
  const pos = scored.findIndex((x) => x.uid === sid), rank = pos < 0 ? null : scored.filter((x) => x.gpa > scored[pos].gpa).length + 1;
  const failed = me.grades.filter((x) => !x.passed).length;
  let academicAlert = null;
  if (me.gpa !== null && me.gpa < PASS_MARK) academicAlert = { level: 'danger', label: 'إنذار أكاديمي', message: `المعدل التراكمي ${me.gpa}% أقل من حد النجاح (${PASS_MARK}%).` };
  else if (failed) academicAlert = { level: 'warning', label: 'مقررات راسبة', message: `لدى الطالب ${failed} مقرر/مقررات لم ينجح فيها بعد.` };
  const requests = db.prepare(`SELECT r.id, r.no, r.status, r.created_at createdAt, st.label service FROM requests r JOIN service_types st ON st.code = r.service_code WHERE r.student_id = ? ORDER BY r.created_at DESC LIMIT 20`).all(sid);
  const holds = db.prepare('SELECT id, hold_type type, note, created_at createdAt FROM student_holds WHERE student_id = ? AND active = 1 ORDER BY id DESC').all(sid);
  const hallLogs = db.prepare('SELECT id, kind, subject, hall, entered_at enteredAt, exited_at exitedAt FROM hall_logs WHERE student_id = ? ORDER BY entered_at DESC LIMIT 10').all(sid);
  const staffGrades = gradesFor(db, sid, null).grades;
  return {
    student,
    academicSummary: { gpa: me.gpa, cohortRank: rank, cohortTotal: scored.length, earnedHours: me.earnedHours, totalHours: me.totalHours, passed: me.summary.passed, failed, academicAlert },
    grades: staffGrades, requests, holds, hallLogs,
    scheduleConflicts: detectScheduleConflicts(db, sid),
  };
}
