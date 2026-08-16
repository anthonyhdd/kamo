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
 *  ① THE OFFER IS GUARANTEED, AND IT IS GUARANTEED ONCE — WHERE THERE IS SOMETHING TO SELL.
 *    2026-08-15: 1481 new users, 100 paywalls — 6.8%, because every source in the file fires
 *    from a locked control on the paint screen and most of this product is not the paint
 *    screen. The first offer now rides on activation beats with a dwell backstop under them.
 *    Asserted as a PAIR, and it has to be: "fires for everybody" and "fires once" are the two
 *    ways this breaks, and a test for either one alone passes against the other's worst
 *    version. Asserted on a PRICED page, because a browser with no store is now the one place
 *    this guarantee deliberately does not apply — see ③.
 *  ③ AND IN A BROWSER IT NEVER ARRIVES ON ITS OWN (2026-08-16). 6162 paywalls opened in a
 *    browser over 15-16 August and produced 40 taps on "Get KAMO — free": 0.6%. 2755 of them
 *    were the uninvited `first`, which lands 1500ms after a seek round ends — one tap from
 *    "Challenge back" — and again off the dwell backstop, i.e. on the compose screen of the
 *    reply the user had already started making. That one is refused and silent now. A finger
 *    on a locked control still gets an answer, and the answer is the pill that goes to the
 *    store; an explicit ✦ still opens the sheet, which is also the only door to the creator
 *    pass. The sheet must still never fall through to pwPurchase(), whose non-wrapper branch
 *    grants KAMO+ for free.
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
     ③ below still drives the untouched production path.
     `__pw` reaches the sources that have no button on the hero screen — `color` fires from a
     swatch that only exists once a photo is on the board, and what is under test is the
     REFUSAL, not the road to the swatch. */
  .replace('function pwFirstArm(){', 'window.__pwFirst=(b)=>pwFirstOffer(b);\nwindow.__pw=(s,f)=>openPaywall(s,f);\nfunction pwFirstArm(){');
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

/** A page with the wire recorded, and localStorage seeded before the app boots.
 *
 * `priced` IS HOW A SURFACE THAT CAN SELL IS REPRODUCED, and setPrices() is the honest way to
 * do it: pwWebOffer() is `no bridge AND no prices`, so a real localized price is exactly what
 * separates a browser from the wrapper as far as the paywall is concerned. Faking
 * window.ReactNativeWebView instead would ALSO redirect track() into the native bridge, and
 * every assertion in this file reads the Amplitude wire. */
async function boot(seed, priced) {
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
  /* Before the 900ms settle, so a priced page is priced well inside the shortened dwell. */
  if (priced) await page.evaluate(() => window.KAMO.setPrices({ weekly: '$2.99', lifetime: '$14.99' }));
  await page.waitForTimeout(900);
  return { page, sent };
}
const count = (sent, type) => sent.filter(e => e.event_type === type).length;

console.log('\n① EVERY INSTALL THAT CAN BUY IS OFFERED SOMETHING, AND ONLY ONCE');
{
  /* Nothing is clicked in this block. A fresh device is booted and left alone, which is
     exactly the session the backstop exists for — 93% of the population never reaches a
     locked control, and until this shipped they were asked nothing at all.
     PRICED, because that is where this guarantee lives now: a browser with no store refuses
     the offer outright (③), so asserting the guarantee on an unpriced page would be asserting
     the opposite rule and calling it this one. */
  const { page, sent } = await boot(null, true);
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
     assertion that the key is read at all.
     PRICED for the same reason as above, and here it is load-bearing rather than tidy: on an
     unpriced page this block passes with the key never read at all, because the web refusal
     produces the same zero. */
  const { page, sent } = await boot({ kamo_pw_first: '1' }, true);
  await page.waitForTimeout(DWELL_MS + 900);
  count(sent, 'paywall_viewed') === 0
    ? ok('a device that has already been offered is left alone on the next launch')
    : bad('a returning device was offered again — the once-per-install key is not being read');
  await page.close();
}

