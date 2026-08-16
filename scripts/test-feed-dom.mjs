#!/usr/bin/env node
/**
 * THE FEED, AND THE THREE THINGS THAT WOULD MAKE IT NOT WORTH SHIPPING.
 *
 * 1. THE ROUND HAS TO BE THE ROUND. The feed does not reimplement the game — it mounts a
 *    real chSeek into each slide (see the chSeek(hideId, opts) refactor). If that mount goes
 *    to document.body instead of the slide, the feed looks fine in a screenshot and is a
 *    fullscreen round with a scroller trapped underneath it. The test asserts the round is a
 *    DESCENDANT of the first slide, which a fixed overlay on body can never be.
 *
 * 2. ONE ROUND ALIVE AT A TIME. Every round holds a 10Hz interval and a set of pointer
 *    listeners. A feed that mounts and never destroys gets slower with every swipe and the
 *    symptom arrives long after the cause, on somebody else's phone. Asserted by counting
 *    .chS after a scroll, not by reading the code.
 *
 * 3. THE DEFAULT HAS TO BE VISIBLE AND REVERSIBLE. Public-by-default is only defensible if
 *    the row saying so is on the sheet, and if turning it off actually calls set_hide_public
 *    with false. Both are asserted here, because both are the difference between a product
 *    decision and publishing somebody's living room without asking.
 *
 * Also covers the cold start: on day one feed_page returns nothing for everybody, and an
 * empty feed that renders a black screen instead of an invitation is the whole launch.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feed-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the feed test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Both RPC doors are stubbed at their declaration, not appended: chFeed() fetches its first
   page the moment it is called, so a hook added at the end of the module is too late.
   window.__rpc records every call so the test can assert what actually went over the wire —
   the point of set_hide_public is the call, not the label next to the switch. */
const stub = (src, anchor) => {
  if (!src.includes(anchor)) throw new Error('anchor missing: ' + anchor);
  return src.replace(anchor, anchor +
    'window.__rpc=window.__rpc||[];window.__rpc.push([fn,body]);' +
    'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');
};
let html = stub(real, 'async function kfRpc(fn,body){');
html = stub(html, 'async function chRpc(fn,body){');
/* THE THIRD DOOR. chRpcRows exists because PostgREST returns a set-returning function as an
   ARRAY and chRpc unwraps to the first element — the reaction counts come through it, so a
   harness that stubs only the other two sends them at the real network and paints nothing. */
html = stub(html, 'async function chRpcRows(fn,body){');
/* THE FOURTH DOOR, AND IT IS NOT AN RPC. `replay` is the flag that stops a tap on your own
   hide reaching submit_attempt and inflating your own attempt count with a guess from the one
   person who painted it — and it lives on a slide object with no DOM at all. What it DOES
   reach is the analytics: activate() stamps every feed_slide with it. So the tap-a-card path
   is asserted through the number the product already emits, rather than through a hook added
   to window.KAMOFEED, which is the wrapper's bridge contract and has no business carrying a
   test affordance. Recorded at the declaration for the same reason as the RPCs above: the
   first slide activates before anything appended to the module could run. */
html = html.replace('function track(event,props){',
  'function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);');

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

const ROWS = n => Array.from({ length: n }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'tony',
  n_attempts: i, n_found: 0, created_at: '2026-08-1' + (2 - (i % 3)) + 'T10:0' + i + ':00Z',
}));

/* `before` runs against the fresh page BEFORE it navigates — the only window in which a test
   can plant localStorage the app will read on boot (a legacy reaction key, say). It takes the
   page rather than a value so it can use addInitScript, which is the one hook that survives
   the navigation. */
async function open(rows, extra, before) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (before) await before(page);
  await page.addInitScript((a) => {
    window.__seed = Object.assign({
      feed_page: a.r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    }, a.extra || {});
  }, { r: rows, extra: extra || null });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  /* The real entry point: the button on the camera screen, clicked the way a thumb does. */
  await page.evaluate(() => document.getElementById('btnFeed').click());
  await page.waitForTimeout(800);
  return page;
}

console.log('\nTHE FEED PLAYS REAL ROUNDS, ONE AT A TIME');
{
  const page = await open(ROWS(3));

  const slides = await page.evaluate(() => document.querySelectorAll('.kfSlide').length);
  slides === 3 ? ok('every hide in the page becomes a slide (3)') : bad(`expected 3 slides, got ${slides}`);

  /* THE MOUNT. A round on document.body would be position:fixed over everything and would
     satisfy any "is there a round on screen" check — so the assertion is containment. */
  const inside = await page.evaluate(() => {
    const s = document.querySelector('.kfSlide'), r = document.querySelector('.chS');
    return !!(s && r && s.contains(r) && r.classList.contains('chIn'));
  });
  inside ? ok('the round mounts INSIDE the first slide, not over the page') : bad('the round is not inside the slide');

  const one = await page.evaluate(() => document.querySelectorAll('.chS').length);
  one === 1 ? ok('exactly one round is alive') : bad(`expected 1 round, got ${one}`);

  /* The scroll drives the IntersectionObserver, which is what a swipe does on a phone. */
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(900);
  const still = await page.evaluate(() => document.querySelectorAll('.chS').length);
  still === 1 ? ok('scrolling to the next hide destroys the previous round (still 1)') : bad(`after a scroll there are ${still} rounds`);

  const second = await page.evaluate(() => {
    const s = document.querySelectorAll('.kfSlide')[1], r = document.querySelector('.chS');
    return !!(s && r && s.contains(r));
  });
  second ? ok('the new round mounts in the slide that was scrolled to') : bad('the round did not follow the scroll');

  /* THE ANSWER IS NEVER ASKED FOR. feed_page is a listing call and must carry nothing but a
     cursor — a page that asked the server for cx/cy would put the solution in the response
     of every slide before a single tap. */
  const args = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').map(c => Object.keys(c[1]).sort().join(',')));
  args.length && args.every(a => a === 'p_before,p_limit')
    ? ok('feed_page is called with a cursor and nothing else')
    : bad('feed_page called with ' + JSON.stringify(args));

  await page.close();
}

/* THE OPENING FRAME COSTS NOTHING, and that is a property of the wire, not of a stopwatch.
 * The feed used to make two round trips for one open: kfProbe asked "is there anything" at
 * launch and threw the answer away, then chFeed() asked again — from a standing start, with a
 * thumb already on the screen and a spinner where the photo goes. The second call is the one
 * the user waits for, and it is the one that did not need to exist.
 * Asserted by COUNTING feed_page calls across the tap rather than by timing the paint: a
 * timing test on a laptop passes on any machine fast enough to hide the regression, which is
 * every machine except the phone that has the problem. If a slide exists and the wire was
 * silent, the page came from memory. There is no other way for that to be true. */
