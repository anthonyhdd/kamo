#!/usr/bin/env node
/**
 * THE FULL-BLEED PAYWALL ARM, RENDERED IN A REAL BROWSER.
 *
 * The arm is presentation over shared machinery, and presentation is exactly what the static
 * checks cannot see: whether the hero actually shows, whether the right line lights for the
 * lock that opened it, whether the sheet's plan rows are really gone from the screen while
 * still feeding sellability, and whether the one-line plan toggle sells only what the store
 * returned. Every DOM test in this repo boots pinned to the sheet arm (navigator.webdriver),
 * so without this file the arm half of a 50/50 revenue experiment would ship untested.
 *
 * The seed is localStorage BEFORE load — the same door the assignment comment documents for
 * harnesses — so the code under test is byte-identical to what users load.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-pwfull-dom.mjs
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
  console.log('· playwright-core not installed — skipping the full-arm test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__f={'
  + 'arm(){return{cls:paywallEl.classList.contains("pwFull"),arm:pwArm};},'
  + 'open(src){openPaywall(src,true);'
  + 'const lit=[...document.querySelectorAll("#pwHero .pwHeroLn")].filter(l=>l.classList.contains("on")).map(l=>l.dataset.hero);'
  + 'return{lit:lit,ctx:(document.getElementById("pwHeroCtx")||{}).textContent||"",'
  + 'hero:getComputedStyle(document.getElementById("pwHero")).display,'
  + 'plans:getComputedStyle(document.getElementById("pwPlans")).display,'
  + 'title:getComputedStyle(document.getElementById("pwTitle")).display};},'
  + 'prices(p){window.KAMO.setPrices(p);return this.lifeline();},'
  + 'lifeline(){const el=document.getElementById("pwLifeLine");'
  + 'return{show:getComputedStyle(el).display!=="none",text:el.textContent,'
  + 'buy:(document.getElementById("pwBuy")||{}).textContent||"",plan:pwPlan,'
  + 'terms:getComputedStyle(document.getElementById("pwTerms")).display};},'
  /* postNative is the last thing KAMO controls before StoreKit takes over, so stubbing it is
     how "did this actually try to buy" gets answered without a store. ReactNativeWebView has
     to exist too, or pwPurchase() takes the browser branch (setPro) and never posts at all —
     which is the shape of the false pass this hook was written to avoid. Both are removed
     again on the way out so nothing downstream inherits a fake wrapper. */
  + 'tapLine(){window.__bought=null;const rn=window.ReactNativeWebView,pn=postNative;'
  + 'const before={plan:pwPlan,buy:document.getElementById("pwBuy").textContent,'
  + 'line:document.getElementById("pwLifeLine").textContent};'
  + 'window.ReactNativeWebView={postMessage(){}};'
  + 'postNative=(m)=>{if(m&&m.type==="purchase")window.__bought=m.product;return true;};'
  + 'try{document.getElementById("pwLifeLine").click();}finally{postNative=pn;'
  + 'if(rn)window.ReactNativeWebView=rn;else delete window.ReactNativeWebView;}'
  + 'return{purchased:window.__bought,plan:pwPlan,before:before,'
  + 'buy:document.getElementById("pwBuy").textContent,'
  + 'line:document.getElementById("pwLifeLine").textContent,'
  + 'loading:document.getElementById("pwBuy").classList.contains("loading")};},'
  /* #shareSheet is in this list because it was missing from the CSS one, and it is the biggest
     thing on the screen the full arm opens over: on the reveal the sheet is auto-presented, so
     every paywall opened from a finished round had "Can they find you?", the challenge card,
     Challenge a friend and the Instagram button burning through the hero. */
  + 'chrome(){const g=q=>getComputedStyle(document.querySelector(q)).visibility;'
  + 'return{brand:g(".brand"),done:g("#btnDone"),back:g("#btnBack"),hint:g("#hint"),'
  + 'sheet:g("#shareSheet")};},'
  + 'close(){closePaywall();return this.chrome();},'
  + 'facts(){return{paint:PAINT_SECONDS};}};\n'
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

const { globSync } = await import('node:fs');
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