console.log('\n③ IN A BROWSER NOTHING ARRIVES ON ITS OWN');
{
  /* THE FOUNDER'S BUG, ASSERTED WHERE HE MET IT. Left alone past the dwell, an unpriced page
     must produce NO paywall at all — this is the same session as ① with the one difference
     that decides it, and until 2026-08-16 it produced the sheet that landed on the compose
     screen of a reply. The wire AND the class, because "it opened and closed" and "it never
     opened" are the same silence on the wire alone. */
  const { page, sent } = await boot();
  await page.waitForTimeout(DWELL_MS + 900);
  const shown = await page.evaluate(() => document.getElementById('paywall').classList.contains('show'));
  count(sent, 'paywall_viewed') === 0 && !shown
    ? ok('an untouched browser is left alone — no sheet, and nothing on the wire')
    : bad(`a browser saw ${count(sent, 'paywall_viewed')} paywalls${shown ? ' and one is on screen' : ''} — the offer is interrupting a page that cannot sell`);
  /* AND THE LOCKED CONTROL STILL ANSWERS. A refusal that shows nothing is a dead button; the
     pill is what replaces the sheet, and it has to say where the tool lives rather than
     promise an unlock the page cannot perform. */
  await page.evaluate(() => window.__pw('color', true));
  await page.waitForTimeout(200);
  const pill = await page.evaluate(() => {
    const h = document.getElementById('hint');
    return { text: (h.textContent || '').trim(), tap: h.classList.contains('tap') };
  });
  count(sent, 'paywall_viewed') === 0 && /in the app/i.test(pill.text) && pill.tap
    ? ok(`a locked colour answers with the pill ("${pill.text}")`)
    : bad(`the locked colour produced ${count(sent, 'paywall_viewed')} paywalls and the pill reads ${JSON.stringify(pill.text)} (tappable: ${pill.tap})`);
  count(sent, 'paywall_web_hinted') === 1
    ? ok('and the pill is measured, so the install taps beside it have a denominator')
    : bad(`the pill produced ${count(sent, 'paywall_web_hinted')} events — the whole web ask is unmeasured`);
  /* The navigation is ABORTED rather than answered: the tap has to really leave the page for
     this to be the production path, and the document has to survive for the wire and the ✦
     to still be readable afterwards. A 204 was tried first — Chromium tore the context down
     anyway. */
  await page.route('**/onelink.me/**', r => r.abort());
  await page.route('**/apps.apple.com/**', r => r.abort());
  await page.evaluate(() => document.getElementById('hint').click());
  await page.waitForTimeout(400);
  count(sent, 'paywall_install_tapped') === 1
    ? ok('tapping the pill goes to the store, and is measured as an install tap')
    : bad(`the pill tap produced ${count(sent, 'paywall_install_tapped')} install taps — it is a sentence with nothing behind it`);
  try { await page.close(); } catch {}
}
{
  /* ✦ IS NOT AN EXCEPTION EITHER (founder, 2026-08-16). It was, for one version of this file:
     a tap on a KAMO+ control opened the sheet on the argument that a request deserves the
     screen it asked for. `plus` ran 937 impressions over 15-16 August inside a population that
     produced 40 install taps in total, so what it deserves is an answer, not a sales screen
     with nothing behind it. */
  const { page, sent } = await boot();
  await page.route('**/onelink.me/**', r => r.abort());
  await page.route('**/apps.apple.com/**', r => r.abort());
  await page.waitForTimeout(DWELL_MS + 900);
  await page.evaluate(() => window.__pw('plus'));
  await page.waitForTimeout(200);
  const asked = await page.evaluate(() => ({
    shown: document.getElementById('paywall').classList.contains('show'),
    pill: (document.getElementById('hint').textContent || '').trim(),
  }));
  !asked.shown && /in the app/i.test(asked.pill)
    ? ok(`✦ answers without a sheet ("${asked.pill}")`)
    : bad(`✦ produced shown:${asked.shown} pill:${JSON.stringify(asked.pill)} — the browser still gets a paywall it cannot buy from`);
  /* THE PASS DOOR MOVED WITH THE SHEET. Its only entrance was a 1.2s hold on the paywall's
     Restore, which a browser can no longer open — so a creator handed a code would have had no
     way to enter it outside the app. The phrase itself is not typed here (that is
     test-pass-dom's job, and it needs the live one): what must never regress is that the hold
     still RAISES the field, on a control the web can actually see.
     BEFORE THE BUY TAP BELOW, deliberately — that one hands the document to a navigation this
     test aborts, and anything reading the DOM after it is reading a page on its way out.
     EVENTS DISPATCHED ON THE ELEMENT rather than driven by page.mouse: the ✦ lives on the
     COMPOSE screen and this page is still on the hero, where it is display:none and a real
     cursor would land on whatever is underneath. bindPassHold listens on the button itself, so
     this is its own contract — and the alternative, walking a headless browser into compose
     through a camera it does not have, would test the harness. */
  await page.evaluate(() => {
    const b = document.getElementById('btnPlus');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 60 }));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.getElementById('btnPlus').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => !!document.getElementById('ffIn'))
    ? ok('and holding ✦ still raises the creator-pass field, which is now its only door on the web')
    : bad('holding ✦ raises nothing — the creator pass is unreachable outside the app');
  await page.evaluate(() => { const c = document.getElementById('ffNo'); if (c) c.click(); });
  /* THE MEMBERSHIP IS STILL UNSELLABLE, and this outlives the refusal above: the sheet is
     still reachable in a browser through the creator pass, and pwPurchase's non-wrapper branch
     is `window.KAMO.setPro(true)` — a grant for nothing. #pwBuy is clicked directly rather
     than through the sheet for that reason; the handler is what is under test.
     SPIED ON window.KAMO.setPro rather than on the ✦: pwPurchase's browser branch reaches the
     grant through `window.KAMO`, so this wrapper sits on the exact path it would take. Both
     branches are synchronous, so one evaluate is enough — and reading it in a second one
     raced the navigation the tap starts and died on a destroyed context. */
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
  count(sent, 'purchase_initiated') === 0
    ? ok('and it never reaches the purchase path')
    : bad('the web CTA fell through to pwPurchase() — that branch grants KAMO+ for nothing');
  try { await page.close(); } catch {}
}

console.log('\n② THE TAIL STOPS, AND IT STOPS USER-INITIATED OPENS TOO');
{
  /* PRICED, like ①: the cap governs a screen that opens, and in a browser none of these taps
     produces one at all now (③). Asserting it there would read as "the cap is holding" on a
     page where nothing was ever asked. */
  const { page, sent } = await boot(null, true);
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
