// مولّد PDF بنية PDF/A-2b: خطوط مضمَّنة (Identity-H + ToUnicode)، بيانات XMP، OutputIntent (sRGB)، بلا تشفير ولا جافاسكربت،
// وحقل توقيع رقمي (ByteRange/Contents) يُملأ لاحقاً. لا اعتماديات.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { visualCodes } from './arabic.js';

const A = new URL('../assets/', import.meta.url), asset = (n) => fs.readFileSync(new URL(n, A));
const META = JSON.parse(asset('cert-fonts.json').toString('utf8'));
const FONT_FILES = { regular: asset('cert-regular.ttf'), bold: asset('cert-bold.ttf') };
for (const k of ['cairo-regular', 'cairo-bold', 'amiri-regular', 'amiri-bold', 'messiri-bold']) FONT_FILES[k] = asset(`cert-${k}.ttf`);
// عائلات الخطوط: dejavu للوثائق العامة، وcairo/amiri لكشف العلامات بما يطابق الشاشة (العناوين الكبيرة في amiri بخط المسيري)
const FAMS = { dejavu: { regular: 'regular', bold: 'bold' }, cairo: { regular: 'cairo-regular', bold: 'cairo-bold' }, amiri: { regular: 'amiri-regular', bold: 'amiri-bold', title: 'messiri-bold' } };
const BASENAME = { regular: 'DejaVuSans', bold: 'DejaVuSans-Bold', 'cairo-regular': 'Cairo-Regular', 'cairo-bold': 'Cairo-Bold', 'amiri-regular': 'Amiri-Regular', 'amiri-bold': 'Amiri-Bold', 'messiri-bold': 'ElMessiri-Bold' };
let FAM = 'dejavu';
const logical = (font, size) => (font === 'bold' && size >= 17 && FAMS[FAM].title ? 'title' : font);
const phys = (font, size) => FAMS[FAM][logical(font, size)];
export const SIG_BYTES = 12288;                                           // سعة توقيع CMS (12 كيلوبايت) تتسع لشهادة وسلسلة وختم زمني

const f2 = (n) => (Math.round(n * 100) / 100).toString();
const hex16 = (n) => n.toString(16).padStart(4, '0');
const pdfDate = (d) => `D:${d.toISOString().slice(0, 19).replace(/[-:T]/g, '')}+00'00'`;
const xmpDate = (d) => d.toISOString().slice(0, 19) + '+00:00';
const utf16 = (s) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex')}>`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function textWidth(str, fontKey, size) {
  const m = META[phys(fontKey, size)]; let w = 0;
  for (const c of visualCodes(str)) w += (m.widths[m.cmap[c] ?? 0] ?? 0);
  return (w / m.upem) * size;
}
const glyphHex = (str, fontKey, size) => { const m = META[phys(fontKey, size)]; return visualCodes(str).map((c) => hex16(m.cmap[c] ?? 0)).join(''); };

