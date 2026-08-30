#!/usr/bin/env node
/**
 * THE ONE-BUZZ SEEKER, IN A REAL BROWSER.
 *
 * The seeker screen was rewritten end to end (one aimed buzz, no clock, snap reveal,
 * A/B flip, send-one-back) and every one of its failure modes is invisible to the static
 * checks: a reticle that never appears, a release that commits nothing, a snap that turns
 * into a fade, a flip with nothing behind it, a re-hide that leaves the overlay up. This
 * drives the real file with a mouse and asserts the round end to end — miss, win with the
 * percentile line, give-up, the legacy marker fallback, and the no-install send-back.
 *
 * chRpc is stubbed by injecting immediately after its declaration (the seeker fetches its
 * hide during load), and the storage images are fulfilled from a route so the snap has real
 * frames to swap. Skips loudly without playwright-core, like every DOM test here.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-buzz-dom.mjs
 */
/* globSync is NOT imported here: it landed in node:fs in Node 22, and the sync-mirror
   workflow runs the gate on Node 20 — a static named import of a missing export is a
   SyntaxError BEFORE the playwright-core skip can run, which turned this whole test into
   "THE ONE-BUZZ SEEKER IS BROKEN" on a machine that was only supposed to skip it. It is
   resolved dynamically below, after the skip guard, exactly like the other DOM tests. */
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
  console.log('· playwright-core not installed — skipping the buzz test — run: ' + PW_SETUP);
  process.exit(0);
}
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const anchor = 'async function chRpc(fn,body){';
if (!real.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
let html = real.replace(anchor, anchor + 'if(window.__rpc) return window.__rpc(fn,body);');
/* ⚠️ THE SECOND DOOR. chRpcRows is not chRpc — PostgREST returns a set-returning function as
   an ARRAY and chRpc unwraps to the first element, so anything that legitimately wants rows
   (the day's board) goes through the other one. Stubbing only chRpc sent those calls at the
   real network, where they failed silently and the screen painted nothing. */
const anchorRows = 'async function chRpcRows(fn,body){';
if (!html.includes(anchorRows)) { console.error('anchor missing: chRpcRows'); process.exit(1); }
html = html.replace(anchorRows, anchorRows
  + 'if(window.__rpc){ const r=await window.__rpc(fn,body); return Array.isArray(r)?r:(r?[r]:[]); }');

const MIME = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try { const b = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(b); }
  catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// a real tiny JPEG (2x3 px) so <img> decodes
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAADAAIBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AL9f/9k=', 'base64');

const { globSync } = await import('node:fs');
const glob = (p) => { try { return (typeof globSync === 'function' ? globSync(p) : []) || []; } catch { return []; } };
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/* ⚠️ A PHOTO WITH A SIZE. JPG above is a placeholder a few pixels tall — fine for every other
   case in this file, and useless here: the frame rendered 3px high and the card 10px, so the
   first version of this assertion was measuring the harness rather than the layout. The exact
   trap the send hit-test carries a note about. 600x800 of flat grey gives the frame real
   geometry to be covered by. */
/* ⚠️ THE SHAPE OF THE SCREEN, NOT JUST A SIZE. The first attempt used a 600x800 photo,
   which letterboxes into a 390x844 viewport at 390x520 with 162px of black above and
   below -- so cy=0.92 landed at y=640, ABOVE the card, and the assertion failed against
   correct code. An image the viewport's own shape fills it, and cy then means on screen
   what it means in the answer key. Two false diagnoses today came from measuring the
   harness instead of the layout; this is the fix for both. */
const BIG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAYYAAANMCAIAAADXDp1JAAAIBUlEQVR42u3UoQ0AAAgEsR8dgWBsZsAhmnSCE5fqAXgiEgCWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCWpAFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJakAWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlSQBYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAZakAmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBlqQCYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQGWJAFgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFgSgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYEoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWBKAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBFiSCoAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEWJIKgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRYkgSAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRgSYAlAVgSYEkAlgRYEoAlAZYEYEmAJQFYEmBJAJYEYEmAJQFYEmBJAJYEWBKAJQGWBGBJgCUBWBJgSQCWBGBJgCUBWBJgSQCWBFgSgCUBlgRgSYAlAVgSYEkAlgRgSYAlAVgSYEkAFwtCOGXsyEGUNgAAAABJRU5ErkJggg==', 'base64');
async function boot({ hit, pct, others, frames, name = 'tony', deadPhoto = false, cy = 0.5, big = false, round = 1, oldRound = 0, ansCx = 0.5, run = 0, life = true, best = 0, reduced = false, passLeft = false, board = null, noStore = false }) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  await page.route('**/storage/v1/object/public/hides/**', route => {
    const u = route.request().url();
    /* `deadPhoto` kills the camo image itself, not just the reveal frames: a dead storage
       path, an object still replicating, a tunnel. See the block at the end of this file. */
    if (deadPhoto) return route.fulfill({ status: 404, body: 'x' });
    if (!frames && (u.includes('_b.jpg') || u.includes('_w.jpg'))) return route.fulfill({ status: 404, body: 'x' });
    route.fulfill(big ? { status: 200, contentType: 'image/png', body: BIG }
                      : { status: 200, contentType: 'image/jpeg', body: JPG });
  });
  await page.addInitScript(({ hit, pct, others, name, cy, round, oldRound, ansCx, run, life, best, passLeft, board, noStore }) => {
    /* ⚠️ REFUSED, NOT ABSENT. Safari in private mode hands you a localStorage that EXISTS and
       throws on write, which is exactly the shape chDeviceId() was built to survive — deleting
       the object instead would throw somewhere else and test the harness. Cookies swallow
       writes, IndexedDB is gone: all three stores refused, which is the only state in which
       chDeviceId() returns its shared "w-nostore" sentinel. */
    if (noStore) {
      try {
        const dead = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); },
                       removeItem() {}, clear() {}, key: () => null, length: 0 };
        Object.defineProperty(window, 'localStorage', { configurable: true, get: () => dead });
      } catch (e) {}
      try { Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set() {} }); } catch (e) {}
      try { Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined }); } catch (e) {}
    }
    /* ⚠️ THE LIFE IS SEEDED EXPLICITLY, ALWAYS. "0" means spent and anything else — a missing
       key included — means available, so an unseeded break case silently becomes a SAVE case
       that still renders a pill, and the assertion passes while testing the other mechanic. */
    try {
      /* ⚠️ THE DAY'S SKIP IS SEEDED SPENT UNLESS A CASE ASKS FOR IT, exactly like the run's
         life. Since 2026-08-29 the FIRST give-up of a UTC day leaves the run standing and ends
         with "Skipped." instead of an epitaph — so every case here that uses the give-up as a
         cheap way to reach an ending would silently become a pass case, and the one that reads
         the headline would compare against the wrong sentence. Spent by default keeps every
         existing assertion meaning what it was written to mean. */
      if (passLeft) localStorage.removeItem('kamo_giveup_day');
      else localStorage.setItem('kamo_giveup_day', new Date().toISOString().slice(0, 10));
      localStorage.setItem('kamo_seek_run', String(run));
      localStorage.setItem('kamo_seek_best', String(best));
      localStorage.setItem('kamo_seek_life', life ? '1' : '0');
    } catch (e) {}
    window.__board = board || [];
    window.__calls = [];
    window.__rpc = (fn, body) => {
      window.__calls.push([fn, body]);
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 3, n_found: 1, limit_s: null, max_taps: null, name, round });
      /* `old_round` is what the server sends when a miss landed on an ANCESTOR's figure — the
         player found a real camouflaged person, just not this round's. */
      if (fn === 'submit_attempt') return Promise.resolve({ hit, tries: 4, missed: 3, secs: 9, pct, others,
        old_round: oldRound || undefined, old_name: oldRound ? 'OchreHare' : undefined, old_id: oldRound ? 'someoneelse0000' : undefined });
      if (fn === 'reveal_hide') return Promise.resolve({ cx: ansCx, cy: cy, r: 0.1 });
      if (fn === 'streak_board_v2') return Promise.resolve(window.__board || []);
      return Promise.resolve(null);
    };
  }, { hit, pct, others, name, cy, round, oldRound, ansCx, run, life, best, passLeft, board, noStore });
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  return page;
}
const page0Text = async (page) => page.evaluate(() => {
  const e = document.querySelector('.chRun');
  return e && e.style.display !== 'none' ? e.textContent : '';
});
const txt = async (page, id) => page.evaluate(i => { const e = document.getElementById(i); return e ? e.textContent : null; }, id);
const calls = async (page) => page.evaluate(() => window.__calls.map(c => c[0]));