console.log('\nTHE HARNESS PIN HOLDS — WITHOUT A SEED, HEADLESS GETS THE SHEET');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__f, null, { timeout: 10000 });
  const a = await page.evaluate(() => window.__f.arm());
  a.arm === 'sheet' && !a.cls
    ? ok('navigator.webdriver lands on the sheet arm, so every other DOM test stays deterministic')
    : bad(`headless got arm "${a.arm}" (pwFull class: ${a.cls}) — the whole gate is now a coin flip`);
  await page.close();
}

console.log('\nTHE FULL ARM RENDERS, AND THE RIGHT LINE LIGHTS');
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
/* kamo_pw_seen ALONGSIDE THE ARM, and it is a fixture fix rather than a behaviour change.
   Since 2026-08-14 the FIRST paywall an install ever sees has to come from the end of a round
   — the nth split showed that impression converts at twice the rate of any other and was
   being spent by whichever tool lock fired first. This suite is about what the full-bleed arm
   RENDERS, not about when it is allowed to open, and its fixture is a fresh device opening
   from a non-payoff source: exactly the case the new rule defers. Without this seed the
   paywall never opens and five assertions fail on a screen that is fine.
   The gate itself is asserted in scripts/test-pwgate-dom.mjs, which owns that question. */
await page.addInitScript(() => { try {
  localStorage.setItem('kamo_pw_design', 'full');
  localStorage.setItem('kamo_pw_seen', '1');
} catch (e) {} });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__f, null, { timeout: 10000 });
{
  const a = await page.evaluate(() => window.__f.arm());
  a.arm === 'full' && a.cls
    ? ok('the seeded device is on the full arm, class applied')
    : bad(`seeded full but got arm "${a.arm}", class ${a.cls}`);

  const f = await page.evaluate(() => window.__f.facts());
  /* WAS open('time'), AND THAT SLAB IS GONE. The retake paywall was the only thing that ever
     opened the sheet on `time` or `round_end`, and it was removed on 2026-08-12 once the
     measurement showed it was a third of all paywall views for no subscriptions. The hero
     slab it lit went with it: NO CLOCK. sells a constraint the free round no longer has.
     The character took its place, so this is the same assertion pointed at the pitch that
     actually ships — one slab lit, and a context line that names it. */
  const t = await page.evaluate(() => window.__f.open('char'));
  t.hero !== 'none' && t.plans === 'none' && t.title === 'none'
    ? ok('open: hero on screen, sheet copy and plan rows off it')
    : bad(`hero:${t.hero} plans:${t.plans} title:${t.title} — two paywalls are showing at once`);
  t.lit.length === 1 && t.lit[0] === 'char'
    ? ok('the character lock lights EVERY FINISH and nothing else')
    : bad(`from the character lock, lit = ${JSON.stringify(t.lit)}`);
  /* No numeral to check any more — the pitch stopped quoting a clock, which is the point. */
  /* `kamo`, not `body` — the brand's own noun for the figure, banned-word rule of 2026-08-13.
     Asserted as the exact phrase rather than loosened to /finish/: the word IS the thing under
     test here, and a check that survives the noun going back to `body` would be checking
     nothing. */
  /Every kamo and every finish/.test(t.ctx)
    ? ok(`and the context names what is bought ("${t.ctx}")`)
    : bad(`the character context reads: ${JSON.stringify(t.ctx)}`);

  const m = await page.evaluate(() => window.__f.open('mark'));
  m.lit.length === 1 && m.lit[0] === 'mark'
    ? ok('the export lock lights the struck-through WATERMARK')
    : bad(`from the mark lock, lit = ${JSON.stringify(m.lit)}`);

  const g = await page.evaluate(() => window.__f.open('plus'));
  g.lit.length === 0 && g.ctx.length > 0
    ? ok('a contextless open lights nothing and still says something')
    : bad(`generic open: lit=${JSON.stringify(g.lit)} ctx=${JSON.stringify(g.ctx)}`);
}

