#!/usr/bin/env node
/**
 * THE CROP THE USER DRAGS IS THE CROP THAT GETS PAINTED.
 *
 * A picked photo fills the board, and filling costs width — a 3:4 shot on a 9:19.5 screen keeps
 * ~64% of itself. Which 64% is now the user's to choose, and that choice runs through TWO
 * different machines: the preview is the live <img> under a CSS transform, the paint is
 * coverInto() sampling a source rect out of the same image. Nothing forces them to agree.
 *
 * When they disagree the picture JUMPS at the shutter — you frame the subject, you press
 * Capture, and the board comes back showing somewhere else. That is the exact failure
 * syncPreviewFit() was written for on the fit frame, and it is invisible to any test that only
 * reads photoFrame back: the state would be perfect in both readings while the two renderers
 * did different things with it.
 *
 * So the centre of this file is a cross-check that never touches the pan arithmetic. The source
 * is a RAMP — red encodes x, green encodes y — so any pixel names the source coordinate it came
 * from. The expected coordinate is derived from the <img>'s POST-TRANSFORM
 * getBoundingClientRect() and object-fit:cover's own geometry, i.e. from what the browser
 * actually painted, and compared against what coverInto() sampled. If photoSrcRect() ever
 * stopped inverting the CSS transform the two would part company and this would say so.
 *
 * The rest is the things that make it usable rather than correct:
 *   · the crop cannot be dragged off the photo (an uncovered edge is the bars, back again)
 *   · zoom cannot go under 1 (same reason) or past the ceiling
 *   · the figure's gestures and the photo's are never both live
 *   · the aim clock does not auto-capture the user mid-drag
 *   · a different photo does not inherit the last one's crop
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-reframe-dom.mjs
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
  console.log('· playwright-core not installed — skipping the reframe test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__rf={'
  /* THE RAMP. r = x, g = y, so a sampled pixel is a source coordinate. A flat or textured
     source could not tell "the crop moved" from "the crop is fine" at all. */
  + 'async load(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;'
  + 'const g=c.getContext("2d"),im=g.createImageData(w,h);'
  + 'for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;'
  + 'im.data[i]=Math.round(x*255/(w-1));im.data[i+1]=Math.round(y*255/(h-1));im.data[i+2]=128;im.data[i+3]=255;}'
  + 'g.putImageData(im,0,0);const u=c.toDataURL("image/png");'
  + 'await new Promise((res,rej)=>{photo.onload=res;photo.onerror=rej;photo.src=u;});'
  /* Straight into the state enterCompose() would have left, without enterCompose(): spawning
     the hider needs WebGL, and this file is about the photo, not the figure. */
  + 'bgKind="photo";mode="compose";photo.style.display="block";syncPreviewFit();'
  + 'return {w:photo.naturalWidth,h:photo.naturalHeight};},'
  + 'source(k){bgKind=k;},'
  + 'frame(){return {s:photoFrame.s,tu:photoFrame.tu,tv:photoFrame.tv};},'
  + 'reset(){resetPhotoFrame();return {s:photoFrame.s,tu:photoFrame.tu,tv:photoFrame.tv};},'
  + 'framing(on){setFraming(on);return {on:framing,bar:frameBar.style.display,'
  + 'gl:getComputedStyle(glCanvas).pointerEvents,cls:stage.classList.contains("framing"),'
  + 'btn:btnFrame.classList.contains("on"),blocked:timerBlocked()};},'
  + 'btnShown(){return getComputedStyle(btnFrame).display!=="none";},'
  + 'showBtn(v){btnFrame.style.display=v;},'
  /* Driven through the REAL handlers on the real element — the whole question is whether the
     gesture layer and the sampler share a definition of the crop, and a test that poked
     photoFrame directly would be asking a different one. */
  + 'drag(dx,dy){const r=stage.getBoundingClientRect();'
  + 'const x0=r.left+r.width/2,y0=r.top+r.height/2;const o=(x,y)=>({clientX:x,clientY:y,pointerId:1,bubbles:true,cancelable:true});'
  + 'photo.dispatchEvent(new PointerEvent("pointerdown",o(x0,y0)));'
  + 'for(let i=1;i<=6;i++)photo.dispatchEvent(new PointerEvent("pointermove",o(x0+dx*i/6,y0+dy*i/6)));'
  + 'photo.dispatchEvent(new PointerEvent("pointerup",o(x0+dx,y0+dy)));'
  + 'return {s:photoFrame.s,tu:photoFrame.tu,tv:photoFrame.tv};},'
  + 'pinch(from,to){const r=stage.getBoundingClientRect();'
  + 'const cx=r.left+r.width/2,cy=r.top+r.height/2;'
  + 'const o=(id,x,y)=>({clientX:x,clientY:y,pointerId:id,bubbles:true,cancelable:true});'
  + 'photo.dispatchEvent(new PointerEvent("pointerdown",o(1,cx-from/2,cy)));'
  + 'photo.dispatchEvent(new PointerEvent("pointerdown",o(2,cx+from/2,cy)));'
  + 'for(let i=1;i<=6;i++){const d=from+(to-from)*i/6;'
  + 'photo.dispatchEvent(new PointerEvent("pointermove",o(1,cx-d/2,cy)));'
  + 'photo.dispatchEvent(new PointerEvent("pointermove",o(2,cx+d/2,cy)));}'
  + 'photo.dispatchEvent(new PointerEvent("pointerup",o(1,cx-to/2,cy)));'
  + 'photo.dispatchEvent(new PointerEvent("pointerup",o(2,cx+to/2,cy)));'
  + 'return {s:photoFrame.s,tu:photoFrame.tu,tv:photoFrame.tv};},'
  /* What the browser PAINTED (post-transform box) and what the sampler READ, side by side. */
  + 'boxes(){const p=photo.getBoundingClientRect(),s=stage.getBoundingClientRect();'
  + 'return {p:{x:p.left,y:p.top,w:p.width,h:p.height},s:{x:s.left,y:s.top,w:s.width,h:s.height}};},'
  + 'srcRect(cw,ch){const r=photoSrcRect(photo.naturalWidth,photo.naturalHeight,cw/ch,photoFrame);'
  + 'return {rx:r.rx,ry:r.ry,rw:r.rw,rh:r.rh};},'
  + 'sample(cw,ch,pts){const c=document.createElement("canvas");c.width=cw;c.height=ch;'
  + 'const g=c.getContext("2d");coverInto(g,cw,ch);'
  + 'return pts.map(([u,v])=>{const d=g.getImageData(Math.min(cw-1,Math.round(u*cw)),Math.min(ch-1,Math.round(v*ch)),1,1).data;'
  + 'return [d[0],d[1]];});}};\n'
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
await page.waitForFunction(() => !!window.__rf, null, { timeout: 10000 });

