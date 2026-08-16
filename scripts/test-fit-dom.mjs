#!/usr/bin/env node
/**
 * A PICKED PHOTO FILLS THE BOARD. THE CAMERA STILL GETS ITS BARS.
 *
 * The letterbox in coverInto() exists for ONE source: the camera. The sensor is wider than the
 * board, a cover-crop throws that width away, and the blurred bars buy back a field of view the
 * user can see is missing because the stock Camera app shows it. That argument does not survive
 * the trip to the photo library — nothing was cropped on the way in, there is no wider version
 * to restore — and the geometry did not care. A standard iPhone photo (3024x4032, sr 0.75) on a
 * 9:19.5 board (dr 0.46) lands at dr/sr 0.62, one hundredth over MIN_FIT_H, straight into the
 * fit path: ~18% of blurred, 45%-dimmed screen top and bottom. Portrait shots off the camera
 * roll — the most obvious thing to hide a figure in — came back letterboxed, and the bars are
 * PIXELS INSIDE THE PUBLISHED IMAGE, so every seeker of that hide saw them too.
 *
 * This asserts the rule from both ends, because it is one predicate with two callers and they
 * fail in opposite directions:
 *   · a picked photo that still bands is the bug this file was written for
 *   · a camera frame that stops banding is the "zoomed in" viewfinder coming back, which is a
 *     regression nobody would report as one — it just looks like a narrower lens
 *
 * Driven through the real coverInto() into a real canvas and read back as PIXELS, not as the
 * predicate's return value: the bars are two drawImage calls and a 45% black fill after the
 * branch, and a test on the boolean would pass just as happily if the fill outlived it. A
 * source painted pure red gives an unambiguous readout — 255 is the frame, anything near 140 is
 * the dimmed blur.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-fit-dom.mjs
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
  console.log('· playwright-core not installed — skipping the fit test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__ff={'
  /* A solid source, so a sampled pixel says which PATH ran and nothing else. Any texture here
     would survive the blur as texture and make "is this the frame or the fill" a judgement. */
  + 'async photo(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;'
  + 'const g=c.getContext("2d");g.fillStyle="#ff0000";g.fillRect(0,0,w,h);'
  + 'const u=c.toDataURL("image/png");'
  + 'await new Promise((res,rej)=>{photo.onload=res;photo.onerror=rej;photo.src=u;});'
  + 'bgKind="photo";syncPreviewFit();return photo.style.objectFit;},'
  /* The board canvas, at the aspect the phone actually hands coverInto — NOT the stage's, which
     is what usesFitFrame() falls back to. Passing it through is the whole reason the predicate
     takes a ratio. */
  + 'render(cw,ch){const c=document.createElement("canvas");c.width=cw;c.height=ch;'
  + 'const g=c.getContext("2d");coverInto(g,cw,ch);'
  + 'const px=(x,y)=>{const d=g.getImageData(x,y,1,1).data;return d[0];};'
  + 'return{band:{y:+sceneBand.y.toFixed(4),h:+sceneBand.h.toFixed(4)},'
  + 'top:px(cw>>1,2),mid:px(cw>>1,ch>>1),bot:px(cw>>1,ch-3)};},'
  /* The camera half. A <video> with a real videoWidth cannot be conjured in a headless page, so
     the CAM path is asserted on the predicate alone — the pixels below prove the predicate is
     what coverInto() branches on. */
  + 'pred(kind,sw,sh,dr){const k=bgKind;bgKind=kind;'
  + 'const r=usesFitFrame(sw,sh,dr);bgKind=k;return r;}};\n'
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__ff, null, { timeout: 10000 });

/* 390x844 is the board these numbers were computed against — a 9:19.5 iPhone, dr 0.462. */
const BW = 390, BH = 844;

