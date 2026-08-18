#!/usr/bin/env node
/**
 * THE RECORD SPEAKS ON THE BREAK, AND IT DOES NOT LAND ON THE TITLE.
 *
 * `best` has been written to localStorage since the run shipped and read back by nothing, so
 * the first player to see it will see it here — on the loss, where it is the only number left
 * to chase. The suffix costs eight to ten characters on a pill that the file has already
 * measured as living one row away from the headline:
 *
 *     "At 390px: the break overlaps it by 44px, the record by 12-22px depending on the string."
 *
 * That measurement is why the sentence is only affordable in `.dead`, which chRunShow moves
 * into .chTop's centred column (position:static) before it prints. The whole safety argument
 * is therefore a LAYOUT claim, not a copy one, and a layout claim asserted in a comment is a
 * layout claim that stops being true the first time somebody re-styles the pill. So this reads
 * the two rectangles back out of a real browser and intersects them.
 *
 * Both widths, because they fail differently: 390px is where the overlap was photographed, and
 * 320px (iPhone SE) is where a pill that no longer overlaps anything can still outgrow the
 * screen it is centred on — the failure the move to .chTop cannot catch by itself.
 *
 * The equality case is the other half. best >= broke always, and at equality the run that just
 * died IS the record: "Run of 6 broken · best 6" prints one number twice. Asserted as an
 * ABSENCE, because that is the kind of rule a later edit removes by accident.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-runrec-dom.mjs
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
  console.log('· playwright-core not installed — skipping the run-record test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Same anchor test-seek-dom uses, and for the same reason: the seeker IIFE fetches the hide on
   load, so a hook appended after the module has already missed it. */
const anchor = 'async function chRpc(fn,body){';
const html = real.replace(anchor, anchor +
  'if(window.__seed&&window.__seed[fn]) return window.__seed[fn];');
const PNG = readFileSync(join(ROOT, 'icon.png'));

const MIME = {'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css'};
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, {'Content-Type':'text/html'}); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, {'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'});
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m), bad = m => { failed++; console.error('  ✗ ' + m); };

/* One wrong tap ends the round — the miss branch calls ending() directly, it does not wait for
   max_taps — so the whole fixture is: seed the two numbers, load, tap once, read the pill. */
async function breakRun(run, best, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  /* The camo photo is an absolute Supabase URL, so it cannot come off the local server. A real
     decoded image matters here and did not in test-seek-dom: an <img> that never loads leaves
     .chFrame at zero height, and a tap on a zero-height frame is a tap on nothing. */
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.addInitScript(([r, b]) => {
    window.__seed = {
      get_hide: { img_path: 'x.png', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' },
      submit_attempt: { hit: false, tries: 1, missed: 1, secs: 0, pct: null, others: 0 },
    };
    try { localStorage.setItem('kamo_seek_run', String(r)); localStorage.setItem('kamo_seek_best', String(b)); } catch (e) {}
  }, [run, best]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const frame = await page.locator('#chFrame').boundingBox();
  if (!frame) { await page.close(); return { err: 'the frame never mounted' }; }
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.waitForTimeout(1300);
  const out = await page.evaluate(() => {
    const pill = document.getElementById('chRun'), head = document.getElementById('chHead');
    if (!pill || !head) return { err: 'pill or headline missing' };
    const p = pill.getBoundingClientRect(), h = head.getBoundingClientRect();
    return {
      text: pill.textContent.trim(),
      shown: getComputedStyle(pill).display !== 'none',
      /* The founder's question, answered as geometry: do the two boxes share any area at all. */
      overlap: !(p.right <= h.left || p.left >= h.right || p.bottom <= h.top || p.top >= h.bottom),
      offscreen: p.left < 0 || p.right > innerWidth,
      /* Two lines inside a 999px pill is not an overlap, but it is the same string being too
         long for the same screen — worth failing while the cause is still one commit old.
         MEASURED AGAINST THE PILL'S OWN LINE, not against a constant. This read `> 40`, which
         was the pill's height on the day it was written — an assertion about FONT SIZE wearing
         the clothes of an assertion about wrapping. The docked pill of 2026-08-18 is two
         points larger on purpose and tripped it at 390px while sitting plainly on one line,
         and the honest reading of that failure is that the probe was wrong, not the pill.
         Line-height plus the box's own padding and borders asks the question that was meant,
         at any size this pill is ever given. */
      wrapped: (() => {
        const cs = getComputedStyle(pill);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const box = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
                  + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        return p.height > lh * 1.6 + box;
      })(),
      /* WHERE IT ENDED UP, and this one is read as structure rather than as pixels because
         the failure mode is not a collision — it is a silent disappearance. #chFoot is
         written with innerHTML when the ending card is built, so a pill docked one line too
         early is destroyed by that assignment and the round simply ends with no run on it:
         nothing overlaps, nothing runs off screen, every geometric assertion above still
         passes, and the feature is gone. So: still in the document, first child of the foot,
         and ahead of the flip button that used to prepend itself into that slot. */
      docked: pill.parentElement && pill.parentElement.id === 'chFoot',
      first: pill.parentElement && pill.parentElement.firstElementChild === pill,
      aboveCard: (() => { const c = document.querySelector('#chFoot .chCard');
        return !!c && !!(pill.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); })(),
    };
  });
  await page.close();
  return out;
}

console.log('\nTHE BROKEN RUN NAMES THE RECORD IT FELL SHORT OF');
for (const width of [390, 320]) {
  const r = await breakRun(4, 6, width);
  if (r.err) { bad(`${width}px: ${r.err}`); continue; }
  r.text === 'Run of 4 broken · best 6'
    ? ok(`${width}px: the break carries the record ("${r.text}")`)
    : bad(`${width}px: the break reads ${JSON.stringify(r.text)}`);
  r.overlap ? bad(`${width}px: the pill lands on the headline — the thing .chTop exists to prevent`)
            : ok(`${width}px: pill and headline share no pixels`);
  r.offscreen ? bad(`${width}px: the pill runs off the screen`) : ok(`${width}px: the pill fits its viewport`);
  r.wrapped ? bad(`${width}px: the sentence wrapped inside the pill`) : ok(`${width}px: one line`);
  (r.docked && r.first && r.aboveCard)
    ? ok(`${width}px: the run docks at the head of #chFoot, above the flip and the card`)
    : bad(`${width}px: the run is not first in #chFoot above the card `
          + JSON.stringify({ docked: r.docked, first: r.first, aboveCard: r.aboveCard }));
}

console.log('\nAND STAYS QUIET WHEN THE RUN THAT DIED WAS THE RECORD');
{
  const r = await breakRun(6, 6, 390);
  if (r.err) bad(r.err);
  else r.text === 'Run of 6 broken'
    ? ok(`equality prints the number once ("${r.text}")`)
    : bad(`equality reads ${JSON.stringify(r.text)}`);
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the record speaks on the break and stays off the title');
process.exit(failed ? 1 : 0);