console.log('\nLOAD — full-bleed photo, floating words, running clock');
{
  const page = await boot({ hit: false, frames: true });
  /* The sender is the AUTHOR of the puzzle, never its subject: "Find @tony" made the
     stranger hunt for a person who is not in the picture. */
  (await txt(page, 'chHead')) === '@tony hid a kamo here' ? ok('head names the sender as the one who HID') : bad('head: ' + await txt(page, 'chHead'));
  /^One (tap|buzz) to find\.?$/.test(await txt(page, 'chSub') || '') ? ok('sub states the deal') : bad('sub: ' + await txt(page, 'chSub'));
  const clockShown = await page.evaluate(() => document.getElementById('chClock').style.display !== 'none');
  clockShown ? ok('clock is running from decode') : bad('clock never started');
  const capped = await page.evaluate(() => {
    const img = document.querySelector('#chFrame img'); const cs = getComputedStyle(img);
    return { mw: cs.maxWidth, mh: cs.maxHeight };
  });
  parseFloat(capped.mh) >= 844 ? ok(`photo capped only by the viewport (${capped.mh} = 100dvh)`) : bad(`photo still capped: ${capped.mh}`);
  await page.close();
}

console.log('\nAIM & MISS — reticle above the finger, one buzz ends it, snap + flip');
{
  const page = await boot({ hit: false, frames: true });
  await page.mouse.move(200, 500);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const ret = await page.evaluate(() => {
    const r = document.querySelector('.chRet'); if (!r) return null;
    return { top: parseFloat(r.style.top), left: parseFloat(r.style.left) };
  });
  ret ? ok('reticle appears on touch') : bad('no reticle on touch');
  if (ret) (ret.top < 500 - 40) ? ok(`reticle offset above the finger (y=${ret.top})`) : bad(`reticle not offset: y=${ret.top}`);
  await page.mouse.move(210, 520); await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const cs = await calls(page);
  cs.includes('submit_attempt') ? ok('release commits the buzz') : bad('no submit_attempt after release: ' + cs);
  const v2 = await page.evaluate(() => (window.__calls.find(c => c[0] === 'submit_attempt') || [])[1]);
  v2 && v2.p_v === 2 ? ok('buzz rides the v2 overload (percentile era)') : bad('p_v missing: ' + JSON.stringify(v2));
  cs.includes('save_seek_trace') ? ok('the trace is filed at the end') : bad('no save_seek_trace: ' + cs);
  const tr = await page.evaluate(() => (window.__calls.find(c => c[0] === 'save_seek_trace') || [])[1]);
  tr && tr.p_trace && tr.p_trace.end && tr.p_trace.why === 'miss' && Array.isArray(tr.p_trace.a)
    ? ok('trace carries the buzz instant and the aims') : bad('trace malformed: ' + JSON.stringify(tr && tr.p_trace && Object.keys(tr.p_trace)));

  /* ═══ THE PLAYER IS COUNTABLE, AND NOT VIA THE AUTHOR KEY ═══════════════════════════════════
     Until 2026-08-30 retention could only be computed for people who had PUBLISHED — the author
     key is minted on the first publish and nowhere else, so a device that opens the app daily
     and plays twenty rounds without making one was, to every query, nobody. Founder: "Rétention
     devrait juste être des active users non ? Pas besoin de créer non ??".
     ⚠️ IT MUST NOT BE `k`, AND THAT IS THE ASSERTION THAT MATTERS MOST HERE. Minting the author
     key on a play would stamp a board identity onto every anonymous link visitor, and `k` is the
     leaderboard's entry ticket — its population would quietly become "anyone who tapped a link".
     ⚠️ AND IT MUST NOT BE IN THE TRACE. get_seek_traces hands that jsonb to the creator, so a
     stable per-person key in there follows a stranger across every hide they ever play. It rides
     its own column, which that function does not select. */
  const durable = await page.evaluate(() => { try { return localStorage.getItem('kamo_did'); } catch (e) { return null; } });
  tr && typeof tr.p_device === 'string' && tr.p_device.length > 0
    ? ok('the round files a device key, so a player who never publishes is countable')
    : bad('no p_device on save_seek_trace: ' + JSON.stringify(tr && Object.keys(tr))
        + ' — pure players stay invisible, which is the whole point of the column');
  tr && durable && tr.p_device === durable
    ? ok('and it is the DURABLE id already on the device, not a freshly minted one')
    : bad(`p_device ${JSON.stringify(tr && tr.p_device)} is not kamo_did ${JSON.stringify(durable)} `
        + '— an id minted per round counts one person as many and reads as zero retention');
  tr && tr.p_trace && !('d' in tr.p_trace) && !tr.p_trace.device
    ? ok('and it is NOT in the trace jsonb, which the creator gets to read')
    : bad('the device key was put in p_trace — get_seek_traces hands that to any creator '
        + 'replaying the hide, which links a stranger across every round they have played');

  /* ═══ THE OPEN IS COUNTED, NOT ONLY THE ENDING ══════════════════════════════════════════
     seek_traces is written by sendTrace(), which runs on hit, miss and giveup — endings. A
     recipient who opens a friend's challenge, looks at the photograph and leaves wrote nothing
     at all, so "46% of sent hides were opened" was really "46% were opened AND finished": a
     floor read as an open rate. The send loop is this product's only free acquisition and its
     middle step had no number.
     ⚠️ THE HARNESS IS THE POSITIVE CONTROL FOR `wd`, WHICH IS THE POINT OF ASSERTING IT HERE.
     The browser population on this product is ~89% automated — Amplitude reported 3157 link
     opens on 2026-08-29 against 191 challenges sent — so a row nobody can filter is a row
     worth nothing. Playwright IS an automated browser and sets navigator.webdriver, so if this
     round does not report wd:true the discriminator does not work and the table it feeds
     cannot be cleaned. */
  const open = await page.evaluate(() => (window.__calls.find((c) => c[0] === 'log_link_open') || [])[1]);
  open ? ok('a link round writes its OPEN, before any tap decides anything')
       : bad('no log_link_open on a link round — the middle step of the send loop stays unmeasured');
  open && open.p_dev && open.p_dev === durable
    ? ok('and it carries the same durable device key the trace does')
    : bad('log_link_open device key ' + JSON.stringify(open && open.p_dev) + ' is not kamo_did '
        + JSON.stringify(durable) + ' — opens and rounds could not be joined to one person');
  open && open.p_wd === true
    ? ok('and this automated browser is flagged wd:true, so real traffic can be told from crawlers')
    : bad('log_link_open reported wd:' + JSON.stringify(open && open.p_wd) + ' from Playwright, '
        + 'which IS a webdriver — the flag that separates ~89% automated traffic does not work');
  open && open.p_host === 'browser'
    ? ok('and names the surface it was opened on')
    : bad('log_link_open host: ' + JSON.stringify(open && open.p_host));

  const src = await page.evaluate(() => document.querySelector('#chFrame img').src);
  (src.includes('_b.jpg') || src.includes('_w.jpg'))
    ? ok(`THE SNAP: photo swapped to the revealed frame (${src.includes('_w') ? 'mid-wave — il bouge' : 'still'})`)
    : bad('no snap, src=' + src);
  /* The loss names its clock now, like the win does. The reveal line moved to the subtitle. */
  /^Lost in \d+\.\d+s$/.test(await txt(page, 'chHead')) ? ok('one miss ends the round, on the clock') : bad('head after miss: ' + await txt(page, 'chHead'));
  (await txt(page, 'chSub')) === 'The kamo was right there.' ? ok('and the reveal line carries under it') : bad('sub after miss: ' + await txt(page, 'chSub'));
  const reh = await page.evaluate(() => { const e = document.getElementById('chReh'); return e ? e.textContent : null; });
  /* NAMES THE SENDER WHEN THE HIDE IS SIGNED, bare when it is not — and the assertion has to
     allow both or it pins whichever fixture this file happens to load. The "to @x" half is the
     2026-08-14 change: the feed said "Hide one in this photo" and converted at 7% against the
     link path's 222% on the same button in the same position, so the sentence names a person
     on both surfaces now. Still an EXACT match either way: a regression that empties the
     handle must fail here rather than pass a substring check on "Challenge back".
     RENAMED 2026-08-15: "Send one back" described a mechanism that does not happen — nothing
     is sent, the reply is published and the creator finds it — and what the recipient gets is
     a round, not a message. */
  /^Challenge( @[^@\s]+)? back$/.test(reh || '')
    ? ok(`primary CTA is the no-install send-back${/ to @/.test(reh) ? ', naming the sender' : ''}`)
    : bad('chReh: ' + reh);
  const go = await page.evaluate(() => { const e = document.getElementById('chGo'); return e ? e.textContent : null; });
  go === 'Get KAMO' ? ok('install CTA is secondary') : bad('chGo: ' + go);
  // flip
  await page.waitForTimeout(2200); // let the wave settle
  const flipBtn = await page.evaluate(() => !!document.getElementById('chFlipB'));
  flipBtn ? ok('flip button armed') : bad('no flip button');
  await page.evaluate(() => document.getElementById('chFlipB').click());
  await page.waitForTimeout(100);
  const src2 = await page.evaluate(() => document.querySelector('#chFrame img').src);
  (!src2.includes('_b.jpg') && !src2.includes('_w.jpg')) ? ok('flip A: back to camouflage') : bad('flip did not return to camo: ' + src2);
  await page.evaluate(() => document.getElementById('chFlipB').click());
  await page.waitForTimeout(100);
  const src3 = await page.evaluate(() => document.querySelector('#chFrame img').src);
  src3.includes('_b.jpg') ? ok('flip B: revealed again — the double-take') : bad('flip back failed: ' + src3);
  // second buzz impossible
  await page.mouse.move(150, 400); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => window.__calls.filter(c => c[0] === 'submit_attempt').length);
  n === 1 ? ok('no second buzz, ever') : bad('a second buzz got through: ' + n);
  await page.close();
}

