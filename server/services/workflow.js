// مراحل اعتماد العلامات: مدخلة (draft) ← مراجَعة (reviewed) ← معتمدة (approved).
// الطلاب والكشوف لا ترى إلا المعتمدة. تعديل علامة معتمدة أو إعادة فتحها يتطلب صلاحية الاعتماد وتبريراً يُسجَّل في grade_changes.
import { tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const STAGES = ['draft', 'reviewed', 'approved'];
export const STAGE_LABEL = { draft: 'مدخلة', reviewed: 'مراجَعة', approved: 'معتمدة' };

export const workflowOn = (db) => (db.prepare("SELECT value FROM site_settings WHERE key = 'grades_workflow'").get()?.value ?? 'on') !== 'off';
export const initialStatus = (db) => (workflowOn(db) ? 'draft' : 'approved');
export function setWorkflow({ db }, actor, on, ip) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('grades_workflow', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(on ? 'on' : 'off');
  audit(db, actor, on ? 'تفعيل مراحل اعتماد العلامات' : 'إيقاف مراحل اعتماد العلامات', 'grades_workflow', ip);
  return { enabled: !!on };
}
export const canApprove = (actor) => !!actor?.can?.('grade:approve');
export function needJustification(j) {
  const t = String(j ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 5 || t.length > 300) throw new HttpError(400, 'اكتب تبريراً (5 إلى 300 حرف) لتعديل علامة معتمدة.', 'validation', 'justification');
  return t;
}
export function logChange(db, actor, g, action, nw, justification) {
  db.prepare(`INSERT INTO grade_changes (grade_id, student_id, course, action, old_total, new_total, old_theory, new_theory, old_practical, new_practical, old_status, new_status, justification, actor_id, at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(g.id, g.student_id, g.course, action, g.mark ?? null, nw.mark ?? g.mark ?? null, g.theory_mark ?? null, nw.theory ?? g.theory_mark ?? null,
    g.practical_mark ?? null, nw.practical === undefined ? g.practical_mark ?? null : nw.practical, g.workflow_status ?? null, nw.status ?? g.workflow_status ?? null, justification ?? null, actor?.id ?? null, Date.now());
}

// ينقل مجموعة علامات إلى مرحلة: reviewed (من draft) | approved (من reviewed) | draft (إعادة من reviewed) | reviewed (إعادة فتح من approved، بتبرير)
export function transitionGrades({ db }, actor, b, ip) {
  const stage = String(b?.stage ?? '');
  if (!STAGES.includes(stage)) throw new HttpError(400, 'مرحلة غير معروفة.', 'validation', 'stage');
  const ids = [...new Set((Array.isArray(b?.gradeIds) ? b.gradeIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new HttpError(400, 'اختر علامة واحدة على الأقل.', 'validation', 'gradeIds');
  if (ids.length > 1000) throw new HttpError(400, 'الحد الأقصى 1000 علامة في العملية الواحدة.', 'validation');
  const just = b?.justification ? String(b.justification).replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  const updated = [], skipped = [], approvedNow = [];
  tx(db, () => {
    for (const id of ids) {
      const g = db.prepare('SELECT * FROM grades WHERE id = ?').get(id);
      if (!g) { skipped.push({ id, reason: 'غير موجودة' }); continue; }
      const from = g.workflow_status;
      if (from === stage) { skipped.push({ id, reason: 'في هذه المرحلة أصلاً' }); continue; }
      const forward = STAGES.indexOf(stage) === STAGES.indexOf(from) + 1;
      if (stage === 'approved') {
        if (!canApprove(actor)) throw new HttpError(403, 'لا تملك صلاحية اعتماد العلامات.', 'forbidden');
        if (!forward) { skipped.push({ id, reason: 'يجب مراجعتها أولاً' }); continue; }
      } else if (from === 'approved') {                    // إعادة فتح علامة معتمدة
        if (!canApprove(actor)) throw new HttpError(403, 'إعادة فتح علامة معتمدة تتطلب صلاحية الاعتماد.', 'forbidden');
        if (stage !== 'reviewed') { skipped.push({ id, reason: 'تُعاد المعتمدة إلى «مراجَعة» فقط' }); continue; }
        needJustification(just);
      } else if (!forward && !(from === 'reviewed' && stage === 'draft')) { skipped.push({ id, reason: 'انتقال غير مسموح' }); continue; }
      const now = Date.now();
      if (stage === 'approved') db.prepare("UPDATE grades SET workflow_status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").run(actor.id, now, id);
      else if (stage === 'reviewed') db.prepare("UPDATE grades SET workflow_status = 'reviewed', reviewed_by = ?, reviewed_at = ?, approved_by = NULL, approved_at = NULL WHERE id = ?").run(actor.id, now, id);
      else db.prepare("UPDATE grades SET workflow_status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(id);
      logChange(db, actor, g, `${STAGE_LABEL[from]} ← ${STAGE_LABEL[stage]}`, { status: stage }, from === 'approved' ? just : null);
      updated.push(id);
      if (stage === 'approved') approvedNow.push({ studentId: g.student_id, course: g.course });
    }
    if (updated.length) audit(db, actor, `نقل ${updated.length} علامة إلى «${STAGE_LABEL[stage]}»`, `grades:${updated.slice(0, 5).join(',')}${updated.length > 5 ? '…' : ''}`.slice(0, 100), ip);
  });
  return { updated: updated.length, skipped, approvedNow, stage };
}

export function gradeHistory(db, gradeId) {
  return db.prepare(`SELECT c.at, c.action, c.old_total oldTotal, c.new_total newTotal, c.justification, COALESCE(u.display_name, '—') actor FROM grade_changes c LEFT JOIN users u ON u.id = c.actor_id
    WHERE c.grade_id = ? ORDER BY c.id DESC LIMIT 50`).all(Number(gradeId));
}
