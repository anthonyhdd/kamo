#!/usr/bin/env node
/**
 * THE PAYWALL SELLS THIS SLIDER, SO THE SLIDER GETS TESTED.
 *
 * The `size` pitch reads "Free paints at N fixed sizes. KAMO+ unlocks the whole range, down to
 * fine detail." That is a promise about a control, made to someone deciding whether to pay, and
 * nothing anywhere asserted that the control keeps it. A member silently stuck on the three
 * presets would be the app taking money for something it does not hand over — and it would look
 * exactly like normal use, because the bar renders identically either way apart from a 10px
 * thumb.
 *
 * Both halves matter and they fail in opposite directions:
 *   · a member snapped to presets is a refund and a one-star review
 *   · a free user reaching the continuous range is the paid tool given away, which is the
 *     substitute problem the free round was deleted for
 *
 * Driven through the real pointer handlers on the real bar, sweeping it end to end, because the
 * branch that decides this lives inside pointerdown and reads canPro() at the moment of the
 * touch — not at render time, which is where a test on classes or thumb visibility would look.
 *
 * THE SECOND HALF OF THIS FILE EXISTS BECAUSE THE FIRST HALF PASSED THROUGH THE WORST DAYS.
 * Everything above only asks whether the paid tool is withheld. For two days it was withheld
 * PERFECTLY and also advertised nowhere: one dot drawn, thumb hidden, and the bar wired to no
 * paywall at all. Trials per new customer went 3.19% → 0.77% and every assertion here stayed
 * green, because "nobody can buy it" and "nobody can find it" look identical to a test that
 * only watches `brush`. So the rest of this file watches what is on screen and what a tap
 * opens — the two things that were silently deleted.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-brush-dom.mjs
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
  console.log('· playwright-core not installed — skipping the brush test (set PW_CORE=<dir with node_modules>)');
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__b={'
  /* forceFree is cleared as well as isPro set: it is the founder preview flag, and a member
     with it left on IS a member seeing the free experience — the one state that would make
     this whole test lie about what a paying user gets. */
  + 'setPro(v){isPro=!!v;forceFree=false;renderSizeBar();},'
  /* THE BAR HAS TO BE ON SCREEN. It ships display:none and startPaint() reveals it, so a test
     that only shows #paintUI leaves clientHeight at 0 — every dot then lands at a negative
     offset off the top of the control and the whole layout reads inverted. The sweep tests
     survived that because sizeFromEvent clamps t, which is exactly the kind of "passes on a
     broken page" this file exists to stop. */
  + 'show(){document.getElementById("paintUI").style.display="block";'
  + 'sizeBar.style.display="block";renderSizeBar();},'
  /* Per-launch state, reset between blocks. PW_CAP.size allows one sheet per launch by
     design, so without this every block after the first measures the capped path and the
     uncapped assertions fail for the wrong reason. */
  + 'reset(){pwOpens=0;pwInterruptions=0;for(const k in pwSourceOpens)delete pwSourceOpens[k];'
  + 'closePaywall();sizeBar.classList.remove("lockPulse");},'
  + 'sweep(n){const r=sizeBar.getBoundingClientRect(),out=[];'
  + 'for(let i=0;i<=n;i++){const y=r.top+24+(r.height-48)*(i/n);'
  + 'const o={clientY:y,clientX:r.left+5,bubbles:true,pointerId:1};'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerdown",o));'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerup",o));out.push(brush);}return out;},'
  + 'sizes(){return FREE_SIZES.slice();},'
  + 'bounds(){return{min:BRUSH_MIN,max:BRUSH_MAX};},'
  + 'spread(){return FREE_SIZES.map(tFromBrush);},'
  + 'stops(){return SIZE_STOPS.slice();},'
  + 'locked(){return PRO_SIZES.slice();},'
  /* What is actually on screen, read back through getComputedStyle rather than from the
     arrays that drew it — a dot positioned off the end of the bar, or left at display:none,
     is invisible to the user no matter what the model says. */
  + 'dots(){return (sizeBar._dots||[]).map((d,i)=>({size:SIZE_STOPS[i],'
  + 'shown:getComputedStyle(d).display!=="none",locked:d.classList.contains("locked"),'
  + 'top:parseFloat(d.style.top)||0,dia:parseFloat(d.style.width)||0}));},'
  + 'pw(){return{open:paywallEl.classList.contains("show"),src:pwLastSource,opens:pwOpens,'
  + 'sizeOpens:pwSourceOpens.size||0,pulsing:sizeBar.classList.contains("lockPulse")};},'
  + 'closePw(){closePaywall();sizeBar.classList.remove("lockPulse");},'
  /* Tap exactly where a stop is drawn, using the same geometry renderSizeBar used, so the
     test exercises the real hit-testing instead of asserting on the arrays. */
  + 'tap(size){const r=sizeBar.getBoundingClientRect(),h=r.height-48;'
  + 'const y=r.top+24+(1-tFromBrush(size))*h;'
  + 'const o={clientY:y,clientX:r.left+5,bubbles:true,pointerId:1};'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerdown",o));'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerup",o));return brush;},'
  + 'star(){return sizeStar.getBoundingClientRect();},'
  + 'barBox(){return sizeBar.getBoundingClientRect();},'
  + 'tapStar(){sizeStar.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:1}));},'
  + 'fillBottom(){return parseFloat(sizeFill.style.bottom)||0;},'
  + 'barH(){return sizeBar.clientHeight;}};\n'
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__b, null, { timeout: 10000 });
/* The bar only has a height once the paint screen is up, and there is no camera here. */
await page.evaluate(() => window.__b.show());
await page.waitForTimeout(150);
{
  const h = await page.evaluate(() => window.__b.barH());
  if (h < 100) { console.error(`  ✗ the size bar is ${h}px tall — every geometry assertion below would be meaningless`); failed++; }
}