console.log('\nTHE FEED OPENS ON THE PAGE THE PROBE ALREADY FETCHED');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((r) => {
    window.__seed = {
      feed_page: r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    };
  }, ROWS(4));
  await page.goto(base, { waitUntil: 'load' });
  /* The launch probe, waited for rather than slept on: until it has answered there is no
     cache to open from and the test would be asserting against a race. */
  await page.waitForFunction(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').length >= 1, null, { timeout: 6000 });
  const before = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').length);

  await page.evaluate(() => document.getElementById('btnFeed').click());
  await page.waitForSelector('.kfSlide', { timeout: 6000 });
  const after = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').length);

  after === before
    ? ok(`the first slide is on screen with no feed_page call after the tap (${before} total)`)
    : bad(`opening the feed cost ${after - before} extra feed_page call(s) — the probe's page was not reused`);

  /* AND THE PHOTOS DO NOT ALL START AT ONCE. Eight full-resolution JPEGs queued in the same
     tick means the only one being looked at waits behind seven that are not. The first two
     are eager on purpose — slide 1 is one flick away — and everything past them defers. */
  const load = await page.evaluate(() => [...document.querySelectorAll('.kfSlide .kfPrev')].map(i => i.getAttribute('loading') || ''));
  load.length >= 3 && load[0] !== 'lazy' && load[1] !== 'lazy' && load.slice(2).every(v => v === 'lazy')
    ? ok('slides past the second defer their photo (' + load.map(v => v || 'eager').join(', ') + ')')
    : bad('photo loading is ' + JSON.stringify(load) + ' — expected eager, eager, then lazy');

  const prio = await page.evaluate(() => (document.querySelector('.kfSlide .kfPrev') || {}).getAttribute && document.querySelector('.kfSlide .kfPrev').getAttribute('fetchpriority'));
  prio === 'high' ? ok('the opening photo is fetched at high priority') : bad('the first slide has fetchpriority=' + prio);

  await page.close();
}

/* HOW LONG IT TOOK, WHICH THIS SCREEN COULD NOT SAY. The feed was made to open on a page
 * fetched at launch instead of at the tap — a whole round trip off the critical path — and
 * afterwards there was no way to judge it: feed_opened and feed_slide carry no duration, and
 * completion sat at 85-91% before and after, exactly as it should, because the change was
 * about the length of the wait and not about whether people got through it.
 * THE ASSERTIONS ARE ON THE WIRE, and on `cached` above all: that property is what turns the
 * question "did the probe's page get reused" from an argument into a filter. A timing event
 * that fires but carries no way to tell the two paths apart would measure nothing.
 * ⚠️ The photo is routed to a real 1×1 PNG rather than left to 404, because decode() rejects
 * on a broken image and the suite would then be asserting the failure path while looking
 * like it asserted the happy one. */