console.log('\nTHE PHOTO THAT USED TO COME BACK LETTERBOXED');
{
  // 3024x4032 — what an iPhone hands the picker. dr/sr = 0.616, over MIN_FIT_H.
  const fit = await page.evaluate(() => window.__ff.photo(3024, 4032));
  const r = await page.evaluate(([w, h]) => window.__ff.render(w, h), [BW, BH]);
  r.top === 255 && r.bot === 255
    ? ok(`a 3:4 photo reaches the top and bottom rows unblurred (${r.top}/${r.mid}/${r.bot})`)
    : bad(`a 3:4 photo still bands: top ${r.top}, bottom ${r.bot} against a frame of ${r.mid} — `
        + 'that is the dimmed blur, baked into the published image every seeker will open');
  r.band.y === 0 && r.band.h === 1
    ? ok('and sceneBand covers the whole board, so extractPalette() reads the photo')
    : bad(`sceneBand is ${JSON.stringify(r.band)} — the palette is sampled from a band that no `
        + 'longer exists');
  fit === 'cover'
    ? ok('the live preview is cover too, so the shutter changes nothing on screen')
    : bad(`the preview is object-fit:${fit} while the capture covers — the board jumps at the shutter`);
}

console.log('\nAND THE ONES THAT ALWAYS FILLED IT STILL DO');
{
  for (const [w, h, why] of [[1080, 1920, 'a 9:16 portrait'], [4032, 3024, 'a 4:3 landscape'],
    [390, 844, 'a board-shaped reply photo']]) {
    await page.evaluate(([a, b]) => window.__ff.photo(a, b), [w, h]);
    const r = await page.evaluate(([a, b]) => window.__ff.render(a, b), [BW, BH]);
    r.top === 255 && r.bot === 255 && r.band.h === 1
      ? ok(`${why} fills the board (${r.top}/${r.mid}/${r.bot})`)
      : bad(`${why} bands: top ${r.top}, bottom ${r.bot}, band ${JSON.stringify(r.band)}`);
  }
}

console.log('\nTHE CAMERA KEEPS ITS FIELD OF VIEW');
{
  const dr = BW / BH;
  /* Portrait dimensions on purpose: the phone hands back a 16:9 frame STANDING UP (1080x1920,
     sr 0.56), which is still wider than a 9:19.5 board and is the case the bars were built for.
     Passing 1920x1080 here would be a landscape webcam, which MIN_FIT_H rejects — and a test
     that asserted `true` on it would be asserting the opposite of the rule. */
  const cases = [
    [1080, 1920, true, '16:9 standing up, the framing the phone hands back in portrait (dr/sr 0.82)'],
    [1080, 1440, true, 'full-sensor 4:3 (dr/sr 0.62)'],
  ];
  for (const [w, h, want, why] of cases) {
    const got = await page.evaluate(([a, b, d]) => window.__ff.pred('cam', a, b, d), [w, h, dr]);
    got === want
      ? ok(`${why} → fit frame`)
      : bad(`${why} → cover — the viewfinder is back to throwing away sensor width, which reads `
          + 'to the user as a zoomed-in lens, not as a crop');
  }
  const wide = await page.evaluate(([d]) => window.__ff.pred('cam', 1920, 640, d), [dr]);
  wide === false
    ? ok('and a frame too wide to fit (dr/sr 0.15) still covers, so the figure never stands in blur')
    : bad('an ultra-wide camera frame takes the bars — MIN_FIT_H stopped rejecting it');
  const tall = await page.evaluate(([d]) => window.__ff.pred('cam', 1080, 2400, d), [dr]);
  tall === false
    ? ok('and a frame narrower than the board covers, where bars would be pure loss')
    : bad('a frame narrower than the board takes bars');
}

console.log('\nTHE RULE IS THE SOURCE, NOT THE RATIO');
{
  const dr = BW / BH;
  const asCam = await page.evaluate(([d]) => window.__ff.pred('cam', 3024, 4032, d), [dr]);
  const asPhoto = await page.evaluate(([d]) => window.__ff.pred('photo', 3024, 4032, d), [dr]);
  asCam === true && asPhoto === false
    ? ok('the same 3:4 geometry fits from the camera and covers from the library')
    : bad(`3:4 reads fit=${asCam} from the camera and fit=${asPhoto} from the library — the two `
        + 'sources have collapsed onto one rule again');
}

await browser.close();
server.close();
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ framing holds');