const FREE = await page.evaluate(() => window.__b.sizes());
const B = await page.evaluate(() => window.__b.bounds());

console.log('\nA MEMBER GETS THE WHOLE SCALE');
{
  const swept = await page.evaluate(() => { window.__b.setPro(true); return window.__b.sweep(12); });
  const distinct = new Set(swept);
  distinct.size > FREE.length + 3
    ? ok(`${distinct.size} distinct sizes across the bar, not ${FREE.length} (${swept[0]} → ${swept[swept.length - 1]})`)
    : bad(`a member reaches only ${distinct.size} sizes (${[...distinct].join(', ')}) — they are snapped to the `
        + 'presets, which is the paywall selling a control it does not hand over');
  swept.some((b) => b < Math.min(...FREE))
    ? ok(`and reaches below the smallest free size (down to ${Math.min(...swept)}, floor ${B.min})`)
    : bad(`a member never gets under ${Math.min(...FREE)} — "down to fine detail" is the pitch, and `
        + 'the fine end is exactly what is missing');
  swept.some((b) => b > Math.max(...FREE))
    ? ok(`and above the largest (up to ${Math.max(...swept)}, ceiling ${B.max})`)
    : bad(`a member never gets over ${Math.max(...FREE)}`);
}

console.log('\nA FREE USER DOES NOT');
{
  const swept = await page.evaluate(() => { window.__b.setPro(false); return window.__b.sweep(12); });
  const distinct = [...new Set(swept)].sort((a, b) => a - b);
  distinct.every((b) => FREE.includes(b))
    ? ok(`every touch lands on a preset (${distinct.join(', ')})`)
    : bad(`a free user reached ${distinct.filter((b) => !FREE.includes(b)).join(', ')} — the paid tool `
        + 'is being given away, which is the substitute problem the free round was deleted for');
  distinct.length === FREE.length
    ? ok(`and all ${FREE.length} of them are reachable`)
    : bad(`only ${distinct.length} of the ${FREE.length} free sizes can be selected (${distinct.join(', ')}) — `
        + 'one of them is unreachable, so the choice is smaller than the paywall says');
}

