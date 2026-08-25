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

async function boot({ hit, pct, others, frames, name = 'tony', deadPhoto = false }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  await page.route('**/storage/v1/object/public/hides/**', route => {
    const u = route.request().url();
    /* `deadPhoto` kills the camo image itself, not just the reveal frames: a dead storage
       path, an object still replicating, a tunnel. See the block at the end of this file. */
    if (deadPhoto) return route.fulfill({ status: 404, body: 'x' });
    if (!frames && (u.includes('_b.jpg') || u.includes('_w.jpg'))) return route.fulfill({ status: 404, body: 'x' });
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
  });
  await page.addInitScript(({ hit, pct, others, name }) => {
    window.__calls = [];
    window.__rpc = (fn, body) => {
      window.__calls.push([fn, body]);
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 3, n_found: 1, limit_s: null, max_taps: null, name });
      if (fn === 'submit_attempt') return Promise.resolve({ hit, tries: 4, missed: 3, secs: 9, pct, others });
      if (fn === 'reveal_hide') return Promise.resolve({ cx: 0.5, cy: 0.5, r: 0.1 });
      return Promise.resolve(null);
    };
  }, { hit, pct, others, name });
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  return page;
}
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
    null, { timeout: 2500 }).then(() => true).catch(() => false);
  layers ? ok('one confetti layer is thrown')
         : bad(`${await page.evaluate(() => document.querySelectorAll('.kConfetti').length)} confetti `
             + 'layers within 2.5s of the find — expected exactly 1');

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
  await page.waitForTimeout(900);
  const src = await page.evaluate(() => document.querySelector('#chFrame img').src);
  src.includes('_b.jpg') ? ok('give up → immediate reveal') : bad('no reveal on give-up: ' + src);
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

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the one-buzz seeker behaves');
process.exit(failed ? 1 : 0);
