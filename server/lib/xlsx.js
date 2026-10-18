// قراءة وكتابة xlsx دون اعتماديات. القراءة: نصوص مشتركة/مضمّنة، أرقام، تواريخ (من أنماط الخلايا). الكتابة: أوراق بعناوين منسّقة، RTL، عرض أعمدة.
import { readZip, writeZip } from './zip.js';

const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
});
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const text = (xml) => { let o = ''; for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) o += decode(m[1]); return o; };
const colIdx = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const iso = (serial) => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);

function dateStyles(styles) {
  if (!styles) return new Set();
  const custom = new Map(); for (const m of styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decode(m[2]));
  const isDate = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[ymd]/i.test(custom.get(id).replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles); const set = new Set(); let i = 0;
  if (xfs) for (const m of xfs[1].matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)) { if (isDate(Number(m[1]))) set.add(i); i++; }
  return set;
}

// يعيد { sheets: [{ name, rows: string[][] }] } — كل القيم نصوص (التواريخ بصيغة YYYY-MM-DD)
export function readXlsx(buf) {
  const z = readZip(buf), get = (n) => z.get(n)?.toString('utf8');
  const wb = get('xl/workbook.xml'); if (!wb) throw new Error('الملف ليس مصنّف Excel (xlsx) صالحاً.');
  const rels = new Map([...(get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sst = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  const dates = dateStyles(get('xl/styles.xml')), sheets = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]), state = /state="([^"]+)"/.exec(m[0])?.[1], rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    if (state === 'hidden' || state === 'veryHidden') continue;
    let target = rels.get(rid) ?? ''; target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = get(target); if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ri = Number(/r="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1, row = []; let cn = 0;
      for (const c of (r[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], ref = /\sr="([A-Z]+\d+)"|^r="([A-Z]+\d+)"/.exec(attrs), ci = ref ? colIdx(ref[1] ?? ref[2]) : cn; cn = ci + 1;
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1], s = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0), body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]; let val = '';
        if (t === 's') val = sst[Number(v)] ?? '';
        else if (t === 'inlineStr') val = text(body);
        else if (t === 'str' || t === 'e') val = v === undefined ? '' : decode(v);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) val = dates.has(s) && Number(v) > 0 ? iso(Number(v)) : (Number.isInteger(Number(v)) || /e/i.test(v) ? String(Number(v)) : v);
        row[ci] = val;
      }
      while (rows.length < ri) rows.push([]);
      rows[ri] = Array.from(row, (x) => x ?? "");
    }
    sheets.push({ name, rows });
  }
  return { sheets };
}

// sheets: [{ name, rows: any[][], widths?: number[], header?: boolean, rtl?: boolean, textCols?: number[] }]
export function writeXlsx(sheets, { title = 'تقرير' } = {}) {
  const files = [];
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF054239"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF054239"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFDCE3DD"/></left><right style="thin"><color rgb="FFDCE3DD"/></right><top style="thin"><color rgb="FFDCE3DD"/></top><bottom style="thin"><color rgb="FFDCE3DD"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs></styleSheet>`;
  sheets.forEach((sh, si) => {
    const widths = sh.widths ?? [], cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = sh.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colName(ci)}${ri + 1}`, hdr = sh.header !== false && ri === 0, st = hdr ? 1 : (sh.textCols?.includes(ci) ? 2 : 3);
      return typeof v === 'number' && Number.isFinite(v) && !sh.textCols?.includes(ci) ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const freeze = sh.header !== false ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh.rtl === false ? '' : ' rightToLeft="1"'}${si === 0 ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${rows}</sheetData></worksheet>` });
  });
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' });
  files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>الجامعة السورية للعلوم الأمنية</dc:creator></cp:coreProperties>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: styles });
  return writeZip(files);
}
