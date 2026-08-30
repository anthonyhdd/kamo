#!/usr/bin/env node
/**
 * THE KAMO ARRIVES, IT DOES NOT SIMPLY EXIST.
 *
 * Everything else on the compose screen already has weight: the drag is a spring with momentum
 * and an elastic settle, the limbs trail the movement and ease back to rest, the shutter lands
 * a bounded punch that decays. The one moment with no motion at all was the FIRST one — the
 * figure was there between two frames, the only event on that screen that reads as a page
 * render rather than as a thing happening.
 *
 * ⚠️ IT REUSES THE SPRING AND THE PUNCH rather than adding a third system: the group is lifted
 * and `_ty` left at the base, so the existing spring does the fall with the same momentum and
 * settle the drag has. One behaviour, not two that have to be kept in agreement.
 *
 * ⚠️ AND THE LANDING IS AN EVENT, NOT A TIMER. A setTimeout would guess at a spring whose
 * duration depends on the frame rate — punching mid-air on a 120Hz screen and long after the
 * fact on a stalled one. lerpChar fires it when the figure has actually arrived, which is what
 * this suite drives: HIDEY.step() advances the spring by hand, so the assertions are about the
 * physics rather than about how fast the machine running them happens to be.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-arrival-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the arrival test — run: ' + PW_SETUP); process.exit(0); }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png',
               '.json': 'application/json', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  let body = null;
  try { body = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); } catch {}
  if (body) { rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(body); }
  else { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
await page.goto(base + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.HIDEY && window.HIDEY.setBg && window.HIDEY.charPos), { timeout: 20000 });
await page.evaluate(() => window.HIDEY.setBg('data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="100%" height="100%" fill="#8a9299"/></svg>')));
await page.waitForTimeout(900);

console.log('\nIT FALLS IN, AND IT LANDS WHERE IT BELONGS');
{
  /* Re-spawned by hand so the drop is observed from its first frame: the boot spawn happened
     while the page was still loading and has long since settled by the time a test can look. */
  const start = await page.evaluate(() => {
    window.HIDEY.respawn();
    return window.HIDEY.charPos();
  });
  start && typeof start.y === 'number' && typeof start.ty === 'number'
    ? ok(`the figure reports a position (${start.y.toFixed(2)}) and a target (${start.ty.toFixed(2)})`)
    : bad('charPos gave nothing usable: ' + JSON.stringify(start));

  /* ABOVE ITS PLACE, NOT AT IT. This is the whole change: the spring is pulling to the base
     and the figure starts over it. */
  start && (start.y - start.ty) > 0.5
    ? ok(`it starts above where it belongs (+${(start.y - start.ty).toFixed(2)})`)
    : bad(`it spawned at its target (y ${start && start.y}, ty ${start && start.ty}) — there `
        + 'is no fall, so the first moment on this screen is still a page render');

  /* AND THE SPRING BRINGS IT DOWN. Stepped by hand rather than waited on: the duration is a
     function of frame rate, and a wall-clock wait would assert the machine, not the physics. */
  const settled = await page.evaluate(() => { window.HIDEY.step(90); return window.HIDEY.charPos(); });
  Math.abs(settled.y - settled.ty) < 0.03
    ? ok(`and the spring settles it on the base (${settled.y.toFixed(3)} vs ${settled.ty.toFixed(3)})`)
    : bad(`it never arrived: y ${settled.y} against ty ${settled.ty} — the figure is left `
        + 'hanging, which is worse than no drop at all');
}

console.log('\nAND THE LANDING IS AN EVENT, NOT A TIMER');
{
  /* The punch is the shutter's own decaying squash, reused. What matters is that it fires ON
     ARRIVAL: a timer would land it mid-air on a fast screen and long after the fact on a slow
     one. Driving the spring by hand is the only way to assert that distinction. */
  /* ⚠️ A DURATION, NOT MERELY "NOT INSTANT", AND THAT IS THE ASSERTION THIS SUITE EXISTS FOR.
     The first version of the drop reused the drag spring, which is tuned for a finger: the
     target sits hundredths away and it closes that in a frame or two. Handed 1.15 units it did
     the same thing — measured in a browser, 1.15 to -0.05 in THREE frames, about 50ms. The
     arithmetic was right and the animation did not exist, and an assertion that only asked
     "is it still above the base after two frames" was green the whole time.
     Counted frame by frame instead: a fall has to be READABLE, which is neither a teleport nor
     a wait. 20 frames is a third of a second at 60Hz. */
  const fall = await page.evaluate(() => {
    window.HIDEY.respawn();
    const seen = [];
    for (let i = 0; i < 60; i++) { seen.push(window.HIDEY.charPos().y); window.HIDEY.step(1); }
    const base = window.HIDEY.charPos().ty;
    return { landedAt: seen.findIndex((v) => v <= base + 0.0001), seen: seen.slice(0, 16) };
  });
  fall.landedAt >= 10
    ? ok(`the fall lasts ${fall.landedAt} frames — long enough to be seen`)
    : bad(`the figure landed after ${fall.landedAt} frames (~${Math.round(fall.landedAt * 16.7)}ms) — `
        + 'that is a teleport with extra steps, which is what reusing the drag spring produced');
  fall.landedAt <= 45
    ? ok('and short enough that nobody waits for it')
    : bad(`the fall takes ${fall.landedAt} frames — the compose screen is held hostage by it`);
  /* ACCELERATING, not linear: a constant-speed drop reads as a slide, not as weight.
     ⚠️ SAMPLED WIDE APART. Comparing the first frame-pair against the second one reads
     0.010 against 0.010 — gravity is real there but smaller than the rounding, so a correct
     fall failed this assertion. Early against LATE is where acceleration is legible. */
  const early = fall.seen[1] - fall.seen[2];
  const late = fall.seen[11] - fall.seen[12];
  late > early * 1.5
    ? ok(`it accelerates — ${early.toFixed(4)} per frame at the top, ${late.toFixed(4)} lower down`)
    : bad(`the fall is linear (${early.toFixed(4)} then ${late.toFixed(4)} per frame) — no gravity, `
        + 'so it reads as a slide rather than as weight');

  /* IT CAN ONLY LAND ONCE. `_dropping` is cleared before the punch is set, so a spring that
     hovers inside the threshold for several frames cannot re-punch every frame — which would
     be a figure that never stops shaking. */
  const twice = await page.evaluate(() => { window.HIDEY.step(30); return window.HIDEY.charPos(); });
  Math.abs(twice.y - twice.ty) < 0.03
    ? ok('and it stays landed — the punch does not re-fire every frame it sits still')
    : bad('the figure moved again after landing: ' + JSON.stringify(twice));
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ the kamo arrives');