console.log('\nA CHAIN SAYS WHICH KAMO, BEFORE THE TAP AND AFTER IT');
{
  /* THE FOUNDER'S ROUND, 2026-08-28. A round-2 photograph carries round 1's figure too, and
     that one was the big obvious grey shape dead centre (cx 0.499/0.429) while the answer was
     small and top-left (cx 0.221/0.228). He tapped the obvious one and could not have known:
     the headline said "hid a kamo" and the sub said "Round 2", which is a number, not a rule. */
  const page = await boot({ hit: false, frames: true, round: 2, oldRound: 1, ansCx: 0.22, cy: 0.23 });
  (await txt(page, 'chHead')) === '@tony hid a new kamo here'
    ? ok('before the tap, the headline says the kamo is a NEW one')
    : bad('chain headline: ' + await txt(page, 'chHead'));

  await page.mouse.move(195, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1800);

  (await txt(page, 'chHead')) === 'Wrong kamo.'
    ? ok('a tap on an ancestor is named, not scored as a plain failure')
    : bad('ending head: ' + await txt(page, 'chHead'));

  /* ⚠️ ONE CIRCLE, NOT TWO — founder, 2026-08-21, "why u put 2 circles and don't show the
     body". The miss ring must be REPLACED by the answer ring, never joined by it: two rings
     differing only in border colour is a legend nobody was given. */
  const marks = await page.evaluate(() => {
    const f = document.getElementById('chFrame');
    return [...f.querySelectorAll('.chMark')].map((m) => ({
      hit: m.classList.contains('hit'), left: m.style.left, top: m.style.top,
    }));
  });
  marks.length === 1 && marks[0].hit
    ? ok('exactly one ring is left on the photo, and it is the answer')
    : bad(`${marks.length} ring(s) on the frame: ` + JSON.stringify(marks));

  /* AND IT SITS ON THE ANSWER, not on the figure that was tapped. Asserted against the frame's
     own width so a letterboxed fixture cannot make this pass by accident. */
  const placed = await page.evaluate(() => {
    const m = document.querySelector('#chFrame .chMark.hit');
    const im = document.querySelector('#chFrame img');
    if (!m || !im || !im.offsetWidth) return null;
    return { x: parseFloat(m.style.left) / im.offsetWidth, y: parseFloat(m.style.top) / im.offsetHeight };
  });
  placed && Math.abs(placed.x - 0.22) < 0.02 && Math.abs(placed.y - 0.23) < 0.02
    ? ok(`the ring lands on the answer (${placed.x.toFixed(2)}, ${placed.y.toFixed(2)}), not on the tap`)
    : bad('answer ring at ' + JSON.stringify(placed) + ', expected ~0.22/0.23');
  await page.close();
}

console.log('\nAND ROUND ONE IS LEFT EXACTLY AS IT WAS');
{
  /* One figure, one revealed body: the miss ring earns its place because the flip against the
     revealed frame shows how close the tap came. Nothing above may touch this. */
  const page = await boot({ hit: false, frames: true, round: 1 });
  (await txt(page, 'chHead')) === '@tony hid a kamo here'
    ? ok('a first-round photo still says "a kamo", with no chain wording')
    : bad('round-1 headline: ' + await txt(page, 'chHead'));
  await page.mouse.move(195, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1800);
  const kinds = await page.evaluate(() => [...document.querySelectorAll('#chFrame .chMark')]
    .map((m) => (m.classList.contains('hit') ? 'hit' : 'miss')));
  kinds.length === 1 && kinds[0] === 'miss'
    ? ok('the miss ring survives on a round-1 photo — the body is the answer there')
    : bad('round-1 rings: ' + JSON.stringify(kinds));
  await page.close();
}

console.log('\nTHE RUN PILL SAYS WHEN A MISS ACTUALLY ENDS IT');
{
  /* The one life is invisible: a player does not know they have it, does not know when they
     spent it, and so does not know that THIS round is the one that costs the run — the only
     moment the round carries any stake at all. The hint modal says it, but after the tap and
     on one arm, to somebody who has already decided.
     ⚠️ IN THE PILL THAT IS ALREADY THERE. Two teaching pills were deleted from this screen for
     spending 7.2 seconds of a round on text; a third would be the same mistake in new words. */
  const spent = await boot({ hit: false, frames: true, run: 4, life: false, best: 9 });
  const pill = await page0Text(spent);
  /\b4\b/.test(pill) && /last life/i.test(pill)
    ? ok(`a spent life is named on the live pill ("${pill}")`)
    : bad(`run pill with the life gone reads ${JSON.stringify(pill)}`);
  await spent.close();

  const held = await boot({ hit: false, frames: true, run: 4, life: true, best: 9 });
  const pill2 = await page0Text(held);
  !/last life/i.test(pill2 || '')
    ? ok(`an intact life claims nothing ("${pill2}")`)
    : bad(`the pill cried "last life" while the life was still there: ${JSON.stringify(pill2)}`);
  await held.close();

  /* NOTHING TO LOSE, NOTHING SAID. Telling somebody with no run that they might lose it is the
     sentence the hint modal already refuses to print for the same reason. */
  const none = await boot({ hit: false, frames: true, run: 0, life: false, best: 0 });
  const pill3 = await page0Text(none);
  !/last life/i.test(pill3 || '')
    ? ok('a player with no run is told nothing about losing one')
    : bad(`a run of 0 was warned about its last life: ${JSON.stringify(pill3)}`);
  await none.close();
}

