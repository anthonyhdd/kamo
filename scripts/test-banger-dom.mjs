#!/usr/bin/env node
/**
 * THE OPENER — the banger's position obeys its arm, and the ways that goes wrong in silence.
 *
 * 69% of feed openings die on the first slide with the photo painted (feed_first_paint,
 * 2026-08-18: 92.7% of paints < 1s — they are declining, not waiting), and the curve after
 * slide 1 is flat. The bangerArm experiment moves the proven feed_best hide from slide 3 to
 * slide 0 for never-published devices, position being the only variable. Every failure mode
 * here renders a perfectly fine-looking feed:
 *
 *   - OPENER SHOWN TO THE CONTROL ARM. A leaking holdout is not a smaller effect, it is no
 *     measurement — and the screen looks identical to a working experiment.
 *   - OPENER SHOWN TO A CREATOR. The arm spends the door-slot on the population dying at the
 *     door; a device with published hides keeps freshness-first, banger at 3, like always.
 *   - TWO BANGERS IN ONE SESSION. kfSeedBest must stand down when the opener seeded — a
 *     second proven hide at slide 3 would change two variables and read as neither.
 *   - THE SEEN OPENER. An opener you have already met is furniture; the session must run
 *     bangerless rather than reopen on a rerun.
 *   - THE DUPLICATE. The cached first page can legally contain the banger row; exactly one
 *     slide may carry it, and the collision files as `seeded` in feed_dupe_blocked.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-banger-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the banger-opener test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Stubbed at the declaration, not appended: kfBangerProbe runs on the 1200ms launch timer,
   long before any hook appended at the end of the module could exist. */
const stub = (src, anchor) => {
  if (!src.includes(anchor)) throw new Error('anchor missing: ' + anchor);
  return src.replace(anchor, anchor +
    'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');
};
let html = stub(real, 'async function kfRpc(fn,body){');
html = stub(html, 'async function chRpc(fn,body){');
html = stub(html, 'async function chRpcRows(fn,body){');
html = html.replace('function track(event,props){',
  'function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);');
html = html.replace('function chFeed(opts){',
  'window.__chFeed=(o)=>chFeed(o);\nfunction chFeed(opts){');

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/* Eight strangers' fresh hides, and one proven one the room has voted for. */
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: null,
  n_attempts: i, n_found: 0, created_at: '2026-08-16T10:0' + i + ':00Z',
}));
const BANGER = { id: 'best0', img_path: 'b0.jpg', name: null, n_attempts: 9, n_found: 5, created_at: '2026-08-14T09:00:00Z' };

/**
 * A device with both arms, the hide list and its own history in a known state. The 1500ms
 * wait before opening the feed is not padding: kfBangerProbe rides the same 1200ms launch
 * timer as kfProbe, and opening earlier would test a prefetch that never ran.
 */
async function open({ arm = 'on', mine = [], seen = [], rows = ROWS } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = {
      feed_page: a.rows,
      feed_best: [a.banger],
      /* THE ROWS HAVE TO RESOLVE, or the ordering this file asserts is measured against a
         scroller the feed has been emptying underneath it.
         Unseeded, get_hide fell through the stub to the real call — and what came back
         decided the test. On a machine with no route to the project it throws, the round
         shows its card, every slide stays mounted and the assertions pass. On CI, where the
         call lands, the server answers honestly that these fixture ids are not rows, and a
         feed that now DROPS a hide the server says is gone takes them out one by one: slide 0
         came back "p1.jpg" against an expected "b0.jpg" with four of nine rows left standing.
         The feed was doing exactly what it was just taught to do; the fixture had never said
         these hides exist. Seeded the same way test-feed-dom seeds it, so the two harnesses
         agree on what a live row looks like. */
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      log_skip: null,
      log_attempt: null,
    };
    localStorage.setItem('kamo_feed_banger_arm', a.arm);
    localStorage.setItem('kamo_feed_gate_arm', 'off');   // one experiment on stage at a time
    if (a.mine.length) localStorage.setItem('kamo_hides', JSON.stringify(a.mine));
    if (a.seen.length) localStorage.setItem('kamo_feed_seen', JSON.stringify(a.seen));
    localStorage.setItem('kamo_pw_first', '1');
    localStorage.setItem('kamo_feed_swiped', '1');
  }, { rows, banger: BANGER, arm, mine, seen });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__chFeed({}));
  await page.waitForTimeout(1000);
  return page;
}

/* What the room actually holds: the src of every slide's photo, in order. */
const srcs = page => page.evaluate(() =>
  [...document.querySelectorAll('.kfSlide img.kfPrev')].map(i => (i.getAttribute('src') || '').split('/').pop()));