const BW = 390, BH = 844;
// 3:4 standing up — the shape this whole feature exists for. Halved from 3024x4032 so the ramp
// is built and encoded in a moment; the ratio is what matters, and it is identical.
const SW = 1512, SH = 2016;

const dims = await page.evaluate(([w, h]) => window.__rf.load(w, h), [SW, SH]);
if (dims.w !== SW || dims.h !== SH) bad(`the ramp did not decode at ${SW}x${SH} (got ${dims.w}x${dims.h})`);

/* The cover fit, restated here rather than imported: this file's job is to disagree with the
   page when the page is wrong, and sharing its helper would remove the only witness. */
const cover = (sw, sh, dr) => (sw / sh > dr)
  ? { rx: (sw - sh * dr) / 2, ry: 0, rw: sh * dr, rh: sh }
  : { rx: 0, ry: (sh - sw / dr) / 2, rw: sw, rh: sw / dr };

/* Expected source coordinate at board point (u,v), read off the PAINTED box. No pan arithmetic
   anywhere in here — that is the point. object-fit is resolved against the box's OWN ratio,
   which is what makes this one formula cover both states: un-dragged the box is the stage and
   cover crops inside it, dragged the box is proportional to the photo and cover is the
   identity. Either way it is the browser's geometry, not the page's. */
function expectedRG(boxes, u, v) {
  const { p, s } = boxes;
  const px = s.x + u * s.w, py = s.y + v * s.h;
  const u0 = (px - p.x) / p.w, v0 = (py - p.y) / p.h;
  const r = cover(SW, SH, p.w / p.h);
  return [(r.rx + u0 * r.rw) * 255 / (SW - 1), (r.ry + v0 * r.rh) * 255 / (SH - 1)];
}