console.log('\nWIN — percentile spoken, same snap');
{
  const page = await boot({ hit: true, pct: 78, others: 12, frames: true });
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1200);
  const head = await txt(page, 'chHead');
  /^Found in \d+\.\ds$/.test(head || '') ? ok(`head carries the time ("${head}")`) : bad('head after win: ' + head);
  (await txt(page, 'chSub')) === 'Faster than 78% of players.' ? ok('percentile line') : bad('sub after win: ' + await txt(page, 'chSub'));
  const found = await page.evaluate(() => document.getElementById('chFrame').classList.contains('found'));
  found ? ok('green frame on the find') : bad('no found state');

  /* THE CONFETTI, ASSERTED WHERE ITS ONLY CALLER LIVES. These three checks used to sit in
     test-peek-dom, which reached confettiBurst() through the sender's local rehearsal of their
     own hide — an overlay deleted on 2026-08-15, when "See it live" replaced a simulated round
     with the real one in the feed. The burst itself is not dead: this is the other call site
     and always was the one that matters, a stranger actually finding you.
     EXACTLY ONE LAYER. It is a full-screen canvas and a second one is a second full-screen
     canvas; nothing about that is visible, because they are transparent and stack perfectly.
     POLLED, NOT SAMPLED AT A FIXED INSTANT. The effect has a lifetime, so any single moment is
     either too early or too late — and the reduce-motion bloom below lives about 870ms, which
     is exactly the kind of number a hardcoded wait gets wrong the first time somebody tunes
     the animation. Both windows are asserted by waiting for the condition instead. */
  const layers = await page.waitForFunction(() => document.querySelectorAll('.kConfetti').length === 1,
    /* 2500 was the ceiling until 2026-08-27 and it went red on the CI runner while passing
       4/4 locally. The condition was already polled — the note above is right — so the defect
       was never the sampling, it was a ceiling tuned on a fast idle machine. A polled wait that
       succeeds in 200ms costs 200ms no matter what this number says; the only thing raising it
       can do is stop a loaded runner from being called a bug. */
    null, { timeout: 8000 }).then(() => true).catch(() => false);
  layers ? ok('one confetti layer is thrown')
         : bad(`${await page.evaluate(() => document.querySelectorAll('.kConfetti').length)} confetti `
             + 'layers within 8s of the find — expected exactly 1');

  /* AND IT HAS TO LEAVE. The canvas sits at z-index 95, above the ending card's own buttons.
     One left behind is an invisible sheet over every control on the screen — the loop's most
     valuable moment ends on a card nobody can tap. */
  const gone = await page.waitForFunction(() => document.querySelectorAll('.kConfetti').length === 0,
    null, { timeout: 4000 }).then(() => true).catch(() => false);
  gone
    ? ok('and it removes itself when the last piece dies')
    : bad('a confetti canvas is still in the DOM 4s after the find — at z-index 95 that is an '
        + 'invisible sheet over "Send one back" and every other control on the ending');
  await page.close();
}

/* REDUCED MOTION IS A REAL PATH, NOT A SWITCH THAT TURNS THE FEATURE OFF. confettiBurst()
   returned early under it once, which left those users with a green frame, a headline, and
   nothing else — the setting asks for less movement, not for less feedback. It draws a still
   mint bloom instead, carrying the same class, so the cleanup rule above covers it too.
   Emulated for real: asserting on the CSS text would prove nothing about what the branch does. */
console.log('\nWIN UNDER REDUCE MOTION — a still bloom, and it still leaves');
{
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  await page.route('**/storage/v1/object/public/hides/**', route =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG }));
  await page.addInitScript(() => {
    window.__calls = [];
    window.__rpc = (fn, body) => {
      window.__calls.push([fn, body]);
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 3, n_found: 1, limit_s: null, max_taps: null, name: 'tony' });
      if (fn === 'submit_attempt') return Promise.resolve({ hit: true, tries: 4, missed: 3, secs: 9, pct: 78, others: 12 });
      if (fn === 'reveal_hide') return Promise.resolve({ cx: 0.5, cy: 0.5, r: 0.1 });
      return Promise.resolve(null);
    };
  });
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  /* The bloom's whole life is ~870ms (a frame, 300ms held, a 560ms fade-out), so it is gone
     well before the 1.2s these blocks usually wait for the ending card. Waited for, not
     sampled — a fixed instant here asserts the timing rather than the behaviour, and this one
     failed exactly that way the first time it was written. */
  const bloomed = await page.waitForFunction(() => document.querySelectorAll('.kConfetti').length === 1,
    null, { timeout: 2500 }).then(() => true).catch(() => false);
  const rmFound = await page.evaluate(() => document.getElementById('chFrame').classList.contains('found'));
  bloomed && rmFound
    ? ok('it still celebrates — green frame and a still bloom, no flying particles')
    : bad(`Reduce Motion gets found=${rmFound}, bloom=${bloomed} — the setting asks for less `
        + 'movement, not for no feedback');
  const rmGone = await page.waitForFunction(() => document.querySelectorAll('.kConfetti').length === 0,
    null, { timeout: 3000 }).then(() => true).catch(() => false);
  rmGone
    ? ok('and the bloom cleans up too')
    : bad('a bloom is left at z-index 95 — an invisible sheet over every control');
  await page.close();
}

console.log('\nGIVE UP — explicit, immediate reveal, same ending');
{
  const page = await boot({ hit: false, frames: true });
  await page.evaluate(() => document.getElementById('chQuit').click());
  /* ⚠️ WAITED ON, NOT SLEPT THROUGH. This was waitForTimeout(900) followed by a read, and 900ms
     is a guess about how long a decode takes on whatever machine is running — fine on a Mac
     with nothing else on it, not fine on the CI runner, where it went red twice in one day on
     branches that could not touch this code (a .sql file, and a comment). The failure it
     produced was also actively misleading: it printed the frame's REAL URL, which reads like a
     network stub that failed to intercept, and cost an hour of looking for one. The swap is an
     event; wait for the event. The generous ceiling costs nothing when it passes in 200ms. */
  const revealed = await page.waitForFunction(
    () => { const i = document.querySelector('#chFrame img'); return !!(i && i.src.includes('_b.jpg')); },
    null, { timeout: 8000 }).then(() => true).catch(() => false);
  const src = await page.evaluate(() => { const i = document.querySelector('#chFrame img'); return i ? i.src : '(no img)'; });
  revealed ? ok('give up → immediate reveal') : bad('no reveal on give-up after 8s: ' + src);
  /^Lost in \d+\.\d+s$/.test(await txt(page, 'chHead')) ? ok('same ending as a miss') : bad('head: ' + await txt(page, 'chHead'));
  const cs = await calls(page);
  !cs.includes('submit_attempt') ? ok('giving up files no attempt') : bad('give-up filed an attempt');
  cs.includes('save_seek_trace') ? ok('trace still filed') : bad('no trace on give-up');
  await page.close();
}

console.log('\nLEGACY HIDE — no frames uploaded: marker fallback, no flip');
{
  const page = await boot({ hit: false, frames: false });
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1200);
  const cs = await calls(page);
  cs.includes('reveal_hide') ? ok('falls back to reveal_hide') : bad('no reveal_hide call: ' + cs);
  const marks = await page.evaluate(() => document.querySelectorAll('#chFrame .chMark.hit').length);
  marks >= 1 ? ok('answer marker shown') : bad('no answer marker');
  /* ⚠️ AND IT IS THE ONLY RING ON THE PHOTO. With the body revealed the player's own mark earns
     its place — the flip against the revealed frame shows how far off they were. Here there is
     no body: the answer is itself a ring, so leaving the miss up puts two rings on a photograph
     with nothing on screen saying which is which. They differ only by border colour, mint
     against white, which is a legend nobody was given. Founder, 2026-08-21, looking at exactly
     this screen: "why u put 2 circles and don't show the body". */
  const all = await page.evaluate(() => [...document.querySelectorAll('#chFrame .chMark')].map(m => m.className));
  all.length === 1 && /hit/.test(all[0])
    ? ok('and it is the ONLY ring on the photo — the miss steps aside when it has no body to be measured against')
    : bad(`${all.length} rings on a photo with no body: ${JSON.stringify(all)}`);
  const flipBtn = await page.evaluate(() => !!document.getElementById('chFlipB'));
  !flipBtn ? ok('no flip button without frames') : bad('flip armed with nothing to flip');
  await page.close();
}

/* ⚠️ AND A BLIP ON THE REVEAL FRAME NO LONGER COSTS THE BODY.
   The frame is the payoff of the whole round, and it got exactly one <img> load. A single
   failure dropped the round to the marker fallback for good — no body, no flip button, nothing
   to try again with — and the frames are demonstrably there: 16 of 16 played public hides
   sampled across four days carry theirs. So what reaches that branch is a transient failure,
   not an absent asset, and it was being treated as permanent. */