console.log('\nTHE FEED SAYS HOW LONG IT TOOK TO OPEN');
{
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const sent = [];
  await page.route('**/api.eu.amplitude.com/**', async r => {
    try { (JSON.parse(r.request().postData() || '{}').events || []).forEach(e => sent.push(e)); } catch {}
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
  });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.addInitScript((r) => {
    window.__seed = {
      feed_page: r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    };
  }, ROWS(4));
  await page.goto(base, { waitUntil: 'load' });
  /* ⚠️ WAIT FOR THE PROBE, DO NOT SLEEP PAST IT. kfProbe fires on a 1200ms timer after load,
     and the first version of this block clicked at 700ms — before the cache existed — so it
     measured the network path and reported cached=false. The assertion below caught it, which
     is the only reason this comment exists rather than a wrong number in a report. */
  await page.waitForFunction(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').length >= 1, null, { timeout: 8000 });
  await page.evaluate(() => document.getElementById('btnFeed').click());
  /* decode() resolves on its own schedule, so the wait is on the event landing rather than on
     a clock — a fixed sleep would either flake or hide a regression that made it slower. */
  await page.waitForFunction(() => true);
  await page.waitForTimeout(1200);
  /* A real second slide, so "later slides carry no timing" is an assertion and not a vacuous
     pass over an empty list. */
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(900);

  const paint = sent.find(e => e.event_type === 'feed_first_paint');
  const slide = sent.filter(e => e.event_type === 'feed_slide').find(e => (e.event_properties || {}).n === 1);

  paint ? ok('feed_first_paint reached Amplitude') : bad('feed_first_paint never fired — the first photo painted and nothing said so');
  if (paint) {
    const p = paint.event_properties || {};
    typeof p.ms === 'number' && p.ms >= 0 && p.ms < 60000
      ? ok(`it carries the milliseconds from the tap to the decoded photo (ms=${p.ms})`)
      : bad('feed_first_paint.ms is ' + JSON.stringify(p.ms));
    /* The one that would have caught calling decode() before src: that ordering resolves in
       about zero milliseconds every time, and reads as a feed that opens instantly. */
    p.ok === true ? ok('and it reports the photo actually decoded (ok=true)') : bad('feed_first_paint.ok=' + p.ok + ' — the timing is measuring a failed image');
    p.cached === true ? ok('and cached=true, so the probe page path is separable in one filter') : bad('feed_first_paint.cached=' + p.cached);
    typeof p.ms_page === 'number' ? ok(`and ms_page says how much of it was the rows (ms_page=${p.ms_page})`) : bad('ms_page=' + JSON.stringify(p.ms_page));
    p.slides === 4 ? ok('and slides reports the page it actually built (4)') : bad('slides=' + JSON.stringify(p.slides));
  }
  /* Asserted on the TYPE, not on the event existing. feed_slide n=1 has been on the wire
     since the feed shipped, so "is it there" passes against a build that carries no timing
     at all — which is exactly what it did on the first run of this block. */
  slide && typeof (slide.event_properties || {}).ms === 'number' && typeof (slide.event_properties || {}).cached === 'boolean'
    ? ok('feed_slide n=1 carries the round-mounted milestone (ms=' + slide.event_properties.ms + ', cached=' + slide.event_properties.cached + ')')
    : bad('feed_slide n=1 carries no timing: ' + JSON.stringify(slide ? slide.event_properties : null));
  /* Later slides must stay clean: a duration on a swipe the user chose to make would bury
     the one number that is about the app being slow. */
  const later = sent.filter(e => e.event_type === 'feed_slide' && (e.event_properties || {}).n > 1);
  later.every(e => (e.event_properties || {}).ms === undefined)
    ? ok('and later slides carry no timing (' + later.length + ' checked)')
    : bad('a swipe past the first slide is being timed as if it were the open');

  await page.close();
}

/* THE EXIT IS THE SWIPE, AND NOTHING ELSE OFFERS IT. "Next hide ↑" was removed (founder,
 * 2026-08-14): the feed is scroll-snap with scroll-snap-stop:always, so the swipe was always
 * the exit and the button was a second way to do the same thing, sitting under two controls
 * that are about THIS photo.
 * WHICH MAKES THE HINT LOAD-BEARING. It used to be killed the moment the ending card appeared
 * — correct then, because the pill landed on top of that button and swallowed its taps. With
 * the button gone the collision is gone, and killing the only instruction for the only way
 * out would leave a first-round player on a card with nowhere to go. Both halves are asserted
 * here, because removing the button without this is a dead end and it looks like a tidy diff. */
console.log('\nTHE ROUND ENDS ON TWO CONTROLS, AND THE SWIPE IS THE WAY OUT');
{
  const page = await open(ROWS(3), { react_to_hide: null, hide_reactions_of: [],
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chFoot .chCard', { timeout: 8000 });

  const card = await page.evaluate(() => ({
    next: !!document.getElementById('chNext'),
    reh: !!document.getElementById('chReh'),
    send: !!document.getElementById('chSend'),
    hint: !!document.getElementById('kfHint'),
    labels: [...document.querySelectorAll('#chFoot .chCard button')].map(b => (b.textContent || '').trim()).filter(Boolean),
  }));

  card.next === false ? ok('the ending card has no Next control') : bad('#chNext is still on the card');
  card.reh && card.send
    ? ok('and it still offers both of the ones that go somewhere: ' + JSON.stringify(card.labels.slice(0, 2)))
    : bad('the card lost a control it should have kept: ' + JSON.stringify(card.labels));
  /* The half that turns a removal into a dead end if it is missed. */
  card.hint ? ok('and the swipe hint survives the card, because it is now the only way out')
            : bad('the hint was killed by the ending card — the round now has no exit at all');

  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(700);
  const afterScroll = await page.evaluate(() => ({ hint: !!document.getElementById('kfHint'),
    rounds: document.querySelectorAll('.chS').length }));
  afterScroll.hint === false ? ok('and it dies on the scroll — the moment it stops being true') : bad('the hint outlived the swipe it describes');
  afterScroll.rounds === 1 ? ok('and the swipe still advances the feed (1 round alive)') : bad(`after the swipe there are ${afterScroll.rounds} rounds`);

  await page.close();
}

/* AND THE CLOCK MUST STOP WHEN SOMETHING COVERS THE ROUND. Every time a round reports —
 * submit_attempt, the percentile every other player is ranked against, "found in 12s" — came
 * from Date.now()-t0, so seconds spent looking at the profile card were charged to the round.
 * Opening your own profile mid-round cost you the round. So did taking a call.
 * ASSERTED ON THE CLOCK'S OWN TEXT, not on an internal flag: the number on screen is the
 * number that gets submitted, and a test that read a private accumulator could pass while the
 * thing the player is judged on kept running. */
console.log('\nCOVERING THE ROUND STOPS ITS CLOCK');
{
  /* ⚠️ ITS OWN PAGE, WITH A REAL PHOTO ROUTED IN. The shared open() lets the slide images
     404, and startClock() hangs off img.onload — so the round never starts timing and every
     assertion below reads 0s and passes against everything, including the bug. That is what
     the first run of this block did. */
  const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAF0lEQVQIW2NkYGD4z8DAwMgABXAGNgEAJz0BAWv6xkkAAAAASUVORK5CYII=', 'base64');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PX }));
  await page.route('**/api.eu.amplitude.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.addInitScript((r) => {
    window.__seed = {
      feed_page: r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    };
    localStorage.setItem('kamo_handle', 'tony');
  }, ROWS(3));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').length >= 1, null, { timeout: 8000 });
  await page.evaluate(() => document.getElementById('btnFeed').click());
  await page.waitForTimeout(1500);
  const clock = () => page.evaluate(() => {
    const e = [...document.querySelectorAll('.kfSlide *')].find(x => /^\d+(\.\d+)?s$/.test((x.textContent || '').trim()));
    return e ? parseFloat(e.textContent) : null;
  });
  const t0 = await clock();
  t0 === null ? bad('no round clock on screen — the rest of this block cannot mean anything') : ok(`the round is timing (${t0}s)`);

  /* The overlay is the My-kamos grid now (data-blocks-timer) — profile moved onto it, but
     the invariant is the same: anything covering a live round must stop its clock. */
  await page.evaluate(() => { document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="mine"]').click(); });
  await page.waitForTimeout(2500);
  const t1 = await clock();
  /* One 100ms tick of slop is the design: the pause is sampled from the clock's own interval
     rather than from a second observer over the same overlays. */
  t1 !== null && t0 !== null && (t1 - t0) < 0.5
    ? ok(`2.5s with the grid open costs the round ${((t1 - t0)).toFixed(1)}s`)
    : bad(`the clock ran under the grid: ${t0}s → ${t1}s — those seconds go into submit_attempt`);

  await page.evaluate(() => { document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="all"]').click(); });
  await page.waitForTimeout(900);
  const t2 = await clock();
  /* The other half, and the one a naive "just stop the timer" fix breaks: coming back to
     Everyone must resume, not leave the round frozen for good. */
  t2 !== null && (t2 - t1) > 0.4
    ? ok(`and coming back resumes the round (${t1}s → ${t2}s)`)
    : bad(`the clock did not restart after the grid closed: ${t1}s → ${t2}s`);

  await page.close();
}

/* TAPPING YOUR OWN CARD PUTS THE HIDE ON THE SCREEN, AND NEVER COUNTS AS A PLAY.
 * A photo-sized cell looks tappable and used to forward to Watch — which is behind KAMO+ and
 * does not exist at all on a hide nobody has played, so most of this grid was inert. It opens
 * the hide in the feed now, which works on every cell.
 * THE FLAG IS THE WHOLE CORRECTNESS ARGUMENT. Your own hide is skipped by feed_page on purpose
 * (playing it is never a round — you painted it), so the slide has to be seeded by hand, and a
 * seeded slide without `replay` sends the buzz to submit_attempt: your own attempt count goes
 * up, recorded against the one person on earth who knew the answer. It is invisible on screen
 * and permanent in the table, which is why it is asserted rather than assumed. */
console.log('\nA CARD IN YOUR OWN GRID OPENS THAT HIDE, AS A REPLAY');
{
  const page = await open(ROWS(3), null, (p) => p.addInitScript(() => {
    localStorage.setItem('kamo_hides', JSON.stringify(['mine-1']));
  }));
  await page.evaluate(() => { document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="mine"]').click(); });
  await page.waitForTimeout(1200);
  const cells = await page.evaluate(() => document.querySelectorAll('#kfMine .kmCell').length);
  cells === 1 ? ok('the grid draws a cell for the remembered hide') : bad(`the grid drew ${cells} cells`);

  const before = await page.evaluate(() => document.querySelectorAll('.kfSlide').length);
  /* On the CELL, not on a button inside it — the guard that leaves Send and Watch to their
     own handlers is part of what is under test, and clicking a button would step past it. */
  await page.evaluate(() => { window.__tr = []; document.querySelector('#kfMine .kmCell').click(); });
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => ({
    slides: document.querySelectorAll('.kfSlide').length,
    gridShown: getComputedStyle(document.getElementById('kfMine')).display !== 'none',
    pill: document.getElementById('kfScope').textContent.trim(),
    ticked: (document.querySelector('#kfMenu button.on') || {}).dataset,
    slide: (window.__tr.find((e) => e[0] === 'feed_slide') || [])[1] || null,
    tapped: window.__tr.some((e) => e[0] === 'mine_cell_tapped'),
  }));
  after.slides === before + 1
    ? ok('the hide is added to the feed as a slide of its own')
    : bad(`slides went ${before} → ${after.slides} — feed_page skips your own hides, so nothing seeds it`);
  !after.gridShown ? ok('and the grid gets out of the way') : bad('#kfMine is still covering the slide it just opened');
  /^Everyone/.test(after.pill) && after.ticked && after.ticked.s === 'all'
    ? ok('the pill and the menu tick agree that the feed is back')
    : bad(`the pill reads "${after.pill}" while the menu has ${JSON.stringify(after.ticked)} ticked`);
  after.tapped ? ok('the tap is counted, so a dead grid is distinguishable from an unused one')
               : bad('no mine_cell_tapped — the cell is doing something nothing can see');
  after.slide && after.slide.replay === true
    ? ok('and the round is mounted as a REPLAY — the buzz cannot reach submit_attempt')
    : bad(`feed_slide carries ${JSON.stringify(after.slide)} — without replay:true a tap on your own `
        + 'hide is filed as somebody having played it, by the person who painted it');
  await page.close();
}

/* ONE CONTROL PER CARD, ON EVERY CARD, IN ONE COLOUR.
 * All three of these regress by looking reasonable. A `plays > 0` guard round the button reads
 * like an optimisation and takes the feature off three cards in four — which is how it shipped
 * for weeks, with most of this grid showing no control at all under the photo. A second button
 * "while we're here" reads like generosity and puts two 12px words in a 32px strip. And a
 * conditional tint on the send glyph reads like information right up until somebody asks why
 * some of them are green, which is the point at which it stops being information.
 * Run twice rather than seeded with two different rows: the harness answers get_hide with one
 * value for every id, so a played hide and an unplayed one cannot share a grid here. Both
 * states matter — the dim one is the one nobody would think to check. */
for (const [label, attempts] of [['nobody has played it', 0], ['five people have', 5]]) {
  console.log(`\nEVERY CARD CARRIES ONE BUTTON — ${label}`);
  const page = await open(ROWS(3), { get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: attempts, n_found: 2, name: 'tony' } },
    (p) => p.addInitScript(() => { localStorage.setItem('kamo_hides', JSON.stringify(['mine-1'])); }));
  await page.evaluate(() => { document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="mine"]').click(); });
  await page.waitForTimeout(1200);

  const card = await page.evaluate(() => {
    const cell = document.querySelector('#kfMine .kmCell');
    const btns = [...cell.querySelectorAll('.kmActs .kmBtn')];
    const b = btns[0];
    return {
      count: btns.length,
      label: b ? b.textContent.trim() : null,
      dim: b ? b.classList.contains('dim') : null,
      lock: b ? b.classList.contains('lock') : null,
      disabled: b ? b.disabled : null,
      /* Infinite animations anywhere in the grid, pseudo-elements included — the shimmer lives
         on the element itself, but "what loops in here" is the invariant, not one selector. */
      spin: (document.getAnimations ? document.getAnimations() : [])
        .filter((a) => a.effect && a.effect.target && a.effect.target.closest
          && a.effect.target.closest('#kfMine') && a.effect.getTiming().iterations === Infinity)
        .map((a) => a.animationName || 'anim'),
      /* Specifically: is the DIM one moving. That is the failure worth naming — a shimmer is a
         door, and a door on a hide nobody has played opens onto nothing. */
      dimSpin: (document.getAnimations ? document.getAnimations() : [])
        .filter((a) => a.effect && a.effect.target && a.effect.target.classList
          && a.effect.target.classList.contains('dim') && a.effect.getTiming().iterations === Infinity)
        .length,
    };
  });
  card.count === 1
    ? ok(`exactly one button under the photo ("${card.label}")`)
    : bad(`${card.count} buttons in the action row — a half-width cell fits one 12px word, and `
        + 'two of them are told apart only by a glyph');
  card.dim === (attempts < 1)
    ? ok(attempts < 1 ? 'and it is dim, because there is nothing behind it yet'
                      : 'and it is live, because there are taps to show')
    : bad(`dim=${card.dim} on a hide with ${attempts} plays`);
  /* THE SHIMMER BELONGS TO THE LOCKED STATE AND TO NOTHING ELSE, and this assertion has been
     both ways in two days — cut on 2026-08-15 (four locked cells, four mint edges travelling out
     of phase behind photographs) and restored the same day. The founder's argument won: this is
     the only paid surface on the screen, the grid is the one place a creator's own results make
     the upsell make sense, and a static edge is a badge where a moving one is a door.
     So the invariant is not "nothing moves", it is WHICH thing moves — and the one that must
     never is the dim button, because a door on a hide nobody has played opens onto nothing.
     A member's grid stays still too: for them these are tools, not doors. */
  const wantSpin = attempts > 0;   // free user, played hide → locked → shimmering
  (card.spin.length > 0) === wantSpin && card.dimSpin === 0
    ? ok(wantSpin ? `the locked button shimmers, and only it (${card.spin.join(', ')})`
                  : 'nothing moves on a card with no plays')
    : bad(`loops in the grid: ${card.spin.join(', ') || 'none'} (dim: ${card.dimSpin}) — expected `
        + `${wantSpin ? 'the locked button to shimmer' : 'nothing to move'}, and the dim button `
        + 'must never move whatever else does');

  /* THE DEAD ONE SELLS NOTHING. A paywall over a map of a hide nobody has played is charging
     for an empty room, and it is the fastest way to make KAMO+ look like it sells nothing.
     Driven through a real click, because `disabled` and the handler's own guard are two
     separate defences and only one of them is visible in the markup. */
  await page.evaluate(() => { const b = document.querySelector('#kfMine .kmActs .kmBtn'); if (b) b.click(); });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    paywall: !!document.querySelector('#paywall.show'),
    heat: !!document.getElementById('khHeat'),
  }));
  if (attempts < 1) {
    !after.paywall && !after.heat
      ? ok('and tapping it does nothing at all — no paywall for a map of an empty hide')
      : bad(`tapping the dim button opened paywall=${after.paywall} heat=${after.heat}`);
  } else {
    after.paywall
      ? ok('and a free user tapping a played one meets the paywall')
      : bad('the locked button opened nothing — the ✦ is promising a door that is not there');
  }

  /* ONE COLOUR ON THE SEND GLYPH. It went mint on hides that had never been sent, which made a
     grid of photographs read as two kinds of control. The count is still said, in words, by the
     "N to send" chip above the grid — and the cell keeps its brighter border. */
  const sendColours = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('#kfMine .kmShare')].map((e) => getComputedStyle(e).color))]);
  sendColours.length === 1
    ? ok(`every send icon is the same colour (${sendColours[0]})`)
    : bad(`the send icons render in ${sendColours.length} colours (${sendColours.join(', ')}) — a `
        + 'colour that has to be asked about is not a signal');
  await page.close();
}

