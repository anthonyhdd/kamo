#!/usr/bin/env node
/**
 * WHICH PLAN IS THE HERO — the 50/50 arm, rendered in a real browser.
 *
 * The arm flips ONE variable (`pwPlan` at boot) and everything the user actually reads is
 * derived from it three functions away: the CTA label, the terms line, and the secondary
 * #pwLifeLine offer. A static check can see the constant; it cannot see that a device seeded
 * into the lifetime arm really ends up with "Unlock forever" on the button and the weekly
 * demoted to the small line — nor, more importantly, that a device in the lifetime arm whose
 * store cannot sell the lifetime falls back to the weekly instead of showing a hero for a
 * product that does not exist. That last case is the one that would silently halve revenue,
 * and it is the reason this file exists rather than a line in check.mjs.
 *
 * Every assertion drives the page the way the app does: seed localStorage before load, post
 * prices through window.KAMO.setPrices (the only thing the native layer ever calls), read
 * what is on screen. No internal state is asserted that the user cannot see.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-planarm-dom.mjs
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
  console.log('· playwright-core not installed — skipping the plan-arm test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Read from the page rather than hardcoded, so this file follows the arm being ramped, killed
   or set back to 50 instead of having to be edited alongside it. */
const LIFETIME_ROLLOUT = Number(real.match(/const PLAN_LIFETIME_ROLLOUT\s*=\s*(\d+)/)?.[1]);
if (!Number.isFinite(LIFETIME_ROLLOUT)) {
  console.log('✗ could not read PLAN_LIFETIME_ROLLOUT out of index.html — the rollout-aware assertions cannot run');
  process.exit(1);
}
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__p={'
  + 'arm(){return{plan_arm:planArm,pwPlan:pwPlan,pw_arm:pwArm,'
  + 'active:(document.querySelector("#pwPlans .pwPlan.active")||{dataset:{}}).dataset.plan};},'
  /* The arm has to be readable off an EVENT, not just off a variable: the whole experiment is
     unreadable in Amplitude if track() forgets to stamp it, and that is a silent failure. */
  + 'stamp(){let got=null;const pn=postNative;postNative=(m)=>{if(m&&m.type==="track")got=m.props;return true;};'
  + 'try{track("paywall_viewed",{source:"test"});}finally{postNative=pn;}return got;},'
  + 'prices(p){window.KAMO.setPrices(p);openPaywall("plus",true);'
  + 'const line=document.getElementById("pwLifeLine");'
  + 'return{buy:(document.getElementById("pwBuy")||{}).textContent||"",'
  + 'disabled:!!(document.getElementById("pwBuy")||{}).disabled,'
  + 'terms:(document.getElementById("pwTerms")||{}).textContent||"",'
  + 'line:line.textContent,lineShown:getComputedStyle(line).display!=="none",'
  + 'plan:pwPlan};}};\n'
  + real.slice(at);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const body = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

/* Both prices, the shape a healthy store returns. WEEKLY/LIFETIME are deliberately
   unmistakable strings: an assertion that passes on "$2.99" would also pass on a stale
   hardcoded markup value, which is exactly the false pass the price nodes have produced
   before. */
const WEEKLY = '€3.49', LIFETIME = '€16.99';
const BOTH = { weekly: WEEKLY, lifetime: LIFETIME, trial: '3 days' };

async function open(seed, prices, wrapper) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  /* INSIDE THE APP vs IN A BROWSER IS A DIFFERENT PAYWALL, and only one of them is this
     experiment's population. pwWebOffer() replaces the CTA with "Get KAMO — free" whenever
     there is no wrapper, because a browser cannot sell KAMO+ at all — so the store-failure
     assertions below have to run with a bridge present or they measure the web branch and
     pass for the wrong reason. Only postMessage is stubbed: everything else about the page
     stays the code users load. */
  if (wrapper) await page.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
  await page.addInitScript((s) => { try {
    /* The full arm is the only one with a hero CTA and a #pwLifeLine — the sheet arm shows
       plan ROWS instead, and this experiment is about which plan the CTA sells. Seeding it
       matches production, where PW_FULL_ROLLOUT is 100.
       kamo_pw_seen because the first paywall of an install is deferred to a payoff beat;
       this suite is about what the paywall RENDERS, not when it may open. */
    localStorage.setItem('kamo_pw_design', 'full');
    localStorage.setItem('kamo_pw_seen', '1');
    if (s) localStorage.setItem('kamo_plan_arm', s);
  } catch (e) {} }, seed);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__p, null, { timeout: 10000 });
  const arm = await page.evaluate(() => window.__p.arm());
  const view = prices ? await page.evaluate((p) => window.__p.prices(p), prices) : null;
  const stamp = await page.evaluate(() => window.__p.stamp());
  await page.close();
  return { arm, view, stamp };
}