console.log('\nA BLIP ON THE REVEAL FRAME IS RETRIED, NOT SURRENDERED TO');
{
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  let bTries = 0;
  await page.route('**/storage/v1/object/public/hides/**', route => {
    const u = route.request().url();
    if (u.includes('_b.jpg')) { bTries++; if (bTries === 1) return route.abort('failed'); }
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
  });
  await page.addInitScript(() => {
    window.__calls = [];
    window.__rpc = (fn) => {
      window.__calls.push([fn, null]);
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 3, n_found: 1, limit_s: null, max_taps: null, name: 'tony' });
      if (fn === 'submit_attempt') return Promise.resolve({ hit: false, tries: 4, missed: 3, secs: 9, pct: 40, others: 0 });
      if (fn === 'reveal_hide') return Promise.resolve({ cx: 0.5, cy: 0.5, r: 0.1 });
      return Promise.resolve(null);
    };
  });
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(2000);
  const got = await page.evaluate(() => {
    const i = document.querySelector('#chFrame img');
    return { src: i ? i.src : '', flip: !!document.getElementById('chFlipB'), marks: document.querySelectorAll('#chFrame .chMark').length };
  });
  bTries >= 2 ? ok(`the frame was asked for again (${bTries} requests)`) : bad(`only ${bTries} request — the blip was taken as an absence`);
  /* EITHER reveal frame counts. Once `_b` lands the two alternate every 360ms — up, wave, up —
     so pinning this to `_b` would fail on whichever tick the read happens to land on. What is
     being asserted is that the camo photo has been replaced by the body at all. */
  /_(b|w)\.jpg/.test(got.src)
    ? ok(`and the body is on screen after the retry (${got.src.split('/').pop().split('?')[0]})`)
    : bad(`the photo is still ${got.src.split('/').pop()} — a blip cost the player the reveal`);
  got.flip ? ok('and the flip is armed, so the double-take is there to replay') : bad('no flip button after a successful retry');
  await page.close();
}

console.log('\nSEND ONE BACK — drops into compose with the same photo, no camera');
{
  const page = await boot({ hit: false, frames: true });
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('chReh').click());
  await page.waitForTimeout(900);
  const gone = await page.evaluate(() => !document.querySelector('.chS'));
  gone ? ok('seeker overlay dropped') : bad('overlay still up');
  /* THE PHOTO ARRIVES AS A BLOB NOW, and this assertion changed with it (2026-08-16).
     It used to require `src` to be the storage URL with crossOrigin="anonymous" — the
     MECHANISM rather than the property, and that mechanism was the bug: the feed has already
     fetched the same URL without CORS, so WebKit serves the CORS request its no-cors cache
     entry, the image never decodes, and coverInto() falls through to a near-black slab that
     gets painted and published. chRehide fetches the bytes and hands over a blob: URL, which
     is same-origin by construction.
     SO THE TEST ASSERTS THE PROPERTY: the photo decoded, and a canvas it has been drawn into
     can still be read. That is what crossOrigin was ever FOR — the publish path ends in
     toBlob() — and it stays true whichever way the bytes get here next. */
  const ph = await page.evaluate(() => {
    const p = document.getElementById('photo');
    if (!p) return null;
    let readable = null;
    try {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      c.getContext('2d').drawImage(p, 0, 0, 8, 8);
      c.toDataURL('image/jpeg');       // throws SecurityError on a tainted canvas
      readable = true;
    } catch (e) { readable = false; }
    return { display: p.style.display, blob: p.src.startsWith('blob:'), w: p.naturalWidth, readable };
  });
  ph && ph.display === 'block' && ph.w > 0
    ? ok(`the answered photo actually decoded (${ph.w}px wide)`)
    : bad('the reply photo never loaded — this is the black-board bug: ' + JSON.stringify(ph));
  ph && ph.readable
    ? ok('and the board it feeds can still be read, so the publish can toBlob')
    : bad('the photo taints the canvas — every publish from this round would die at toBlob');
  const composing = await page.evaluate(() => document.getElementById('start') ? document.getElementById('start').style.display === 'none' : true);
  composing ? ok('compose flow entered (splash gone)') : bad('splash still up');
  await page.close();
}

/* ⚠️ A PHOTO THAT NEVER ARRIVES IS NOT A ROUND — AND IT USED TO BE PLAYED ANYWAY.
   There was no img.onerror on the seeker at all. With storage answering 404 the screen kept
   its headline ("@tony hid a kamo here / One tap to find") over a black rectangle wearing the
   alt text of a broken <img>, and the round underneath was completely live: the buzz still
   committed and submit_attempt still filed an attempt. The clock, which hangs off img.onload
   alone, never started — so what it filed was p_ms 0, and that number goes into the percentile
   every other player on that hide is scored against. A round nobody could see, timed at 0.0s,
   counted for everyone.
   THE THREE THINGS THAT HAVE TO HOLD, and each of them failed on its own before: the screen
   says so, the round refuses the tap, and nothing is filed. */
