# Rollcall movements

Daily capture of the Victorian Department of Education's public Provisional Appointments list, published as de-identified counts for [Rollcall](https://www.rollcallvic.com.au/) school pages.

## What is stored
Per appointment: Job No, school, position title, classification, role group, and the date it was first seen.
The Recommended Applicant column is never read, so names are never stored. The public feed under `docs/` holds counts only.

## How it works
`.github/workflows/daily.yml` runs every day:
1. `scraper/scrape.mjs` opens the list in a headless browser and collects all rows.
2. `scraper/ingest.mjs` adds new Job Nos to `data/appointments.json` (one record per Job No).
3. `scraper/match.mjs` matches the Department's shortened school names to Rollcall schools (`data/schools-index.json`, with hand fixes in `data/aliases.json`).
4. `scraper/build-feed.mjs` writes `docs/movements/<school-slug>.json` and `docs/meta.json`.
5. Changes are committed, and GitHub Pages serves `docs/`.

## What the numbers mean
These are provisional appointments published by the Department, not confirmed starts. The date is when this project first saw the entry, not when the person started. History begins on the first capture; there is no backfill.

Source: Victorian Department of Education, Provisional Appointments list. School names: DataVic School Locations 2026 (CC BY 4.0).
