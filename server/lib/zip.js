// قراءة/كتابة ملفات ZIP (يكفي لـ xlsx وdocx) دون اعتماديات: الضغط عبر zlib المدمجة.
import zlib from 'node:zlib';

const u16 = (b, o) => b.readUInt16LE(o), u32 = (b, o) => b.readUInt32LE(o);
export const crc32 = (buf) => zlib.crc32(buf) >>> 0;

// يعيد Map(اسم الملف ← Buffer). يرفض الأرشيفات المشفّرة أو الضخمة (حماية من قنبلة الضغط).
export function readZip(buf, { maxTotal = 60 * 1024 * 1024, maxEntries = 400 } = {}) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('الملف ليس أرشيف ZIP/XLSX صالحاً.');
  const n = u16(buf, eocd + 10); let p = u32(buf, eocd + 16);
  if (n > maxEntries) throw new Error('عدد ملفات الأرشيف كبير جداً.');
  const out = new Map(); let total = 0;
  for (let i = 0; i < n; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('أرشيف تالف.');
    const flags = u16(buf, p + 8), method = u16(buf, p + 10), csize = u32(buf, p + 20), usize = u32(buf, p + 24);
    const nl = u16(buf, p + 28), el = u16(buf, p + 30), cl = u16(buf, p + 32), off = u32(buf, p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('الأرشيف مشفّر.');
    total += usize; if (total > maxTotal) throw new Error('حجم الملف بعد فك الضغط كبير جداً.');
    const lnl = u16(buf, off + 26), lel = u16(buf, off + 28), start = off + 30 + lnl + lel;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: maxTotal }));
  }
  return out;
}

// files: [{ name, data: Buffer|string }]
export function writeZip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data), useDeflate = comp.length < data.length, body = useDeflate ? comp : data, crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt32LE(0x58210000, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt32LE(0x58210000, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