console.log('\nA PHOTO THAT NEVER ARRIVES SAYS SO, AND FILES NOTHING');
{
  const page = await boot({ hit: false, deadPhoto: true });
  /* One retry is built in, so the failure state lands a beat after the first 404. */
  await page.waitForFunction(() => /didn't load/.test(document.getElementById('chHead')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
  const head = await txt(page, 'chHead');
  /didn't load/.test(head || '')
    ? ok(`the screen says the photo failed ("${head}")`)
    : bad(`a dead photo still reads "${head}" — a live round on a black rectangle`);
  const sub = await txt(page, 'chSub');
  /didn't come through/.test(sub || '')
    ? ok('and the sub says what to do about it')
    : bad(`sub reads "${sub}"`);
  const clock = await page.evaluate(() => document.getElementById('chClock').style.display);
  clock === 'none' ? ok('the clock never started, and is not shown pretending to') : bad(`clock display: ${clock}`);
  /* The buzz, driven exactly as a thumb drives it in the cases above. */
  await page.mouse.move(190, 420);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const filed = await calls(page);
  filed.includes('submit_attempt')
    ? bad(`an attempt was filed on a photo that never loaded: ${JSON.stringify(filed)} — this is the 0.0s round`)
    : ok('and the buzz commits nothing — no attempt, no 0.0s in anybody else\'s percentile');
  /* On a link there is nowhere to go but the same URL, so the card offers exactly that. */
  const retry = await page.evaluate(() => [...document.querySelectorAll('#chFoot button')].map(b => b.textContent.trim()));
  retry.includes('Try again')
    ? ok('and a link round is offered the one thing that can still work')
    : bad(`no way out of a dead link round: ${JSON.stringify(retry)}`);
  /* The card is the whole message. Left visible, the failed <img> paints the browser's own
     broken-image glyph — grey box, question mark, alt text as a caption — in the middle of it. */
  const glyph = await page.evaluate(() => { const i = document.querySelector('#chFrame img'); return i ? getComputedStyle(i).display : 'gone'; });
  (glyph === 'none' || glyph === 'gone')
    ? ok('and the broken image is taken off the card rather than left to draw its own error')
    : bad(`the failed <img> is still display:${glyph} — the browser paints a broken-image glyph over the card`);
  await page.close();
}

/* ═══ THE CARD MOVES OFF THE ANSWER ═══════════════════════════════════════════════════════════
   Founder, 2026-08-27, from a real round: the kamo was hidden low, the ending card sat on top of
   it, and the reveal revealed nothing. The payoff of the round is seeing where it was.

   ⚠️ THE FIRST VERSION READ h.cy AND WOULD HAVE SHIPPED INERT. get_hide does not carry the
   answer — cx/cy/r arrive only from reveal_hide, after the round is over, because the answer
   must never ship alongside the puzzle. Reading h.cy found undefined and returned, which leaves
   exactly the same trace as "the card is already clear". This suite is what caught it, because
   its get_hide seed is honest about what the server actually returns. */
{
  console.log('\nTHE ENDING CARD DOES NOT SIT ON THE ANSWER');
  const lift = async (cy) => {
    const page = await boot({ hit: false, frames: true, cy, big: true });
    /* ⚠️ THE ROUND HAS TO END. boot() only loads it — the first version of this measured a
       #chFoot that was 10px tall because no card had ever been written, and reported the
       feature broken. Give up is the shortest honest path to an ending with a reveal. */
    await page.evaluate(() => document.getElementById('chQuit').click());
    await page.waitForTimeout(3400);
    const v = await page.evaluate(() => {
      const f = document.getElementById('chFoot');
      const t = f && getComputedStyle(f).transform;
      if (!t || t === 'none') return 0;
      const m = /matrix\(.*,\s*(-?[\d.]+)\)$/.exec(t);
      return m ? Math.round(Math.abs(parseFloat(m[1]))) : 0;
    });
    await page.close();
    return v;
  };
  const low = await lift(0.92);
  const high = await lift(0.18);
  /* ⚠️ THE CASE THAT SHIPPED BROKEN. A kamo in the MIDDLE — the founder's screenshot, cy≈0.52 —
     made the first version throw the card at the ceiling, over the headline and the run pill,
     to uncover nothing. A bottom-anchored card can only clear something by moving above it, so
     for anything not near the bottom the required lift is most of the screen. The rule is now
     the answer key itself: below CH_LIFT_LOW nothing moves, whatever the geometry says. */
  const middle = await lift(0.52);
  low > 0
    ? ok(`a kamo hidden low pushes the card off it (${low}px)`)
    : bad('a kamo at cy=0.92 is behind the ending card and the card did not move — the reveal '
        + 'reveals nothing, which is the whole payoff of the round');
  middle === 0
    ? ok('a kamo in the middle leaves the card alone — it was thrown at the ceiling once')
    : bad(`a kamo at cy=0.52 moved the card ${middle}px. A bottom-anchored card can only clear `
        + 'something by rising above it, so for a middle kamo that means the top of the screen — '
        + 'covering the headline and the run pill to uncover nothing. This shipped once.');
  high === 0
    ? ok('and a kamo up top leaves the card exactly where it belongs')
    : bad(`a kamo at cy=0.18 is nowhere near the card and it moved anyway (${high}px) — the card `
        + 'is bottom-anchored for a reason and must not wander');
}

console.log('\nTHE CELEBRATION ERUPTS FROM THE KAMO, NOT FROM THE MIDDLE OF THE PICTURE');
{
  /* chCelebrate's flash, ring and sparks have always landed on the tap. The confetti was the
     one piece still anchored on #chFrame — the PHOTOGRAPH — so finding a kamo tucked into a
     corner threw the celebration from the centre of the picture instead of from the thing
     that was found.
     ⚠️ ASSERTED AS A PROPERTY, NOT AS A POSITION. A first version tapped at x=60 and expected
     an origin near 60; the fixture's photo is cover-fitted and narrow, so that tap does not
     normalise where the arithmetic says and the assertion was about the harness. Two different
     taps must produce two different origins — that is true of a burst that follows the player
     and false of one nailed to the frame, whatever the fixture does with the geometry.
     ⚠️ AND READ OFF data-ox: the layer is a full-screen canvas, so its bounding box is the
     viewport no matter where it draws. confettiBurst writes its origin down for this. */
  const originOf = async (px) => {
    /* ⚠️ big:true — a VIEWPORT-SHAPED photo. The default fixture's image is 2px wide, so its
       client rect is 2px and every tap normalises to the same place: the burst looked nailed
       to the frame when the arithmetic was right and the picture was a sliver. */
    const page = await boot({ hit: true, pct: 50, others: 3, frames: true, big: true });
    await page.mouse.move(px, 420); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
    await page.waitForTimeout(600);
    const ox = await page.evaluate(() => {
      const b = document.querySelector('.kConfetti');
      return b ? Number(b.dataset.ox) : null;
    });
    await page.close();
    return ox;
  };
  const left = await originOf(90);
  const right = await originOf(300);
  (left !== null && right !== null)
    ? ok(`the celebration records where it fired (${left} and ${right})`)
    : bad('no .kConfetti layer, or it carries no origin');
  (left !== null && right !== null && Math.abs(right - left) >= 40)
    ? ok('and it follows the tap — two finds in different places burst in different places')
    : bad(`both bursts fired at the same spot (${left} vs ${right}) — the confetti is still `
        + 'nailed to the frame, so a kamo in a corner is celebrated in the middle of the photo');
}

console.log('\nTHE REVEAL LANDS — the flip is an event, not a swap');
{
  /* The reveal is the moment this app is named for, and it was a JPEG swap: the frames carry
     the payoff but nothing said "something just happened". The snap rides the flip itself, not
     the wave that arrives 360ms later.
     ⚠️ ON THE FRAME, NOT THE PHOTO. Scaling the <img> would slide the kamo away from the ring
     drawn at its own coordinates and from the marks pinned to the frame. */
  const page = await boot({ hit: true, pct: 60, others: 4, frames: true, big: true });
  await page.mouse.move(120, 400); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(240);
  const hit = await page.evaluate(() => {
    const fr = document.getElementById('chFrame');
    const b = fr && fr.querySelector('.chBoom');
    return { snapped: !!(fr && fr.classList.contains('chSnap')),
             boom: !!b, left: b ? Math.round(parseFloat(b.style.left)) : null,
             mid: fr ? Math.round(fr.clientWidth / 2) : null };
  });
  hit.snapped ? ok('the frame punches on the flip') : bad('no .chSnap on the frame after the reveal');
  hit.boom ? ok(`and a shockwave is drawn (x=${hit.left})`) : bad('no .chBoom in the frame');
  /* FROM THE KAMO ON A FIND: the tap IS the answer, so no round trip is needed to aim it. */
  hit.boom && hit.left !== null && Math.abs(hit.left - hit.mid) > 20
    ? ok('fired from the kamo, not from the middle of the frame')
    : bad(`the shockwave fired at x=${hit.left} against a frame centre of ${hit.mid} — it is `
        + 'not being aimed at the thing that was found');

  /* AND IT LEAVES. A reveal that keeps moving competes with what it is revealing, and a class
     left on the frame would re-run the punch on the next render. */
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const fr = document.getElementById('chFrame');
    return { snapped: !!(fr && fr.classList.contains('chSnap')), boom: !!(fr && fr.querySelector('.chBoom')) };
  });
  (!after.snapped && !after.boom)
    ? ok('both the punch and the shockwave clear themselves')
    : bad(`the reveal effect outstayed itself: ${JSON.stringify(after)}`);
  await page.close();

  /* ⚠️ AND A MISS FIRES FROM THE TAP, NOT FROM THE CENTRE. The first version reasoned that a
     miss does not know the answer yet, so it centred the impact. Founder, 2026-08-29: the
     picture does not switch instantly, so a bloom in the middle while the player is still
     looking at the spot they touched belongs to nothing. The impact answers the GESTURE; where
     the kamo was is the revealed frame's job, a beat later. */
  const miss = await boot({ hit: false, frames: true, big: true });
  await miss.mouse.move(300, 300); await miss.mouse.down(); await miss.waitForTimeout(80); await miss.mouse.up();
  await miss.waitForTimeout(240);
  const mb = await miss.evaluate(() => {
    const fr = document.getElementById('chFrame');
    const b = fr && fr.querySelector('.chBoom');
    return { left: b ? Math.round(parseFloat(b.style.left)) : null, mid: fr ? Math.round(fr.clientWidth / 2) : null };
  });
  mb.left !== null && Math.abs(mb.left - 300) <= 20
    ? ok(`a miss bursts where the finger landed (x=${mb.left})`)
    : bad(`a miss burst at x=${mb.left} for a tap at x=300 (frame centre ${mb.mid}) — the `
        + 'impact is not answering the gesture that caused it');
  await miss.close();
}

