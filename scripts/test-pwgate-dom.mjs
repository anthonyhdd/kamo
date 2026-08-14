#!/usr/bin/env node
/**
 * WHICH IMPRESSION THE PAYWALL SPENDS, AND WHERE IT STOPS.
 *
 * Splitting paywall_viewed and purchase_initiated by `nth` over 1-14 August:
 *
 *   nth 1        3505 views ->  119 Buy taps    3.4%
 *   nth 2        2173 ->  38                    1.7%
 *   nth 3        1334 ->  20                    1.5%
 *   nth 9,10,11   108 ->   0                    0%
 *
 * Two rules follow, and this suite exists because both are invisible in a screenshot and
 * both fail silently — a paywall that opens when it should not looks exactly like a paywall.
 *
 *  ① THE FIRST ONE IS EARNED. More than half the value of the whole surface is one impression
 *    per install, and it was being spent by whichever tool lock fired first — color, time,
 *    size, all the same moment: a wall hit mid-paint. The first paywall an install ever sees
 *    now has to come from the end of a round. Asserted as a PAIR, on the same click: refused
 *    on a fresh device, opened once the device has seen one. A test that only checked the
 *    refusal would pass against a paywall that never opens at all.
 *  ② THE TAIL IS CAPPED, INCLUDING FORCED OPENS. Every budget already in the file exempts
 *    user-initiated opens, which is exactly how a launch reached eleven. Asserted through the
 *    real ✦ button, which passes no force flag but is user-initiated and therefore skipped
 *    every existing cap.
 *
 * On the WIRE rather than on the DOM: paywall_viewed is what the decision produces, and the
 * sheet's visibility is a second thing that can be true for other reasons.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-pwgate-dom.mjs
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
for (const b of pwBases(ROOT)) {
  try { ({ chromium } = req(b ? join(b, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) { console.log('· playwright-core not installed — skipping the paywall-gate test — run: ' + PW_SETUP); process.exit(0); }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace('async function chRpc(fn,body){', 'async function chRpc(fn,body){ if(window.__rpc) return window.__rpc(fn,body);');
const MIME = { '.js': 'text/javascript', '.png': 'image/png' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try { const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(b); }
  catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/** A page with the wire recorded, and localStorage seeded before the app boots. */
async function boot(seed) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const sent = [];
  await page.route('**/api.eu.amplitude.com/**', async r => {
    try { (JSON.parse(r.request().postData() || '{}').events || []).forEach(e => sent.push(e)); } catch {}
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
  });
  await page.addInitScript((s) => {
    window.__rpc = () => Promise.resolve(null);
    Object.keys(s || {}).forEach(k => localStorage.setItem(k, s[k]));
  }, seed || {});
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return { page, sent };
}
const count = (sent, type) => sent.filter(e => e.event_type === type).length;

console.log('\n① THE FIRST PAYWALL IS EARNED, NOT TAKEN BY WHICHEVER LOCK FIRES FIRST');
{
  const { page, sent } = await boot();            // fresh install: nothing in storage
  await page.evaluate(() => document.getElementById('btnPlus').click());
  await page.waitForTimeout(700);
  count(sent, 'paywall_viewed') === 0
    ? ok('a fresh device tapping a lock gets no paywall')
    : bad(`a fresh device was shown ${count(sent, 'paywall_viewed')} paywall(s) from a tool lock`);
  const def = sent.find(e => e.event_type === 'paywall_deferred');
  def ? ok(`and the refusal reports itself (source=${(def.event_properties || {}).source})`)
      : bad('nothing was emitted — a refusal that reports nothing is indistinguishable from a dead button');
  await page.close();
}

console.log('\nAND THE SAME TAP OPENS IT ONCE THE DEVICE HAS SEEN ONE');
{
  /* The other half of the pair. Without it, a paywall that never opens at all would pass the
     block above with full marks. */
  const { page, sent } = await boot({ kamo_pw_seen: '1' });
  await page.evaluate(() => document.getElementById('btnPlus').click());
  await page.waitForTimeout(700);
  count(sent, 'paywall_viewed') >= 1
    ? ok('an install that has already been offered once sees the paywall normally')
    : bad('the paywall never opens even for a device that has seen one — the rule is a wall, not a move');
  await page.close();
}

console.log('\nAND A DEVICE THAT NEVER FINISHES A ROUND IS NOT STRANDED');
{
  /* The escape hatch, asserted rather than hoped for: after PW_FIRST_MAX_DEFER refusals the
     next source through wins, so somebody who only ever hits locks still gets an offer. */
  const { page, sent } = await boot({ kamo_pw_defer: '4' });
  await page.evaluate(() => document.getElementById('btnPlus').click());
  await page.waitForTimeout(700);
  count(sent, 'paywall_viewed') >= 1
    ? ok('past the deferral limit the offer is finally made')
    : bad('the escape hatch does not open — a device that never finishes a round is offered nothing, ever');
  await page.close();
}

console.log('\n② THE TAIL STOPS, AND IT STOPS USER-INITIATED OPENS TOO');
{
  const { page, sent } = await boot({ kamo_pw_seen: '1' });
  /* Twelve real taps on ✦. It passes no force flag but is user-initiated, so it skips every
     budget already in the file — which is how a launch reached eleven paywalls. */
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => {
      const p = document.getElementById('paywall'); if (p) p.classList.remove('show');
      document.getElementById('btnPlus').click();
    });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  const n = count(sent, 'paywall_viewed');
  n > 0 && n <= 8
    ? ok(`twelve taps produced ${n} paywalls and then stopped`)
    : bad(`twelve taps produced ${n} paywalls — the hard cap is not holding`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} problem(s)\n` : '\n✓ the first paywall is earned and the tail is capped\n');
process.exit(failed ? 1 : 0);
