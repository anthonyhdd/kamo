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
         long for the same screen — worth failing while the cause is still one commit old. */
      wrapped: p.height > 40,
    };
  });
  await page.close();
  return out;
}


/* ⚠️ AND THE STATE NOBODY EVER SAW, WHICH IS MOST OF THEM. Until 2026-08-20 the pill was hidden
   whenever the run was 0 and `best` was passed only on the break — so it appeared when you were
   winning, vanished when you were not, and showed your record exactly once, in its own epitaph.
   The median best run in the whole base is 3: most people are at 0 most of the time, so the
   centre of this game was invisible to most of them, permanently.
   These read the pill AT MOUNT, with no tap, because that is the state the old fixture could
   not reach — breakRun() taps, and a tap is what produced the only state that was ever tested. */
async function atMount(run, best, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.addInitScript(([r, b]) => {
    window.__seed = {
      get_hide: { img_path: 'x.png', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' },
      submit_attempt: { hit: false, tries: 1, missed: 1, secs: 0, pct: null, others: 0 },
    };
    try { localStorage.setItem('kamo_seek_run', String(r)); localStorage.setItem('kamo_seek_best', String(b)); } catch (e) {}
  }, [run, best]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(1100);
  const out = await page.evaluate(() => {
    const pill = document.getElementById('chRun'), head = document.getElementById('chHead');
    if (!pill || !head) return { err: 'pill or headline missing' };
    const p = pill.getBoundingClientRect(), h = head.getBoundingClientRect();
    return {
      text: pill.textContent.trim(), cls: pill.className,
      shown: getComputedStyle(pill).display !== 'none',
      overlap: !(p.right <= h.left || p.left >= h.right || p.bottom <= h.top || p.top >= h.bottom),
      offscreen: p.left < 0 || p.right > innerWidth,
      height: Math.round(p.height),
    };
  });
  await page.close();
  return out;
}

console.log('\nAT ZERO IT NAMES THE TARGET INSTEAD OF THE VOID');
{
  const r = await atMount(0, 6, 390);
  r.err ? bad(r.err)
    : r.shown && r.text === 'Best 6'
      ? ok(`a player at 0 with a record is told what there is to beat ("${r.text}")`)
      : bad(`the zero state reads ${JSON.stringify(r.text)} shown=${r.shown}`);
  !r.overlap && !r.offscreen ? ok('and it clears the headline like every other state') : bad('the zero state collides');
  /* Quieter than a live run: it is a target, not a stake. Giving it the same weight would tell
     somebody at 0 that they are in the middle of something. */
  /rest/.test(r.cls || '') ? ok('and it is drawn as the quiet state') : bad(`class is ${JSON.stringify(r.cls)}`);
}
{
  /* NOTHING AT ALL FOR A GENUINELY NEW PLAYER. There is no true sentence yet, and the
     alternative is teaching copy — the two biggest teaching pills on this screen were deleted
     for spending 7.2 seconds of a round on text. */
  const r = await atMount(0, 0, 390);
  r.err ? bad(r.err)
    : r.shown === false ? ok('and a player with no record at all is shown nothing, rather than a 0')
    : bad(`a brand-new player sees ${JSON.stringify(r.text)}`);
}

console.log('\nTHE RECORD IS VISIBLE WHILE THE RUN IS LIVE, NOT ONLY IN ITS EPITAPH');
{
  const r = await atMount(4, 6, 390);
  r.err ? bad(r.err)
    : r.text === '4 · best 6' ? ok(`a live run carries the number it is chasing ("${r.text}")`)
    : bad(`a live run reads ${JSON.stringify(r.text)}`);
  r.height <= 44 ? ok('on one line') : bad(`the live pill is ${r.height}px tall — it wrapped`);
}
{
  /* Same rule the break line already follows: at best <= run the record IS this run, and
     "6 · best 6" prints one number twice and reads like a bug. */
  const r = await atMount(6, 6, 390);
  r.err ? bad(r.err)
    : r.text === '6' ? ok('and says it once when the run has caught the record')
    : bad(`equality reads ${JSON.stringify(r.text)}`);
}

console.log('\nAND IT WEIGHS MORE ONCE THERE IS SOMETHING TO LOSE');
/* p90 of the best run anyone has ever had is 8 and p99 is 18, so a live 7 is rare air: the tap
   is expensive and a hint is worth its price for the first time. That is the moment the pill
   has to stop looking like the one at 1. */
{
  const lo = await atMount(4, 9, 390), hi = await atMount(7, 9, 390);
  !/\bhot\b/.test(lo.cls || '') ? ok('a run of 4 is drawn plainly') : bad('the escalation fires too early');
  /\bhot\b/.test(hi.cls || '') ? ok('a run of 7 is drawn as a stake') : bad(`a run of 7 reads class ${JSON.stringify(hi.cls)}`);
  hi.height <= 52 && !hi.overlap && !hi.offscreen
    ? ok('and the heavier pill still clears the headline and the viewport')
    : bad(`the hot pill is ${hi.height}px, overlap=${hi.overlap} offscreen=${hi.offscreen}`);
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