const PTS = [[0.5, 0.5], [0.12, 0.12], [0.88, 0.88], [0.5, 0.08], [0.5, 0.92]];
async function agree(label) {
  const boxes = await page.evaluate(() => window.__rf.boxes());
  const got = await page.evaluate(([cw, ch, pts]) => window.__rf.sample(cw, ch, pts), [BW, BH, PTS]);
  /* COVERAGE FIRST, AND IT IS A SEPARATE QUESTION FROM AGREEMENT. The first build of this
     feature dragged the <img> with a CSS transform, which moves the element's BOX — #photo's box
     is the stage, so a 150px drag left the right-hand 150px of the screen with no element over
     it and the preview showed a black band. Every coordinate below still matched: the canvas and
     the transform agreed exactly about which source pixel belonged at which board point, and the
     preview had a hole in it anyway. Agreement cannot see that. Containment can. */
  {
    const { p, s } = boxes;
    const out = Math.max(p.x - s.x, p.y - s.y, (s.x + s.w) - (p.x + p.w), (s.y + s.h) - (p.y + p.h));
    out > 0.5
      ? bad(`${label}: the photo leaves ${out.toFixed(1)}px of the stage uncovered — that is a `
          + 'black band down the side of the preview, which is the letterbox back under another name')
      : ok(`${label}: the preview still covers the whole stage (${(-out).toFixed(0)}px overhang)`);
  }
  let worst = 0, at = null;
  PTS.forEach(([u, v], i) => {
    const e = expectedRG(boxes, u, v);
    const d = Math.max(Math.abs(e[0] - got[i][0]), Math.abs(e[1] - got[i][1]));
    if (d > worst) { worst = d; at = [u, v]; }
  });
  // 4/255 of a ramp spanning the whole photo is ~24px of a 1512px source — a rounding budget,
  // nowhere near the ~140px a one-finger drag moves.
  worst <= 4
    ? ok(`${label}: the paint samples where the preview is looking (worst ${worst.toFixed(1)}/255)`)
    : bad(`${label}: the board and the preview disagree by ${worst.toFixed(1)}/255 at `
        + `(${at.join(',')}) — the picture JUMPS at the shutter, which is the whole failure this `
        + 'file exists to catch');
}

console.log('\nTHE BUTTON BELONGS TO THE PHOTO');
{
  await page.evaluate(() => window.__rf.showBtn('flex'));
  const on = await page.evaluate(() => window.__rf.framing(true));
  on.on && on.cls && on.bar === 'flex'
    ? ok('a picked photo can enter reframe')
    : bad(`reframe would not open on a photo (${JSON.stringify(on)})`);
  await page.evaluate(() => window.__rf.framing(false));
  await page.evaluate(() => window.__rf.source('cam'));
  const cam = await page.evaluate(() => window.__rf.framing(true));
  !cam.on && cam.bar === 'none'
    ? ok('a live camera cannot — there is no crop to drag, you move the phone')
    : bad('reframe opened over the camera, where the gesture means nothing and the figure loses its drag');
  await page.evaluate(() => window.__rf.source('photo'));
}

console.log('\nONE GESTURE, ONE MEANING');
{
  const on = await page.evaluate(() => window.__rf.framing(true));
  on.gl === 'none'
    ? ok('while reframing the figure layer stops taking pointers, so a drag reaches the photo')
    : bad(`#gl still has pointer-events:${on.gl} — the drag moves the character and the photo `
        + 'both, which is the collision the mode exists to avoid');
  on.blocked
    ? ok('and the aim clock is parked, so nobody is auto-captured mid-drag')
    : bad('the aim clock keeps running while reframing — a free user gets shot out from under '
        + 'their own hands, and the capture is whatever the crop happened to be');
  const off = await page.evaluate(() => window.__rf.framing(false));
  off.gl === 'auto' && !off.blocked
    ? ok('and both come back on Done')
    : bad(`leaving reframe left #gl at pointer-events:${off.gl}, timer blocked=${off.blocked}`);
  await page.evaluate(() => window.__rf.framing(true));
}

console.log('\nTHE DRAG IS THE CROP');
{
  await agree('centred');
  const f = await page.evaluate(() => window.__rf.drag(-90, 0));
  f.tu < -0.15
    ? ok(`a 90px drag moves the crop (tu ${f.tu.toFixed(3)})`)
    : bad(`a 90px drag moved the crop to tu=${f.tu.toFixed(3)} — the gesture is not reaching the frame`);
  await agree('panned left');
  await page.evaluate(() => window.__rf.drag(180, 0));
  await agree('panned right');
}