const seeded = page => page.evaluate(() => (window.__tr || []).filter(e => e[0] === 'feed_best_seeded').map(e => e[1]));

console.log('\nTHE ON ARM OPENS ON THE PROVEN PHOTO, ONCE');
{
  const page = await open();
  const s = await srcs(page);
  s[0] === 'b0.jpg' ? ok('slide 0 is the banger — the door leads with the photo the room voted for')
                    : bad(`slide 0 is ${JSON.stringify(s[0])}, expected b0.jpg (room: ${JSON.stringify(s)})`);
  s.filter(x => x === 'b0.jpg').length === 1
    ? ok('and exactly once — kfSeedBest stood down instead of seeding a second one at 3')
    : bad(`the banger appears ${s.filter(x => x === 'b0.jpg').length} times: ${JSON.stringify(s)}`);
  const ev = await seeded(page);
  ev.length === 1 && ev[0] && ev[0].pos === 0 && ev[0].plays === 9
    ? ok('feed_best_seeded filed once, carrying pos:0 and the plays it promised')
    : bad(`feed_best_seeded: ${JSON.stringify(ev)}`);
  await page.close();
}

console.log('\nTHE CONTROL ARM KEEPS TODAY\'S FEED — FRESHNESS AT THE DOOR, BANGER AT 3');
{
  const page = await open({ arm: 'off' });
  const s = await srcs(page);
  s[0] === 'p0.jpg' ? ok('slide 0 is the fresh hide — the holdout does not leak')
                    : bad(`slide 0 is ${JSON.stringify(s[0])}, expected p0.jpg`);
  s[3] === 'b0.jpg' ? ok('and the banger holds the middle, at slide 3, like always')
                    : bad(`slide 3 is ${JSON.stringify(s[3])}, expected b0.jpg (room: ${JSON.stringify(s)})`);
  const ev = await seeded(page);
  ev.length === 1 && ev[0] && ev[0].pos === 3
    ? ok('feed_best_seeded says pos:3, so the two arms are tellable apart in the data')
    : bad(`feed_best_seeded: ${JSON.stringify(ev)}`);
  await page.close();
}

console.log('\nA CREATOR NEVER MEETS THE OPENER, WHATEVER THE COIN SAID');
{
  const page = await open({ arm: 'on', mine: ['minehide'] });
  const s = await srcs(page);
  s[0] === 'p0.jpg' ? ok('slide 0 stays fresh — the door-slot is spent only on who is dying at the door')
                    : bad(`slide 0 is ${JSON.stringify(s[0])}, expected p0.jpg`);
  const ev = await seeded(page);
  ev.length === 1 && ev[0] && ev[0].pos === 3
    ? ok('and the banger still serves them at slide 3 — the arm gates the position, not the photo')
    : bad(`feed_best_seeded: ${JSON.stringify(ev)}`);
  await page.close();
}

console.log('\nA SEEN OPENER DECLINES INSTEAD OF RERUNNING');
{
  const page = await open({ arm: 'on', seen: ['best0'] });
  const s = await srcs(page);
  s.indexOf('b0.jpg') === -1
    ? ok('the session runs bangerless — an opener already met is furniture, not proof')
    : bad(`the seen banger came back at index ${s.indexOf('b0.jpg')}`);
  const ev = await seeded(page);
  ev.length === 0 ? ok('and its absence is on the record: no feed_best_seeded at all')
                  : bad(`feed_best_seeded fired anyway: ${JSON.stringify(ev)}`);
  await page.close();
}

console.log('\nTHE PAGE\'S OWN COPY OF THE BANGER IS A TWIN, NOT A SECOND SLIDE');
{
  const page = await open({ arm: 'on', rows: [BANGER, ...ROWS] });
  const s = await srcs(page);
  s.filter(x => x === 'b0.jpg').length === 1
    ? ok('one slide carries it — the loadPage dedup ate the twin')
    : bad(`the banger appears ${s.filter(x => x === 'b0.jpg').length} times: ${JSON.stringify(s)}`);
  const dupe = await page.evaluate(() => (window.__tr || []).filter(e => e[0] === 'feed_dupe_blocked').map(e => e[1]));
  dupe.length === 1 && dupe[0] && dupe[0].seeded === 1
    ? ok('and the collision filed as `seeded`, the kind the dedup comment calls expected')
    : bad(`feed_dupe_blocked: ${JSON.stringify(dupe)}`);
  await page.close();
}

await browser.close(); server.close();
if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
console.log('\nall banger-opener assertions passed');