/* A REAL DEVICE WHOSE localStorage THROWS. This is the production population the arm code
 * forgot: iOS privacy modes and the 1.0.2 `incognito` WebView can make the property reject
 * outright, and the assignment used to live inside a try/catch wrapped around the read — so
 * the throw skipped the decision too and left the initialisers standing. It was not
 * hypothetical: on 2026-08-16, a day after PW_FULL_ROLLOUT went to 100, 796 of 1971
 * paywall viewers still reported design_arm "sheet".
 *
 * Only the two experiment keys are made to throw. The page touches localStorage a hundred
 * times for unrelated state, and poisoning all of it would test the app's overall resilience
 * rather than this decision — a different question, and one that would fail for reasons that
 * are not this bug.
 *
 * `navigator.webdriver` is forced false because the harness pin is the FIRST branch a
 * headless run hits; leaving it true would assert the pin again and never reach the code
 * this covers. `roll` then makes the coin deterministic.
 *
 * The constant is installed for the whole of module evaluation and torn down the instant it
 * ends, rather than after a fixed number of calls: three.js loads from vendor/ BEFORE the
 * inline script and consumes an unknown number of Math.random() calls generating object
 * UUIDs, so "the arms are calls one and two" is wrong — it was, and it made this block fail
 * inverted. `window.__p` is assigned on the last line of the module, which is exactly the
 * moment both arms are decided, so its setter is the restore hook. Nothing downstream — boot,
 * the 3D scene, the particle work — inherits a frozen Math.random. */
async function openDenied(roll) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((r) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    const DENIED = new Set(['kamo_pw_design', 'kamo_plan_arm']);
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) {
      if (DENIED.has(k)) throw new DOMException('storage denied', 'SecurityError');
      return get.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
      if (DENIED.has(k)) throw new DOMException('storage denied', 'SecurityError');
      return set.call(this, k, v);
    };
    const nativeRandom = Math.random;
    Math.random = () => r;
    let probe;
    Object.defineProperty(window, '__p', {
      configurable: true,
      get() { return probe; },
      set(v) { probe = v; Math.random = nativeRandom; },
    });
  }, roll);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__p, null, { timeout: 10000 });
  const arm = await page.evaluate(() => window.__p.arm());
  await page.close();
  return arm;
}

console.log('\nTHE HARNESS PIN HOLDS — AN UNSEEDED HEADLESS RUN IS NOT A COIN FLIP');
{
  const a = await open(null, null);
  a.arm.plan_arm === 'weekly' && a.arm.pwPlan === 'weekly'
    ? ok('navigator.webdriver lands on the weekly arm, so every other DOM test stays deterministic')
    : bad(`headless got plan_arm "${a.arm.plan_arm}" / pwPlan "${a.arm.pwPlan}" — every paywall assertion in this repo is now flaky`);
}