console.log('\nTHE DAY HAS ONE SKIP, AND IT DOES NOT COST THE RUN');
{
  /* The give-up used to cost the run outright, and that was right: an exit that costs nothing
     is a slower swipe, and the feed lock only creates a stake if leaving is expensive. A DAILY
     CAP IS NOT THAT FREE EXIT — the second give-up of the same day costs the run exactly as it
     always did (asserted in test-feedlock-dom ③b). What one pass buys is the round that was
     simply unplayable, without pretending it was a loss. */
  const page = await boot({ hit: false, frames: true, run: 4, passLeft: true });
  const label = await page.evaluate(() => {
    const q = document.getElementById('chQuit');
    return q ? { text: q.textContent, free: q.classList.contains('free') } : null;
  });
  label && label.free && /1 today/i.test(label.text)
    ? ok(`the pass is named before it is spent ("${label.text}")`)
    : bad('the free exit is not announced: ' + JSON.stringify(label));

  await page.evaluate(() => document.getElementById('chQuit').click());
  await page.waitForTimeout(1400);
  const head = await txt(page, 'chHead'), sub = await txt(page, 'chSub');
  /* ⚠️ NOT "Lost in 6.2s". Printing a loss over a run that is still standing is the app
     telling a player something untrue about their own record, and the seconds go with it:
     time is the score, and a round that did not count has none. */
  head === 'Skipped.'
    ? ok('a spent pass is not dressed as a loss')
    : bad(`the skip ending reads ${JSON.stringify(head)} — a run that survived was announced as a defeat`);
  /Your run is safe/i.test(sub || '')
    ? ok(`and it says why ("${sub}")`)
    : bad(`the skip subtitle is ${JSON.stringify(sub)} — it never tells the player the run held`);

  const stored = await page.evaluate(() => ({
    run: localStorage.getItem('kamo_seek_run'),
    life: localStorage.getItem('kamo_seek_life'),
    day: localStorage.getItem('kamo_giveup_day'),
  }));
  stored.run === '4' ? ok('the run is untouched in storage') : bad(`the pass moved the run to ${stored.run}`);
  stored.day ? ok('and the day is stamped, so tomorrow is the next one') : bad('the pass was never recorded — it is free every round');

  /* ⚠️ AND THE SPLIT REACHES POSTGRES, NOT ONLY AMPLITUDE. A free skip and a run-breaking quit
     are opposite events wearing the same word, and on the night the mechanic shipped they were
     one number: `passed` went to seek_failed and Amplitude has no current day in hourly, so
     100 give-ups could not be split for a whole day. The trace is jsonb and save_seek_trace
     stores it verbatim, so the flag is queryable the minute it lands. */
  const sent = await page.evaluate(() => (window.__calls || [])
    .filter((c) => c[0] === 'save_seek_trace').map((c) => c[1] && c[1].p_trace));
  sent.length === 1 && sent[0] && sent[0].why === 'giveup'
    ? ok('the round files one trace, and it says how it ended')
    : bad('save_seek_trace payloads: ' + JSON.stringify(sent).slice(0, 160));
  sent[0] && sent[0].passed === true
    ? ok('and the trace records that the day\'s skip covered it — readable without Amplitude')
    : bad(`the trace carries passed=${JSON.stringify(sent[0] && sent[0].passed)} — a free skip `
        + 'and a broken run are the same row again');
  await page.close();

  /* ⚠️ AND IT DOES NOT HAND THE LIFE BACK — asserted on a run whose life is ALREADY GONE,
     because that is the only state where the difference is visible. Writing the life on this
     path would be the free exit by the back door: quit once, get the life returned, miss for
     free afterwards, which is precisely the loop chNoteSeek's note refuses.
     (A first version wrote `stored.life !== '1' || true`, which is an assertion that cannot
     fail. It is the exact fault this file spends its comments warning about.) */
  const spent = await boot({ hit: false, frames: true, run: 4, life: false, passLeft: true });
  await spent.evaluate(() => document.getElementById('chQuit').click());
  await spent.waitForTimeout(1400);
  const after = await spent.evaluate(() => ({
    run: localStorage.getItem('kamo_seek_run'), life: localStorage.getItem('kamo_seek_life'),
  }));
  after.life === '0'
    ? ok('a spent life stays spent through the pass — the two are not the same currency')
    : bad(`the pass handed the life back (kamo_seek_life=${after.life}), which makes the next `
        + 'miss free as well — the free-exit loop by the back door');
  after.run === '4'
    ? ok('and the run still stands with no life behind it')
    : bad(`the pass failed to hold a run with no life: run=${after.run}`);
  await spent.close();
}

