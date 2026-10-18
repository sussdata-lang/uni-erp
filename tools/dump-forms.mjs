import { openDb } from '../server/db.js';
import { sections } from '../server/services/students.js';
import fs from 'node:fs';
const db = openDb(':memory:');
const secs = sections(db).map((s) => ({ title: s.title, fields: s.fields.filter((f) => f.name !== 'status').map((f) => ({ name: f.name, label: f.label, type: f.type, required: !!f.required, hint: f.hint ?? '', def: f.default ?? '', options: f.type === 'program' ? [] : (f.options ?? []).map((o) => (typeof o === 'object' ? o.l : o)), max: f.max ?? null })) }));
const faculties = db.prepare('SELECT name, name_en, code FROM faculties ORDER BY id').all();
fs.writeFileSync('/dev/stdout', JSON.stringify({ secs, faculties }, null, 1));

