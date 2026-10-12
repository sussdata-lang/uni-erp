import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// قارئ .env بسيط (بلا اعتماديات). المتغيرات الفعلية في البيئة لها الأولوية.
function loadDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const env = { ...loadDotEnv(path.join(ROOT, '.env')), ...process.env };
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
  const cfg = {
    root: ROOT,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    dbPath: abs(env.DB_PATH ?? './data/uni-erp.db'),
    uploadDir: abs(env.UPLOAD_DIR ?? './data/uploads'),
    publicDir: path.join(ROOT, 'public'),
    sessionHours: Number(env.SESSION_HOURS ?? 8),
    cookieSecure: env.COOKIE_SECURE === '1',
    trustProxy: env.TRUST_PROXY === '1',
    universityName: env.UNIVERSITY_NAME ?? 'الجامعة السورية للعلوم الأمنية',
    publicUrl: env.PUBLIC_URL ?? null,
    scryptN: Number(env.SCRYPT_N ?? 2 ** 15),
    maxAttachmentBytes: 2 * 1024 * 1024,
    signingKey: env.SIGNING_KEY || null,
    ...overrides,
  };
  if (!cfg.signingKey) {
    // مفتاح التوقيع: يُولَّد مرة واحدة ويُحفظ بصلاحيات مقيّدة. فقدانه يعني عدم القدرة على التحقق من الوثائق القديمة.
    const keyFile = path.join(path.dirname(cfg.dbPath), 'secret.key');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    cfg.signingKey = fs.readFileSync(keyFile, 'utf8').trim();
  }
  return cfg;
}