console.log('\nTHE THREE FREE SIZES READ AS THREE');
{
  const t = await page.evaluate(() => window.__b.spread());
  /* Positions on the bar, not raw sizes: BRUSH_CURVE bends the response, so 16/26/40 looked
     like a spread and rendered as three marks inside the top third of the control. */
  const gaps = t.slice(1).map((v, i) => v - t[i]);
  gaps.every((g) => g > 0.16)
    ? ok(`they sit ${gaps.map((g) => g.toFixed(2)).join(' and ')} apart on the bar`)
    : bad(`the free sizes are ${gaps.map((g) => g.toFixed(2)).join(' and ')} apart — they land close `
        + 'enough together to read as one size');
  t[0] > 0.25 && t[t.length - 1] < 0.95
    ? ok(`and stay off both ends (${t[0].toFixed(2)} – ${t[t.length - 1].toFixed(2)})`)
    : bad(`the free range runs to the end of the bar (${t[0].toFixed(2)} – ${t[t.length - 1].toFixed(2)}) — `
        + 'there is nothing visibly left to unlock');
}

/* ── The half that was missing, and it is the half the money was in. ─────────────────────
   Everything above checks that the paid tool is not given away. Nothing checked that anyone
   could FIND OUT it was for sale — and for two days nobody could: one dot was drawn, the
   thumb was hidden, and the bar never opened the paywall at all. Trials per new customer
   went 3.19% → 0.77% across that change. These are the assertions that would have caught it.
*/
console.log('\nA FREE USER CAN SEE WHAT THEY DO NOT HAVE');
{
  const STOPS = await page.evaluate(() => window.__b.stops());
  const LOCKED = await page.evaluate(() => window.__b.locked());
  const dots = await page.evaluate(() => { window.__b.reset(); window.__b.setPro(false); return window.__b.dots(); });
  const shown = dots.filter((d) => d.shown);

  shown.length === STOPS.length
    ? ok(`all ${STOPS.length} stops are drawn (${shown.map((d) => d.size).join(', ')})`)
    : bad(`only ${shown.length} of ${STOPS.length} stops are drawn — a control that shows one `
        + 'position cannot teach anyone that the other four exist');

  const lockedShown = shown.filter((d) => d.locked).map((d) => d.size).sort((a, b) => b - a);
  lockedShown.join() === LOCKED.slice().sort((a, b) => b - a).join()
    ? ok(`the locked sizes are visible and marked locked (${lockedShown.join(', ')})`)
    : bad(`locked stops rendered: ${lockedShown.join(', ') || 'none'}, expected ${LOCKED.join(', ')} — `
        + 'an invisible paid range is a paid range nobody buys');

  /* Two stops that overlap are one stop with a smear, and the user cannot aim at either. */
  const ordered = [...shown].sort((a, b) => a.top - b.top);
  const clearance = ordered.slice(1).map((d, i) =>
    (d.top - ordered[i].top) - (d.dia / 2) - (ordered[i].dia / 2));
  Math.min(...clearance) > 4
    ? ok(`and none of them collide (tightest gap ${Math.min(...clearance).toFixed(1)}px)`)
    : bad(`two stops are ${Math.min(...clearance).toFixed(1)}px apart edge to edge — they read as `
        + 'one blob and cannot be aimed at separately');

  const dias = ordered.map((d) => d.dia);
  new Set(dias).size === dias.length && dias.every((v, i) => i === 0 || v <= dias[i - 1])
    ? ok(`each dot previews its stroke (${[...dias].reverse().join(' → ')}px, all distinct)`)
    : bad(`dot diameters are ${dias.join(', ')} — they must be distinct and shrink down the bar, `
        + 'or the dots stop meaning "size" and become decoration');
}

