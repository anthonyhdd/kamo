#!/usr/bin/env node
/**
 * IS THE KAMO ACTUALLY HIDDEN? — the arithmetic, exercised on colours we choose.
 *
 * `coverage` does not answer that question and never did. computeScore() counts the fraction
 * of the figure's pixels carrying ANY paint, off the paint layer's alpha, and never compares
 * the paint to what it sits against. Drag the brush across the whole figure in the cream of
 * the wall behind you, stand it in front of a dark hoodie: 100. Over the seven days to
 * 2026-08-28, 92.9% of hides reported exactly 100, so the >= 70 floors in create_hide,
 * feed_page and get_hide admit essentially everything.
 *
 * concealFromSamples() measures the EDGE instead — pairs of samples straddling the silhouette.
 * A "% hidden" built on interior board-vs-blur distance already lived here once and was pulled
 * out as noise: it punished the shading pass and moved when the light moved, because it
 * compared a lit figure against a global idea of the scene. A boundary comparison is local, so
 * an evenly-lit room and a dramatic one score the same and shading TO MATCH now helps.
 *
 * ⚠️ THIS NUMBER GATES NOTHING (founder's call, 2026-08-28: measure first, block nothing). It
 * is written to hides.conceal so a threshold can be chosen against n_found/n_attempts instead
 * of guessed. That is exactly why it has a test now: a measurement nobody checked is how
 * `coverage` came to mean something other than its name for months.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-conceal-dom.mjs
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
  console.log('· playwright-core not installed — skipping the conceal test — run: ' + PW_SETUP);
  process.exit(0);
}

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* ⚠️ THE MIME MAP IS NOT DECORATION. Served without a Content-Type, a module script is
   refused by the browser on type grounds — which surfaces as a console message, NOT a
   pageerror — so the app simply never boots and every global is undefined with an empty
   error list. That is an hour of looking at the wrong thing; the map is the fix. */
const MIME = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png',
               '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  /* Read BEFORE writing the head: a writeHead(200) followed by a throwing read leaves the
     catch trying to send a second set of headers, which crashes the whole run. */
  let body = null;
  try { body = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); } catch {}
  if (body) {
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(body);
  } else { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.KAMO && typeof window.KAMO.conceal === "function", { timeout: 15000 });

/* A square figure in the middle of a field. Two flat colours and a mask — everything the
   arithmetic reads and nothing it does not, so a failure here is the formula and never the
   fixture. */
const score = (figRGB, bgRGB, side = 24) => page.evaluate(([fig, bg, S]) => {
  const md = new Uint8ClampedArray(S * S * 4), bd = new Uint8ClampedArray(S * S * 4);
  const lo = Math.round(S * 0.25), hi = Math.round(S * 0.75);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const inFig = x >= lo && x < hi && y >= lo && y < hi;
    md[i + 3] = inFig ? 255 : 0;
    const c = inFig ? fig : bg;
    bd[i] = c[0]; bd[i + 1] = c[1]; bd[i + 2] = c[2]; bd[i + 3] = 255;
  }
  return window.KAMO.conceal(md, bd, S, S);
}, [figRGB, bgRGB, side]);

console.log('\nTHE NUMBER MOVES WITH WHAT THE EYE ACTUALLY SEES');
{
  /* THE CASE THAT STARTED THIS. Hide 99711286d1ca0eb6 is a flat near-white silhouette on a
     scene of mid browns and creams, and its row says coverage 100. */
  const glaring = await score([255, 255, 255], [40, 40, 45]);
  const perfect = await score([128, 120, 110], [128, 120, 110]);
  const near = await score([132, 124, 114], [128, 120, 110]);

  typeof glaring === 'number' && typeof perfect === 'number'
    ? ok(`both ends return a number (${glaring} exposed, ${perfect} matched)`)
    : bad(`conceal returned ${JSON.stringify(glaring)} / ${JSON.stringify(perfect)}`);

  perfect === 100
    ? ok('a figure painted exactly its surroundings scores 100')
    : bad(`a perfectly matched figure scored ${perfect}, expected 100`);

  glaring <= 20
    ? ok(`white on near-black scores ${glaring} — the kamo the founder could not miss`)
    : bad(`a white figure on a near-black field scored ${glaring} — this is the case the whole `
        + 'measure exists for, and a high score here means it is as blind as coverage was');

  near >= 90
    ? ok(`a close-but-not-exact match still scores well (${near}) — shading must not be punished`)
    : bad(`a figure four points off its background scored ${near}: the old "% hidden" was `
        + 'removed for exactly this, punishing the shading pass');

  /* MONOTONIC, which is what makes a threshold pickable at all. If the middle of the range
     does not order correctly, no cut chosen against find rate would mean anything. */
  const mid = await score([190, 185, 180], [128, 120, 110]);
  glaring < mid && mid < perfect
    ? ok(`the range orders: ${glaring} < ${mid} < ${perfect}`)
    : bad(`not monotonic: exposed ${glaring}, middling ${mid}, matched ${perfect}`);
}

console.log('\nAND IT REFUSES TO GUESS');
{
  /* A rim too small to read is a null, never a 0 — a 0 would file "we could not tell" as
     "fully exposed", and the column is nullable precisely so that cannot happen. */
  const tiny = await page.evaluate(() => {
    const S = 4, md = new Uint8ClampedArray(S * S * 4), bd = new Uint8ClampedArray(S * S * 4);
    md[(1 * S + 1) * 4 + 3] = 255;
    return window.KAMO.conceal(md, bd, S, S);
  });
  tiny === null
    ? ok('too few boundary samples returns null, not a zero that would read as exposed')
    : bad(`a 1-pixel figure returned ${JSON.stringify(tiny)} instead of null`);
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ conceal measures concealment');
