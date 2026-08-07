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
  + 'sweep(n){const r=sizeBar.getBoundingClientRect(),out=[];'
  + 'for(let i=0;i<=n;i++){const y=r.top+24+(r.height-48)*(i/n);'
  + 'const o={clientY:y,clientX:r.left+5,bubbles:true,pointerId:1};'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerdown",o));'
  + 'sizeBar.dispatchEvent(new PointerEvent("pointerup",o));out.push(brush);}return out;},'
  + 'sizes(){return FREE_SIZES.slice();},'
  + 'bounds(){return{min:BRUSH_MIN,max:BRUSH_MAX};},'
  + 'spread(){return FREE_SIZES.map(tFromBrush);}};\n'
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
await page.evaluate(() => { document.getElementById('paintUI').style.display = 'block'; });
await page.waitForTimeout(150);

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

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ members get the range they paid for, free users get three sizes');
process.exit(failed ? 1 : 0);
