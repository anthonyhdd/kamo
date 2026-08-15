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
 *  ① THE OFFER IS GUARANTEED, AND IT IS GUARANTEED ONCE. 2026-08-15: 1481 new users, 100
 *    paywalls — 6.8%, because every source in the file fires from a locked control on the
 *    paint screen and most of this product is not the paint screen. The first offer now
 *    rides on activation beats with a dwell backstop under them. Asserted as a PAIR, and it
 *    has to be: "fires for everybody" and "fires once" are the two ways this breaks, and a
 *    test for either one alone passes against the other's worst version.
 *  ③ AND IN A BROWSER IT SELLS THE APP, NOT A DEAD BUTTON. 97% of KAMO is a browser, where
 *    setPrices() is never called and the CTA read "Currently unavailable" forever. It now
 *    routes to the store — and MUST NOT fall through to pwPurchase(), whose non-wrapper
 *    branch grants KAMO+ for free.
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

/* The dwell backstop is 45s in production, which is the right number for a user and an
   absurd one for a suite. Shortened here rather than driven by a fake clock: what is being
   asserted is that the REAL timer path fires on its own, unaided, on a page nobody touches —
   stubbing the timer would test the stub. */
const DWELL_MS = 700;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace('async function chRpc(fn,body){', 'async function chRpc(fn,body){ if(window.__rpc) return window.__rpc(fn,body);')
  .replace('const PW_FIRST_DWELL_MS=45000;', `const PW_FIRST_DWELL_MS=${DWELL_MS};`)
  /* Module scope, so the beats can be driven by name without waiting for a real hunt to end.
     ③ below still drives the untouched production path. */
  .replace('function pwFirstArm(){', 'window.__pwFirst=(b)=>pwFirstOffer(b);\nfunction pwFirstArm(){');
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

console.log('\n① EVERY INSTALL IS OFFERED SOMETHING, AND ONLY ONCE');
{
  /* Nothing is clicked in this block. A fresh device is booted and left alone, which is
     exactly the session the backstop exists for — 93% of the population never reaches a
     locked control, and until this shipped they were asked nothing at all. */
  const { page, sent } = await boot();
  await page.waitForTimeout(DWELL_MS + 900);
  const first = sent.filter(e => e.event_type === 'paywall_viewed' && (e.event_properties || {}).source === 'first');
  first.length === 1
    ? ok(`an untouched device was offered KAMO+ once (beat: ${(first[0].event_properties || {}).first_beat})`)
    : bad(`an untouched device saw ${first.length} first-offers — the guarantee is ${first.length ? 'firing twice' : 'not firing'}`);
  (first[0] || {}).event_properties?.first_beat === 'dwell'
    ? ok('and it is attributed to the beat that produced it')
    : bad(`first_beat reads ${JSON.stringify((first[0] || {}).event_properties?.first_beat)} — the split that judges the four beats is dead`);
  /* THE OTHER HALF, ON THE SAME PAGE: every other beat must now find the guarantee spent.
     A rule that fires on each beat instead of once is the fatigue every cap in that file was
     written against, arriving through the one door none of them guard. */
  await page.evaluate(() => { ['seek_end', 'feed', 'sent', 'dwell'].forEach(b => window.__pwFirst(b)); });
  await page.waitForTimeout(400);
  const again = sent.filter(e => e.event_type === 'paywall_viewed' && (e.event_properties || {}).source === 'first');
  again.length === 1
    ? ok('the three other beats find it already spent')
    : bad(`four beats produced ${again.length} first-offers — it is once per BEAT, not once per install`);
  await page.close();
}
{
  /* The persistence, from the other side: a device that met the offer on a previous launch
     is not asked again. Fails OPEN by design — see pwFirstDone() — so this is the only
     assertion that the key is read at all. */
  const { page, sent } = await boot({ kamo_pw_first: '1' });
  await page.waitForTimeout(DWELL_MS + 900);
  count(sent, 'paywall_viewed') === 0
    ? ok('a device that has already been offered is left alone on the next launch')
    : bad('a returning device was offered again — the once-per-install key is not being read');
  await page.close();
}

console.log('\n③ IN A BROWSER THE CTA SELLS THE APP, AND GIVES NOTHING AWAY');
{
  const { page, sent } = await boot();
  /* The navigation is ABORTED rather than answered: the tap has to really leave the page for
     this to be the production path, and the document has to survive for the wire and the ✦
     to still be readable afterwards. A 204 was tried first — Chromium tore the context down
     anyway. */
  await page.route('**/onelink.me/**', r => r.abort());
  await page.waitForTimeout(DWELL_MS + 900);
  const cta = await page.evaluate(() => {
    const b = document.getElementById('pwBuy');
    return { label: (b.textContent || '').trim(), disabled: !!b.disabled };
  });
  !cta.disabled && /get kamo/i.test(cta.label)
    ? ok(`the web CTA is live and offers the app ("${cta.label}")`)
    : bad(`the web CTA reads ${JSON.stringify(cta.label)}${cta.disabled ? ' and is disabled' : ''} — a browser paywall that cannot be acted on`);
  /* THE TAP AND THE VERDICT IN ONE EVALUATE, and that is not a shortcut. Both branches of
     the handler are synchronous — pwWebInstall assigns location.href, pwPurchase would call
     setPro(true) — so the ✦ is already hidden by the time this returns if the membership was
     given away. Reading it in a SECOND evaluate raced the navigation the tap just started
     and died on a destroyed context about half the time. */
  /* SPIED ON window.KAMO.setPro RATHER THAN ON THE ✦, because the ✦ is hidden on the hero
     screen for reasons that have nothing to do with membership — that version of this
     assertion failed at random depending on which screen the offer opened over. pwPurchase's
     browser branch reaches the grant through `window.KAMO`, so the wrapper below is on the
     exact path it would take. */
  const gaveItAway = await page.evaluate(() => {
    let granted = false;
    const real = window.KAMO.setPro;
    window.KAMO.setPro = (v) => { granted = !!v; return real(v); };
    document.getElementById('pwBuy').click();
    return granted;
  });
  gaveItAway
    ? bad('the tap granted KAMO+ to a web visitor — window.KAMO.setPro(true) is reachable again')
    : ok('the membership is still unsold');
  await page.waitForTimeout(500);
  count(sent, 'paywall_install_tapped') === 1
    ? ok('tapping it is measured as an install tap')
    : bad(`the install tap produced ${count(sent, 'paywall_install_tapped')} events — the biggest install surface in the app is unattributed`);
  count(sent, 'purchase_initiated') === 0
    ? ok('and it never reaches the purchase path')
    : bad('the web CTA fell through to pwPurchase() — that branch grants KAMO+ for nothing');
  try { await page.close(); } catch {}
}

console.log('\n② THE TAIL STOPS, AND IT STOPS USER-INITIATED OPENS TOO');
{
  const { page, sent } = await boot();
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
console.log(failed ? `\n✗ ${failed} problem(s)\n` : '\n✓ every install is offered once, the web CTA sells the app, the tail stays capped\n');
process.exit(failed ? 1 : 0);
