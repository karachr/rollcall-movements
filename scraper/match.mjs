// Matches the Department's truncated school names (30 chars, abbreviated) to Rollcall's school list.
// Usage: node match.mjs data/appointments.json path/to/schools.json [matches-out.json]
//
// Rule: after expanding the Department's abbreviations ("Sec" -> "Secondary", "Sth" -> "South")
// and ignoring spacing and punctuation, short names must equal a Rollcall name. Names that fill
// the 30-character field were cut off, so they may be the start of a longer name.
// Exactly one government school must fit, otherwise the row is reported, never guessed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [dbPath = 'data/appointments.json', schoolsPath, outPath] = process.argv.slice(2);
if (!schoolsPath) { console.error('usage: node match.mjs appointments.json schools.json [out.json]'); process.exit(2); }

// Abbreviations the Department uses in its 30-character school field.
const ABBR = { sec: 'secondary', coll: 'college', sch: 'school', schl: 'school', sth: 'south', nth: 'north', dist: 'district', seniors: 'senior' };
const words = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/\b([pk])-(\d)/g, '$1$2').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => ABBR[w] || w);
// Spaces removed, so "La Trobe" and "LaTrobe" compare equal.
const compact = (s) => words(s).join('');

const db = JSON.parse(readFileSync(dbPath, 'utf8')).records;
const schools = JSON.parse(readFileSync(schoolsPath, 'utf8')).schools
  .filter((s) => s.sec === 'Government' && s.open)
  .map((s) => ({ ...s, c: compact(s.name) }));

// Hand-made fixes for names the rule can't resolve: { "Dept name": "rollcall-slug" }.
const aliases = existsSync('data/aliases.json') ? JSON.parse(readFileSync('data/aliases.json', 'utf8')) : {};

function candidates(raw) {
  if (aliases[raw]) return schools.filter((s) => s.slug === aliases[raw]);
  const rc = compact(raw);
  const truncated = raw.length >= 28; // the field holds 30 characters; allow for trailing spaces
  return schools.filter((s) => (truncated ? s.c.startsWith(rc) : s.c === rc));
}

const cache = new Map();
const result = { matched: [], ambiguous: [], unmatched: [] };
for (const r of Object.values(db)) {
  if (!cache.has(r.school_raw)) cache.set(r.school_raw, candidates(r.school_raw));
}
for (const [raw, c] of cache) {
  if (c.length === 1) result.matched.push({ raw, school_no: c[0].no, slug: c[0].slug, name: c[0].name });
  else if (c.length > 1) result.ambiguous.push({ raw, options: c.map((x) => `${x.name}, ${x.town}`) });
  else result.unmatched.push(raw);
}

const rows = Object.values(db);
const okRaw = new Set(result.matched.map((m) => m.raw));
console.log(`${cache.size} distinct names: ${result.matched.length} matched, ${result.ambiguous.length} ambiguous, ${result.unmatched.length} unmatched`);
console.log(`rows covered: ${rows.filter((r) => okRaw.has(r.school_raw)).length}/${rows.length}`);
if (result.ambiguous.length) console.log('\nAMBIGUOUS:\n' + result.ambiguous.map((a) => `  ${a.raw}  ->  ${a.options.join(' | ')}`).join('\n'));
if (result.unmatched.length) console.log('\nUNMATCHED:\n  ' + result.unmatched.join('\n  '));
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2));