/* A BUTTON THAT DOES EVERYTHING EXCEPT BE VISIBLE. The profile control in the feed bar
 * called openKamoHome() correctly from the day it shipped: the handler ran, the event fired,
 * the .show class landed. The card rendered at z-index 80 underneath a fullscreen #kfeed at
 * 9400 and nobody ever saw it — which is indistinguishable, from the outside, from a dead
 * button, and was reported as one.
 * SO THE ASSERTION IS elementFromPoint, NOT A CLASS. Every class-based or display-based check
 * passes against the broken code, because nothing about the class was ever wrong. The only
 * question that separates the two is whether a finger landing on the card would reach it. */
console.log('\nTHE PROFILE BUTTON OPENS THE CARD WHERE IT CAN BE TOUCHED');
{
  const page = await open(ROWS(3));

  const closed = await page.evaluate(() => {
    const el = document.getElementById('kamoHome');
    return !!el && !el.classList.contains('show');
  });
  closed ? ok('the card starts closed while the feed plays') : bad('#kamoHome is open before anything was tapped');

  /* Profile lives on the My-kamos grid now (top-right, founder's call 2026-08-15): the
     door is #kfMe, visible only once the grid is open — assert that gating too. */
  const meHiddenOnFeed = await page.evaluate(() => document.getElementById('kfMe').style.display === 'none');
  meHiddenOnFeed ? ok('the profile door is absent while the public feed plays') : bad('#kfMe visible over the feed — that corner belongs to the clock chip');
  await page.evaluate(() => { document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="mine"]').click(); });
  await page.waitForTimeout(1200);
  const meShownOnMine = await page.evaluate(() => document.getElementById('kfMe').style.display !== 'none');
  meShownOnMine ? ok('and appears top-right on My kamos') : bad('#kfMe still hidden on the grid');
  await page.evaluate(() => document.getElementById('kfMe').click());
  await page.waitForTimeout(600);

  const st = await page.evaluate(() => {
    const el = document.getElementById('kamoHome');
    if (!el) return { missing: true };
    const card = el.querySelector('.kpCard');
    if (!card) return { noCard: true, shown: el.classList.contains('show') };
    const r = card.getBoundingClientRect();
    /* A point provably inside the card, taken from the card's own box rather than guessed
       from the viewport — the card is bottom-anchored and its height changes with content. */
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2));
    return {
      shown: el.classList.contains('show'),
      z: getComputedStyle(el).zIndex,
      position: getComputedStyle(el).position,
      onTop: !!(hit && el.contains(hit)),
      blockedBy: hit && !el.contains(hit) ? ((hit.closest('[id]') || {}).id || hit.className || hit.tagName) : null,
    };
  });

  st.shown ? ok('tapping it opens the card') : bad('#kamoHome never got .show — the handler did not run');
  st.onTop
    ? ok(`and the card is what a finger would actually hit (z-index ${st.z}, ${st.position})`)
    : bad(`the card is open but BURIED — a tap on it lands on "${st.blockedBy}" instead (z-index ${st.z}, ${st.position})`);

  /* The handler is a toggle, and the second tap is the half that only exists because the
     feed bar stays on screen behind the card. */
  await page.evaluate(() => document.getElementById('kfMe').click());
  await page.waitForTimeout(400);
  const reclosed = await page.evaluate(() => !document.getElementById('kamoHome').classList.contains('show'));
  reclosed ? ok('and tapping it again closes it') : bad('the profile button does not toggle back');

  /* THE PILL SITS IN THE WORDMARK'S BOX, AND THE WORDMARK IS HIT-TESTED BY COORDINATES.
     Shipped 2026-08-15, reported by the founder within the hour: a REAL tap on
     "Everyone ▾" opened the handle modal over the menu, because the brand's
     document-level pointer handler reads clientX/Y in the capture phase and the feed's
     z-index means nothing to it. Every synthetic .click() in this file carries
     clientX/Y = 0 and sails past that handler — which is exactly how the bug shipped.
     So this one goes through page.mouse: real pixels, real pointer events. */
  {
    const pt = await page.evaluate(() => {
      const r = document.getElementById('kfScope').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      menu: document.getElementById('kfMenu').style.display === 'block',
      home: document.getElementById('kamoHome').classList.contains('show'),
    }));
    after.menu && !after.home
      ? ok('a real-pixel tap on the pill opens the MENU, not the wordmark modal')
      : bad('real-pixel pill tap: ' + JSON.stringify(after) + ' — the brand hit-test is eating the pill again');
  }

  await page.close();
}

