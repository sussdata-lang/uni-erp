// قارئ ملفات SQL: يستخرج جمل INSERT (وأعمدة CREATE TABLE) فقط. لا يُنفَّذ أي SQL إطلاقاً.
const strip = (s) => s.replace(/^[`"[\]]+|[`"[\]]+$/g, '');
const ident = (s) => strip(s.trim().split('.').pop());

function* splitStatements(sql) {
  let cur = '', q = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (q) {
      cur += c;
      if (c === '\\' && q === "'") { cur += n ?? ''; i++; } else if (c === q) { if (n === q) { cur += n; i++; } else q = null; }
      continue;
    }
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '#' && !cur.trim()) { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === ';') { if (cur.trim()) yield cur.trim(); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) yield cur.trim();
}

function parseValues(s, start) {            // يقرأ ( ... ),( ... ) ابتداءً من start
  const rows = []; let i = start;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  for (;;) {
    ws(); if (s[i] !== '(') break; i++; const row = [];
    for (;;) {
      ws(); let v;
      if (s[i] === "'" || s[i] === '"') {
        const q = s[i++]; v = '';
        while (i < s.length) {
          if (s[i] === '\\' && q === "'") { const e = s[i + 1]; v += { n: '\n', r: '\r', t: '\t', 0: '\0' }[e] ?? e; i += 2; continue; }
          if (s[i] === q) { if (s[i + 1] === q) { v += q; i += 2; continue; } i++; break; }
          v += s[i++];
        }
      } else {
        let j = i; while (j < s.length && s[j] !== ',' && s[j] !== ')') j++;
        const raw = s.slice(i, j).trim(); i = j; v = /^null$/i.test(raw) ? null : raw;
      }
      row.push(v); ws();
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
      throw new Error('صيغة VALUES غير مفهومة.');
    }
    rows.push(row); ws(); if (s[i] === ',') { i++; continue; } break;
  }
  return rows;
}

// يعيد { tables: { اسم: { columns, rows: [obj] } } }
export function parseSql(sql, { maxRows = 20000 } = {}) {
  const defs = {}, tables = {}; let total = 0;
  for (const st of splitStatements(String(sql).replace(/^\uFEFF/, ''))) {
    let m = /^create\s+(?:temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(([\s\S]*)\)[^)]*$/i.exec(st);
    if (m) {
      const cols = []; let depth = 0, cur = '';
      for (const ch of m[2] + ',') { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { const t = cur.trim(); if (t && !/^(primary|key|unique|constraint|foreign|index|check|fulltext)\b/i.test(t)) cols.push(ident(t.split(/\s+/)[0])); cur = ''; } else cur += ch; }
      defs[ident(m[1])] = cols; continue;
    }
    m = /^insert\s+(?:or\s+\w+\s+)?(?:ignore\s+)?into\s+([^\s(]+)\s*(\(([^)]*)\))?\s*values\s*/i.exec(st);
    if (!m) continue;
    const table = ident(m[1]), cols = m[3] ? m[3].split(',').map(ident) : defs[table];
    if (!cols) throw new Error(`جملة INSERT للجدول ${table} بلا أسماء أعمدة ولا CREATE TABLE يعرّفها.`);
    const rows = parseValues(st, m[0].length);
    for (const r of rows) {
      if (r.length !== cols.length) throw new Error(`عدد القيم (${r.length}) لا يطابق عدد الأعمدة (${cols.length}) في الجدول ${table}.`);
      if (++total > maxRows) throw new Error(`عدد الصفوف يتجاوز ${maxRows}.`);
      (tables[table] ??= { columns: cols, rows: [] }).rows.push(Object.fromEntries(cols.map((c, i) => [c, r[i] === null ? '' : String(r[i])])));
    }
  }
  return { tables };
}

export function parseCsv(text, { maxRows = 20000 } = {}) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0], delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; if (rows.length > maxRows + 1) throw new Error(`عدد الصفوف يتجاوز ${maxRows}.`); } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