console.log('\nSTORAGE THAT THROWS STILL GETS AN ARM — IT DOES NOT SILENTLY OPT OUT');
{
  /* The deterministic one, and the one that cost 40% of the fleet: at rollout 100 no branch
     can legitimately produce "sheet" on a real device — a stored value is promoted or
     honoured, and an unstored device rolls `Math.random()*100<100`, true for every possible
     value. So "sheet" here means the decision was skipped, whatever the coin said. */
  const hi = await openDenied(0.9);
  hi.pw_arm === 'full'
    ? ok('a denied read still lands on the full-bleed paywall at PW_FULL_ROLLOUT 100')
    : bad(`pwArm is "${hi.pw_arm}" with storage throwing — the retired sheet paywall is live again for these devices`);
  hi.plan_arm === 'weekly'
    ? ok('and the plan coin is consulted — a high roll gives the weekly arm')
    : bad(`plan_arm is "${hi.plan_arm}" on a 0.9 roll — expected weekly`);

  /* The half that a swallowed decision can never reach: before the fix `planArm` kept its
     "weekly" initialiser no matter what the coin said, so the lifetime arm was unreachable
     on these devices and the 50/50 read 68/32 in production.

     ⚠️ REWRITTEN 2026-08-24, WHEN PLAN_LIFETIME_ROLLOUT WENT TO 0. This used to assert that a
     0.1 roll REACHES the lifetime arm, which is another way of asserting that the experiment is
     still running — so retiring the arm turned a green test red for the one reason that is not a
     regression. What the assertion was actually protecting is narrower and still worth keeping:
     that a device whose storage throws makes a real decision instead of silently keeping an
     initialiser. So it now checks the coin is consulted and lands on a VALID arm at whatever the
     rollout says, at both ends of the roll — which stays true at 0, at 100, and at any 50/50 this
     is ever set back to. The rendering path for the lifetime hero is not left uncovered: the
     CONTROL and LIFETIME blocks below still seed it through localStorage, which is exactly why
     rollout 0 does NOT override a stored arm (see the note in index.html). */
  const lo = await openDenied(0.1);
  const want = LIFETIME_ROLLOUT > 10 ? 'lifetime' : 'weekly';
  lo.plan_arm === want && lo.pwPlan === want
    ? ok(`and a low roll is decided too — "${want}" at PLAN_LIFETIME_ROLLOUT ${LIFETIME_ROLLOUT}, not an initialiser`)
    : bad(`plan_arm is "${lo.plan_arm}" / pwPlan "${lo.pwPlan}" on a 0.1 roll — expected "${want}" at rollout ${LIFETIME_ROLLOUT}`);
}

console.log('\nCONTROL: WEEKLY IS THE HERO, LIFETIME IS THE LINE');
{
  const a = await open('weekly', BOTH);
  a.view.plan === 'weekly' && a.view.buy.includes(WEEKLY) && /week/i.test(a.view.buy)
    ? ok('the CTA sells the weekly, at the store price')
    : bad(`weekly arm CTA is "${a.view.buy}" (plan ${a.view.plan})`);
  a.view.lineShown && a.view.line.includes(LIFETIME) && /forever/i.test(a.view.line)
    ? ok('the lifetime is offered underneath as the secondary line')
    : bad(`weekly arm line is "${a.view.line}" (shown: ${a.view.lineShown})`);
}

