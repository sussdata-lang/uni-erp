// جدول محاضرات المقررات وكشف التعارض بين مقررات الطالب
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s, label) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
  if (!m) throw new HttpError(400, `${label}: صيغة الوقت HH:MM.`, 'validation');
  return Number(m[1]) * 60 + Number(m[2]);
};

export function getSlots(db, courseId) {
  return db.prepare('SELECT id, day, start_min, end_min, hall FROM course_schedules WHERE course_id = ? ORDER BY day, start_min').all(Number(courseId))
    .map((r) => ({ id: r.id, day: r.day, dayLabel: DAYS[r.day], start: hm(r.start_min), end: hm(r.end_min), hall: r.hall ?? '' }));
}

export function setSlots({ db }, actor, courseId, slots, ip) {
  const c = db.prepare('SELECT id, name FROM courses WHERE id = ?').get(Number(courseId));
  if (!c) throw new HttpError(404, 'المقرر غير موجود.', 'not_found');
  if (!Array.isArray(slots) || slots.length > 20) throw new HttpError(400, 'الحد الأقصى 20 موعداً للمقرر.', 'validation');
  const clean = slots.map((s, i) => {
    const day = Number(s?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new HttpError(400, `الموعد ${i + 1}: اليوم غير صالح.`, 'validation');
    const a = toMin(s.start, `الموعد ${i + 1} (البداية)`), b = toMin(s.end, `الموعد ${i + 1} (النهاية)`);
    if (b <= a) throw new HttpError(400, `الموعد ${i + 1}: النهاية يجب أن تكون بعد البداية.`, 'validation');
    const hall = String(s.hall ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { day, a, b, hall: hall || null };
  });
  tx(db, () => {
    db.prepare('DELETE FROM course_schedules WHERE course_id = ?').run(c.id);
    for (const s of clean) db.prepare('INSERT INTO course_schedules (course_id, day, start_min, end_min, hall) VALUES (?,?,?,?,?)').run(c.id, s.day, s.a, s.b, s.hall);
    audit(db, actor, 'تعديل جدول محاضرات مقرر', c.name.slice(0, 80), ip);
  });
  return { slots: getSlots(db, c.id) };
}

// مقررات الطالب الحالية = مقررات برنامجه في سنته الدراسية غير المنجَزة (لم ينجح فيها بعلامة معتمدة). التعارض يُفحص داخل الفصل نفسه.
export function detectScheduleConflicts(db, studentId) {
  const p = db.prepare('SELECT program_id, study_level FROM student_profiles WHERE user_id = ?').get(Number(studentId));
  if (!p) throw new HttpError(404, 'الطالب غير موجود.', 'not_found');
  const courses = db.prepare(`SELECT c.id, c.name, c.semester FROM courses c WHERE c.program_id = ? AND c.level = ? AND c.active = 1
    AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.student_id = ? AND g.course_id = c.id AND g.workflow_status = 'approved' AND g.mark >= 60)`).all(p.program_id, p.study_level, Number(studentId));
  const slots = db.prepare(`SELECT course_id, day, start_min, end_min, hall FROM course_schedules WHERE course_id IN (${courses.map(() => '?').join(',') || 'NULL'})`).all(...courses.map((c) => c.id));
  const conflicts = [], withSlots = new Set(slots.map((s) => s.course_id));
  for (const sem of [1, 2]) {
    const cs = courses.filter((c) => c.semester === sem), list = slots.filter((s) => cs.some((c) => c.id === s.course_id));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.course_id === b.course_id || a.day !== b.day) continue;
      const lo = Math.max(a.start_min, b.start_min), hi = Math.min(a.end_min, b.end_min);
      if (hi <= lo) continue;
      const nm = (id) => (cs.find((c) => c.id === id) || {}).name ?? '';
      conflicts.push({ semester: sem, day: a.day, dayLabel: DAYS[a.day], overlapMinutes: hi - lo,
        a: { courseId: a.course_id, course: nm(a.course_id), start: hm(a.start_min), end: hm(a.end_min), hall: a.hall ?? '' },
        b: { courseId: b.course_id, course: nm(b.course_id), start: hm(b.start_min), end: hm(b.end_min), hall: b.hall ?? '' } });
    }
  }
  return { studentId: Number(studentId), level: p.study_level, checkedCourses: courses.length, withoutSchedule: courses.filter((c) => !withSlots.has(c.id)).length, conflicts };
}
