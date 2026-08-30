#!/usr/bin/env node
/**
 * EVERY WEB EVENT MUST NAME ITS VARIANT — as a USER property, not only an event property.
 *
 * The portfolio's per-variant dashboards, and every cohort and retention query built on them,
 * segment on `gp:app_variant` — the USER property kamo-app/analytics.js sets with Identify()
 * at init. Until 2026-08-15 the web emitters wrote `app_variant` into event_properties only,
 * so a browser user carried the value on their events and nothing on themselves.
 *
 * That is the worst shape a measurement bug can have: nothing looks broken. The reports keep
 * rendering, the funnels keep resolving, and they quietly answer a narrower question than the
 * one being asked. New-user retention on the KAMO segment returned 2,390 users over 14 days
 * while the same window grouped by the EVENT property showed 5,627 uniques on 2026-08-14 by
 * itself — 97% of KAMO is a plain browser, and none of it was in the segment.
 *
 * It cannot be caught by reading either file. kamo-app/analytics.js is correct on its own, and
 * chWebTrack looked correct too — it even carried a comment claiming it "matches the user
 * property the native SDK sets". Only the wire tells the truth, so this test reads the wire.
 *
 * TWO EMITTERS, and they are separate on purpose:
 *   1. chWebTrack — the funnel. Everything the page tracks in a browser, plus every WEB_ONLY
 *      name from inside the wrapper.
 *   2. the boot-crash beacon — a classic script above the module, which duplicates the key and
 *      the device-id read so it survives a module that never ran. It duplicates this too, and
 *      a fix applied to one emitter and not the other leaves crashes unattributed.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-variantprop-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the variant-property test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

/* Open the real page and return every event body that reached Amplitude.
 *
 * The ingest call is FULFILLED with the API's success shape rather than aborted: chWebTrack
 * logs a warning on a non-ok response, and a test that made every post fail would be asserting
 * against a page in a state no user is ever in. Nothing leaves the machine either way — the
 * route handler answers it locally. */
async function capture(boom) {
  const server = createServer((rq, rs) => {
    const p = decodeURIComponent(rq.url.split('?')[0]);
    /* Real files for everything but the document: the page loads its script as a module, and a
       server answering text/html to every path makes the browser refuse it under strict MIME
       checking — the module then never runs and no event is ever sent, which would read here
       as "the property is missing" instead of "the page did not boot". */
    if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(real); }
    try {
      const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
      rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
      rs.end(b);
    } catch { rs.writeHead(404); rs.end('x'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  const sent = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return route.continue();
    if (u.includes('amplitude.com')) {
      try {
        const body = JSON.parse(route.request().postData() || '{}');
        for (const e of body.events || []) sent.push(e);
      } catch { /* a body this test cannot read is a failure the assertions below will report */ }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
    }
    return route.abort();
  });

  await page.goto(`${origin}/`, { waitUntil: 'load' });
  /* An uncaught throw from a timeout reaches the window 'error' listener the beacon registers
     in capture phase — the same path a real top-level module crash takes. */
  if (boom) await page.evaluate(() => { setTimeout(() => { throw new Error('kamo-variantprop-test-boom'); }, 0); });
  await page.waitForTimeout(1500);
  await page.close(); server.close();
  return sent;
}

console.log('\nEVERY WEB EVENT NAMES ITS VARIANT');

/* ---- 1. the funnel (chWebTrack) ---- */
{
  const sent = await capture(false);
  const funnel = sent.filter((e) => e.event_type !== 'web_error' && e.event_type !== 'resource_error');
  if (!funnel.length) {
    bad('the page sent Amplitude nothing at all on a plain browser load — the whole web funnel is dark, and nothing below can be judged');
  } else {
    ok(`the browser reported ${funnel.length} event(s): ${[...new Set(funnel.map((e) => e.event_type))].join(', ')}`);

    const orphans = funnel.filter((e) => !e.user_properties || e.user_properties.app_variant !== 'kamo');
    orphans.length === 0
      ? ok('every one carries user_properties.app_variant="kamo" — the browser lands in the gp:app_variant segment the dashboards read')
      : bad(`${orphans.length} of ${funnel.length} carry no user-level app_variant (${[...new Set(orphans.map((e) => e.event_type))].join(', ')}) — those users are invisible in every per-variant report`);

    /* The event property stays. It is the ONLY way to read the window that predates the user
       property, because Amplitude denormalizes user properties onto each event at ingest and
       never backfills — deleting it would make the old data unreadable to close the gap. */
    const noEvt = funnel.filter((e) => !e.event_properties || e.event_properties.app_variant !== 'kamo');
    noEvt.length === 0
      ? ok('the event property is still there too, so windows predating the fix stay readable')
      : bad(`${noEvt.length} event(s) dropped the event-level app_variant — every report built on the old data breaks`);

    const noHost = funnel.filter((e) => !e.event_properties || !e.event_properties.host);
    noHost.length === 0
      ? ok('`host` still splits app from browser on every event')
      : bad(`${noHost.length} event(s) lost \`host\` — app and browser collapse into one population again`);
  }
}

/* ---- 2. the boot-crash beacon ---- */
{
  const sent = await capture(true);
  const errs = sent.filter((e) => e.event_type === 'web_error');
  if (!errs.length) {
    bad('a thrown error produced no web_error — the boot-crash beacon is not listening, and a black screen would again be indistinguishable from churn');
  } else {
    errs.every((e) => e.user_properties && e.user_properties.app_variant === 'kamo')
      ? ok('web_error carries user_properties.app_variant="kamo" — a boot crash is findable in the variant dashboards')
      : bad('web_error carries no user-level app_variant — crashes land in the project unattributed, absent from every per-variant report');
    errs.every((e) => e.event_properties && e.event_properties.app_variant === 'kamo')
      ? ok('web_error names the variant on the event too')
      : bad('web_error carries no event-level app_variant either — there is no fallback breakdown to reach for');
  }
}

await browser.close();
console.log(failed ? `\n✗ ${failed} failed\n` : '\n✓ the web names its variant on both emitters\n');
process.exit(failed ? 1 : 0);
