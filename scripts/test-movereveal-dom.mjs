#!/usr/bin/env node
/**
 * THE REVEAL SHOWS THE FIGURE WHERE THE ANSWER SAYS IT IS.
 *
 * Two things describe where the kamo is, and they are built from different material:
 *
 *   · THE ANSWER KEY — chGeom(), the bbox of maskCanvas. It is what create_hide stores as
 *     (cx,cy,r) and what the server tests every tap against.
 *   · THE REVEAL FRAME — beforeBoard: the seeker's revealed photo (…_b.jpg), the hider's own
 *     A/B wipe, and the frame the reveal video wipes in.
 *
 * Move lands after the shutter. commitMove() shifts maskCanvas, so the answer key follows the
 * figure — and beforeBoard was a snapshot taken once inside capture() and never touched, so
 * the reveal did not. A nudged figure therefore produced a hide whose answer was correct and
 * whose reveal pointed somewhere else.
 *
 * NOTHING REPORTS THAT. The tap is judged against the answer key, so the round is scored
 * right; the lie is only in the picture drawn afterwards. From the player's side it is worse
 * than a wrong answer — they tap the figure, the game says "Found in 9.4s", and then shows
 * them the figure half a screen away from their mark. Reported from production on 2026-08-21
 * (hide d08d6d0795d96697: answer at (0.342,0.563), tap 0.037 off it, revealed figure far to
 * the right of both).
 *
 * And it is not a rare gesture. #btnMove is one, but a HOLD anywhere on the board starts a
 * drag too (holdTimer → movingDrag), so a thumb resting a beat too long moves the figure
 * without the player ever choosing the tool.
 *
 * So this drives the real thing: pick a photo through #fileInput, press #shutter, drag the
 * figure with the pointer, and compare the two descriptions of where it ended up. The reveal
 * centre is measured by DIFFING beforeBoard against sceneCanvas — the pixels that are not the
 * photograph are the figure — rather than by reading any variable the fix touches.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-movereveal-dom.mjs
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
  console.log('· playwright-core not installed — skipping the move/reveal test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Below every binding it reads, and beside the answer key it is about to compare against. */
const ANCHOR = 'const CH_MAKE=true;';
if (!real.includes(ANCHOR)) {
  console.error('  ✗ anchor ' + JSON.stringify(ANCHOR) + ' is gone — this test needs updating');
  process.exit(1);
}
const HOOK = ANCHOR + `
window.__mv={
  /* The answer key exactly as chSlot() takes it. */
  geom:()=>{ try{ return chGeom(); }catch(e){ return null; } },
  /* WHERE THE FIGURE IS IN THE REVEALED PHOTO, measured off the pixels rather than asked of
     any variable: beforeBoard minus sceneCanvas is the figure and its shading, and nothing
     else — the paint is not in either. A test that read a variable here would agree with the
     bug, because the bug is that the variable is never updated. */
  revealCentre:()=>{
    try{
      if(!beforeBoard||!sceneCanvas) return null;
      const W=beforeBoard.width,H=beforeBoard.height;
      const a=beforeBoard.getContext("2d").getImageData(0,0,W,H).data;
      const c=document.createElement("canvas"); c.width=W; c.height=H;
      c.getContext("2d").drawImage(sceneCanvas,0,0);
      const b=c.getContext("2d").getImageData(0,0,W,H).data;
      let x0=W,y0=H,x1=-1,y1=-1;
      for(let y=0;y<H;y+=2) for(let x=0;x<W;x+=2){ const i=(y*W+x)*4;
        if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60){
          if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
      return x1<0?null:{cx:(x0+x1)/2/W, cy:(y0+y1)/2/H};
    }catch(e){ return null; }
  },
  /* The answer key AS FROZEN FOR PUBLICATION — chSlot() mints it once, at the first reveal,
     and create_hide is called with this rather than with a fresh chGeom(). */
  slot:()=>{ try{ return (chSlotV&&chSlotV.g)||null; }catch(e){ return null; } },
  /* Four corners of the photograph itself. The tempting fix — slide beforeBoard by the same
     dx/dy — moves the ROOM as well as the figure, which no assertion on the figure alone
     would ever catch. */
  cornersMatchScene:()=>{
    try{
      const W=beforeBoard.width,H=beforeBoard.height;
      const bg=beforeBoard.getContext("2d"), c=document.createElement("canvas");
      c.width=W; c.height=H; c.getContext("2d").drawImage(sceneCanvas,0,0);
      const sg=c.getContext("2d");
      const pts=[[4,4],[W-5,4],[4,H-5],[W-5,H-5],[4,(H/2)|0],[W-5,(H/2)|0]];
      for(const [x,y] of pts){
        const p=bg.getImageData(x,y,1,1).data, q=sg.getImageData(x,y,1,1).data;
        if(Math.abs(p[0]-q[0])+Math.abs(p[1]-q[1])+Math.abs(p[2]-q[2])>12) return false;
      }
      return true;
    }catch(e){ return false; }
  }
};`;
const pageHtml = real.replace(ANCHOR, HOOK);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); process.exit(0); }