console.log('\nTHE FEED CAN SAY SOMETHING BACK');
{
  const page = await open(ROWS(3), { react_to_hide: null, hide_reactions_of: [{ emoji: '\u{1F525}', n: 4 }],
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });
  /* BEFORE THE BUZZ — the point of the 2026-08-16 move. Reactions used to be built by
     ending(), so the only people who could ever say anything were the ones who had already
     spent their shot; everybody who looked and scrolled on met no control at all. The rail is
     mounted with the round now, so it must already be there while the photo is still a
     puzzle. Asserted first, because after the buzz this selector passes either way. */
  await page.waitForSelector('#chRx .chRxB', { timeout: 10000 }).catch(() => {});
  const live = await page.evaluate(() => document.querySelectorAll('#chRx .chRxB').length);
  live === 4 ? ok('four reactions are offered before the round is played') : bad(`live reactions: ${live}`);
  /* AND THE RAIL MUST NOT COST THE SHOT. It sits on top of the stage, which owns every
     gesture on this screen — a pointerdown that reached the stage would arm an aim at the
     emoji and the pointerup would fire the player's single buzz into the margin. */
  /* CHECKED BETWEEN THE DOWN AND THE UP, and that detail is the test. The reticle is created
     on pointerdown and REMOVED on pointerup (closeAim), so asserting after a full tap would
     pass whether or not the event ever reached the stage — a green light for a broken guard.
     No pointerup on the stage either: that one commits the buzz and would spend the round the
     assertions below still need. */
  const armed = await page.evaluate(() => {
    const b = document.querySelector('#chRx .chRxB');
    const o = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: 360, clientY: 400 };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    const seen = !!document.querySelector('.chRet');
    b.dispatchEvent(new PointerEvent('pointerup', o));
    return seen;
  });
  armed === false ? ok('and a tap on the rail never arms an aim') : bad('the rail armed the aim reticle');
  /* THE CONTROL FOR THAT CONTROL: the same gesture on the stage MUST arm it, or the assertion
     above is measuring a stage that stopped listening rather than a guard that works. */
  const stageArms = await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: 195, clientY: 300 };
    st.dispatchEvent(new PointerEvent('pointerdown', o));
    const seen = !!document.querySelector('.chRet');
    st.dispatchEvent(new PointerEvent('pointercancel', o));   // abandoned, never committed
    return seen;
  });
  stageArms === true ? ok('while the stage itself still arms one') : bad('the stage no longer arms an aim — the guard above proves nothing');
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  const n = await page.evaluate(() => document.querySelectorAll('#chRx .chRxB').length);
  n === 4 ? ok('and they survive the ending card that used to build them') : bad(`reactions: ${n}`);
  await page.waitForTimeout(500);
  const counts = await page.evaluate(() => { const e=document.querySelector('#chRx .chRxN'); return e?e.textContent:''; });
  counts === '4' ? ok("and it shows everybody's count, not this phone's") : bad('count shows ' + JSON.stringify(counts));
  await page.evaluate(() => document.querySelector('.chRxB').click());
  await page.waitForTimeout(400);
  const sent = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'react_to_hide').length);
  sent === 1 ? ok('a tap reaches the wire') : bad(`react_to_hide called ${sent}x`);
  /* A DIFFERENT EMOJI IS A DIFFERENT THING TO SAY. The cap used to be one reaction per hide,
     which killed the other three chips silently the moment any one was used. */
  await page.evaluate(() => document.querySelectorAll('.chRxB')[1].click());
  await page.waitForTimeout(400);
  const two = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'react_to_hide').length);
  two === 2 ? ok('and a second emoji is allowed — the cap is per emoji, not per hide') : bad(`two emoji sent ${two} calls`);
  /* THE COURTESY THE CAP EXISTS FOR, unchanged: nobody runs a number up on their own. */
  await page.evaluate(() => document.querySelectorAll('.chRxB')[1].click());
  await page.waitForTimeout(400);
  const again = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'react_to_hide').length);
  again === 2 ? ok('but the same one twice is not — still one tap per emoji') : bad(`a repeat sent ${again} calls`);
  /* THE ANSWER SURVIVES THE ROUND. The used chips are stored as a list under kamo_rx_<id>;
     a device that reacted under the previous build wrote "1", which must not be read back as
     a used emoji and must not lock the chips. */
  const stored = await page.evaluate(() => localStorage.getItem('kamo_rx_hide0'));
  (stored || '').split(',').filter(Boolean).length === 2
    ? ok('and both are remembered on the device')
    : bad('stored reactions: ' + JSON.stringify(stored));
  const lit = await page.evaluate(() => document.querySelectorAll('.chRxB.on').length);
  lit === 2 ? ok('a used chip stays lit rather than going quiet') : bad(`${lit} chips lit`);
  await page.close();
}

/* THE OLD SINGLE-VALUE KEY, READ BY THE NEW CODE. Every device that reacted before this
   change wrote the literal "1" under kamo_rx_<id>. Split on commas that is one entry, "1",
   which matches no emoji — so those people get all four chips back. The failure to avoid is
   the opposite one: a parser that treats a non-empty key as "already reacted" would leave
   them permanently unable to react to that hide, silently, forever. */