function toUnicodeCMap(fontKey) {
  const m = META[fontKey], pairs = [];
  for (const [cp, gid] of Object.entries(m.cmap)) { const u = String.fromCodePoint(Number(cp)).normalize('NFKC'); pairs.push([gid, [...u].map((ch) => hex16(ch.codePointAt(0))).join('')]); }
  pairs.sort((a, b) => a[0] - b[0]);
  const chunks = []; for (let i = 0; i < pairs.length; i += 100) chunks.push(`${Math.min(100, pairs.length - i)} beginbfchar\n${pairs.slice(i, i + 100).map(([g, u]) => `<${hex16(g)}> <${u}>`).join('\n')}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
}

// page: دالة ترسم المحتوى عبر كائن draw. opts: { title, author, subject, created, qr: {size, modules}, signer: {name, reason, location} }
export function buildPdf(opts, paint) {
  FAM = FAMS[opts.family] ? opts.family : 'dejavu';
  const objs = []; const reserve = () => objs.push(null) && objs.length;                 // أرقام الكائنات تبدأ من 1
  const set = (n, buf) => { objs[n - 1] = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1'); };
  const stream = (dict, data, { compress = true } = {}) => { const body = compress ? zlib.deflateSync(data) : data; return Buffer.concat([Buffer.from(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')]); };

  const catalog = reserve(), pages = reserve(), page = reserve(), content = reserve(), info = reserve(), xmp = reserve(), icc = reserve(), intent = reserve(), widget = reserve(), sigObj = reserve(), ap = reserve(), img = reserve();
  const fonts = {}; let fi = 0;
  for (const [key, pk] of Object.entries(FAMS[FAM])) {
    const type0 = reserve(), cid = reserve(), desc = reserve(), file = reserve(), tou = reserve(), tag = `AAAA${String.fromCharCode(65 + Object.keys(FAMS[FAM]).indexOf(key))}${String.fromCharCode(65 + Object.keys(FAMS[FAM]).indexOf(key))}`, base = `${tag}+${BASENAME[pk]}`, m = META[pk];
    const W = Array.from({ length: m.numGlyphs }, (_, i) => Math.round(((m.widths[i] ?? 0) * 1000) / m.upem)).join(' ');
    set(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tou} 0 R >>`);
    set(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 600 /W [0 [${W}]] >>`);
    const sc = 1000 / m.upem;
    set(desc, `<< /Type /FontDescriptor /FontName /${base} /Flags 4 /FontBBox [${m.bbox.map((v) => Math.round(v * sc)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(m.ascent * sc)} /Descent ${Math.round(m.descent * sc)} /CapHeight ${Math.round(m.capHeight * sc)} /StemV ${pk.includes('bold') ? 140 : 80} /FontFile2 ${file} 0 R >>`);
    set(file, stream(`/Length1 ${FONT_FILES[pk].length}`, FONT_FILES[pk]));
    set(tou, stream('', Buffer.from(toUnicodeCMap(pk), 'latin1')));
    fonts[key] = { name: `F${++fi}`, ref: type0 };
  }

  // محتوى الصفحة
  const allOps = [[]], alphas = new Map(); let ops = allOps[0];
  const gs = (a) => { if (!alphas.has(a)) alphas.set(a, `GS${alphas.size + 1}`); return alphas.get(a); };
  const draw = {
    newPage: () => { ops = []; allOps.push(ops); },
    lw: (w) => ops.push(`${f2(w)} w`),
    poly: (pts, mode = 'f') => ops.push(`${pts.map(([x, y], i) => `${f2(x)} ${f2(y)} ${i ? 'l' : 'm'}`).join(' ')} h ${mode}`),
    circle: (cx, cy, r, mode = 'f') => { const k = 0.5523 * r; ops.push(`${f2(cx + r)} ${f2(cy)} m ${f2(cx + r)} ${f2(cy + k)} ${f2(cx + k)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} c ${f2(cx - k)} ${f2(cy + r)} ${f2(cx - r)} ${f2(cy + k)} ${f2(cx - r)} ${f2(cy)} c ${f2(cx - r)} ${f2(cy - k)} ${f2(cx - k)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)} c ${f2(cx + k)} ${f2(cy - r)} ${f2(cx + r)} ${f2(cy - k)} ${f2(cx + r)} ${f2(cy)} c h ${mode}`); },
    pageCount: () => allOps.length,
    fill: (hexColor) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16) / 255); ops.push(`${f2(r)} ${f2(g)} ${f2(b)} rg`); },
    stroke: (hexColor) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16) / 255); ops.push(`${f2(r)} ${f2(g)} ${f2(b)} RG`); },
    rect: (x, y, w, h, mode = 'f') => ops.push(`${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re ${mode}`),
    line: (x1, y1, x2, y2, w = 1) => ops.push(`${f2(w)} w ${f2(x1)} ${f2(y1)} m ${f2(x2)} ${f2(y2)} l S`),
    // align: 'right' → x هو الحافة اليمنى، 'left' → اليسرى، 'center'
    text: (str, { x, y, size = 12, font = 'regular', color = '#10211D', align = 'right' }) => {
      if (!str) return; const lf = logical(font, size), w = textWidth(str, font, size), sx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      draw.fill(color); ops.push(`BT /${fonts[lf].name} ${f2(size)} Tf ${f2(sx)} ${f2(y)} Td <${glyphHex(str, font, size)}> Tj ET`);
    },
    image: (x, y, w, h, o = {}) => ops.push(`q ${o.alpha ? `/${gs(o.alpha)} gs ` : ''}${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(y)} cm /Im1 Do Q`),
    qr: (qr, x, y, size) => {
      const q = 2, total = qr.size + q * 2, u = size / total; ops.push('q 1 1 1 rg'); ops.push(`${f2(x)} ${f2(y)} ${f2(size)} ${f2(size)} re f`); ops.push('0 0 0 rg');
      for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) ops.push(`${f2(x + (c + q) * u)} ${f2(y + size - (r + q + 1) * u)} ${f2(u)} ${f2(u)} re`);
      ops.push('f Q');
    },
  };
  paint(draw);
  set(content, stream('', Buffer.from(allOps[0].join('\n'), 'latin1')));
  const extra = allOps.slice(1).map((o) => { const c = reserve(), pg = reserve(); set(c, stream('', Buffer.from(o.join('\n'), 'latin1'))); return { c, pg }; });

  // الشعار بخلفية شفافة: RGB مضغوط + قناع ألفا (SMask)، فيظهر فوق الألوان الداكنة بلا إطار أبيض
  const crestA = reserve(), flate = (n, extra, data) => Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 400 /Height 480 ${extra} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
  set(crestA, flate(crestA, '/ColorSpace /DeviceGray /BitsPerComponent 8', asset('crest.alpha.z')));
  set(img, flate(img, `/ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${crestA} 0 R`, asset('crest.rgb.z')));
  set(icc, stream('/N 3', asset('srgb.icc')));
  set(intent, `<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB) /RegistryName (http://www.color.org) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${icc} 0 R >>`);

  const created = opts.created, id = crypto.randomBytes(16).toString('hex').toUpperCase();
  const xml = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(opts.title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${esc(opts.author)}</rdf:li></rdf:Seq></dc:creator><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(opts.subject)}</rdf:li></rdf:Alt></dc:description></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${esc(opts.producer)}</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>${esc(opts.producer)}</xmp:CreatorTool><xmp:CreateDate>${xmpDate(created)}</xmp:CreateDate><xmp:ModifyDate>${xmpDate(created)}</xmp:ModifyDate></rdf:Description>
</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
  set(xmp, stream('/Type /Metadata /Subtype /XML', Buffer.from(xml, 'utf8'), { compress: false }));
  set(info, `<< /Title ${utf16(opts.title)} /Author ${utf16(opts.author)} /Subject ${utf16(opts.subject)} /Producer ${utf16(opts.producer)} /Creator ${utf16(opts.producer)} /CreationDate (${pdfDate(created)}) /ModDate (${pdfDate(created)}) >>`);

  set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R /Metadata ${xmp} 0 R /OutputIntents [${intent} 0 R] /AcroForm << /Fields [${widget} 0 R] /SigFlags 3 >> /Lang (ar) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  set(pages, `<< /Type /Pages /Kids [${[page, ...extra.map((e) => e.pg)].map((n) => `${n} 0 R`).join(' ')}] /Count ${1 + extra.length} >>`);
  const res = `/Resources << /Font << ${Object.values(fonts).map((f) => `/${f.name} ${f.ref} 0 R`).join(' ')} >> /XObject << /Im1 ${img} 0 R >>${alphas.size ? ` /ExtGState << ${[...alphas].map(([a, n]) => `/${n} << /ca ${a} /CA ${a} >>`).join(' ')} >>` : ''} >>`;
  set(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595.28 841.89] ${res} /Contents ${content} 0 R /Annots [${widget} 0 R] >>`);
  for (const e of extra) set(e.pg, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595.28 841.89] ${res} /Contents ${e.c} 0 R >>`);
  set(widget, `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /F 132 /P ${page} 0 R /V ${sigObj} 0 R /AP << /N ${ap} 0 R >> >>`);
  set(ap, stream('/Type /XObject /Subtype /Form /BBox [0 0 0 0]', Buffer.alloc(0), { compress: false }));
  const BR = '/ByteRange [0 0000000000 0000000000 0000000000]', placeholder = '0'.repeat(SIG_BYTES * 2);
  set(sigObj, `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${BR} /Contents <${placeholder}> /M (${pdfDate(created)}) /Name ${utf16(opts.signer.name)} /Reason ${utf16(opts.signer.reason)} /Location ${utf16(opts.signer.location)} >>`);

  // تجميع الملف + جدول المراجع
  const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offsets = []; let pos = parts[0].length;
  objs.forEach((o, i) => { offsets.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]); parts.push(b); pos += b.length; });
  const xrefPos = pos;
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

// خطوتان: prepareSigning يملأ ByteRange ويعيد البصمة التي تُوقَّع، ثم finish(cms) يضع التوقيع في مكانه المحجوز.
export function prepareSigning(pdf) {
  const text = pdf.toString('latin1'), brIdx = text.indexOf('/ByteRange ['), cIdx = text.indexOf('/Contents <', brIdx), cStart = cIdx + '/Contents '.length, cEnd = text.indexOf('>', cStart) + 1;
  const range = [0, cStart, cEnd, pdf.length - cEnd], br = `/ByteRange [${range[0]} ${String(range[1]).padStart(10, ' ')} ${String(range[2]).padStart(10, ' ')} ${String(range[3]).padStart(10, ' ')}]`;
  const out = Buffer.from(pdf); out.write(br.padEnd('/ByteRange [0 0000000000 0000000000 0000000000]'.length, ' '), brIdx, 'latin1');
  const digest = crypto.createHash('sha256').update(Buffer.concat([out.subarray(0, cStart), out.subarray(cEnd)])).digest();
  return { digest, finish(cms) {
    if (cms.length > SIG_BYTES) throw new Error('توقيع CMS أكبر من السعة المحجوزة.');
    const done = Buffer.from(out); done.write(`<${cms.toString('hex').toUpperCase().padEnd(SIG_BYTES * 2, '0')}>`, cStart, 'latin1'); return done;
  } };
}
