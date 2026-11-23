// Builds the public feed Rollcall school pages read: docs/movements/<slug>.json, plus docs/meta.json.
// Counts only. No names, no job numbers, no position titles.
//
// Usage: node build-feed.mjs data/appointments.json matches.json docs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';

const [dbPath = 'data/appointments.json', matchPath = 'matches.json', outDir = 'docs'] = process.argv.slice(2);

const records = Object.values(JSON.parse(readFileSync(dbPath, 'utf8')).records);
const slugByRaw = new Map(JSON.parse(readFileSync(matchPath, 'utf8')).matched.map((m) => [m.raw, m.slug]));

const quarterOf = (isoDate) => {
  const [y, m] = isoDate.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
};

const bySchool = new Map();
let unmatched = 0;
for (const r of records) {
  const slug = slugByRaw.get(r.school_raw);
  if (!slug) { unmatched++; continue; }
  const q = quarterOf(r.first_seen);
  const school = bySchool.get(slug) ?? {};
  const counts = (school[q] ??= { teaching: 0, education_support: 0, leadership: 0, other: 0 });
  counts[r.role_group] = (counts[r.role_group] ?? 0) + 1;
  bySchool.set(slug, school);
}

const dates = records.map((r) => r.first_seen).sort();
const trackingSince = dates[0] ?? null;
const updated = dates.at(-1) ?? null;

mkdirSync(`${outDir}/movements`, { recursive: true });
// Drop files for schools that no longer have data (e.g. after an alias change).
for (const f of readdirSync(`${outDir}/movements`)) if (f.endsWith('.json') && !bySchool.has(f.slice(0, -5))) unlinkSync(`${outDir}/movements/${f}`);

for (const [slug, quarters] of bySchool) {
  writeFileSync(`${outDir}/movements/${slug}.json`, JSON.stringify({ tracking_since: trackingSince, updated, quarters }));
}
writeFileSync(`${outDir}/meta.json`, JSON.stringify({
  tracking_since: trackingSince,
  updated,
  schools_with_data: bySchool.size,
  appointments_recorded: records.length,
  appointments_unmatched: unmatched,
  source: 'Victorian Department of Education, Provisional Appointments list',
}, null, 2));
console.log(`${bySchool.size} school files, ${records.length - unmatched}/${records.length} appointments matched, tracking since ${trackingSince}`);