console.log('\nTHE STAGE GOES QUIET UNDERNEATH, AND WAKES ON CLOSE');
{
  /* `char`, NOT `time`. This page has no prices, so it is a browser as far as the paywall is
     concerned, and since 2026-08-16 an unasked-for source is refused there — `time` would
     have left the sheet closed and this block would have gone on passing off the paywall the
     previous one left open. `char` is a tap on a locked control, which still opens. */
  await page.evaluate(() => window.__f.open('char'));
  const c = await page.evaluate(() => window.__f.chrome());
  Object.values(c).every((v) => v === 'hidden')
    ? ok('wordmark, Retake, Done, the hint and the share sheet are all hidden under the paywall')
    : bad(`stage chrome shows through the full arm: ${JSON.stringify(c)}`);
  const after = await page.evaluate(() => window.__f.close());
  Object.values(after).every((v) => v !== 'hidden')
    ? ok('and every one of them is back the moment it closes')
    : bad(`chrome still hidden after close: ${JSON.stringify(after)} — the app looks broken`);
}

console.log('\nTHE ONE-LINE PLAN SELLS ONLY WHAT THE STORE RETURNED, AND BUYS IN ONE TAP');
{
  const before = await page.evaluate(() => window.__f.lifeline());
  before.show === false
    ? ok('no prices yet → no line, no plan it cannot sell')
    : bad(`the line is showing before the store answered: ${JSON.stringify(before.text)}`);

  const after = await page.evaluate(() => window.__f.prices({ weekly: '$2.99', lifetime: '$14.99', trial: '3 days' }));
  after.show && /or \$14\.99 once/.test(after.text)
    ? ok(`prices in → the line offers lifetime ("${after.text}")`)
    : bad(`with both prices, the line reads: ${JSON.stringify(after.text)} (show:${after.show})`);

  /* The price is in the LABEL itself, one font — and "cancel anytime" lives outside the
     button on the terms line, which also keeps the auto-renewal disclosure visible. */
  /Try 3 days free then \$2\.99 \/ week/.test(after.buy)
    ? ok(`the CTA states the whole deal in one line ("${after.buy.trim()}")`)
    : bad(`the button reads: ${JSON.stringify(after.buy)} — the price never reached the point of decision`);
  after.terms !== 'none'
    ? ok('and the terms line below still speaks (auto-renews · cancel anytime)')
    : bad('the terms line is hidden — the renewal disclosure has to stay visible');

  /* THE LINE BUYS, IT DOES NOT SELECT. Two taps to buy was a leak we invented on a screen
     that already loses 12 Apple-sheet cancels for 0 trials: someone who taps "$14.99 once —
     yours forever" has decided. The assertion is that ONE tap reaches StoreKit with the
     lifetime product — not that the CTA changed. */
  const bought = await page.evaluate(() => window.__f.tapLine());
  bought.purchased === 'com.blisscoach.kamo.pro'
    ? ok('one tap on the line goes straight to StoreKit with the lifetime product')
    : bad(`tapping the line asked to purchase ${JSON.stringify(bought.purchased)} — it must buy, not switch`);
  /* AND IT LEAVES THE SCREEN ALONE. Buying used to run through SELECTING lifetime first —
     pwPlan, the row highlight, updatePwBuy() — so the CTA rewrote itself to the lifetime price
     and the line flipped to offering the weekly, in the same instant StoreKit slid up over
     them. Cancel Apple's sheet and you are returned to a paywall that is not the one you were
     reading. The plan travels as an argument now, and these three assertions are the whole
     difference between "buys" and "selects, then buys". */
  bought.plan === bought.before.plan
    ? ok(`and the selected plan is untouched ("${bought.plan}") — the line buys, it does not select`)
    : bad(`pwPlan moved from "${bought.before.plan}" to "${bought.plan}" on a line tap`);
  bought.buy === bought.before.buy
    ? ok('the CTA still says what it said before the tap')
    : bad(`the CTA rewrote itself from ${JSON.stringify(bought.before.buy)} to `
        + `${JSON.stringify(bought.buy)} while the native sheet was opening`);
  bought.line === bought.before.line
    ? ok('and so does the line itself')
    : bad(`the line flipped from ${JSON.stringify(bought.before.line)} to ${JSON.stringify(bought.line)}`);
  !bought.loading
    ? ok('no spinner on the CTA either — the feedback belongs to the control that was pressed')
    : bad('the weekly CTA went into its loading state because the lifetime line was tapped');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the full-bleed arm renders, lights the right line, and sells only real prices');
process.exit(failed ? 1 : 0);
