// Merges a snapshot into the running history, one record per Job No.
// Safe to run repeatedly: a Job No already seen keeps its original first_seen date.
//
// Usage: node ingest.mjs snapshot.json data/appointments.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [snapPath = 'snapshot.json', dbPath = 'data/appointments.json'] = process.argv.slice(2);

// Role groups come from the Department's classification code.
// Prototype mapping, to be confirmed with the site owner:
//   CLASS, CLASS2, LEARN, LEAD, GRD -> teaching   (LEAD = leading teacher, LEARN = learning specialist, GRD = graduate)
//   ES*                              -> education_support
//   AP-*, PR-*                       -> leadership (assistant principal, principal)
export function roleGroup(code) {
  const c = String(code).toUpperCase();
  if (/^ES/.test(c)) return 'education_support';
  if (/^(AP|PR)/.test(c)) return 'leadership';
  if (/^(CLASS|LEARN|LEAD|GRD)/.test(c)) return 'teaching';
  return 'other';
}

// Melbourne calendar date, so a 2am UTC run still lands on the right local day.
const melbDate = (iso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date(iso));

const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const db = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : { records: {} };
const today = melbDate(snap.fetched_at);

let added = 0;
for (const r of snap.rows) {
  if (db.records[r.job_no]) continue;
  db.records[r.job_no] = {
    job_no: r.job_no,
    school_raw: r.school_raw,
    position: r.position,
    classification: r.classification,
    role_group: roleGroup(r.classification),
    first_seen: today,
  };
  added++;
}

mkdirSync(dirname(dbPath), { recursive: true });
writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log(`${snap.rows.length} in snapshot, ${added} new, ${Object.keys(db.records).length} total in history (${today})`);