console.log('\nZOOM, AND ITS TWO WALLS');
{
  await page.evaluate(() => window.__rf.reset());
  const inn = await page.evaluate(() => window.__rf.pinch(80, 240));
  inn.s > 2.4 && inn.s < 3.6
    ? ok(`a 3x pinch zooms 3x (s ${inn.s.toFixed(2)})`)
    : bad(`a 3x pinch produced s=${inn.s.toFixed(2)}`);
  await agree('zoomed in');
  const out = await page.evaluate(() => window.__rf.pinch(240, 20));
  out.s === 1
    ? ok('pinching out stops at 1x — under it the photo stops covering and the bars come back')
    : bad(`pinching out reached s=${out.s.toFixed(3)}, below the cover fit: the board would show `
        + 'empty edges, which is exactly what filling the screen was meant to remove');
  const max = await page.evaluate(() => window.__rf.pinch(20, 900));
  max.s <= 4.0001
    ? ok(`and in at ${max.s.toFixed(1)}x, before the photo turns to mush`)
    : bad(`zoom ran to ${max.s.toFixed(1)}x with no ceiling`);
  await page.evaluate(() => window.__rf.reset());
}

console.log('\nTHE BOARD IS NEVER OFF THE PHOTO');
{
  // Shove far past every edge at both a panning zoom and a zoomed one. Whatever the clamp does,
  // the sampled rect has to stay inside the source — outside it, drawImage reads nothing and
  // the board gets a transparent margin.
  let worst = null;
  for (const [s, dx, dy] of [[1, -4000, 0], [1, 4000, 0], [1, 0, -4000], [1, 0, 4000],
    [2.5, -4000, -4000], [2.5, 4000, 4000]]) {
    await page.evaluate(() => window.__rf.reset());
    if (s > 1) await page.evaluate(([a, b]) => window.__rf.pinch(a, b), [80, 80 * s]);
    await page.evaluate(([a, b]) => window.__rf.drag(a, b), [dx, dy]);
    const r = await page.evaluate(([cw, ch]) => window.__rf.srcRect(cw, ch), [BW, BH]);
    const slack = Math.min(r.rx, r.ry, SW - (r.rx + r.rw), SH - (r.ry + r.rh));
    if (worst === null || slack < worst) worst = slack;
  }
  worst >= -0.5
    ? ok(`every extreme keeps the sampled rect inside the photo (tightest edge ${worst.toFixed(1)}px)`)
    : bad(`a shove past the edge samples ${(-worst).toFixed(1)}px outside the photo — drawImage `
        + 'reads nothing there and the board comes back with a transparent margin');

  await page.evaluate(() => window.__rf.reset());
  const far = await page.evaluate(() => window.__rf.drag(-4000, 0));
  far.tu < -0.05
    ? ok(`and at 1x the crop still slides across the photo's spare width (tu ${far.tu.toFixed(3)})`)
    : bad(`at 1x the pan clamped to tu=${far.tu.toFixed(3)} — a 3:4 photo cover-fitted to a tall `
        + 'board has unused WIDTH, and panning it without zooming in first is the main thing '
        + 'this control is for');
  await agree('hard against the left edge');
}

console.log('\nA NEW PHOTO IS A NEW CROP');
{
  await page.evaluate(() => window.__rf.drag(-4000, 0));
  const before = await page.evaluate(() => window.__rf.frame());
  await page.evaluate(([w, h]) => window.__rf.load(w, h), [1080, 1920]);
  const after = await page.evaluate(() => window.__rf.frame());
  after.s === 1 && after.tu === 0 && after.tv === 0
    ? ok(`picking another photo drops the last one's crop (was tu ${before.tu.toFixed(3)})`)
    : bad(`a new photo inherited ${JSON.stringify(after)} — the crop was chosen against a `
        + 'different picture, and on this one it points at nothing');
  const r = await page.evaluate(() => window.__rf.reset());
  r.s === 1 && r.tu === 0 && r.tv === 0
    ? ok('and Reset returns to the centred fill')
    : bad(`Reset left ${JSON.stringify(r)}`);
}

await browser.close();
server.close();
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the crop holds');
