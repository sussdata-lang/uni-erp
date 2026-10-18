// ترميز/تحليل ASN.1 DER الأدنى اللازم للتوقيع الرقمي (CMS / X.509 / RFC 3161)
const lenBytes = (n) => {
  if (n < 128) return Buffer.from([n]);
  const b = []; while (n > 0) { b.unshift(n & 255); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
};
export const tlv = (tag, ...parts) => { const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))); return Buffer.concat([Buffer.from([tag]), lenBytes(body.length), body]); };
export const seq = (...p) => tlv(0x30, ...p);
export const set = (...p) => tlv(0x31, ...p);
export const sortedSet = (...p) => tlv(0x31, ...[...p].sort(Buffer.compare));            // DER: عناصر SET OF مرتَّبة
export const ctx = (n, ...p) => tlv(0xa0 | n, ...p);                                     // [n] EXPLICIT/IMPLICIT constructed
export const octet = (b) => tlv(0x04, b);
export const nul = () => Buffer.from([0x05, 0x00]);
export const bool = (v) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const printable = (s) => tlv(0x13, Buffer.from(s, 'ascii'));
export const bitString = (b, unused = 0) => tlv(0x03, Buffer.from([unused]), b);
export function int(v) {
  let b = typeof v === 'number' ? Buffer.from(v.toString(16).padStart(v.toString(16).length + (v.toString(16).length % 2), '0'), 'hex') : Buffer.from(v);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
export function oid(s) {
  const p = s.split('.').map(Number), out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) { const t = [n & 127]; let v = Math.floor(n / 128); while (v > 0) { t.unshift((v & 127) | 128); v = Math.floor(v / 128); } out.push(...t); }
  return tlv(0x06, Buffer.from(out));
}
const pad2 = (n) => String(n).padStart(2, '0');
export const utcTime = (d) => tlv(0x17, Buffer.from(`${String(d.getUTCFullYear()).slice(2)}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`));

// تحليل: يعيد { tag, hdr, len, start (بداية الترويسة), vstart, end } ثم children()
export function read(buf, pos = 0) {
  const tag = buf[pos]; let l = buf[pos + 1], h = 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + buf[pos + 2 + i]; h = 2 + n; }
  return { tag, start: pos, vstart: pos + h, len: l, end: pos + h + l, buf };
}
export const value = (n) => n.buf.subarray(n.vstart, n.end);
export const raw = (n) => n.buf.subarray(n.start, n.end);
export function children(n) { const out = []; for (let p = n.vstart; p < n.end;) { const c = read(n.buf, p); out.push(c); p = c.end; } return out; }
export function oidString(n) {
  const b = value(n), out = [Math.floor(b[0] / 40), b[0] % 40]; let v = 0;
  for (const x of b.subarray(1)) { v = v * 128 + (x & 127); if (!(x & 128)) { out.push(v); v = 0; } }
  return out.join('.');
}
export function parseTime(n) {                                 // UTCTime / GeneralizedTime ← Date
  const s = value(n).toString('ascii'); const g = n.tag === 0x18;
  const m = (g ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/ : /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/).exec(s);
  if (!m) return null; const y = g ? Number(m[1]) : Number(m[1]) + (Number(m[1]) >= 50 ? 1900 : 2000);
  return new Date(Date.UTC(y, m[2] - 1, m[3], m[4], m[5], m[6]));
}