console.log('\nTAPPING A LOCKED SIZE ASKS TO BUY IT');
{
  const LOCKED = await page.evaluate(() => window.__b.locked());
  const FREE_MID = FREE[1];

  const before = await page.evaluate((s) => { window.__b.reset(); window.__b.setPro(false); return window.__b.tap(s); }, FREE_MID);
  const afterFree = await page.evaluate(() => window.__b.pw());
  before === FREE_MID && !afterFree.open
    ? ok(`tapping a free stop selects it (${before}) and does not interrupt`)
    : bad(`tapping the free stop ${FREE_MID} gave brush ${before}, paywall open=${afterFree.open} — `
        + 'a free size must never cost a full screen');

  const held = await page.evaluate((s) => window.__b.tap(s), LOCKED[0]);
  const afterLock = await page.evaluate(() => window.__b.pw());
  afterLock.open && afterLock.src === 'size'
    ? ok(`tapping the locked ${LOCKED[0]} opens the paywall as source "${afterLock.src}"`)
    : bad(`tapping the locked stop ${LOCKED[0]} left the paywall open=${afterLock.open} src=${afterLock.src} — `
        + 'this is the regression that took the paint screen out of the funnel entirely');
  held === FREE_MID
    ? ok(`and does not hand the locked size over (brush still ${held})`)
    : bad(`the brush moved to ${held} on a locked tap — the paid tool is being given away`);
}

console.log('\nAND IT CANNOT FLOOD: ONE SHEET PER LAUNCH, THEN THE BAR ANSWERS');
{
  const LOCKED = await page.evaluate(() => window.__b.locked());
  /* NOT a reset: the cap must already be spent, because that is the state being tested. */
  await page.evaluate(() => window.__b.closePw());
  const second = await page.evaluate((s) => { window.__b.tap(s); return window.__b.pw(); }, LOCKED[1]);
  !second.open && second.pulsing
    ? ok('a second locked tap pulses the bar instead of opening a second sheet')
    : bad(`the second locked tap left open=${second.open} pulsing=${second.pulsing} — either it `
        + 'floods (824 views, one tap) or it refuses in total silence, and both have shipped before');
  second.sizeOpens === 1
    ? ok(`and "size" is charged exactly once (${second.sizeOpens})`)
    : bad(`"size" opened ${second.sizeOpens} times — PW_CAP.size is not holding`);
}

console.log('\nTHE ✦ IS ON THE BAR, NOT HANGING OFF IT');
{
  const box = await page.evaluate(() => window.__b.star());
  const bar = await page.evaluate(() => window.__b.barBox());
  box.bottom <= bar.bottom + 0.5 && box.top >= bar.top
    ? ok(`it sits inside the bar (${(bar.bottom - box.bottom).toFixed(0)}px clear of the foot)`)
    : bad(`the ✦ runs from ${box.top.toFixed(0)} to ${box.bottom.toFixed(0)} against a bar of `
        + `${bar.top.toFixed(0)}–${bar.bottom.toFixed(0)} — the only paywall entry on this screen `
        + 'is floating over the photo, unattached to the control it marks');
  box.height >= 30 && box.width >= 30
    ? ok(`and is a real tap target (${box.width.toFixed(0)}×${box.height.toFixed(0)}px)`)
    : bad(`the ✦ tap target is ${box.width.toFixed(0)}×${box.height.toFixed(0)}px — under 30px it is `
        + 'a decoration, not a button');

  await page.evaluate(() => window.__b.closePw());
  const starPw = await page.evaluate(() => { window.__b.tapStar(); return window.__b.pw(); });
  starPw.open && starPw.src === 'size_star'
    ? ok('and tapping it still opens the sheet, uncapped, as "size_star"')
    : bad(`the ✦ left the paywall open=${starPw.open} src=${starPw.src} — the one deliberate `
        + 'buying signal on the paint screen must always be answered');
}

console.log('\nTHE FILL STOPS WHERE THE FREE RANGE STOPS');
{
  const r = await page.evaluate(() => {
    window.__b.setPro(false);
    return { free: window.__b.fillBottom(), h: window.__b.barH() };
  });
  const m = await page.evaluate(() => { window.__b.setPro(true); return window.__b.fillBottom(); });
  r.free > m
    ? ok(`a free user's fill ends ${(r.free - m).toFixed(0)}px above the foot, clear of the locked stops`)
    : bad(`the free fill ends at ${r.free}px like a member's (${m}px) — a solid line drawn through `
        + 'the locked stops says "you already have these"');
}
await page.evaluate(() => window.__b.setPro(false));

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the bar hands over what was paid for, and shows what was not');
process.exit(failed ? 1 : 0);
