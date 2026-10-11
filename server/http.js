import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, code = 'error', field = undefined) { super(message); this.status = status; this.code = code; this.field = field; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8' };

// ترويسات أمنية: لا سكربتات إلا من الموقع نفسه، ولا تضمين في إطارات، ولا تخمين لأنواع الملفات
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'حجم الطلب أكبر من المسموح.', 'too_large');
    chunks.push(c);
  }
  if (!size) return {};
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'يُقبل JSON فقط.', 'bad_content_type');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON غير صالح.', 'bad_json'); }
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function serveStatic(cfg, pathname, res) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(cfg.publicDir, rel));
  if (!file.startsWith(cfg.publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function makeHandler({ cfg, router, getUser }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = (cfg.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'الطريقة غير مسموحة.');
        if (serveStatic(cfg, url.pathname, res)) return;
        throw new HttpError(404, 'غير موجود.', 'not_found');
      }
      const { route, params, pathMatched } = router.match(req.method, url.pathname);
      if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'الطريقة غير مسموحة.' : 'غير موجود.', 'not_found');
      const cookies = parseCookies(req.headers.cookie);
      const user = getUser(cookies.sid);   // مسارات auth:false (مثل /api/me) تقرأ المستخدم إن وُجد دون إلزام
      if (route.opts.auth !== false && !user) throw new HttpError(401, 'يلزم تسجيل الدخول.', 'unauthenticated');
      // كلمة المرور المؤقتة: لا شيء يعمل قبل تغييرها سوى تغييرها والخروج
      if (route.opts.auth !== false && user?.must_change_password && !route.opts.allowMustChange) throw new HttpError(403, 'يجب تغيير كلمة المرور المؤقتة أولاً.', 'password_change_required');
      const ctx = { req, res, ip, params, query: Object.fromEntries(url.searchParams), cookies, user, cfg,
        body: req.method === 'GET' ? {} : await readBody(req, route.opts.maxBody ?? 64 * 1024),
        json: (status, obj, headers) => sendJson(res, status, obj, headers) };
      await route.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) });
      console.error('[server error]', e);
      sendJson(res, 500, { error: 'internal', message: 'خطأ داخلي في الخادم.' });
    }
  };
}

export function sendRaw(res, status, headers, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
