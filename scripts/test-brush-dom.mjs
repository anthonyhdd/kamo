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
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the brush test — run: ' + PW_SETUP);
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
  + 'reset(){pwOpens=0;pwInterruptions=0;for(const k in pwSourceOpens)delete pwSourceOpens[k];sizeBar._askedFloor=0;sizeBar.classList.remove("floorBounce");'
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
  + 'top:parseFloat(d.style.top)||0,dia:parseFloat(d.style.height)||0}));},'
  + 'pw(){return{open:paywallEl.classList.contains("show"),src:pwLastSource,opens:pwOpens,'
  + 'sizeOpens:pwSourceOpens.size||0,pulsing:sizeBar.classList.contains("lockPulse"),'
  + 'bouncing:sizeBar.classList.contains("floorBounce")};},'
  + 'closePw(){closePaywall();sizeBar.classList.remove("lockPulse");},'
  /* Tap exactly where a stop is drawn, using the same geometry renderSizeBar used, so the
     test exercises the real hit-testing instead of asserting on the arrays. */
  + 'tap(size){const r=sizeBar.getBoundingClientRect(),h=r.height-48;'
  + 'const y=r.top+stopY(SIZE_STOPS.indexOf(size),h);'
  + 'const o={clientY:y,clientX:r.left+5,bubbles:true,pointerId:1};'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerdown",o));'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerup",o));return brush;},'
  + 'tapFoot(){const r=sizeBar.getBoundingClientRect(),h=r.height-48;'
  + 'const y=r.top+24+starZoneY(h)+6;'
  + 'const o={clientY:y,clientX:r.left+5,bubbles:true,pointerId:1};'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerdown",o));'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerup",o));return brush;},'
  + 'starShown(){return getComputedStyle(sizeStar).display!=="none";},'
  + 'thumb(){return{shown:getComputedStyle(sizeThumb).display!=="none",dia:parseFloat(sizeThumb.style.width)||0};},'
  + 'setBrush(b){brush=b;renderSizeBar();return{dia:parseFloat(sizeThumb.style.width)||0};},'
  + 'floorPct(){return parseFloat(sizeBar.style.getPropertyValue("--floorPct"))||0;},'
  + 'star(){return sizeStar.getBoundingClientRect();},'
  + 'barBox(){return sizeBar.getBoundingClientRect();},'
  + 'tapStar(){sizeStar.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:1}));},'
  + 'fillShown(){return getComputedStyle(sizeFill).display!=="none";},'
  + 'railShown(){return !sizeBar.classList.contains("stops");},'
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
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
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
/* THE RULE, NOT THE ARRANGEMENT. This block used to assert "no stops are drawn" AND "the
   thumb is visible" — two descriptions of one particular layout, not of the thing 6 August
   broke. That day one dot was drawn, the thumb was hidden and the bar never opened the
   paywall: a free user was shown NOTHING. The rule is that the control must never be empty,
   not that the thumb in particular is what fills it.
   Asserting the layout instead of the rule is also what let a SECOND failure through
   underneath it. With the thumb as the only object, 10/20/36 render at 19/23/27px — a 3.6x
   range of brush drawn as 1.4x — and players report that the three sizes look the same.
   That is now its own assertion, because it is the failure that was actually reported. */
