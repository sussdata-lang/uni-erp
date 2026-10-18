// كتابة docx عربي (RTL) دون اعتماديات: عناوين، فقرات، جداول، وصور JPEG مضمَّنة.
import { writeZip } from './zip.js';
import { esc } from './xlsx.js';

export function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const rPr = (o = {}) => `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.b ? '<w:b/><w:bCs/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${o.sz ?? 22}"/><w:szCs w:val="${o.sz ?? 22}"/><w:rtl/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr>`;
const para = (text, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}<w:bidi/><w:jc w:val="${o.jc ?? 'left'}"/>${o.after !== undefined ? `<w:spacing w:after="${o.after}"/>` : ''}</w:pPr><w:r>${rPr(o)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const cell = (t, w, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${para(t, { ...o, jc: 'center', after: 0 })}</w:tc>`;
const table = (headers, rows) => {
  const n = headers.length, w = Math.floor(9000 / n), line = (c) => `<w:${c} w:val="single" w:sz="4" w:space="0" w:color="DCE3DD"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:bidiVisual/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(line).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${headers.map(() => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h) => cell(h, w, { b: true, color: 'FFFFFF', fill: '054239', sz: 20 })).join('')}</w:tr>
    ${rows.map((r, i) => `<w:tr>${r.map((v) => cell(v === null || v === undefined ? '—' : String(v), w, { fill: i % 2 ? 'F6F8F5' : undefined, sz: 20 })).join('')}</w:tr>`).join('')}</w:tbl><w:p/>`;
};

// blocks: {t:'title'|'h1'|'p'|'note'} {text} | {t:'table', headers, rows} | {t:'image', data: Buffer(JPEG)}
export function writeDocx(blocks, { title = 'تقرير' } = {}) {
  const media = []; let body = '';
  for (const b of blocks) {
    if (b.t === 'title') body += para(b.text, { style: 'Title', b: true, sz: 40, color: '054239', jc: 'center', after: 120 });
    else if (b.t === 'h1') body += para(b.text, { style: 'Heading1', b: true, sz: 28, color: '054239', after: 120 });
    else if (b.t === 'note') body += para(b.text, { sz: 18, color: '566660', after: 80 });
    else if (b.t === 'p') body += para(b.text);
    else if (b.t === 'table') body += table(b.headers, b.rows);
    else if (b.t === 'image') {
      const sz = jpegSize(b.data); if (!sz) continue;
      media.push(b.data); const id = media.length, cx = 5600000, cy = Math.round((cx * sz.h) / sz.w);
      body += `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="chart${id}" descr="${esc(b.alt ?? 'مخطط')}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="chart${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>الجامعة السورية للعلوم الأمنية</dc:creator></cp:coreProperties>` },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((_, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.jpg"/>`).join('')}</Relationships>` },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1300" w:bottom="1000" w:left="1300" w:header="500" w:footer="500" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>` },
    ...media.map((m, i) => ({ name: `word/media/image${i + 1}.jpg`, data: m })),
  ];
  return writeZip(files);
}