const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(pageHtml); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: exe });

/* The real door a browser picks a photo through — a drawn JPEG rather than a fixture, for the
   same reason test-undo-dom draws one: a flat colour gives the palette nothing to extract. */
async function paintScreen() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => bad('PAGE ERROR: ' + e.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 900, 1200);
    grd.addColorStop(0, '#6b7f5a'); grd.addColorStop(0.5, '#8a7f6a'); grd.addColorStop(1, '#3a4a3a');
    g.fillStyle = grd; g.fillRect(0, 0, 900, 1200);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(${100 + ((i * 37) % 90)},${110 + ((i * 53) % 80)},${80 + ((i * 29) % 70)},0.6)`;
      g.beginPath(); g.arc((i * 137) % 900, (i * 211) % 1200, 12 + ((i * 17) % 60), 0, 7); g.fill();
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'room.jpg', { type: 'image/jpeg' }));
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  await page.click('#shutter');
  await page.waitForTimeout(1400);
  return page;
}

const read = async (page) => page.evaluate(() => ({
  geom: window.__mv.geom(),
  reveal: window.__mv.revealCentre(),
  corners: window.__mv.cornersMatchScene(),
}));
const gap = (s) => (s.geom && s.reveal)
  ? Math.hypot(s.geom.cx - s.reveal.cx, s.geom.cy - s.reveal.cy) : null;

/* Generous on purpose. The reveal carries the soft-light shading pass, which spreads a few
   pixels past the mask's own alpha, so the two centres are never bit-identical — and a bug
   worth catching here is the length of a drag, not a rounding difference. */
const TOL = 0.02;

console.log('\nAT THE SHUTTER, THE ANSWER AND THE REVEAL AGREE');
const page = await paintScreen();
const before = await read(page);
{
  if (!before.geom) bad('chGeom() answered null on a fresh capture — there is no answer key at all');
  else if (!before.reveal) bad('nothing in beforeBoard differs from the photo — the reveal frame has no figure in it');
  else {
    gap(before) <= TOL
      ? ok(`the answer key and the revealed figure start on the same spot (${gap(before).toFixed(4)} apart)`)
      : bad(`they disagree before anything has even moved: answer (${before.geom.cx.toFixed(3)},${before.geom.cy.toFixed(3)}) `
        + `against reveal (${before.reveal.cx.toFixed(3)},${before.reveal.cy.toFixed(3)})`);
  }
  before.corners
    ? ok('and the revealed frame is the photograph as shot')
    : bad('the reveal frame does not match the scene at its edges');
}

console.log('\nAND THEY STILL AGREE AFTER THE FIGURE IS MOVED');
{
  await page.click('#btnMove');
  const DX = 96, DY = -64;
  await page.mouse.move(195, 470);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(195 + (DX / 8) * i, 470 + (DY / 8) * i);
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await read(page);
  if (!after.geom || !after.reveal) { bad('the answer key or the reveal frame vanished across the move'); }
  else {
    const movedKey = Math.hypot(after.geom.cx - before.geom.cx, after.geom.cy - before.geom.cy);
    movedKey > 0.03
      ? ok(`the drag landed — the answer key moved ${movedKey.toFixed(3)} across the frame`)
      : bad(`the answer key barely moved (${movedKey.toFixed(4)}) — the drag never reached the board, so`
        + '\n    the rest of this proves nothing. Check #btnMove and the pointer path, not the fix.');
    gap(after) <= TOL
      ? ok(`the revealed figure moved with it (${gap(after).toFixed(4)} apart)`)
      : bad(`THE REVEAL IS POINTING AT THE OLD SPOT: answer (${after.geom.cx.toFixed(3)},${after.geom.cy.toFixed(3)}) `
        + `against reveal (${after.reveal.cx.toFixed(3)},${after.reveal.cy.toFixed(3)}), ${gap(after).toFixed(3)} apart.\n`
        + '    A seeker who taps the figure is told "Found" and then shown the figure somewhere else.');
    after.corners
      ? ok('...and the photograph did not move with it — the room is still where it was shot')
      : bad('the whole reveal frame was shifted, background and all — the room no longer lines up with\n'
        + '    the camouflaged photo, and one edge is now empty pixels');
  }
}

console.log('\nAND A SECOND MOVE COMPOUNDS RATHER THAN RESETTING');
{
  await page.mouse.move(240, 430);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(240 - 10 * i, 430 + 8 * i);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const s = await read(page);
  (s.geom && s.reveal && gap(s) <= TOL)
    ? ok(`two landed drags and they are still together (${gap(s).toFixed(4)} apart)`)
    : bad(`the second move split them again (${s.geom && s.reveal ? gap(s).toFixed(3) : 'nothing measurable'}) — `
      + 'the rebuild is not running on every commitMove()');
}

console.log('\nAND A NUDGE AFTER THE REVEAL MOVES NEITHER — THE ROUND IS ALREADY FROZEN');
{
  /* #btnDone mints the name, the id and the answer key and starts encoding the photo, and
     #btnEdit goes straight back to painting with Move still on the toolbar. Nothing a drag
     does there can reach the hide that was frozen — so the reveal frame must not follow it
     either, or it becomes the one surface describing a position nobody else knows about.
     The floor is 30% coverage, and the strokes have to land ON the figure to count — so this
     runs on a FRESH capture, where the figure is still where the rig puts it, rather than on
     the board the blocks above have been dragging around. */
  const page = await paintScreen();
  for (const y of [320, 352, 384, 416, 448]) {
    await page.mouse.move(120, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(120 + 15 * i, y);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  await page.click('#btnDone');
  await page.waitForTimeout(900);
  const frozen = await page.evaluate(() => window.__mv.slot());
  if (!frozen) {
    bad('#btnDone did not mint a slot — coverage never cleared the floor, so this block proves nothing');
  } else {
    await page.click('#btnEdit');
    await page.waitForTimeout(400);
    await page.click('#btnMove');
    await page.mouse.move(200, 500);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(200 - 9 * i, 500 + 5 * i);
    await page.mouse.up();
    await page.waitForTimeout(500);

    const s = await read(page);
    const live = s.geom;
    const drift = Math.hypot(live.cx - frozen.cx, live.cy - frozen.cy);
    drift > 0.03
      ? ok(`the board moved under the frozen hide (live answer ${drift.toFixed(3)} from the published one)`)
      : bad(`the post-reveal drag never landed (${drift.toFixed(4)}) — this block proves nothing`);
    const toFrozen = Math.hypot(s.reveal.cx - frozen.cx, s.reveal.cy - frozen.cy);
    toFrozen <= TOL
      ? ok(`and the reveal frame stayed with the hide that was published (${toFrozen.toFixed(4)} apart)`)
      : bad(`the reveal frame followed the board instead of the published hide (${toFrozen.toFixed(3)} from it) —\n`
        + '    the photo, the answer key and the revealed frame have to be one instant');
  }
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the reveal shows the figure where the answer key says it is');
process.exit(failed ? 1 : 0);
