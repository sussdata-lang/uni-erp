// محرك القواعد: يقرأ القواعد من جدول rules (قابلة للتعديل دون برمجة) ويعيد أول مخالفة.
export function runRules(db, { studentId, serviceCode, hasAttachment }) {
  const rules = db.prepare('SELECT * FROM rules WHERE enabled = 1 AND (service_code IS NULL OR service_code = ?) ORDER BY id').all(serviceCode);
  const passed = [];
  for (const r of rules) {
    const p = JSON.parse(r.params_json);
    let ok = true;
    if (r.kind === 'no_active_hold') {
      ok = !db.prepare('SELECT 1 FROM student_holds WHERE student_id = ? AND hold_type = ? AND active = 1').get(studentId, p.hold_type);
    } else if (r.kind === 'student_status') {
      // حالة القيد من ملف الطالب؛ الحسابات القديمة بلا ملف لا تُقيَّد
      const pr = db.prepare('SELECT status FROM student_profiles WHERE user_id = ?').get(studentId);
      ok = !pr || (p.allowed ?? ['active']).includes(pr.status);
    } else if (r.kind === 'attachment_required') {
      ok = !!hasAttachment;
    } else if (r.kind === 'max_open_per_service') {
      const n = db.prepare("SELECT COUNT(*) c FROM requests WHERE student_id = ? AND service_code = ? AND status = 'review'").get(studentId, serviceCode).c;
      ok = n < p.max;
    }
    if (!ok) return { ok: false, failed: r, message: r.message, passed };
    passed.push(r);
  }
  return { ok: true, passed };
}
