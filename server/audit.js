import { sha256 } from './security.js';

export const GENESIS = '0'.repeat(64);
const rowHash = (prev, r) => sha256([prev, r.at, r.actor_id ?? '', r.actor_label, r.role, r.action, r.ref, r.ip ?? ''].join('|'));

// إضافة سجل: كل صف يضم بصمة الصف السابق، فأي حذف أو تعديل لاحق يكسر السلسلة.
export function audit(db, actor, action, ref = '', ip = null) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : GENESIS;
  const row = { at: Date.now(), actor_id: actor?.id ?? null, actor_label: actor?.label ?? 'النظام', role: actor?.role ?? 'system', action, ref: String(ref), ip };
  db.prepare('INSERT INTO audit_log (at, actor_id, actor_label, role, action, ref, ip, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(row.at, row.actor_id, row.actor_label, row.role, row.action, row.ref, row.ip, prev, rowHash(prev, row));
}

export function verifyAuditChain(db) {
  let prev = GENESIS, n = 0;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').iterate()) {
    n++;
    if (r.prev_hash !== prev || r.hash !== rowHash(prev, r)) return { ok: false, brokenAtId: r.id, checked: n };
    prev = r.hash;
  }
  return { ok: true, checked: n };
}
