#!/usr/bin/env node
/**
 * UNDO TAKES BACK ONE STROKE, AND CLEAR TAKES BACK ALL OF THEM.
 *
 * Undo and Clear are the only two escapes from a bad stroke, on a board with an 89-second
 * clock running over it — and both of them were quietly wrong, in ways nothing on screen
 * announced and no test looked at.
 *
 *   · UNDO SKIPPED A STEP. The handler popped the top of the stack and then painted whatever
 *     was UNDERNEATH it, while pushUndo() files the state an action is ABOUT to change. So the
 *     first tap threw away the good stroke as well as the bad one, every later tap was a
 *     stroke ahead of itself, and the last one had nothing left to do. Measured on the real
 *     page before the fix: five strokes taking coverage to 9/20/30/37/43%, then five undos
 *     reading 30 → 20 → 9 → 0 → nothing.
 *   · CLEAR STOPPED CLEARING. The budget trim dropped entries from the FRONT, and the front
 *     entry is the blank board Clear restores — so after `cap` strokes (cap is 6 on a retina
 *     390pt board) Clear put back a half-painted figure and called it clearing.
 *
 * Neither is visible in a diff and neither throws. They are visible in the number on the
 * coverage chip, which is what this drives: real strokes through the real pointer handlers on
 * the real board, then the real buttons, comparing the ladder down against the ladder up.
 * Nothing here reads undoStack — a test that watched the array would have agreed with the bug.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-undo-dom.mjs
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
  console.log('· playwright-core not installed — skipping the undo test — run: ' + PW_SETUP);
  process.exit(0);
}

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png',
               '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* THE REAL DOOR A BROWSER PICKS A PHOTO THROUGH. A canvas-drawn JPEG rather than a fixture
   file, because the palette is extracted from whatever is in the picture and a flat colour
   would give the swatch row nothing to offer — the same reason a black board is a bug. */
async function paintScreen() {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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
  await page.waitForTimeout(1200);
  return page;
}

/* The number the user reads, off the chip that reports it — not a private counter. */
const cov = (page) => page.evaluate(() => {
  const e = document.getElementById('covHud');
  const m = e && e.textContent.match(/(\d+)%/);
  return m ? +m[1] : null;
});

/* A stroke wide enough to move the number, and each one on its own row so no two of them
   overlap: overlapping strokes make the ladder ambiguous, which is how an off-by-one hides. */
async function stroke(page, y) {
  await page.mouse.move(120, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(120 + 15 * i, y);
  await page.mouse.up();
  await page.waitForTimeout(220);
}

console.log('\nONE TAP OF UNDO IS ONE STROKE');
{
  const page = await paintScreen();
  const ROWS = [320, 352, 384, 416, 448];
  const up = [];
  for (const y of ROWS) { await stroke(page, y); up.push(await cov(page)); }

  up.every((v, i) => v !== null && (i === 0 ? v > 0 : v > up[i - 1]))
    ? ok(`five strokes climb: ${up.join(' → ')}%`)
    : bad(`the strokes did not paint a readable ladder: ${JSON.stringify(up)}`);

  /* Down the same ladder, one rung per tap, ending on an empty board. `expected` is derived
     from what the strokes actually measured rather than written down, so this suite cannot
     drift into asserting a particular brush size. */
  const expected = up.slice(0, -1).reverse().concat([0]);
  const down = [];
  for (let i = 0; i < ROWS.length; i++) { await page.click('#btnUndo'); await page.waitForTimeout(220); down.push(await cov(page)); }

  JSON.stringify(down) === JSON.stringify(expected)
    ? ok(`and five taps of Undo walk back down it: ${down.join(' → ')}%`)
    : bad(`Undo skipped: got ${down.join(' → ')}%, expected ${expected.join(' → ')}% — `
        + 'popping the top and painting what is underneath is one step too far');

  /* The tap after the board is empty must do nothing at all rather than eat Clear's floor. */
  await page.click('#btnUndo'); await page.waitForTimeout(220);
  (await cov(page)) === 0
    ? ok('and a sixth tap on an empty board is a no-op')
    : bad('Undo went past the blank board');
  await page.close();
}

console.log('\nCLEAR STILL CLEARS AFTER THE BUDGET HAS TRIMMED THE STACK');
{
  /* undoCap() is 3..12 entries and lands at 6 on a retina board this size, so fourteen
     strokes is comfortably past it whatever the device pixel ratio works out to. The trim
     used to shift() — taking the blank board off the front — and Clear reads exactly that
     entry, so this is the assertion that says the floor survives a long round. */
  const page = await paintScreen();
  for (let i = 0; i < 14; i++) await stroke(page, 300 + i * 24);
  const painted = await cov(page);
  painted > 0 ? ok(`fourteen strokes cover ${painted}% — past any undo budget`) : bad('nothing painted');
  await page.click('#btnClear'); await page.waitForTimeout(300);
  (await cov(page)) === 0
    ? ok('and Clear puts back the blank board, not the oldest surviving step')
    : bad(`Clear left ${await cov(page)}% on the board — the budget trim ate its floor`);
  await page.close();
}

console.log('\nAND A MOVE IS ONE STEP LIKE ANY OTHER');
{
  /* commitMove() used to file its entry AFTER the shift while every stroke files the one
     before, so a single Undo after a nudge spent the move's entry and then took the previous
     stroke with it. */
  const page = await paintScreen();
  await stroke(page, 340);
  const one = await cov(page);
  await stroke(page, 380);
  const two = await cov(page);
  await page.click('#btnMove'); await page.waitForTimeout(250);
  await page.mouse.move(195, 400);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(195 + 5 * i, 400 + 4 * i);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.click('#btnUndo'); await page.waitForTimeout(300);
  const after = await cov(page);
  /* The paint goes back where it was, which is the two-stroke board — NOT the one-stroke
     board the old spelling landed on. The mask stays where the drag put it; the stack has
     never held the mask and this suite does not pretend otherwise.

     ⚠️ ASSERTED AS "WHICH BOARD", NOT AS "WITHIN 2%". It used to read
     Math.abs(after - two) <= 2, and that is not the question this section asks. Moving the
     figure changes the surface the coverage is measured over, so `after` legitimately lands
     a little under `two` — by 2 points on macOS and 3 on CI's Linux, because antialiasing
     differs. On 2026-08-30 a runner-image change moved it from 20% to 19% and turned this
     red on eight consecutive merges, on a file nobody had touched. A guard that a font
     update can flip was measuring the renderer, not the undo stack.

     The defect it exists for is unambiguous at this resolution: commitMove() filing its
     entry after the shift meant one Undo spent the move AND took the previous stroke, which
     lands on `one` — ten points away, not three. So the assertion is that the board came
     back to the two-stroke side of the midpoint. It still fails the moment a stroke is
     eaten, and it no longer fails when a runner grows a new font. */
  const midpoint = (one + two) / 2;
  after !== null && after > midpoint && Math.abs(after - two) < Math.abs(after - one)
    ? ok(`Undo after a move returns to the two-stroke board (${after}% — two were ${two}%, one was ${one}%)`)
    : bad(`Undo after a move landed on ${after}% — one stroke was ${one}%, two were ${two}%`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ undo takes back one stroke, and Clear takes back all of them');
process.exit(failed ? 1 : 0);
