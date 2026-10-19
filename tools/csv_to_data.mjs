#!/usr/bin/env node
// نسخة Node من tools/csv_to_data.py (للأجهزة التي ليس عليها Python). تُخرج الملف نفسه js/data.js
//
// الاستخدام:
//     node tools/csv_to_data.mjs                      # يقرأ tools/words.csv
//     node tools/csv_to_data.mjs ملف.csv [خرج.js]     # ملف آخر / مسار خرج آخر
//     --all-grades   لتضمين كل الصفوف (للاختبار)
//     --sample       لوسم البيانات بأنها أمثلة تجريبية (للاختبار)
// الأعمدة: grade, unit, unit_title, word, meaning, sentence, sentence_ar, page, form, order
// order (اختياري): يرتّب التطبيق الوحدات برقمها (الرقم في المعرّف)؛ ضع هنا رقمًا آخر لتقديم وحدة أو تأخيرها
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRADES = [
  ['t1', 'تأسيس — المستوى الأول', 'تأسيس 1'],
  ['g3', 'الثالث الابتدائي', '3 ابتدائي'],
  ['g4', 'الرابع الابتدائي', '4 ابتدائي'],
  ['g5', 'الخامس الابتدائي', '5 ابتدائي'],
  ['g6', 'السادس الابتدائي', '6 ابتدائي'],
  ['m1', 'الأول المتوسط', '1 متوسط'],
  ['m2', 'الثاني المتوسط', '2 متوسط'],
  ['m3', 'الثالث المتوسط', '3 متوسط']
];
// الصفوف التي يدرّسها المعلم الآن. غيّر هذه القائمة لإضافة صف جديد.
const ACTIVE = ['t1', 'g5', 'g6', 'm2'];
const ALIASES = {};
for (const [gid, name, short] of GRADES) {
  for (const key of [gid, name, short, name.replace('ال', '')]) ALIASES[key.trim().toLowerCase()] = gid;
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findForm = (sentence, target) =>
  new RegExp('(^|[^A-Za-z])' + escRe(target) + '(?![A-Za-z])', 'i').test(sentence);

// قارئ CSV يدعم الحقول المقتبسة والفواصل وأسطرًا جديدة داخل الحقول
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function main(csvPath, outPath, allGrades, sample) {
  const active = GRADES.filter(g => allGrades || ACTIVE.includes(g[0]));
  const out = {};
  for (const [gid, name, short] of active) out[gid] = { id: gid, name, short, units: [] };
  const warnings = [];
  let count = 0;

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const head = rows[0].map(h => h.trim());
  rows.slice(1).forEach((cells, i) => {
    const n = i + 2;
    const row = {};
    head.forEach((h, k) => { if (h) row[h] = (cells[k] || '').trim(); });
    if (!row.word) return;
    const gid = ALIASES[(row.grade || '').toLowerCase()];
    if (!gid) { warnings.push(`سطر ${n}: الصف غير معروف (${JSON.stringify(row.grade)})`); return; }
    if (!out[gid]) { warnings.push(`سطر ${n}: الصف ${gid} غير مفعّل ويُتجاهل (راجع ACTIVE في الأداة)`); return; }
    const unitKey = row.unit || '1';
    const uid = 'u' + unitKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const units = out[gid].units;
    let unit = units.find(u => u.id === uid);
    if (!unit) { unit = { id: uid, title: row.unit_title || `Unit ${unitKey}`, words: [] }; units.push(unit); }
    // order (اختياري): رقم ترتيب الوحدة في التطبيق، لتأخير وحدة عن رقمها الطبيعي
    if (row.order && unit.num === undefined) unit.num = Number(row.order);
    const word = { en: row.word, ar: row.meaning || '' };
    if (row.sentence) {
      word.sentence = row.sentence;
      const needle = row.form || row.word;
      if (!findForm(row.sentence, needle)) warnings.push(`سطر ${n}: الكلمة (${needle}) غير موجودة في الجملة -> أضف عمود form`);
    }
    for (const [src, dst] of [['sentence_ar', 'sentenceAr'], ['page', 'page'], ['form', 'form']]) {
      if (row[src]) word[dst] = row[src];
    }
    if (!word.ar) warnings.push(`سطر ${n}: لا يوجد معنى للكلمة (${word.en})`);
    unit.words.push(word);
    count++;
  });

  // version يتغير مع كل توليد، فيعرف التطبيق أن هناك كلمات أحدث من النسخة المحفوظة على الجهاز
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  const version = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const data = { version, grades: active.map(g => out[g[0]]) };
  if (sample) data.sample = true;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = outPath || path.join(here, '..', 'js', 'data.js');
  fs.writeFileSync(target, '// ملف مُولَّد تلقائيًا بواسطة tools/csv_to_data.py — لا تعدّله يدويًا\nwindow.CURRICULUM = ' + JSON.stringify(data, null, 1) + ';\n', 'utf8');
  const unitsN = data.grades.reduce((a, g) => a + g.units.length, 0);
  console.log(`تم: ${count} كلمة في ${unitsN} وحدة -> ${path.resolve(target)}`);
  warnings.forEach(w => console.log('تنبيه:', w));
}

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const pos = args.filter(a => !a.startsWith('--'));
if (pos.length > 2 || flags.some(f => !['--all-grades', '--sample'].includes(f))) {
  console.error('الاستخدام: node tools/csv_to_data.mjs [ملف.csv] [خرج.js] [--all-grades] [--sample]');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
main(pos[0] || path.join(here, 'words.csv'), pos[1], flags.includes('--all-grades'), flags.includes('--sample'));
