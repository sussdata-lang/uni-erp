// النسخ الاحتياطي: لقطة متّسقة لقاعدة البيانات (VACUUM INTO) + كل ملفات data (المرفقات، الشهادات، مفتاح التوقيع) + المفتاح الفعّال، في أرشيف واحد.
// يُنشأ تلقائياً مرة كل يوم، ويُحفظ آخر N نسخة محلياً (BACKUP_KEEP)، ويُنزَّل من لوحة المدير، ويمكن رفعه تلقائياً إلى مخزن خارجي بطلب PUT (BACKUP_PUT_URL)
// لأن النسخ على القرص نفسه لا تحمي من ضياع القرص. إن ضُبطت BACKUP_PASSPHRASE يُشفَّر الأرشيف (AES-256-GCM) لأنه يحوي بيانات الطلاب ومفتاح التوقيع.
import { log } from '../lib/logger.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeZip, readZip } from '../lib/zip.js';
import { audit } from '../audit.js';
import { HttpError } from '../http.js';

export const NAME_RE = /^backup-\d{8}-\d{6}(-[a-z]+)?\.zip(\.enc)?$/;
const MAGIC = Buffer.from('UEB1');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const dataDirOf = (cfg) => path.dirname(cfg.dbPath);
export const backupDirOf = (cfg) => cfg.backupDir || path.join(dataDirOf(cfg), 'backups');

function walk(dir, base, skip, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name), rel = path.posix.join(base, e.name);
    if (skip(full, e)) continue;
    if (e.isDirectory()) walk(full, rel, skip, out); else if (e.isFile()) out.push({ name: rel, full });
  }
  return out;
}
const inside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

/* ---------- التشفير الاختياري ---------- */
export function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(pass, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
export function decrypt(buf, pass) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new HttpError(400, 'الملف ليس نسخة احتياطية مشفَّرة صالحة.', 'validation');
  if (!pass) throw new HttpError(400, 'النسخة مشفَّرة: أدخل عبارة المرور (BACKUP_PASSPHRASE).', 'validation');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48), key = crypto.scryptSync(pass, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new HttpError(400, 'عبارة المرور خاطئة أو الملف تالف.', 'validation'); }
}

/* ---------- الإنشاء ---------- */
export async function createBackup({ db, cfg }, { reason = 'auto', actor = null, ip = null } = {}) {
  const dir = backupDirOf(cfg), dataDir = dataDirOf(cfg), now = new Date();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), tmp = path.join(dir, `.tmp-${stamp}-${crypto.randomBytes(3).toString('hex')}.db`);
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
    const dbBuf = fs.readFileSync(tmp);
    const dbFiles = new Set(['uni-erp.db', path.basename(cfg.dbPath), path.basename(cfg.dbPath) + '-wal', path.basename(cfg.dbPath) + '-shm']);
    const skip = (full, e) => full === dir || inside(full, dir) || (e.isFile() && path.dirname(full) === dataDir && dbFiles.has(e.name)) || e.name.startsWith('.tmp-');
    const files = [{ name: 'database/uni-erp.db', data: dbBuf }];
    const extra = walk(dataDir, 'data', skip);
    for (const f of extra) files.push({ name: f.name, data: fs.readFileSync(f.full) });
    if (!inside(cfg.uploadDir, dataDir) && cfg.uploadDir !== dataDir) for (const f of walk(cfg.uploadDir, 'uploads', () => false)) files.push({ name: f.name, data: fs.readFileSync(f.full) });
    files.push({ name: 'signing-key.txt', data: cfg.signingKey ?? '' });
    const manifest = { app: 'uni-erp', format: 1, createdAt: now.toISOString(), reason, dbSha256: sha(dbBuf), dbBytes: dbBuf.length, files: files.length, note: 'استعد بـ: node scripts/restore.js <الملف> — والخادم متوقف.' };
    files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
    let out = writeZip(files), name = `backup-${stamp}${reason === 'auto' ? '' : '-' + reason.replace(/[^a-z]/g, '')}.zip`;
    if (cfg.backupPassphrase) { out = encrypt(out, cfg.backupPassphrase); name += '.enc'; }
    const file = path.join(dir, name); fs.writeFileSync(file, out, { mode: 0o600 });
    const res = { name, size: out.length, createdAt: now.getTime(), encrypted: !!cfg.backupPassphrase, files: files.length, uploaded: null, error: null };
    if (cfg.backupPutUrl) res.uploaded = await upload(cfg, name, out).catch((e) => { res.error = `تعذّر الرفع الخارجي: ${e.message}`; return false; });
    prune(cfg);
    setStatus(db, res);
    if (actor) audit(db, actor, 'إنشاء نسخة احتياطية', name, ip);
    return res;
  } finally { try { fs.unlinkSync(tmp); } catch { /* غير موجود */ } }
}

