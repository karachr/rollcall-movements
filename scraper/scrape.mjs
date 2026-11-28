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
const ATTEMPTS = 3; // the portal can be briefly unavailable
const RETRY_WAIT_MS = Number(process.env.RETRY_WAIT_MS ?? 5 * 60_000);
const MAX_PAGES = 20; // 100 rows per page -> 2,000 rows ceiling, guards against infinite loops

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e) => e.message.split(/\r?\n/)[0];

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

// Why the list did not appear. Prints no table content: the logs of a public repo are public,
// so page text is only shown when no appointment rows (and therefore no names) are on screen.
async function describePage(page, status) {
  log(`HTTP status: ${status ?? 'no response'}`);
  try {
    log(`page title: ${await page.title()}`);
    if ((await page.evaluate(readRows)).length) return log('appointment rows are on screen, so page text is not logged');
    const text = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300));
    log(`page text: ${text || '(empty)'}`);
  } catch (e) {
    log(`could not inspect the page: ${firstLine(e)}`);
  }
}

async function capture(browser) {
  const ctx = await browser.newContext({ locale: 'en-AU', timezoneId: 'Australia/Melbourne' });
  let page;
  let status;
  try {
    page = await ctx.newPage();
    page.setDefaultTimeout(STALL_MS);

    log('loading list');
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded' });
    status = response?.status();
    await page.waitForSelector('[id="DET_HRS_PROV_AP$hviewall$0"]');

    // 10 rows per page by default; "View 100" cuts requests by 10x.
    const expected = (await page.evaluate(readPager))?.total;
    await page.click('[id="DET_HRS_PROV_AP$hviewall$0"]');
    // Wait for the longer page of rows. Based on the list's own total, so a short list still works.
    const clicked = Date.now();
    while ((await page.evaluate(readRows)).length < Math.min(expected ?? 11, 100)) {
      if (Date.now() - clicked > STALL_MS) throw new Error('"View 100" never loaded');
      await sleep(250);
    }

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
    return { total, rows };
  } catch (e) {
    if (page) await describePage(page, status);
    throw e;
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({ headless: true, ...(CHANNEL ? { channel: CHANNEL } : {}) });
try {
  let result;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await capture(browser);
    } catch (e) {
      log(`attempt ${attempt} of ${ATTEMPTS} failed: ${firstLine(e)}`);
      if (attempt >= ATTEMPTS) throw e;
      log(`waiting ${RETRY_WAIT_MS / 1000}s before trying again`);
      await sleep(RETRY_WAIT_MS);
    }
  }

  const { total, rows } = result;
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
