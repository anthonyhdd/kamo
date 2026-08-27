#!/usr/bin/env node
/**
 * A KAMO MAY NOT HANG OFF THE EDGE OF THE BOARD.
 *
 * Founder, 2026-08-27, with a screenshot: half a body cut off by the side of the frame. It is
 * not a hiding place, it is a hide nobody can win — the part that identifies a figure may be
 * the part that is not there — and it leaves a seeker staring at an edge for a shape that was
 * never in the picture.
 *
 * ⚠️ THIS SUITE MEASURES PIXELS, NOT COORDINATES. A world-space assertion would only prove the
 * clamp agrees with itself; what has to be true is that the figure the SHUTTER captures is
 * whole. So it reads the rendered alpha off the capture and asserts the body's bounding box
 * does not touch the frame — the same canvas chGeom() reads the answer key from, which means
 * the thing asserted is the thing published.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-edgeguard-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the edge-guard test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(real); }
  let b = null; try { b = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); } catch {}
  if (b) { rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(b); }
  else { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
await page.goto(base + '?debug', { waitUntil: 'load' });
await page.waitForFunction(() => !!(window.HIDEY && window.HIDEY.setBg && window.HIDEY.setTarget), { timeout: 20000 });
await page.evaluate(() => window.HIDEY.setBg('data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="100%" height="100%" fill="#8a9299"/></svg>')));
await page.waitForTimeout(900);

/* Shove it far past every edge in turn and read what the shutter actually caught. */
const shove = async (x, y) => page.evaluate(([x, y]) => {
  window.HIDEY.setTarget(x, y);
  window.HIDEY.step(40);
  /* ⚠️ #gl, NOT #board. The board is the PHOTOGRAPH with the figure painted into it — opaque
     in every pixel, so an alpha bbox over it is always the whole frame, which is what the
     first version of this suite measured and reported as six failures against a working
     guard. #gl is the three.js render: transparent everywhere except the body. It is also
     the surface chGeom() reads the published answer key from, so this asserts the same
     pixels the game is played on. */
  const c = document.getElementById('gl');
  const g = c.getContext('webgl2') || c.getContext('webgl');
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  /* readPixels is bottom-up; the flip is done in the loop below by reading rows in reverse. */
  const d = px;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) {
    const flipped = h - 1 - yy;
    if (d[(flipped * w + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  return x1 < 0 ? null : { x0: x0 / w, x1: x1 / w, y0: y0 / h, y1: y1 / h };
}, [x, y]);

console.log('\n— a shoved kamo stays whole —');
for (const [name, x, y] of [['left', -999, 0], ['right', 999, 0], ['down', 0, -999], ['up', 0, 999],
                            ['bottom-right', 999, -999], ['top-left', -999, 999]]) {
  const b = await shove(x, y);
  if (!b) { bad(`${name}: nothing opaque on the board at all — the figure left the frame entirely`); continue; }
  /* One sampled row of tolerance: the scan steps 2px, so a body genuinely inside can still
     report a bbox one sample short of the true edge. */
  const eps = 0.006;
  const clipped = b.x0 <= eps || b.y0 <= eps || b.x1 >= 1 - eps || b.y1 >= 1 - eps;
  clipped
    ? bad(`shoved ${name}, the body reaches the frame edge (x ${b.x0.toFixed(3)}–${b.x1.toFixed(3)}, `
        + `y ${b.y0.toFixed(3)}–${b.y1.toFixed(3)}). A seeker cannot find a shape that is not all there.`)
    : ok(`shoved ${name}, it stops whole inside the frame (x ${b.x0.toFixed(2)}–${b.x1.toFixed(2)}, y ${b.y0.toFixed(2)}–${b.y1.toFixed(2)})`);
}

/* AND IT MUST NOT BECOME A CAGE. The guard exists to stop a body leaving the frame, not to
   stop it moving: a target well inside has to be honoured exactly. */
{
  const before = await page.evaluate(() => { window.HIDEY.setTarget(0, 0); window.HIDEY.step(40); return window.HIDEY.charPos(); });
  const mid = await page.evaluate(() => { window.HIDEY.setTarget(0.4, 0.3); window.HIDEY.step(40); return window.HIDEY.charPos(); });
  (Math.abs(mid.tx - 0.4) < 1e-6 && Math.abs(mid.ty - 0.3) < 1e-6)
    ? ok('and a target well inside the frame is honoured untouched')
    : bad(`a legal move was clamped: asked (0.4, 0.3), got (${mid.tx}, ${mid.ty}) — the guard has `
        + `become a cage. Was at (${before.tx}, ${before.ty}).`);
}

await page.close();
await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} edge-guard check(s) failed` : '\n✓ the kamo stays whole, and still moves');
process.exit(failed ? 1 : 0);