async function upload(cfg, name, buf) {
  const u = new URL(cfg.backupPutUrl);
  if (u.protocol !== 'https:' && !cfg.backupAllowHttp) throw new Error('رابط الرفع يجب أن يكون https');
  const url = cfg.backupPutUrl.includes('{name}') ? cfg.backupPutUrl.replace('{name}', encodeURIComponent(name)) : cfg.backupPutUrl.replace(/\/?$/, '/') + encodeURIComponent(name);
  const res = await (cfg.backupFetch ?? fetch)(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...(cfg.backupPutAuth ? { Authorization: cfg.backupPutAuth } : {}) }, body: buf, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`استجابة ${res.status}`);
  return true;
}

export function listBackups(cfg) {
  const dir = backupDirOf(cfg);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).map((n) => { const s = fs.statSync(path.join(dir, n)); return { name: n, size: s.size, createdAt: s.mtimeMs, encrypted: n.endsWith('.enc') }; }).sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
}
function prune(cfg) {
  const keep = Math.max(1, Number(cfg.backupKeep ?? 14)), all = listBackups(cfg);
  for (const b of all.slice(keep)) try { fs.unlinkSync(path.join(backupDirOf(cfg), b.name)); } catch { /* */ }
}
export function backupPath(cfg, name) {
  if (!NAME_RE.test(String(name))) throw new HttpError(404, 'النسخة غير موجودة.', 'not_found');
  const f = path.join(backupDirOf(cfg), name);
  if (!fs.existsSync(f)) throw new HttpError(404, 'النسخة غير موجودة.', 'not_found');
  return f;
}
export function deleteBackup({ db, cfg }, actor, name, ip) {
  fs.unlinkSync(backupPath(cfg, name)); audit(db, actor, 'حذف نسخة احتياطية', name, ip);
}
const setStatus = (db, s) => db.prepare("INSERT INTO site_settings (key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s));
export const lastStatus = (db) => { try { return JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key = 'last_backup'").get()?.value ?? 'null'); } catch { return null; } };
export function backupInfo({ db, cfg }) {
  return { backups: listBackups(cfg), last: lastStatus(db), keep: Number(cfg.backupKeep ?? 14), encrypted: !!cfg.backupPassphrase, remote: !!cfg.backupPutUrl, auto: cfg.backupAuto !== false, hourUtc: Number(cfg.backupHour ?? 1),
    persistentHint: 'النسخ المحفوظة على الخادم نفسه لا تحمي من ضياع القرص: نزّل نسخة دورياً أو فعّل الرفع الخارجي (BACKUP_PUT_URL).' };
}

/* ---------- الجدولة اليومية ---------- */
export function startBackupScheduler(deps) {
  const { cfg } = deps;
  if (cfg.backupAuto === false) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    const now = new Date(), latest = listBackups(cfg).find((b) => !/-[a-z]+\.zip/.test(b.name.replace(/\.enc$/, '')));
    const due = !latest || (now.getTime() - latest.createdAt > 24 * 3600e3) || (now.getUTCHours() >= Number(cfg.backupHour ?? 1) && new Date(latest.createdAt).toISOString().slice(0, 10) !== now.toISOString().slice(0, 10));
    if (!due) return;
    running = true;
    try { await createBackup(deps, { reason: 'auto' }); } catch (e) { log.warn('backup: ' + e.message); setStatus(deps.db, { createdAt: Date.now(), error: e.message }); } finally { running = false; }
  };
  const first = setTimeout(tick, Number(cfg.backupFirstDelayMs ?? 60_000)), t = setInterval(tick, 15 * 60_000);
  first.unref(); t.unref();
  return () => { clearTimeout(first); clearInterval(t); };
}

/* ---------- الاستعادة (والخادم متوقف): تتحقق قبل أي كتابة وتحتفظ بنسخة من الوضع الحالي ---------- */
export function restoreBackup(cfg, file, { passphrase = cfg.backupPassphrase, force = false } = {}) {
  let buf = fs.readFileSync(file);
  if (buf.subarray(0, 4).equals(MAGIC)) buf = decrypt(buf, passphrase);
  const z = readZip(buf, { maxTotal: 4 * 1024 ** 3, maxEntries: 200000 });
  const man = z.get('manifest.json'); if (!man) throw new HttpError(400, 'الملف ليس نسخة احتياطية لهذا النظام.', 'validation');
  const m = JSON.parse(man.toString('utf8')), dbBuf = z.get('database/uni-erp.db');
  if (m.app !== 'uni-erp' || !dbBuf || sha(dbBuf) !== m.dbSha256) throw new HttpError(400, 'النسخة تالفة (بصمة قاعدة البيانات لا تطابق).', 'validation');
  const probe = path.join(path.dirname(cfg.dbPath), `.restore-probe-${process.pid}.db`); fs.mkdirSync(path.dirname(probe), { recursive: true }); fs.writeFileSync(probe, dbBuf);
  try { const t = new DatabaseSync(probe), r = t.prepare('PRAGMA integrity_check').get(); t.close(); if (Object.values(r)[0] !== 'ok') throw new Error('فشل فحص السلامة'); }
  catch (e) { throw new HttpError(400, `قاعدة البيانات في النسخة غير سليمة: ${e.message}`, 'validation'); } finally { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(probe + s); } catch { /* */ } }
  const dataDir = dataDirOf(cfg), stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15), safe = path.join(dataDir, `pre-restore-${stamp}`);
  if (fs.existsSync(cfg.dbPath) && !force && fs.existsSync(cfg.dbPath + '-wal') && fs.statSync(cfg.dbPath + '-wal').size > 0) {
    // ملف WAL غير فارغ قد يعني خادماً يعمل
    throw new HttpError(409, 'يبدو أن الخادم يعمل (ملف WAL نشط). أوقفه أولاً أو استعمل --force.', 'conflict');
  }
  fs.mkdirSync(safe, { recursive: true });
  for (const s of ['', '-wal', '-shm']) if (fs.existsSync(cfg.dbPath + s)) fs.renameSync(cfg.dbPath + s, path.join(safe, path.basename(cfg.dbPath) + s));
  fs.writeFileSync(cfg.dbPath, dbBuf, { mode: 0o600 });
  let restored = 1;
  const put = (key, rel, base) => {
    const target = path.resolve(base, rel);
    if (!inside(target, base)) throw new HttpError(400, 'مسار غير آمن في النسخة.', 'validation');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, z.get(key)); restored++;
  };
  for (const rel of z.keys()) {
    if (rel.startsWith('data/')) put(rel, rel.slice(5), dataDir);
    else if (rel.startsWith('uploads/')) put(rel, rel.slice(8), cfg.uploadDir);
  }
  return { restored, safeCopy: safe, createdAt: m.createdAt, signingKeyInBackup: (z.get('signing-key.txt') ?? Buffer.alloc(0)).toString('utf8').trim() };
}