console.log('\nTREATMENT: LIFETIME IS THE HERO, WEEKLY IS THE LINE');
{
  const a = await open('lifetime', BOTH);
  a.arm.active === 'lifetime'
    ? ok('the lifetime row carries .active, so a returning sheet arm renders from the same record')
    : bad(`.active is on "${a.arm.active}" — pwPlan and the markup have drifted apart`);
  a.view.plan === 'lifetime' && a.view.buy.includes(LIFETIME) && /forever/i.test(a.view.buy)
    ? ok('the CTA sells the lifetime, at the store price')
    : bad(`lifetime arm CTA is "${a.view.buy}" (plan ${a.view.plan})`);
  !a.view.disabled ? ok('and it is tappable') : bad('the lifetime CTA is disabled — the arm cannot buy at all');
  a.view.lineShown && a.view.line.includes(WEEKLY) && /week/i.test(a.view.line)
    ? ok('the weekly is demoted to the secondary line, not removed')
    : bad(`lifetime arm line is "${a.view.line}" (shown: ${a.view.lineShown})`);
  /* The terms under the CTA are a store-review surface, not decoration: 1.0.9 was rejected on
     2.1(b) for a paywall whose copy promised something the payment sheet did not. A one-time
     purchase must not inherit the subscription's auto-renew wording. */
  /renew/i.test(a.view.terms)
    ? bad(`the lifetime arm still shows subscription terms: "${a.view.terms}"`)
    : ok('the terms describe a one-time purchase, not an auto-renewing subscription');
}

console.log('\nTHE ARM IS STICKY, AND IT IS ON THE EVENTS');
{
  const a = await open('lifetime', BOTH);
  a.arm.plan_arm === 'lifetime'
    ? ok('a stored arm is honoured rather than re-rolled')
    : bad(`stored "lifetime" but read "${a.arm.plan_arm}" — every user would flip arms between launches`);
  a.stamp && a.stamp.plan_arm === 'lifetime'
    ? ok('track() stamps plan_arm, so paywall_viewed → purchase_initiated splits by arm with no join')
    : bad(`paywall_viewed carried plan_arm "${a.stamp && a.stamp.plan_arm}" — the experiment is unreadable in Amplitude`);
}

/* THE ONE THAT WOULD COST REAL MONEY. `com.blisscoach.kamo.pro` has to be a package in the
   RevenueCat `default` offering for the native layer to resolve it; if it is not, setPrices
   arrives with a weekly and no lifetime. Half the fleet must then see the weekly hero, not a
   dead "Unlock forever". applyPlanAvailability() is what does it — this proves it still does
   when the selected plan is the one that vanished. */
console.log('\nTHE STORE CANNOT SELL THE LIFETIME — THE ARM FALLS BACK, IT DOES NOT BREAK');
{
  const a = await open('lifetime', { weekly: WEEKLY, trial: '3 days' });
  a.view.plan === 'weekly'
    ? ok('an unsellable lifetime falls back to the weekly')
    : bad(`plan stayed "${a.view.plan}" with no lifetime price — the arm is selling a product the store does not have`);
  a.view.buy.includes(WEEKLY) && !a.view.disabled
    ? ok('and the CTA is the weekly, live')
    : bad(`fallback CTA is "${a.view.buy}" (disabled: ${a.view.disabled})`);
  !a.view.lineShown
    ? ok('with no secondary line, because there is no second plan to offer')
    : bad(`a secondary line is showing with one sellable plan: "${a.view.line}"`);
}

console.log('\nNO PRICES AT ALL — NOBODY GETS A BUTTON THEY CANNOT USE');
{
  const a = await open('lifetime', {}, true);
  a.view.disabled ? ok('in the app, the CTA stays disabled until the store answers') : bad(`CTA "${a.view.buy}" is live with no prices`);
  !/forever/i.test(a.view.buy)
    ? ok('and it does not promise a lifetime before one has a price')
    : bad(`CTA reads "${a.view.buy}" with no store prices`);
  /* The web branch is not a bug and not this experiment's population — asserted so that a
     future change to pwWebOffer() cannot make the lifetime arm promise something a browser
     visitor can never buy. */
  const w = await open('lifetime', {});
  /free/i.test(w.view.buy) && !/forever/i.test(w.view.buy)
    ? ok('in a browser it offers the free app instead, never the lifetime')
    : bad(`browser CTA with no prices reads "${w.view.buy}"`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} plan-arm check(s) failed` : '\n✓ plan-arm checks passed');
process.exit(failed ? 1 : 0);