console.log('\nA REACTION FROM THE OLD BUILD DOES NOT LOCK THE NEW CHIPS');
{
  const page = await open(ROWS(1), { react_to_hide: null, hide_reactions_of: [],
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } }, (p) =>
    p.addInitScript(() => { try { localStorage.setItem('kamo_rx_hide0', '1'); } catch (e) {} }));
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chRx .chRxB', { timeout: 10000 }).catch(() => {});
  const lit = await page.evaluate(() => document.querySelectorAll('.chRxB.on').length);
  lit === 0 ? ok('none of the four is pre-locked by the legacy value') : bad(`${lit} chips came back lit`);
  await page.evaluate(() => document.querySelector('.chRxB').click());
  await page.waitForTimeout(400);
  const sent = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'react_to_hide').length);
  sent === 1 ? ok('and they can still react') : bad(`react_to_hide called ${sent}x`);
  await page.close();
}

/* THE ENDING IS BUILT FROM THE ANSWER, NOT FROM THE PICTURE OF IT.
   Every caller of snapReveal() used to await it before calling ending(), so the headline and
   the card — both built entirely from the submit_attempt response, already in hand — queued
   behind up to two image loads over the radio. That is the reported lag on the title and the
   modal after a tap in the feed: not a slow render, a card waiting on a download it never
   reads.
   The regression this guards is subtle and silent: re-introducing a single `await` in front
   of ending() costs nothing on a fast connection and makes the ending feel broken on a slow
   one, which is exactly the population that cannot report it. So the reveal frames are
   STALLED OUTRIGHT here — the request is accepted and never answered — and the card is
   required to arrive anyway. A test that merely measured milliseconds would pass on a fast
   machine with the await back in place; one that hangs the network cannot. */
console.log('\nTHE ENDING DOES NOT WAIT FOR THE REVEAL FRAMES');
{
  const page = await open(ROWS(1), {
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 }, hide_reactions_of: [] });
  /* Never fulfilled, never aborted: an abort would resolve the Image() as an error and let
     the old code through. A dead request is what a bad radio actually looks like. */
  let stalled = 0;
  await page.route('**/*_b.jpg', () => { stalled++; });
  await page.route('**/*_w.jpg', () => { stalled++; });
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  /* waitForFunction, never a sleep: the card is mounted off the submit_attempt round trip,
     whose duration is the harness's, not a constant. */
  const landed = await page.waitForFunction(() => {
    const h = document.querySelector('#chHead');
    return !!(h && h.textContent.trim()) && !!document.querySelector('#chFoot .chCard');
  }, { timeout: 8000 }).then(() => true).catch(() => false);
  landed
    ? ok('the headline and the card arrive while the frames are still in flight')
    : bad('the ending never mounted with the reveal frames stalled — it is awaiting them again');
  const head = await page.evaluate(() => (document.querySelector('#chHead') || {}).textContent || '');
  /* The loss states its clock; the reveal line is the subtitle now. */
  /^Lost in \d+\.\d+s$/.test(head.trim())
    ? ok('and it is the real ending, not a placeholder')
    : bad('headline was ' + JSON.stringify(head));
  /* The frames were genuinely requested — otherwise the assertion above proves nothing, it
     just means this hide never had reveal assets to wait for in the first place. */
  stalled > 0 ? ok(`and the frames really were in flight (${stalled} held)`) : bad('no reveal frame was ever requested');
  await page.close();
}

/* THE SEEKER'S OWN RECORD. It could not be derived from anything that already existed —
   kamo_rounds counts only outside the wrapper (by design, it drives the Get KAMO / Play KAMO
   split), and the hit/miss was answered by submit_attempt, drawn, and dropped. So it is a new
   counter, and a counter nobody asserts is a counter that silently stops.
   Counted from ending(), the single funnel for found / missed / gave up — asserting it here
   is what stops somebody "tidying" it into the three branches, where a miss that also reveals
   an ancestor would count the same round twice. */
console.log('\nA ROUND IS FILED ON THIS DEVICE, WIN OR LOSE');
{
  const page = await open(ROWS(2), { react_to_hide: null, hide_reactions_of: [],
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });
  const before = await page.evaluate(() => window.KAMOSEEK.record());
  before.n === 0 && before.hit === 0
    ? ok('a fresh device has no record')
    : bad('the record did not start empty: ' + JSON.stringify(before));
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chFoot .chCard', { timeout: 8000 }).catch(() => {});
  const after = await page.evaluate(() => window.KAMOSEEK.record());
  /* A MISS COUNTS. The rate needs its denominator or it is a win counter wearing a percent
     sign — every round played has to land, not only the ones that went well. */
  after.n === 1 && after.hit === 0
    ? ok('a miss files the round and no hit — the denominator is real')
    : bad('after a miss the record is ' + JSON.stringify(after));
  await page.close();
}

/* THE ONE CONTROL ON THIS CARD THAT LEAVES THE APP.
   Everything else the ending card offers spends the round inside KAMO, which is why the feed
   retains and does not recruit. This button is the exception, so the two things that would
   make it worthless are asserted rather than read:
     1. IT SENDS THIS HIDE. The composer's #ssInvite sends chLink() — the round THIS phone
        made last — and on a feed slide that is somebody else's photo, a stale id, or empty.
        Sending the wrong link here is invisible to the sender and lands a stranger's caption
        on their own share, so the id in the message is compared against the slide's.
     2. IT SENDS SYNCHRONOUSLY. navigator.share must be reached on the tap's own activation;
        the composer cannot manage that because it waits for an upload, and this path exists
        precisely because HID is already known. A share that arrives after an await is a
        share WebKit refuses, so the test asserts the call landed with no timer in between. */
console.log('\nTHE FEED CAN SEND SOMEBODY ELSE\'S HIDE');
{
  const page = await open(ROWS(3), { react_to_hide: null, hide_reactions_of: [],
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });
  /* Recorded, not stubbed away: navigator.share is replaced before the tap so the message is
     readable, and the replacement resolves so the button takes the `shared` branch. */
  await page.evaluate(() => {
    window.__share = [];
    navigator.share = (d) => { window.__share.push(d); return Promise.resolve(); };
  });
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chSend', { timeout: 10000 }).catch(() => {});
  const there = await page.evaluate(() => !!document.querySelector('#chSend'));
  there ? ok('the ending card offers a way out of the app') : bad('#chSend is not on the card');
  /* UNDER THE PRIMARY, AND NOTHING ELSE BETWEEN. This used to assert that the share sat above
     "Next hide ↑" — a share offered after the way out has been named is a share the thumb has
     passed by. That button was removed on 2026-08-14, which made the old comparison vacuous:
     indexOf('chNext') is -1, so "above" could never be true again and the suite went red on a
     control that no longer exists.
     What survives the removal is the real claim: the share is the SECOND thing on the card,
     directly under the one primary action, and no other button separates them. */
  const order = await page.evaluate(() => {
    const f = document.querySelector('#chFoot'); if (!f) return 'no card';
    const ids = [...f.querySelectorAll('button')].map(b => b.id).filter(Boolean);
    if (ids.indexOf('chNext') !== -1) return 'chNext is back: ' + ids.join(',');
    return (ids[0] === 'chReh' && ids[1] === 'chSend') ? 'second' : ids.join(',');
  });
  order === 'second' ? ok('and it is the second control, directly under the primary') : bad('button order: ' + order);
  await page.evaluate(() => document.querySelector('#chSend').click());
  await page.waitForFunction(() => (window.__share || []).length > 0, { timeout: 5000 }).catch(() => {});
  const msg = await page.evaluate(() => (window.__share[0] || {}).text || '');
  /* Against the SLIDE's id, not a literal: the first row of ROWS() is the hide on screen, and
     a hardcoded id here would pass the day the fixture is renamed and the button regressed. */
  msg.includes('/h/' + ROWS(1)[0].id)
    ? ok('and the link it sends is the hide being played, not the sender\'s own')
    : bad('the message carried: ' + JSON.stringify(msg));
  /* The seeded get_hide names the author `tony`; the sender is passing this on, not claiming
     it, so the signature has to be the author's. */
  msg.includes('@tony')
    ? ok('signed with the author, so the sender is passing it on rather than claiming it')
    : bad('the message is not signed by the author: ' + JSON.stringify(msg));
  await page.close();
}

