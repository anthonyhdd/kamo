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
const html = real.replace(anchor, anchor + 'if(window.__rpc) return window.__rpc(fn,body);');

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
async function boot({ hit, pct, others, frames, name = 'tony', deadPhoto = false, cy = 0.5, big = false, round = 1, oldRound = 0, ansCx = 0.5, run = 0, life = true, best = 0, reduced = false, passLeft = false }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
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
  await page.addInitScript(({ hit, pct, others, name, cy, round, oldRound, ansCx, run, life, best, passLeft }) => {
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
    window.__calls = [];
    window.__rpc = (fn, body) => {
      window.__calls.push([fn, body]);
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 3, n_found: 1, limit_s: null, max_taps: null, name, round });
      /* `old_round` is what the server sends when a miss landed on an ANCESTOR's figure — the
         player found a real camouflaged person, just not this round's. */
      if (fn === 'submit_attempt') return Promise.resolve({ hit, tries: 4, missed: 3, secs: 9, pct, others,
        old_round: oldRound || undefined, old_name: oldRound ? 'OchreHare' : undefined, old_id: oldRound ? 'someoneelse0000' : undefined });
      if (fn === 'reveal_hide') return Promise.resolve({ cx: ansCx, cy: cy, r: 0.1 });
      return Promise.resolve(null);
    };
  }, { hit, pct, others, name, cy, round, oldRound, ansCx, run, life, best, passLeft });
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the one-buzz seeker behaves');
process.exit(failed ? 1 : 0);
