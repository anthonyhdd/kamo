#!/usr/bin/env node
/**
 * THE PAYWALL MUST NOT PROMISE A TRIAL THE STORE WILL NOT HONOUR.
 *
 * App Review rejected 1.0.9 (42) on guideline 2.1(b), reviewing on an iPad Air M3:
 *
 *   "we have noticed a discrepancy between the promotional offer displayed on the paywall
 *    and the actual payment dialog. The paywall indicates a 3-day free trial, but the
 *    payment dialog shows no trial period."
 *
 * They were right, and it was a web bug. `trialOn()` is a rollout flag — true for everyone
 * at TRIAL.rollout 100, regardless of what StoreKit returns — so anyone Apple considers
 * ineligible (a reinstall, someone who already consumed the introductory offer for this
 * subscription group, or a reviewer's recycled sandbox account) was shown "3 days free",
 * tapped a button reading Try free, and met a sheet quoting the full weekly price.
 *
 * THE THREE CASES, and the third is the one that makes this dangerous to get wrong:
 *
 *   1. Build reports a trial, store served one   → say so.
 *   2. Build reports, store served NONE          → say nothing. This is the rejection.
 *   3. Build CANNOT report (1.0.2)               → say so anyway.
 *
 * Case 3 is not a compromise, it is the whole safety property. 1.0.2 is 99.7% of the live
 * fleet and never sets `prices.trial`, so on those devices absence means "not implemented",
 * not "no trial". Gating them on it would erase the trial wording for the entire production
 * population — including the 22 people who have started a trial since 3 August, for whom
 * the offer demonstrably works. A test that only checked cases 1 and 2 would pass while
 * silently destroying the funnel it was written to protect.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-trial-copy-dom.mjs
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
  console.log('· playwright-core not installed — skipping the trial-copy test — run: ' + PW_SETUP);
  process.exit(0);
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const { globSync } = await import('node:fs');
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* Drive the real entry points the wrapper uses — setNativeCaps then setPrices — rather than
   reaching into module state, so this exercises the same path a device does. */
async function paywallCopy(caps, prices) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.KAMO && window.KAMO.setPrices, { timeout: 5000 });
  await page.evaluate(([c, p]) => {
    window.KAMO.setNativeCaps(c);
    window.KAMO.setPrices(p);
  }, [caps, prices]);
  await page.waitForTimeout(150);
  const out = await page.evaluate(() => {
    const badge = document.getElementById('pwFreeBadge');
    const buy = document.getElementById('pwBuy');
    const terms = document.getElementById('pwTerms');
    return {
      badgeShown: !!(badge && getComputedStyle(badge).display !== 'none'),
      buy: buy ? buy.textContent.trim() : null,
      terms: terms ? terms.textContent.trim() : null,
    };
  });
  await page.close();
  return out;
}

const CAPS_109 = { revealVideo: true, torch: true, invite: true, settings: true, eventsV2: true };
const CAPS_102 = { revealVideo: true, torch: true };           // exactly what 1.0.2 sends
const PRICES = { weekly: '$2.99', lifetime: '$14.99' };

console.log('\nTHE PAYWALL ONLY PROMISES WHAT THE STORE WILL HONOUR');

/* 1 — the happy path must be untouched. */
{
  const r = await paywallCopy(CAPS_109, { ...PRICES, trial: '3 days' });
  r.badgeShown ? ok('store served a trial → the badge is shown') : bad('store served a trial but the badge is hidden — the funnel is broken');
  /^Try .*free$/i.test(r.buy || '') ? ok(`CTA offers the trial ("${r.buy}")`) : bad(`CTA reads ${JSON.stringify(r.buy)}`);
  /free, then/i.test(r.terms || '') ? ok('terms state the trial and what it renews into') : bad(`terms read ${JSON.stringify(r.terms)}`);
}

/* 2 — THE REJECTION. Build reports, store returned no introductory offer. */
{
  const r = await paywallCopy(CAPS_109, PRICES);
  !r.badgeShown ? ok('store served NO trial → the badge is gone') : bad('store served no trial and the paywall still advertises one — this is the 2.1(b) rejection');
  r.buy === 'Get KAMO+' ? ok(`CTA drops the trial ("${r.buy}")`) : bad(`CTA still reads ${JSON.stringify(r.buy)} with no trial available`);
  r.terms && !/free/i.test(r.terms) && /week/i.test(r.terms)
    ? ok(`terms quote the price with no trial claim ("${r.terms}")`)
    : bad(`terms read ${JSON.stringify(r.terms)}`);
}

/* 3 — THE FLEET. 1.0.2 cannot report; absence must not be read as "no trial". */
{
  const r = await paywallCopy(CAPS_102, PRICES);
  r.badgeShown
    ? ok('1.0.2 cannot report → the trial wording survives for 99.7% of users')
    : bad('the trial wording vanished on 1.0.2 — this would erase the trial funnel on the live fleet');
  /^Try .*free$/i.test(r.buy || '')
    ? ok(`1.0.2 CTA unchanged ("${r.buy}")`)
    : bad(`1.0.2 CTA changed to ${JSON.stringify(r.buy)}`);
}

/* 4 — before the store answers at all, nothing may be claimed as absent. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.KAMO && window.KAMO.setNativeCaps, { timeout: 5000 });
  await page.evaluate((c) => window.KAMO.setNativeCaps(c), CAPS_109);
  await page.waitForTimeout(120);
  const shown = await page.evaluate(() => {
    const b = document.getElementById('pwFreeBadge');
    return !!(b && getComputedStyle(b).display !== 'none');
  });
  await page.close();
  shown ? ok('no store answer yet → the trial is not pre-emptively withdrawn')
        : bad('the badge is hidden before the store has answered — a slow network would silently kill the offer');
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the paywall promises only what the store returned');
process.exit(failed ? 1 : 0);