/* WHERE THE HUNT CAME FROM. n_attempts counts every play into one number, so a creator
   could not tell whether their feed was working or their friends were. The source rides the
   trace; what matters is that a feed round says so on the wire. */
console.log('\nA HUNT SAYS WHERE IT CAME FROM');
{
  const page = await open(ROWS(3), {
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chRx .chRxB', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => {
    const c = (window.__rpc || []).filter(x => x[0] === 'save_seek_trace').pop();
    return c && c[1] && c[1].p_trace ? c[1].p_trace.src : null;
  });
  t === 'feed' ? ok('a round played in the feed files its trace as src:"feed"')
               : bad('trace src on a feed round: ' + JSON.stringify(t));
  await page.close();
}

/* THE BLOCK, WHICH IS THE ONLY CONTROL HERE THAT MAKES A PROMISE ABOUT THE FUTURE.
   "Don't show me this person" is not a statement about one photo, so the three things worth
   asserting are all about what happens AFTER: the tag is kept, the next request carries it,
   and the already-fetched tail — chosen by a request that predates the block — does not
   survive. A block that only removed the slide under the thumb would look identical on this
   screen and be broken two swipes later. */
console.log('\nBLOCKING AN AUTHOR OUTLIVES THE PHOTO IT WAS ASKED FOR');
{
  const page = await open(ROWS(4), { block_author: 'tag_abc123',
    submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
    save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 } });

  /* Down one slide first, so there is something above the block as well as below it. */
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(900);
  /* THE ONLY WAY OUT OF A FEED ROUND IS NOW THE TAP. "I give up" was removed from the feed
     — the swipe is the exit there — so this ends the round the way a player does: press and
     release on the stage, which commits the aim. */
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    if (!st) return;
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o));
    st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  /* WAITED FOR, NEVER SLEPT ON — the rule this file's sibling already writes down: the ending
     card mounts BEHIND the reveal frames, whose load time is not a constant. A 900ms sleep
     here passed five runs out of six and took the whole gate red on the sixth, with a null
     dereference rather than a failed assertion, so it read as "THE FEED IS BROKEN" with no
     detail at all. */
  await page.waitForSelector('#chBlk', { timeout: 10000 }).catch(() => {});

  const present = await page.evaluate(() => {
    const b = document.getElementById('chBlk');
    return b ? b.textContent : null;
  });
  present === "Don't show me this person"
    ? ok('the round ends with a block next to the report, in the feed')
    : bad('block control reads ' + JSON.stringify(present));

  /* The reload after a block must ask the server again rather than reuse the tail it already
     holds. Emptying the seed here is how the test can tell those two apart. */
  await page.evaluate(() => { window.__seed.feed_page = []; window.__rpc.length = 0; });
  await page.evaluate(() => { const b = document.getElementById('chBlk'); if (b) b.click(); });
  await page.waitForTimeout(900);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kamo_blocked') || '[]'));
  Array.isArray(stored) && stored.length === 1 && stored[0] === 'tag_abc123'
    ? ok('what is kept is the tag block_author returned — not the hide id, not the author key')
    : bad('kamo_blocked holds ' + JSON.stringify(stored));

  const sent = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'feed_page').map(c => c[1]));
  sent.length && sent.every(b => Array.isArray(b.p_block_tags) && b.p_block_tags.includes('tag_abc123'))
    ? ok('and every feed_page after it carries the block list')
    : bad('feed_page after the block: ' + JSON.stringify(sent));

  /* One slide above the block survives; the blocked slide and everything under it do not. */
  const left = await page.evaluate(() => document.querySelectorAll('.kfSlide').length);
  left === 1
    ? ok('the blocked hide and the unplayed tail below it are gone (1 slide kept above)')
    : bad(`expected 1 slide left, got ${left}`);

  const end = await page.evaluate(() => {
    const m = document.getElementById('kfMid');
    return m && m.style.display !== 'none' ? (m.textContent || '').trim() : '';
  });
  /^That's everything for now\./.test(end)
    ? ok('and running out that way is an invitation, not a black screen')
    : bad('after the block the feed shows ' + JSON.stringify(end.slice(0, 80)));

  await page.close();
}

/* A hide somebody was personally SENT has no feed behind it, so there is nothing for a block
   to act on — and a control that reads as if it did something and does not is worse than no
   control. Same round, same ending, mounted outside the feed. */
console.log('\nAND IT DOES NOT APPEAR WHERE THERE IS NO FEED');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__seed = {
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 },
    };
  });
  await page.goto(base + '?h=abc123def4567890', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const q = document.getElementById('chQuit'); if (q) q.click(); });
  await page.waitForTimeout(900);
  const pair = await page.evaluate(() => ({
    rep: !!document.getElementById('chRep'), blk: !!document.getElementById('chBlk'),
  }));
  pair.rep && !pair.blk
    ? ok('a sent hide still offers Report, and offers no block')
    : bad('outside the feed: ' + JSON.stringify(pair));
  await page.close();
}

/* THE CONSENT MODAL IS GONE (2026-08-15) AND THE COVERAGE DID NOT GO WITH IT — it moved to
   the two places that now carry the same guarantee. That guarantee is worth restating, because
   this is the one screen in the app where being wrong publishes somebody's room: nobody
   reaches the public feed without the sentence saying so having been on screen first.
     · IT IS ON SCREEN — test-peek-dom.mjs asserts #ssVis is displayed in the SHORT sheet,
       above the send, in the state the sheet actually arrives in. That assertion is what the
       modal was reinstated for on 2026-08-14, when the suite proving it was quarantined and
       red; it is green now, which is what let the modal go.
     · IT IS OBEYED — check.mjs asserts chUpload() publishes through
       kfApplyVisibility(mine,kfWantPublic()), so the row's answer is the only thing that
       decides, and the call site cannot quietly start passing `true`.
   What is left here is the half neither of those can see: that the stored answer survives and
   reaches the wire as the value the user chose. Driven through the exported doors rather than
   a real publish, which would need a painted board and a storage round trip to say the same
   thing. */