console.log('\nA FREE USER CAN SEE THE WHOLE FREE SET');
{
  await page.evaluate(() => { window.__b.reset(); window.__b.setPro(false); });
  const dots = await page.evaluate(() => window.__b.dots());
  const shown = dots.filter((d) => d.shown);
  const t = await page.evaluate(() => window.__b.thumb());

  (shown.length > 0 || t.shown)
    ? ok(shown.length ? `${shown.length} stops are drawn (${shown.map((d) => d.size).join(', ')})`
                      : `the thumb stands in for them (${t.dia}px)`)
    : bad('a free user faces an EMPTY control — no stops and no thumb. That is the 6 August '
        + 'bug, the one that took trials per new customer from 3.19% to 0.77%.');

  const refused = shown.filter((d) => !FREE.includes(d.size));
  refused.length === 0
    ? ok('and nothing is drawn that a tap would be refused')
    : bad(`${refused.length} unavailable sizes are drawn (${refused.map((d) => d.size).join(', ')}) — `
        + 'a size picker that shows what it refuses is a frustration machine, whatever it is styled like');

  if (shown.length > 1) {
    const dias = shown.map((d) => d.dia);
    const spread = Math.max(...dias) / Math.max(0.01, Math.min(...dias));
    const brushSpread = Math.max(...FREE) / Math.min(...FREE);
    new Set(dias).size === dias.length && spread >= 2
      ? ok(`and they look like different sizes (${dias.join(' / ')}px — ${spread.toFixed(1)}x across a ${brushSpread.toFixed(1)}x range)`)
      : bad(`the free sizes are drawn at ${dias.join(' / ')}px — ${spread.toFixed(1)}x, for a brush range of `
          + `${brushSpread.toFixed(1)}x. Players cannot see three levels because three levels are not being drawn.`);
  }

  const st = await page.evaluate(() => window.__b.starShown());
  st ? bad('the ✦ is still on the paint screen — the fading rail already says "there is more", '
        + 'and a second signal is the last piece of furniture left on the photo')
     : ok('and the ✦ is gone with them');
}

console.log('\nTHE THUMB IS THE PREVIEW');
{
  const sizes = [];
  for (const b of FREE) sizes.push(await page.evaluate((x) => window.__b.setBrush(x), b));
  sizes.every((v, i) => i === 0 || v.dia > sizes[i - 1].dia)
    ? ok(`its diameter follows the brush (${sizes.map((v) => v.dia).join(' → ')}px for ${FREE.join(', ')})`)
    : bad(`diameters ${sizes.map((v) => v.dia).join(', ')} do not follow ${FREE.join(', ')} — the one `
        + 'object left has to carry the size, or the control says nothing at all');
}

console.log('\nTHE RAIL SAYS THE SCALE CONTINUES, WITHOUT OFFERING IT');
{
  const f = await page.evaluate(() => { window.__b.setPro(false); return window.__b.floorPct(); });
  const m = await page.evaluate(() => { window.__b.setPro(true); return window.__b.floorPct(); });
  f > 20 && f < 85
    ? ok(`a free user's rail runs solid to ${f.toFixed(0)}% and fades below it`)
    : bad(`--floorPct is ${f} for a free user — the fade has to sit where their travel actually ends`);
  m >= 99
    ? ok('a member\'s rail is uniform — nothing below is locked, so nothing suggests it')
    : bad(`a member's rail fades at ${m}% — that is a lie about a range they own`);
  await page.evaluate(() => window.__b.setPro(false));
}

console.log('\nREACHING UNDER THE FLOOR STILL ASKS TO BUY');
{
  await page.evaluate((b) => { window.__b.reset(); window.__b.setBrush(b); }, FREE[1]);
  const held = await page.evaluate(() => window.__b.tapFoot());
  const first = await page.evaluate(() => window.__b.pw());
  first.open && first.src === 'size_star'
    ? ok(`the first reach opens the sheet as "${first.src}", uncapped`)
    : bad(`the first reach left open=${first.open} src=${first.src} — the paint screen is out of `
        + 'the funnel again, which is the regression this whole thread started from');
  held === FREE[1]
    ? ok(`and the brush does not move (still ${held})`)
    : bad(`the brush jumped to ${held} — the foot is not a stop`);

  await page.evaluate(() => window.__b.closePw());
  const second = await page.evaluate(() => { window.__b.tapFoot(); return window.__b.pw(); });
  !second.open && second.bouncing
    ? ok('and asking again bounces the thumb instead of a second full screen mid-round')
    : bad(`the second reach left open=${second.open} bouncing=${second.bouncing} — it either floods `
        + '(824 views, one tap) or refuses in silence, and both have shipped before');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the bar hands over what was paid for, and shows what was not');
process.exit(failed ? 1 : 0);
