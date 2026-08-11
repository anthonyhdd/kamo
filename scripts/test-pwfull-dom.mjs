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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of [process.env.PW_CORE, ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the full-arm test (set PW_CORE=<dir with node_modules>)');
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
  + 'return{show:el.style.display!=="none",text:el.textContent,'
  + 'buy:(document.getElementById("pwBuy")||{}).textContent||"",plan:pwPlan};},'
  + 'toggle(){document.getElementById("pwLifeLine").click();return this.lifeline();},'
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
const exe = (globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome') || [])[0];
if (!exe) { console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
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
await page.addInitScript(() => { try { localStorage.setItem('kamo_pw_design', 'full'); } catch (e) {} });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__f, null, { timeout: 10000 });
{
  const a = await page.evaluate(() => window.__f.arm());
  a.arm === 'full' && a.cls
    ? ok('the seeded device is on the full arm, class applied')
    : bad(`seeded full but got arm "${a.arm}", class ${a.cls}`);

  const f = await page.evaluate(() => window.__f.facts());
  const t = await page.evaluate(() => window.__f.open('time'));
  t.hero !== 'none' && t.plans === 'none' && t.title === 'none'
    ? ok('open: hero on screen, sheet copy and plan rows off it')
    : bad(`hero:${t.hero} plans:${t.plans} title:${t.title} — two paywalls are showing at once`);
  t.lit.length === 1 && t.lit[0] === 'time'
    ? ok('the clock lock lights MORE TIME and nothing else')
    : bad(`from the time lock, lit = ${JSON.stringify(t.lit)}`);
  t.ctx.includes(`${f.paint} seconds`) && /All the time you want/.test(t.ctx) && /waiting/.test(t.ctx)
    ? ok(`and the context sells unlimited against the real free clock ("${t.ctx}")`)
    : bad(`the time context reads: ${JSON.stringify(t.ctx)}`);

  const re = await page.evaluate(() => window.__f.open('round_end'));
  !/waiting/.test(re.ctx) && re.ctx.includes(`${f.paint} seconds`)
    ? ok('round_end keeps the free clock but drops "this round is waiting" — the round is over')
    : bad(`round_end context reads: ${JSON.stringify(re.ctx)}`);

  const m = await page.evaluate(() => window.__f.open('mark'));
  m.lit.length === 1 && m.lit[0] === 'mark'
    ? ok('the export lock lights the struck-through WATERMARK')
    : bad(`from the mark lock, lit = ${JSON.stringify(m.lit)}`);

  const g = await page.evaluate(() => window.__f.open('plus'));
  g.lit.length === 0 && g.ctx.length > 0
    ? ok('a contextless open lights nothing and still says something')
    : bad(`generic open: lit=${JSON.stringify(g.lit)} ctx=${JSON.stringify(g.ctx)}`);
}

console.log('\nTHE ONE-LINE PLAN TOGGLE SELLS ONLY WHAT THE STORE RETURNED');
{
  const before = await page.evaluate(() => window.__f.lifeline());
  before.show === false
    ? ok('no prices yet → no line, no plan it cannot sell')
    : bad(`the line is showing before the store answered: ${JSON.stringify(before.text)}`);

  const after = await page.evaluate(() => window.__f.prices({ weekly: '$2.99', lifetime: '$14.99', trial: '3 days' }));
  after.show && /or \$14\.99 once/.test(after.text)
    ? ok(`prices in → the line offers lifetime ("${after.text}")`)
    : bad(`with both prices, the line reads: ${JSON.stringify(after.text)} (show:${after.show})`);

  const flipped = await page.evaluate(() => window.__f.toggle());
  flipped.plan === 'lifetime' && /\$14\.99/.test(flipped.buy) && /\$2\.99\/week/.test(flipped.text)
    ? ok(`tapping it flips the CTA to lifetime and offers the weekly back ("${flipped.text}")`)
    : bad(`after the toggle: plan=${flipped.plan} buy=${JSON.stringify(flipped.buy)} line=${JSON.stringify(flipped.text)}`);

  const back = await page.evaluate(() => window.__f.toggle());
  back.plan === 'weekly' && /or \$14\.99 once/.test(back.text)
    ? ok('and tapping again goes back to the weekly with the trial CTA')
    : bad(`after the second toggle: plan=${back.plan} line=${JSON.stringify(back.text)}`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the full-bleed arm renders, lights the right line, and sells only real prices');
process.exit(failed ? 1 : 0);