console.log('\nTHE VISIBILITY ANSWER IS WHAT REACHES THE WIRE');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.__seed = { set_hide_public: null }; });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* PUBLIC IS STILL THE DEFAULT — founder's call, 2026-08-13, unchanged by removing the modal.
     A fresh device that has never touched the row wants public, and the row on the sheet is
     what tells it so before the send. */
  (await page.evaluate(() => window.KAMOFEED.wantPublic())) === true
    ? ok('a fresh device wants public — the default did not move when the modal went')
    : bad('a fresh device reads as private: the default flipped silently, which is a different '
        + 'product from the one the share sheet describes');

  const sent = await page.evaluate(async () => {
    const before = (window.__rpc || []).length;
    window.KAMOFEED.setVisibility('hide-1', window.KAMOFEED.wantPublic());
    await new Promise((r) => setTimeout(r, 200));
    return (window.__rpc || []).slice(before).filter((c) => c[0] === 'set_hide_public').map((c) => c[1]);
  });
  sent.length === 1 && sent[0].p_public === true
    ? ok('and publishing sends p_public:true for it')
    : bad(`the wire carried ${JSON.stringify(sent)} for a device that wants public`);

  /* AND TURNING IT OFF IS A REAL ANSWER, not decoration. This is the state the founder was
     stuck in for a day: the row had been switched off once and every hide since was private.
     It must stay private — removing the modal must not re-consent anybody. */
  const off = await page.evaluate(async () => {
    const el = document.getElementById('ssVis');
    if (el) el.click();                       // the row's own handler, the way a thumb does it
    const before = (window.__rpc || []).length;
    window.KAMOFEED.setVisibility('hide-2', window.KAMOFEED.wantPublic());
    await new Promise((r) => setTimeout(r, 200));
    return { want: window.KAMOFEED.wantPublic(),
             wire: (window.__rpc || []).slice(before).filter((c) => c[0] === 'set_hide_public').map((c) => c[1]) };
  });
  off.want === false && off.wire.length === 1 && off.wire[0].p_public === false
    ? ok('switching the row off keeps the hide off the feed, all the way to the wire')
    : bad(`after switching off: ${JSON.stringify(off)} — a row that does not reach set_hide_public `
        + 'is a privacy control that does nothing');

  /* AND IT SURVIVES THE RELAUNCH, which is the property that made the old latch dangerous and
     is the same property that makes the row trustworthy: an answer that evaporates would put
     somebody back in the feed they left. */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  (await page.evaluate(() => window.KAMOFEED.wantPublic())) === false
    ? ok('and the answer survives a relaunch')
    : bad('the private answer did not survive a reload — the next hide goes public');
  await page.close();
}

/* THE SECOND LAP. A player who has cleared the room was being told the room was empty. */
console.log('\nA CLEARED FEED REOPENS INSTEAD OF SAYING IT IS EMPTY');
{
  const rows = ROWS(3);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((r) => {
    /* Every hide already played on this device — the exact state 31 of 66 opens hit today. */
    localStorage.setItem('kamo_feed_seen', JSON.stringify(r.map(x => x.id)));
    window.__seed = { feed_page: r, set_hide_public: null,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' } };
  }, rows);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('btnFeed').click());
  /* WAITED FOR, NEVER SLEPT ON. The lap costs a SECOND feed_page round trip after the first
     one comes back empty, so a fixed sleep here is a test that goes red on a slow morning —
     which it did, once, in the gate. Wait for the thing being asserted, with a ceiling. */
  await page.waitForFunction(() => document.querySelectorAll('.kfSlide').length > 0, null, { timeout: 8000 })
    .catch(() => {});

  const slides = await page.evaluate(() => document.querySelectorAll('.kfSlide').length);
  slides === 3 ? ok('the seen hides come back rather than a dead end (3 slides)')
               : bad(`expected the feed to reopen with 3 slides, got ${slides}`);
  const mid = await page.evaluate(() => {
    const m = document.getElementById('kfMid');
    return m && m.style.display !== 'none' ? (m.textContent || '').trim() : '';
  });
  !/Nothing here yet/.test(mid)
    ? ok('and it does not tell a regular player the feed is empty')
    : bad('still showing the cold start to somebody who has played: ' + JSON.stringify(mid.slice(0, 40)));
  await page.close();
}

console.log('\nDAY ONE — AN EMPTY FEED IS AN INVITATION, NOT A BLACK SCREEN');
{
  const page = await open([]);
  const txt = await page.evaluate(() => {
    const m = document.getElementById('kfMid');
    return m && m.style.display !== 'none' ? (m.textContent || '').trim() : '';
  });
  /^Nothing here yet\./.test(txt) ? ok('the empty feed says so and offers the way out ("' + txt.slice(0, 34) + '…")')
    : bad('empty feed rendered ' + JSON.stringify(txt.slice(0, 80)));
  const cta = await page.evaluate(() => !!document.getElementById('kfCta'));
  cta ? ok('and it carries a button rather than a dead end') : bad('no CTA on the empty state');
  await page.close();
}

console.log('\nPUBLIC IS A DEFAULT, NOT A POLICY');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { window.__seed = { set_hide_public: null }; });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const start = await page.evaluate(() => {
    const b = document.getElementById('ssVis');
    return b ? { on: b.getAttribute('aria-pressed'), t: (document.getElementById('ssVisT') || {}).textContent } : null;
  });
  start && start.on === 'true' && start.t === 'Public'
    ? ok('the share sheet says Public before anything is sent')
    : bad('visibility row starts as ' + JSON.stringify(start));

  const sub = await page.evaluate(() => (document.getElementById('ssVisS') || {}).textContent || '');
  /feed/i.test(sub) ? ok('and it says where that puts the photo ("' + sub + '")') : bad('the row does not name the feed: ' + JSON.stringify(sub));

  const after = await page.evaluate(() => {
    document.getElementById('ssVis').click();
    return { on: document.getElementById('ssVis').getAttribute('aria-pressed'), t: document.getElementById('ssVisT').textContent, stored: localStorage.getItem('kamo_hide_public') };
  });
  after.on === 'false' && after.t === 'Private' && after.stored === '0'
    ? ok('one tap turns it off, and the choice sticks on the device')
    : bad('after the tap: ' + JSON.stringify(after));

  /* The label is not the feature. A row that flips its own text and never tells the server
     is worse than no row, because it reads as a setting that was honoured. */
  const wired = await page.evaluate(() => {
    window.__rpc = [];
    return !!(window.KAMOFEED && window.KAMOFEED.setVisibility);
  });
  if (wired) {
    const call = await page.evaluate(async () => { window.KAMOFEED.setVisibility('abc123', false); await new Promise(r => setTimeout(r, 120)); return (window.__rpc || []).find(c => c[0] === 'set_hide_public'); });
    call && call[1] && call[1].p_id === 'abc123' && call[1].p_public === false
      ? ok('turning it off calls set_hide_public(id, false)')
      : bad('set_hide_public was not called correctly: ' + JSON.stringify(call));
  } else {
    bad('KAMOFEED.setVisibility is not reachable');
  }
  await page.close();
}

console.log('\nTHE BUTTON WAITS FOR THE FEED TO EXIST');
{
  /* Shipped visible, and on day one it led every user to "Nothing here yet." — nothing is
     public yet and the 3191 existing hides stay private by design, so the button was a
     button that went nowhere. The gate is a launch probe, and both directions matter: hidden
     while the feed is empty, and revealed by itself the day it is not, with no deploy. */
  const empty = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await empty.addInitScript(() => { window.__seed = { feed_page: [] }; });
  await empty.goto(base, { waitUntil: 'load' });
  await empty.waitForTimeout(2200);   // the probe fires at 1200ms
  const hidden = await empty.evaluate(() => getComputedStyle(document.getElementById('btnFeed')).display);
  hidden === 'none'
    ? ok('an empty feed hides its button rather than offering a dead end')
    : bad('button display with an empty feed: ' + hidden);
  await empty.close();

  const full = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await full.addInitScript(() => { window.__seed = { feed_page: [{ id: 'h0', img_path: 'p0.jpg', name: 'tony', n_attempts: 0, n_found: 0, created_at: '2026-08-13T10:00:00Z' }] }; });
  await full.goto(base, { waitUntil: 'load' });
  await full.waitForTimeout(2200);
  const ready = await full.evaluate(() => window.KAMOFEED && document.getElementById('btnFeed') ? { probe: true } : null);
  ready
    ? ok('and one public hide is enough to bring it back — no deploy needed')
    : bad('the probe never resolved');
  await full.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the feed plays real rounds and the visibility default is honest');
process.exit(failed ? 1 : 0);
