// Scrapes the Victorian Department of Education "Provisional Appointments" public list.
// PRIVACY: the "Recommended Applicant" column (index 4) is never read. Names never leave the page.
//
// Usage: node scrape.mjs [out.json]
// Env:   BROWSER_CHANNEL=msedge|chrome (local), or leave unset in CI to use Playwright's Chromium.

import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const URL =
  'https://edupay.eduweb.vic.gov.au/psc/EDUPPRD1_EA/APPLICANT/HRMS/c/DOE_MENU_HRS.DOE_HRS_PROV_APPNT.GBL?Page=DOE_HRS_PROV_APPNT&Action=U';
const OUT = process.argv[2] || 'snapshot.json';
const CHANNEL = process.env.BROWSER_CHANNEL; // e.g. "msedge"
const STALL_MS = 60_000; // the portal sometimes stalls 10-15s; allow generously
const MAX_PAGES = 20; // 100 rows per page -> 2,000 rows ceiling, guards against infinite loops

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page. Columns: 0 job no, 1 school, 2 position, 3 classification,
// 4 recommended applicant (DELIBERATELY SKIPPED), 5 grievance close date.
function readRows() {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const tds = [...tr.children].filter((c) => c.tagName === 'TD');
    if (tds.length !== 6) continue;
    const t = (i) => tds[i].innerText.replace(/\s+/g, ' ').trim();
    if (!/^\d{6,8}$/.test(t(0))) continue;
    out.push({
      job_no: t(0),
      school_raw: t(1),
      position: t(2),
      classification: t(3),
      grievance_close: t(5),
    });
  }
  return out;
}

function readPager() {
  const m = document.body.innerText.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/);
  return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
}

const browser = await chromium.launch({ headless: true, ...(CHANNEL ? { channel: CHANNEL } : {}) });
try {
  const ctx = await browser.newContext({ locale: 'en-AU', timezoneId: 'Australia/Melbourne' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(STALL_MS);

  log('loading list');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[id="DET_HRS_PROV_AP$hviewall$0"]');

  // 10 rows per page by default; "View 100" cuts requests by 10x.
  await page.click('[id="DET_HRS_PROV_AP$hviewall$0"]');
  await page.waitForFunction(() => document.querySelectorAll('tr').length > 60);

  const seen = new Map();
  let total = null;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const pager = await page.evaluate(readPager);
    const rows = await page.evaluate(readRows);
    if (pager) total = pager.total;
    let added = 0;
    for (const r of rows) if (!seen.has(r.job_no)) { seen.set(r.job_no, r); added++; }
    log(`page ${p}: ${rows.length} rows on screen, ${added} new, ${seen.size}/${total ?? '?'} collected`);

    // The pager's own "from-to" text lags behind the grid, so stop on collected count instead.
    if (total === null || seen.size >= total) break;

    const firstBefore = rows[0]?.job_no;
    await page.click('[id="DET_HRS_PROV_AP$hdown$0"]');
    // Wait for the grid to change. Retry-friendly: poll rather than trust one event.
    const t0 = Date.now();
    for (;;) {
      await sleep(250);
      const now = await page.evaluate(readRows);
      if (now[0] && now[0].job_no !== firstBefore) break;
      if (Date.now() - t0 > STALL_MS) throw new Error(`page ${p + 1} never loaded`);
    }
  }

  const rows = [...seen.values()];
  if (total === null) throw new Error('could not read the total from the pager');
  if (rows.length !== total) throw new Error(`expected ${total} rows, collected ${rows.length}`);

  const snapshot = {
    fetched_at: new Date().toISOString(),
    source: 'Victorian Department of Education, Provisional Appointments list',
    total,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  log(`ok: ${rows.length} rows -> ${OUT}`);
} finally {
  await browser.close();
}