console.log('\nTHE RUN PILL IS THE DOOR TO THE DAY\'S BOARD');
{
  const BOARD = [
    { rank: 1, who: 'PewterOwln7', streak: 40, rounds: 164, hints: 0, me: false },
    { rank: 2, who: 'FaintSquid72', streak: 19, rounds: 122, hints: 2, me: false },
    { rank: 3, who: 'UmberPika', streak: 12, rounds: 46, hints: 0, me: false },
    { rank: 4, who: 'J3Sp3r', streak: 11, rounds: 152, hints: 0, me: false },
    { rank: 5, who: 'DustyAddersx', streak: 9, rounds: 32, hints: 0, me: false },
    { rank: 6, who: 'AmberOwlwr', streak: 8, rounds: 15, hints: 0, me: false },
    { rank: 7, who: 'HiddenStoatf0', streak: 7, rounds: 25, hints: 1, me: false },
    { rank: 8, who: 'tony', streak: 6, rounds: 16, hints: 0, me: true },
    { rank: 9, who: 'DimSkinkbw', streak: 5, rounds: 62, hints: 0, me: false },
    { rank: 10, who: 'RustyMantiszw', streak: 4, rounds: 16, hints: 0, me: false },
  ];
  const page = await boot({ hit: false, frames: true, run: 6, board: BOARD });

  /* ⚠️ INERT DURING THE HUNT. This chip sits above a photograph somebody is searching with the
     clock that IS their score running underneath: a full-screen board over that is sabotaging
     the round to advertise a screen about rounds. pointer-events stays none until the round
     ends, so a stray touch cannot reach it at all rather than being caught and thrown away. */
  const live = await page.evaluate(() => {
    const el = document.querySelector('.chRun');
    return el ? { tap: el.classList.contains('tap'), pe: getComputedStyle(el).pointerEvents } : null;
  });
  live && !live.tap && live.pe === 'none'
    ? ok('mid-hunt the pill is not a control at all')
    : bad('the run pill is tappable during a live round: ' + JSON.stringify(live));

  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.chRun');
    return el ? { tap: el.classList.contains('tap'), pe: getComputedStyle(el).pointerEvents } : null;
  });
  after && after.tap && after.pe !== 'none'
    ? ok('and once the round is over it becomes the door')
    : bad('the pill never became tappable after the round: ' + JSON.stringify(after));

  await page.evaluate(() => document.querySelector('.chRun').click());
  await page.waitForTimeout(700);
  const shown = await page.evaluate(() => {
    const w = document.querySelector('.chBoardWrap');
    if (!w) return null;
    return {
      chase: (w.querySelector('#chBoardChase') || {}).textContent,
      ranks: [...w.querySelectorAll('.chRowN')].map((e) => Number(e.textContent)),
      metas: [...w.querySelectorAll('.chRowMeta')].map((e) => e.textContent),
      mine: [...w.querySelectorAll('.chRow.me .chRowWho')].map((e) => e.textContent),
    };
  });
  shown ? ok('the board opens') : bad('tapping the pill opened nothing');

  /* ⚠️ IT USED TO READ "2 more in a row and you pass @x" AND THE FOUNDER DID NOT LIKE IT.
     Fair — a coach's line on a scoreboard, and it names another player in the second person,
     which reads as the app volunteering somebody as your rival rather than reporting what
     happened. A position is a fact and it is enough: the highlighted row below already shows
     who is above you. Asserted on the ORDINAL, because "11st" is the bug every naive version
     of this has. */
  shown && /You’re 8th today/.test(shown.chase || '')
    ? ok(`the headline states the position and nothing else ("${shown.chase}")`)
    : bad(`the headline reads ${JSON.stringify(shown && shown.chase)}`);

  /* FIVE, A GAP, THEN THE NEIGHBOURHOOD: 1-5 and 6-10 around a rank of 8, de-duplicated. */
  shown && JSON.stringify(shown.ranks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    ? ok('the top and the neighbourhood are both there, in rank order and de-duplicated')
    : bad('rows rendered: ' + JSON.stringify(shown && shown.ranks));

  shown && shown.mine.length === 1 && shown.mine[0] === 'You'
    ? ok('and exactly one row is yours, named as such')
    : bad('own row: ' + JSON.stringify(shown && shown.mine));

  /* ⚠️ "0 hints" ON EVERY ROW WOULD MAKE A SCOREBOARD OF WHO NEEDED HELP, and hints are the one
     thing in this product with measured demand — 397 people spent a free one and none bought.
     The number appears only where there is one. */
  const withH = ((shown && shown.metas) || []).filter((m) => /h$/.test(m));
  withH.length === 2
    ? ok('hints show only on the rows that used any')
    : bad('hint annotations: ' + JSON.stringify(shown && shown.metas));

  /* ═══ AND IT HAS TO SPEAK THE APP'S LANGUAGE ══════════════════════════════════════════════
     The first version of this screen was a data table in a sheet: one animation, no haptic,
     a bare numeral, and no sign of the thing that makes a daily board work. The app it lives
     in has 91 haptic calls and twenty named animations. */
  const dressed = await page.evaluate(() => {
    const w = document.querySelector('.chBoardWrap');
    if (!w) return null;
    const rows = [...w.querySelectorAll('.chRow')];
    return {
      /* ⚠️ THE DEADLINE IS THE MECHANIC. The board wipes at midnight UTC, and a reset nobody
         can see is a reset nobody plays against — it is what turns a table into a clock. */
      left: (w.querySelector('#chBoardLeft') || {}).textContent,
      /* ⚠️ ONCE, IN THE HEADER — not on every row. Putting the mark beside each number was the
         mistake: at 11px it read as a smudge and at 15px as a beige blob wedged between the
         name and the figure. A glyph nobody can recognise is noise next to the one number on
         the line that matters. Checked on a rendered board twice; there was no other way. */
      glyphs: rows.filter((r) => r.querySelector('svg')).length,
      titleGlyph: !!w.querySelector('.chBoardTitle svg'),
      medals: [...w.querySelectorAll('.chRowN')].slice(0, 4).map((e) => e.className),
      total: rows.length,
      /* Staggered, and capped: a delay that keeps growing makes the last rows a queue. */
      delays: rows.map((r) => r.style.animationDelay),
      chase: (w.querySelector('#chBoardChase') || {}).textContent,
    };
  });
  dressed && /resets in \d+[hm]/.test(dressed.left || '')
    ? ok(`the reset is on screen and ticking ("${dressed.left}")`)
    : bad(`no deadline: ${JSON.stringify(dressed && dressed.left)} — the daily wipe is the whole `
        + 'mechanic and nothing says when it lands');
  dressed && dressed.titleGlyph && dressed.glyphs === 0
    ? ok('the kamo mark appears once, in the header, where it is big enough to read')
    : bad(`glyphs: title ${dressed && dressed.titleGlyph}, rows ${dressed && dressed.glyphs} — `
        + 'a mark too small to recognise is noise beside the number');
  /* THE MEDALS ARE THE HIERARCHY. Without them rank 1 with a run of 40 looks like rank 10 with
     4, and the list reads as a log rather than a board. */
  dressed && JSON.stringify(dressed.medals) === JSON.stringify(['chRowN m1', 'chRowN m2', 'chRowN m3', 'chRowN'])
    ? ok('the top three are medalled and the fourth is not')
    : bad('rank chips: ' + JSON.stringify(dressed && dressed.medals));
  const ds = (dressed && dressed.delays) || [];
  ds.length && ds[0] === '0s' && parseFloat(ds[ds.length - 1]) > 0
    && ds.every((d) => parseFloat(d) <= 0.35)
    ? ok(`the rows arrive staggered and the stagger is capped (last ${ds[ds.length - 1]})`)
    : bad('row delays: ' + JSON.stringify(ds));
  /* NOT "Loading…" — a placeholder is not a state. Asserted on the FINAL text, so this also
     proves the in-flight sentence was replaced rather than left behind. */
  dressed && !/loading/i.test(dressed.chase || '')
    ? ok('and nothing is left saying "loading"')
    : bad('the chase line still reads: ' + JSON.stringify(dressed && dressed.chase));

  /* ⚠️ WHAT IS SHAREABLE IS NOT THE RANK. "I'm #8 on KAMO" is a brag with no content — about
     the sender, and giving the reader nothing to be curious about. The number at the TOP is
     the fact that makes a stranger open a link, and the sender's own row is the contrast that
     makes the message theirs.
     AND THE LEADER IS NEVER NAMED: a handle in somebody else's group chat is a person who did
     not agree to be there. The number is the story and it belongs to nobody. */
  const sharing = await page.evaluate(async () => {
    const b = document.getElementById('chBoardShare');
    if (!b || b.style.display === 'none') return null;
    let sent = null;
    navigator.share = (o) => { sent = o.text; return Promise.resolve(); };
    b.click();
    await new Promise((r) => setTimeout(r, 300));
    return { label: b.textContent, text: sent };
  });
  sharing ? ok(`the board offers a share ("${sharing.label}")`) : bad('no share button on a populated board');
  sharing && /40 kamos in a row/.test(sharing.text || '')
    ? ok("it leads with the day's best, which is the part a stranger would open")
    : bad('share text: ' + JSON.stringify(sharing && sharing.text));
  sharing && /I\u2019m on 6|I’m on 6/.test(sharing.text || '')
    ? ok('and carries the sender as the contrast, not the headline')
    : bad('the sender is missing from: ' + JSON.stringify(sharing && sharing.text));
  sharing && !/PewterOwln7/.test(sharing.text || '')
    ? ok('the leader is never named — a handle in a stranger\'s chat did not consent to be there')
    : bad('the share names another player: ' + JSON.stringify(sharing && sharing.text));
  await page.close();

  /* ═══ AND THE EMPTY BOARD IS THE BEST OFFER OF THE DAY ══════════════════════════════════
     Every UTC midnight this list is wiped, so this is the screen the first players of the day
     meet. It used to read "Nobody has a run yet today" — a fact, asking for nothing. What is
     true of it is rarer: the top is unclaimed and two finds take it. So it SHOWS the prize. */
  /* ⚠️ THE PILL HAS TO EXIST TO BE TAPPED. At run 0 with no record it is display:none — there
     is nothing true to print — so a fixture with an empty board AND an empty player cannot
     reach this screen at all. A run of 3 against a board that returns nothing is the real
     case anyway: the day just reset, or every find was on a hide below the floor. */
  const fresh = await boot({ hit: false, frames: true, run: 3, best: 5, board: [] });
  await fresh.mouse.move(200, 500); await fresh.mouse.down(); await fresh.waitForTimeout(80); await fresh.mouse.up();
  await fresh.waitForTimeout(1600);
  await fresh.evaluate(() => document.querySelector('.chRun') && document.querySelector('.chRun').click());
  await fresh.waitForTimeout(700);
  const empty = await fresh.evaluate(() => {
    const w = document.querySelector('.chBoardWrap');
    if (!w) return null;
    const g = w.querySelector('.chRow.ghost');
    return {
      chase: (w.querySelector('#chBoardChase') || {}).textContent,
      ghost: g ? { who: g.querySelector('.chRowWho').textContent,
                   medal: g.querySelector('.chRowN').className,
                   run: g.querySelector('.chRowRun').textContent } : null,
      share: !!(w.querySelector('#chBoardShare') && w.querySelector('#chBoardShare').style.display !== 'none'),
    };
  });
  empty && empty.ghost && empty.ghost.who === 'You?' && /m1/.test(empty.ghost.medal)
    ? ok('an empty board shows the prize — a gold chip with your name on it')
    : bad('empty state: ' + JSON.stringify(empty));
  empty && !/nobody/i.test(empty.chase || '') && /yours/i.test(empty.chase || '')
    ? ok(`and offers it rather than reporting an absence ("${empty.chase}")`)
    : bad('empty headline: ' + JSON.stringify(empty && empty.chase));
  /* NOTHING TO SEND WHEN THERE IS NOTHING TO SEND. A share button on an empty board would
     offer to broadcast a zero. */
  empty && !empty.share
    ? ok('and offers no share, because there is nothing yet to send')
    : bad('the empty board offered a share');
  await fresh.close();
}

/* ── A DEVICE THAT CANNOT REMEMBER ANYTHING SENDS NOTHING ──────────────────────────────── */
console.log('\n— a storage-refused device is left uncounted, not merged —');
{
  /* ⚠️ THE SENTINEL IS SHARED, AND THAT IS THE WHOLE DANGER. chDeviceId() returns the literal
     "w-nostore" when localStorage, cookies and IndexedDB have all refused — so it is the SAME
     string on every such device. Written through to device_key they would collapse into one
     row-group that plays every day and never churns: a single fabricated super-retained user,
     inflating the exact number this column was added to measure, and doing it invisibly because
     the row looks perfectly normal.
     An absent key is honest. A shared one is a lie, and it is the kind that reads as good news. */
  const p = await boot({ hit: false, pct: 55, others: 4, frames: true, noStore: true });
  await p.waitForTimeout(500);
  await p.mouse.move(200, 500); await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(210, 520); await p.waitForTimeout(60); await p.mouse.up();
  await p.waitForTimeout(1200);
  const call = await p.evaluate(() => (window.__calls.find(c => c[0] === 'save_seek_trace') || [])[1]);
  const sentinel = await p.evaluate(() => {
    /* Proves the fixture actually reached the state under test rather than quietly leaving a
       working store behind — the harness fault that would turn this whole block green for the
       wrong reason. */
    try { localStorage.setItem('probe', '1'); return 'localStorage still writable'; } catch (e) {}
    try { if (window.indexedDB) return 'indexedDB still present'; } catch (e) {}
    return 'all stores refused';
  });
  sentinel === 'all stores refused'
    ? ok('the fixture really is a device with nowhere to write')
    : bad('the no-store fixture did not take: ' + sentinel);
  call
    ? ok('the round still files its trace — telemetry must not depend on storage')
    : bad('no save_seek_trace at all on a storage-refused device');
  call && !call.p_device
    ? ok('and it files NO device key rather than the shared sentinel')
    : bad(`a storage-refused device sent p_device=${JSON.stringify(call && call.p_device)} — every `
        + 'such device shares that string, so they merge into one user who never churns');
  await p.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the one-buzz seeker behaves');
process.exit(failed ? 1 : 0);
