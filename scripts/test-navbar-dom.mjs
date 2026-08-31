#!/usr/bin/env node
/**
 * THE FEED IS THE HOME NOW, FOR 85 OF EVERY 100 RETURNING DEVICES.
 *
 * A rollout, not an experiment: at ~130 publishes a day a 50/50 needs about three weeks, and
 * the 15% holdout exists only because the alternative reading is worthless — the week before
 * this shipped contains a 15-hour upload outage, an arm shipped and killed inside 36 hours,
 * TikTok spend cut to zero, and installs falling 940/day -> 150/day.
 *
 * This file covers the four ways a boot-line change can be quietly catastrophic:
 *
 *   · IT COSTS THE APP. index.html reaches every user on push, and a throw on the boot line is
 *     a blank screen for all of them at once. The feed failing must land on the camera.
 *   · IT STEALS A SHARE LINK. Somebody handed a specific hide is not a session to redirect.
 *   · IT HIJACKS A FIRST LAUNCH, putting strangers' photographs in front of a device that has
 *     never seen the camera and raising a permission sheet behind a feed being read.
 *   · IT LEAKS THE HOLDOUT, which would leave the only contemporary control group empty and
 *     the rollout unreadable in either direction.
 *
 * And one more, which is why the ✕ became a camera in the same breath: at 85% that control is
 * the ONLY door to creation for most of the fleet, and this app has twice shipped a button
 * that was present, visible, correctly sized and untappable.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feedhome-dom.mjs
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
/* THE ONE ENTRY POINT THAT HAS NO BUTTON. The page is a <script type="module">, so nothing
   declared in it lands on window — and chFeed({first}) is reached in the app only from the
   post-send offer, at the far end of a capture, a paint, an upload and a share sheet. Driving
   all of that to assert one pill is a test about the wrong thing. The alias is written BEFORE
   the declaration on purpose: function declarations hoist, so this runs at module evaluation
   rather than on the first call, which is exactly when the alias is needed. */
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

/* ⚠️ A SWIPE COSTS A ROUND NOW, SO A TEST THAT SWIPES HAS TO PLAY ONE.
   The feed locks the slide under the thumb until its round is answered (FEED_LOCK in chFeed),
   which is what stopped the run being farmable by scrolling. Every case below that scrolls to
   prove something about the SLIDE LIFECYCLE — teardown, timing properties, block filtering —
   used to set scrollTop straight past a live round, and the clamp now pulls it back.
   Answering first is the faithful fix rather than switching the lock off for the suite: it is
   what a player does, and it keeps these cases running against the shipped configuration. One
   tap on the stage is the whole game, so it ends the round whatever the answer is. */
const answerAndScroll = async (page) => {
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    if (!st) return;
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o));
    st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  /* ⚠️ WAITED FOR, NEVER SLEPT ON — the rule this file already writes down further below, and
     the lock is a new way to get it wrong. A fixed 600ms passed alone and failed inside the
     full gate, where a dozen Chromes share the machine: the ending had not landed, the slide
     was still locked, the clamp pulled the scroll back and the failure read as "the round did
     not follow the scroll" — a sentence about the feed, produced by a sleep in the harness. */
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.kfSlide')].some(x => x.classList.contains('kfLock')),
    { timeout: 9000 }).catch(() => {});
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
};

const ROWS = n => Array.from({ length: n }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'tony',
  n_attempts: i, n_found: 0, created_at: '2026-08-1' + (2 - (i % 3)) + 'T10:0' + i + ':00Z',
}));

/* `before` runs against the fresh page BEFORE it navigates — the only window in which a test
   can plant localStorage the app will read on boot (a legacy reaction key, say). It takes the
   page rather than a value so it can use addInitScript, which is the one hook that survives
   the navigation. */
/* THE ROUND'S PHOTO HAS TO ARRIVE. chSeek() grew an img.onerror: a camo image that never
   loads now says so on the headline ("This one didn't load"), stops the clock and refuses the
   buzz, rather than leaving a live round on a black rectangle filing 0.0s attempts. That is
   the fix, and it means a harness which lets the photo 404 is asserting against the failure
   screen instead of against the round. One transparent pixel is all any of these cases need. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const HROWS = [{ id: 'a1', img_path: 'x.jpg', cx: .5, cy: .5, r: .12, secs: 9, n_attempts: 3, n_found: 1, name: 'zoe' },
               { id: 'a2', img_path: 'y.jpg', cx: .4, cy: .6, r: .10, secs: 7, n_attempts: 2, n_found: 2, name: 'max' }];

/* Boots the app at the root, the way a returning device does. The arm is SEEDED and never
   rolled: a coin in here would put the subject of this suite on stage half the time. */
async function boot({ arm = 'feed', everAsked = true, seek = false, feedFails = false, replies = null, mine = null, wrapper = false } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  /* THE WRAPPER, STUBBED AT ITS THINNEST. Only the presence of the object matters here —
     navShouldShow asks "is this the installed app", not "does it implement anything". A
     postMessage that swallows is enough, and stubbing no further keeps this from becoming a
     test of the bridge. */
  if (wrapper) await page.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
  await page.addInitScript(([a, ea, ff, rows, rep, mn]) => {
    window.__seed = {
      feed_page: ff ? undefined : rows,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    };
    /* my_replies is seeded only when a case is about it: left undefined, the stub falls
       through and the launch takes the no-reply path, which is most opens. */
    if (rep !== null) window.__seed.my_replies = rep;
    try {
      if (a) localStorage.setItem('kamo_home_arm', a);
      if (ea) localStorage.setItem('kamo_cam_asked', '1');
      else localStorage.removeItem('kamo_cam_asked');
      /* chMine() is what decides whether the launch asks at all — a device that never
         published skips the round trip entirely. */
      if (mn) localStorage.setItem('kamo_hides', JSON.stringify(mn));
    } catch (e) {}
  }, [arm, everAsked, feedFails, HROWS, replies, mine]);
  await page.goto(base + (seek ? '?h=abc123' : ''), { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  page.__errs = errs;
  return page;
}
const feedUp = p => p.evaluate(() => !!document.querySelector('.kfBar'));

const seekUp = p => p.evaluate(() => !!document.getElementById('chStage'));
/* The camera is not "the screen in front" — it is whether the compose surface exists at all.
   Both arms must have it, because closing the feed has to land somewhere. */
const cameraBooted = p => p.evaluate(() => !!document.getElementById('board'));

/* ── ① IT IS ON ALL THREE SCREENS ──────────────────────────────────────────────────────── */
{
  console.log('\n— the bar is on the feed, the camera and the board —');
  const seen = async (p) => p.evaluate(() => {
    const n = document.getElementById('kNav');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { shown: getComputedStyle(n).display !== 'none' && r.width > 0 && r.height > 0,
             on: [...n.querySelectorAll('[data-tab]')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.tab),
             tabs: [...n.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab) };
  });

  const f = await boot({ arm: 'feed' });
  let v = await seen(f);
  v && v.shown ? ok('the feed has it') : bad('no tab bar on the feed — the main screen: ' + JSON.stringify(v));
  JSON.stringify(v && v.tabs) === JSON.stringify(['cam', 'feed', 'board'])
    ? ok('three tabs, camera then feed then board') : bad('tabs: ' + JSON.stringify(v && v.tabs));
  JSON.stringify(v && v.on) === JSON.stringify(['feed'])
    ? ok('and the feed tab is the one lit') : bad('lit: ' + JSON.stringify(v && v.on));

  /* THE BOARD IS A SCREEN NOW, so the bar has to survive it — a tab that dismisses the bar
     that opened it is a trap door. */
  await f.evaluate(() => document.querySelector('#kNav [data-tab="board"]').click());
  await f.waitForTimeout(700);
  v = await seen(f);
  const boardUp = await f.evaluate(() => !!document.querySelector('.chBoardWrap.show'));
  boardUp && v && v.shown ? ok('the board opens from the bar and keeps it')
    : bad(`board ${boardUp}, bar ${JSON.stringify(v)}`);
  JSON.stringify(v && v.on) === JSON.stringify(['board'])
    ? ok('and the board tab is lit while it is up') : bad('lit on the board: ' + JSON.stringify(v && v.on));

  /* ⚠️ AND NOTHING CAN TAKE IT AWAY FROM ITS OWN TAB. Founder, from a real device: "the menu
     sometimes disappears on the leaderboard." It could not be reproduced here, so the invariant
     was made unconditional rather than a guess at the cause being shipped — the board returns
     true before any other test. Asserted by forcing a state that WOULD hide it anywhere else. */
  const stuck = await f.evaluate(() => {
    try { window.mode = 'paint'; } catch (e) {}
    const sh = document.getElementById('shareSheet'); if (sh) sh.classList.add('show');
    return new Promise((r) => setTimeout(() => {
      const n = document.getElementById('kNav');
      if (sh) sh.classList.remove('show');
      r(n ? getComputedStyle(n).display : 'gone');
    }, 260));
  });
  stuck !== 'none' && stuck !== 'gone'
    ? ok('paint mode and an open sheet cannot take the bar off the board')
    : bad(`the bar went ${stuck} on the board — a tab bar that vanishes from its own tab is a trap`);

  /* ⚠️ AND NO SECOND WAY OUT. With the bar up, a Close button is a duplicate of the tab that
     is already there and the least interesting control on the screen. It must still exist when
     the bar does NOT — a link round gives the whole app to one hide, the board opens from the
     run pill, and without it somebody is trapped on a leaderboard. */
  const closeShown = await f.evaluate(() => {
    const b = document.getElementById('chBoardClose');
    return b ? getComputedStyle(b).display : 'missing';
  });
  closeShown === 'none'
    ? ok('and no Close button, because the bar already is the way out')
    : bad(`the board shows a Close (${closeShown}) beside a tab bar that does the same thing`);

  /* AND BACK. The camera tab shuts the board and gets the feed out of the way.
     ⚠️ "OUT OF THE WAY" IS NOT "CLOSED" ANY MORE, AND THE DIFFERENCE IS THE POINT. This read
     `!document.querySelector('.kfBar')` — the feed's DOM being gone — which was true because
     the camera tab destroyed the session. That destruction was a free skip past a locked hide
     (see ①c), so the feed is now HELD: its DOM stays, its round stays, and it is hidden. The
     property this block actually cares about is unchanged — the camera is what you are
     looking at — so it is asserted on what is VISIBLE rather than on what exists. */
  await f.evaluate(() => document.querySelector('#kNav [data-tab="cam"]').click());
  await f.waitForTimeout(600);
  const home = await f.evaluate(() => {
    const r = document.getElementById('kfeed');
    return { board: !!document.querySelector('.chBoardWrap.show'),
             feedShown: !!(r && getComputedStyle(r).visibility !== 'hidden'),
             board_el: !!document.getElementById('board') };
  });
  (!home.board && !home.feedShown && home.board_el)
    ? ok('the camera tab lands on the capture screen, with the board shut and the feed out of the way')
    : bad('after the camera tap: ' + JSON.stringify(home));
  (await seen(f)).shown ? ok('and the bar is still there') : bad('the bar vanished on the camera screen');
  await f.close();
}

/* ── ①b THE FEED TAB IS THE ONLY DOOR LEFT, SO IT IS THE ONE THAT GETS TAPPED ──────────── */
{
  console.log('\n— the Feed tab actually opens the feed, by tap —');
  /* ⚠️ THIS IS NOT REDUNDANT WITH THE SUITES THAT PLAY THE FEED, AND THE REASON IS RECENT.
     All of them opened it by clicking #btnFeed, the camera's own button. That button was
     deleted on 2026-08-29 — the bar replaced it — and the bar's handler is module-scoped, so
     every one of those suites now opens the feed through window.KAMOFEED.open(). Not one of
     them touches a control any more. This is the single assertion standing between the fleet
     and a feed that no user can reach while every feed test stays green.
     REAL CLICK, NOT .click(). Playwright's actionability check refuses a target that does not
     receive the event — covered, zero-sized, or behind something — which is exactly the class
     of failure this app has shipped three times and which a dispatched DOM click sails
     straight through. */
  const p = await boot({ arm: 'camera' });
  await p.waitForTimeout(400);
  let opened = null, why = null;
  try {
    await p.click('#kNav [data-tab="feed"]', { timeout: 4000 });
    await p.waitForTimeout(900);
    opened = await feedUp(p);
  } catch (e) { why = String(e.message).split('\n')[0].slice(0, 120); }
  opened
    ? ok('a real tap on the Feed tab opens the feed')
    : bad('the Feed tab did not open the feed' + (why ? ' — ' + why : '')
        + ' — this is the ONLY control that reaches the feed since #btnFeed was deleted');
  /* AND THE CAMERA IS STILL BEHIND IT. The feed is an overlay over compose; if the tap tore
     the camera down there is nothing to come back to. */
  const back = await p.evaluate(() => !!document.getElementById('board'));
  back ? ok('and the camera is still underneath, ready to be tabbed back to')
       : bad('the feed tap took the camera down with it');
  await p.close();
}

/* ── ①c THE FEED IS HELD, NOT REBUILT — WHICH IS WHAT KEEPS THE RUN HONEST ─────────────── */
{
  console.log('\n— tabbing to the camera and back keeps the same hide —');
  /* ⚠️ THIS IS A STREAK EXPLOIT, NOT A COSMETIC ONE, AND THAT IS WHY IT IS HERE RATHER THAN
     IN A FEED SUITE. FEED_LOCK exists because a streak you can keep by scrolling is not a
     streak: once a slide is engaged you cannot swipe past it, you find it or you press "I
     give up", and giving up costs the run everywhere except the one free pass a day.
     The tab bar drove straight through all of that. Camera called kfState.close(), which
     destroyed the round — no find, no give-up, no cost — and Feed built a fresh session that
     drew a different hide. An unlimited free skip, one tap wide, on the screen the whole
     mechanic lives on. Founder, 2026-08-29: "sinon trop facile de continuer un streak".
     Three things have to hold, and the second is the one a lazy test would miss. */
  const p = await boot({ arm: 'feed' });
  await p.waitForTimeout(900);
  const wall0 = Date.now();
  const before = await p.evaluate(() => {
    const s = document.querySelector('.kfSlide .chS') || document.querySelector('.chS');
    const c = document.getElementById('chClock');
    return { hide: s ? (s.dataset.hid || null) : null,
             slides: document.querySelectorAll('.kfSlide').length,
             scroll: (document.getElementById('kfScroll') || {}).scrollTop,
             photo: (document.querySelector('.chFrame img') || {}).src || null,
             /* ⚠️ THE IDENTITY OF THE ROUND, WHICH IS THE PROPERTY THAT ACTUALLY CLOSES THE
                EXPLOIT. "Same photo" is satisfied by a round that was torn down and rebuilt on
                the same row — and a rebuilt round is a fresh clock and an unspent lock, which
                is the free skip wearing a disguise. A marker on the element the round mounted
                into cannot survive a rebuild: activate() destroys the round and the DOM goes
                with it. This is also what separates holding by visibility from holding by
                display:none — at least in theory: the callback's activate() opens with
                `if(S.round) S.round.destroy()`, so a spurious re-activation rebuilds the round.
                ⚠️ IN PRACTICE THIS FIXTURE CANNOT TELL THEM APART. display:none passes this
                assertion too. It sits at slide 0 with two rows, which is where a locked round
                always is, so neither a lost scroll position nor a re-fired observer has room to
                happen here. The assertion is still the right one — it catches the rebuild
                whatever causes it — but it is not evidence for the choice of property. */
             marked: (() => { const el = document.querySelector('.chS');
               if (!el) return false; el.dataset.probe = 'keep'; return true; })(),
             clock: c ? c.textContent : null,
             run: (() => { try { return localStorage.getItem('kamo_run'); } catch (e) { return 'x'; } })() };
  });
  before.photo ? ok('a round is up in the feed to hold onto')
               : bad('no round mounted in the fixture: ' + JSON.stringify(before));

  await p.click('#kNav [data-tab="cam"]', { timeout: 4000 });
  await p.waitForTimeout(1300);
  const away = await p.evaluate(() => {
    const r = document.getElementById('kfeed');
    const n = document.getElementById('kNav');
    /* ⚠️ "NOT ON SCREEN" RATHER THAN "visibility:hidden", ON PURPOSE. A first version read the
       one property the implementation happens to use, which meant a display:none variant
       failed HERE — on the wrong assertion, with the wrong message — and the scroll check
       below, the only one that can tell the two apart, never got to run at all. This asks the
       question the block is actually about; the scroll assertion does the discriminating. */
    const cs = r ? getComputedStyle(r) : null;
    return { alive: !!r,
             hiddenNow: !r ? 'gone'
               : (cs.display === 'none' || cs.visibility === 'hidden' || !r.getClientRects().length)
                 ? 'hidden' : 'shown',
             /* The camera has to be genuinely in front, not merely underneath something
                transparent — the whole point is that the player uses the camera. */
             onCam: [...n.querySelectorAll('[data-tab]')].filter((b) => b.classList.contains('on'))
               .map((b) => b.dataset.tab).join(',') };
  });
  away.alive && away.hiddenNow === 'hidden'
    ? ok('the feed is held rather than destroyed')
    : bad('the feed was ' + (away.alive ? 'left visible (' + away.hiddenNow + ')' : 'DESTROYED')
        + ' — a destroyed round is a free skip past a locked hide');
  away.onCam === 'cam'
    ? ok('and the camera tab is the one lit')
    : bad('tab lit while held: ' + JSON.stringify(away.onCam));

  await p.click('#kNav [data-tab="feed"]', { timeout: 4000 });
  /* ⚠️ SHORT ON PURPOSE. A long settle here is time the clock is legitimately running again,
     and the first version's 700ms wait ate most of the margin it was testing — it reported a
     product bug (2.4s → 3.1s over a 1.3s hold) that was entirely the harness's own wait. The
     comparison below is against measured wall time for the same reason: a constant threshold
     is a guess about machine speed. */
  await p.waitForTimeout(120);
  const wall1 = Date.now();
  const back = await p.evaluate(() => {
    const c = document.getElementById('chClock');
    return { photo: (document.querySelector('.chFrame img') || {}).src || null,
             scroll: (document.getElementById('kfScroll') || {}).scrollTop,
             slides: document.querySelectorAll('.kfSlide').length,
             feeds: document.querySelectorAll('#kfeed').length,
             sameRound: (() => { const el = document.querySelector('.chS');
               return !!(el && el.dataset.probe === 'keep'); })(),
             vis: (() => { const r = document.getElementById('kfeed'); if (!r) return 'gone';
               const c = getComputedStyle(r);
               return (c.display === 'none' || c.visibility === 'hidden') ? 'hidden' : 'shown'; })(),
             clock: c ? c.textContent : null };
  });
  back.vis === 'shown'
    ? ok('and Feed gives it straight back')
    : bad('the feed did not come back: ' + JSON.stringify(back));
  back.photo && back.photo === before.photo
    ? ok('on the SAME hide — the one thing the founder asked for')
    : bad('the hide changed across a tab round-trip: ' + JSON.stringify({ was: before.photo, now: back.photo }));
  /* ⚠️ AND THE SCROLLER KEPT ITS PLACE. This is why the hold is visibility and not
     display:none: the slide you are on IS the scrollTop, and display:none drops it on most
     engines — which would put the feed back at slide 0 and reproduce the reported bug in a
     different costume, while the "same hide" assertion above still passed on slide 0 being
     the same slide 0. */
  /* ⚠️ NOT "the scroller kept its place" — THAT ASSERTION WAS VACUOUS AND IT PASSED FOR THE
     WRONG REASON. A locked round sits on slide 0, so scrollTop is 0 both sides of the trip and
     `0 === 0` was true of every implementation, including the destroy-and-rebuild it was meant
     to rule out. This is the question it was reaching for: is this the SAME round, or a new one
     on the same photograph? A rebuilt round is a fresh clock and an unspent lock. */
  before.marked
    ? (back.sameRound
        ? ok('and it is the SAME round, not a new one built on the same photograph')
        : bad('the round was torn down and rebuilt across the trip — same hide, but a fresh '
            + 'clock and an unspent lock, which is the free skip with better manners'))
    : bad('could not mark the round to check its identity');
  back.feeds === 1
    ? ok('and there is still exactly one feed, not a second one stacked on it')
    : bad(back.feeds + ' feed roots in the document');

  /* ⚠️ THE CLOCK IS THE HALF A LAZY TEST WOULD MISS. Holding the DOM is not enough: the round
     measures from image decode to the tap, that number is filed as p_ms and becomes best_ms —
     a hide's PUBLIC record, printed on the re-send as "fastest 4.1s". A player who steps away
     for a minute and comes back and finds it would file a 63-second find and quietly poison
     the record of somebody else's hide. Held above for 1.3s; anything under half of that is
     the tick granularity, anything near it is a clock that never stopped. */
  const t = (v) => { const m = /([\d.]+)s/.exec(String(v || '')); return m ? parseFloat(m[1]) : null; };
  const t0 = t(before.clock), t1 = t(back.clock);
  const wall = (wall1 - wall0) / 1000, ran = (t0 !== null && t1 !== null) ? t1 - t0 : null;
  ran === null
    ? bad('could not read the round clock: ' + JSON.stringify({ before: before.clock, back: back.clock }))
    : (ran < wall - 1
        ? ok(`and the round's clock stopped while it was held (${ran.toFixed(1)}s counted `
            + `across ${wall.toFixed(1)}s away)`)
        : bad(`the clock kept running while the feed was held — ${ran.toFixed(1)}s counted `
            + `across ${wall.toFixed(1)}s away. That lands in p_ms and becomes best_ms, the `
            + "public record printed on somebody else's hide."));

  /* AND THE SHUTTER REALLY ENDS IT. Held forever, the session would block every chFeed() that
     comes after a publish — "See it live", the reply return, land_on_own_hide all bail on
     kfState — so publishing would finish on a feed that silently refused to open. */
  await p.click('#kNav [data-tab="cam"]', { timeout: 4000 });
  await p.waitForTimeout(400);
  /* ⚠️ THROUGH THE BUTTON, NOT THROUGH THE FUNCTION. capture() lives in the module scope of
     an inline `type="module"` script, so page.evaluate cannot see it — a first version called
     it directly, threw ReferenceError, and the .catch() around it turned a test that ran
     nothing into a test that reported a product bug. The DOM handler is reachable from
     anywhere, which is also how a thumb reaches it. */
  const fired = await p.evaluate(() => {
    const st = document.getElementById('start'); if (st) st.style.display = 'none';
    const b = document.getElementById('shutter'); if (!b) return 'no shutter';
    b.style.display = 'block'; b.click(); return 'clicked';
  });
  await p.waitForTimeout(500);
  const gone = await p.evaluate(() => document.querySelectorAll('#kfeed').length);
  fired === 'clicked' && gone === 0
    ? ok('and pressing the shutter ends the held session for real')
    : bad(`a held feed survived a capture (${fired}, ${gone} root(s) left) — every chFeed() `
        + 'after a publish bails on kfState, so "See it live" would open nothing');
  await p.close();
}

/* ── ② AND IT IS HIDDEN WHERE SOMETHING ELSE OWNS THE BOTTOM ───────────────────────────── */
{
  console.log('\n— and it gets out of the way —');
  /* ⚠️ THIS IS THE BLOCK THAT MATTERS. A bar pinned to the bottom of every screen is the exact
     shape of the two failures this product has already paid for: the feed's .kfHint pill on
     2026-08-20 took the send rate down 62%, and the landing arm on 08-22 halved it. Both
     shipped with the send button present, visible and untappable, and both passed every DOM
     assertion written about them. So the share sheet is hit-tested, not inspected. */
  /* ⚠️ arm 'camera', NOT 'feed'. A first version opened the sheet with the feed up and read the
     send button as covered by #chStage — which is true and meaningless: .chS is z-index 9000
     and the share sheet is 58, and in the real product the sheet appears after publishing, on
     the compose screen, with no feed round mounted over it. The test was measuring a state
     that cannot happen. Assert the harness before the product. */
  const p = await boot({ arm: 'camera' });
  await p.evaluate(() => { const s = document.getElementById('shareSheet'); if (s) s.classList.add('show'); });
  await p.waitForTimeout(300);
  const overSheet = await p.evaluate(() => {
    const n = document.getElementById('kNav');
    return n ? getComputedStyle(n).display : 'missing';
  });
  overSheet === 'none'
    ? ok('the share sheet takes the bottom and the bar leaves it')
    : bad(`the bar is ${overSheet} over the share sheet — the send button lives there, and this `
        + 'app has lost it twice to things merely sitting near it');

  /* AND THE SEND BUTTON ITSELF, BY elementFromPoint. Three points across its width, because a
     cover that clips one edge is the failure that reads as fine in a screenshot. */
  const hit = await p.evaluate(() => {
    const b = document.getElementById('ssInvite');
    if (!b) return { missing: true };
    b.style.display = 'block';
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { collapsed: true };
    const d = (el) => !el ? 'nothing' : el.id ? '#' + el.id
      : '.' + String(el.className.baseVal || el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return { pts: [[0.5, 0.5], [0.08, 0.5], [0.92, 0.5]].map(([fx, fy]) => {
      const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
      return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }) };
  });
  if (hit.missing || hit.collapsed) bad('the send button could not be measured: ' + JSON.stringify(hit));
  else {
    const blocked = hit.pts.filter((h) => !h.ours);
    blocked.length === 0
      ? ok('and a thumb reaches "Send to a friend" at all three points')
      : bad('the send button is covered at ' + blocked.map((h) => h.at).join(', ')
          + ' — this is the 08-20 and 08-22 regression, with a tab bar as the cause');
  }
  await p.close();
}

/* ── ③ A ROUND KEEPS ITS OWN CONTROLS, ABOVE THE BAR ────────────────────────────────────── */
{
  console.log('\n— the round is lifted, not covered —');
  /* In the feed EVERY SLIDE IS A ROUND — .chS is mounted per slide, fixed and full-bleed — so
     the bar and the round's own bottom controls share that edge permanently. The give-up sits
     bottom-left and the hint bottom-right; a bar centred between them at the same height is a
     crowded line at best and a covered control at worst. They move up instead. */
  const p = await boot({ arm: 'feed' });
  await p.waitForTimeout(400);
  const lifted = await p.evaluate(() => {
    const q = document.querySelector('.chS.chIn .chQuit') || document.querySelector('.chQuit');
    const n = document.getElementById('kNav');
    if (!q || !n) return { missing: !q ? 'quit' : 'nav' };
    const qr = q.getBoundingClientRect(), nr = n.getBoundingClientRect();
    return { overlap: !(qr.bottom <= nr.top || qr.top >= nr.bottom || qr.right <= nr.left || qr.left >= nr.right),
             body: document.body.classList.contains('nav-on'),
             quitBottom: Math.round(innerHeight - qr.bottom), navTop: Math.round(nr.top) };
  });
  lifted.body ? ok('the body carries the class the lift hangs on') : bad('no nav-on class: ' + JSON.stringify(lifted));
  !lifted.missing && !lifted.overlap
    ? ok(`the give-up sits clear of the bar (${lifted.quitBottom}px up)`)
    : bad('the give-up overlaps the tab bar: ' + JSON.stringify(lifted));
  await p.close();
}

/* ── ③b THE SHUTTER, WHICH IS THE ONE THAT WOULD HAVE HURT MOST ─────────────────────────── */
{
  console.log('\n— the capture button is not under the bar —');
  /* ⚠️ #shutterWrap sits at bottom:30px centred, z-index 15. The bar is bottom:12px centred,
     z-index 9500 and about 45px tall: the same rectangle, and the bar wins. Left alone, the
     tab bar meant to navigate TO the camera would have sat on top of the button that uses it —
     the entry point of the whole product. Hit-tested, because a covered control photographs
     perfectly and this app has already lost a button twice to exactly that. */
  const p = await boot({ arm: 'camera' });
  await p.waitForTimeout(400);
  const sh = await p.evaluate(() => {
    const b = document.getElementById('shutterWrap');
    const n = document.getElementById('kNav');
    if (!b || !n) return { missing: !b ? 'shutter' : 'nav' };
    b.style.display = 'block';
    /* ⚠️ THE HERO HAS TO GO FIRST. Without a camera the fixture keeps #start up, and .aurora —
       its animated background — covers the shutter: a first version read that as "the bar is
       on the button" and would have sent me chasing a bug that was the harness. The shutter
       only exists as a control once a camera is granted, so the test puts it in that state. */
    const st = document.getElementById('start'); if (st) st.style.display = 'none';
    const r = b.getBoundingClientRect(), nr = n.getBoundingClientRect();
    if (!r.width || !r.height) return { collapsed: true };
    const d = (el) => !el ? 'nothing' : el.id ? '#' + el.id
      : '.' + String(el.className.baseVal || el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return {
      overlap: !(r.bottom <= nr.top || r.top >= nr.bottom),
      gap: Math.round(nr.top - r.bottom),
      pts: [[0.5, 0.5], [0.5, 0.14], [0.5, 0.86]].map(([fx, fy]) => {
        const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
        return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }),
    };
  });
  if (sh.missing || sh.collapsed) bad('the shutter could not be measured: ' + JSON.stringify(sh));
  else {
    /* ⚠️ A GAP, NOT MERELY "NO OVERLAP". The first version asserted the two rectangles did not
       intersect and passed at 86px — where, on a real phone, the word "Capture" under the
       button sat on the bar's top edge. Not overlapping is not the same as not crowded, and
       only a photograph of a device showed the difference. */
    !sh.overlap && sh.gap >= 24
      ? ok(`the shutter sits clear of the bar with ${sh.gap}px between them`)
      : bad(`the shutter is ${sh.overlap ? 'overlapping' : 'only ' + sh.gap + 'px above'} the bar `
          + '— the Capture label lands on it');
    const blocked = sh.pts.filter((h) => !h.ours);
    blocked.length === 0
      ? ok('and a thumb reaches it top, middle and bottom')
      : bad('the SHUTTER is covered at ' + blocked.map((h) => h.at).join(', ')
          + ' — the tab bar is sitting on the capture button, which is the entry point of the '
          + 'entire product');
  }
  await p.close();
}

/* ── ③c THE ROW BESIDE THE SHUTTER, WHICH IS WHERE THE BAR ACTUALLY LANDED ─────────────── */
{
  console.log('\n— the camera row is lifted too, and every corner is tappable —');
  /* ⚠️ THE SHUTTER WAS LIFTED AND THE ROW BESIDE IT WAS NOT — the exact half-fix this file
     exists to catch. .camBtn sits at bottom:52px and the bar occupies roughly 12→68, so the
     picker's INVISIBLE 44px hit pad — added precisely because the visible button is 23px —
     lay under a bar at z-index 9500. Nothing looked wrong: a screenshot shows a small chip
     near a bar, correctly sized, correctly padded, quietly losing its lower half.
     THE TORCH WAS THE OTHER HALF. It was pinned at bottom:150px, an inch above a shutter that
     lived at 30; the bar moved the shutter to 128 and the two became the same rectangle. The
     founder photographed a flash icon inside the capture ring on 2026-08-29.
     ⚠️ AND THAT IS WHY THIS ASSERTS AGAINST THE SHUTTER, NOT AGAINST A CONSTANT. Both bugs
     were an offset measured once against furniture that later moved. A test that hard-codes
     150 learns nothing the third time somebody lifts the row. */
  const p = await boot({ arm: 'camera' });
  await p.waitForTimeout(400);
  const row = await p.evaluate(() => {
    const st = document.getElementById('start'); if (st) st.style.display = 'none';
    const n = document.getElementById('kNav'), sw = document.getElementById('shutterWrap');
    if (!n || !sw) return { missing: !n ? 'nav' : 'shutter' };
    sw.style.display = 'block';
    const d = (el) => !el ? 'nothing' : el.id ? '#' + el.id
      : '.' + String(el.className.baseVal || el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    const nr = n.getBoundingClientRect(), sr = sw.getBoundingClientRect();
    const one = (id) => {
      const b = document.getElementById(id); if (!b) return { id, gone: true };
      b.style.display = 'flex';
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height) return { id, collapsed: true };
      /* The picker is 23px with a 44px ::after pad centred on it; the pad is what a thumb
         actually lands on, so that is the box to hit-test, not the painted square. */
      const pad = 44, cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const box = { x: cx - pad / 2, y: cy - pad / 2, w: pad, h: pad };
      return { id,
        onBar: !(r.bottom <= nr.top || r.top >= nr.bottom),
        padOnBar: !(box.y + box.h <= nr.top || box.y >= nr.bottom),
        onShutter: !(r.bottom <= sr.top || r.top >= sr.bottom || r.right <= sr.left || r.left >= sr.right),
        side: cx < innerWidth / 2 ? 'left' : 'right',
        pts: [[0.5, 0.5], [0.5, 0.12], [0.5, 0.88]].map(([fx, fy]) => {
          const el = document.elementFromPoint(box.x + box.w * fx, box.y + box.h * fy);
          return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }) };
    };
    return { pick: one('btnPhoto'), light: one('btnLight'),
             navTop: Math.round(nr.top), shutTop: Math.round(sr.top) };
  });
  if (row.missing) bad('the camera row could not be measured: ' + JSON.stringify(row));
  else for (const b of [row.pick, row.light]) {
    const name = b.id === 'btnPhoto' ? 'the photo picker' : 'the flash';
    if (b.gone || b.collapsed) { bad(`${name} could not be measured: ` + JSON.stringify(b)); continue; }
    !b.onBar && !b.padOnBar
      ? ok(`${name} sits clear of the bar, hit pad included`)
      : bad(`${name} ${b.onBar ? 'overlaps' : 'has its 44px hit pad under'} the tab bar `
          + '— present, visible, and losing taps to a bar at z-index 9500');
    !b.onShutter
      ? ok(`and clear of the capture button`)
      : bad(`${name} is ON the shutter — this is the flash-inside-the-capture-ring bug`);
    const blocked = b.pts.filter((h) => !h.ours);
    blocked.length === 0
      ? ok(`and a thumb reaches ${name} top, middle and bottom`)
      : bad(`${name} is covered at ` + blocked.map((h) => h.at).join(', '));
  }
  /* ONE CONTROL PER CORNER, WHICH IS THE WHOLE REASON THE PICKER MOVED. The founder asked for
     the flash on the left; the left is where the picker was. They cannot share it — the note
     on #btnPhoto refused a stack in that corner years before this — so the picker took the
     slot the feed button had just vacated. If a later change puts them back on the same side
     the screen is lopsided and one of them is on the shutter again. */
  if (!row.missing && !row.pick.gone && !row.light.gone) {
    row.light.side === 'left' && row.pick.side === 'right'
      ? ok('flash left, shutter centre, library right — one control per corner')
      : bad(`both bottom controls are on the same side (flash:${row.light.side}, `
          + `picker:${row.pick.side}) — one of them is about to be under the shutter`);
  }
  await p.close();
}

/* ── ③d THE TOAST MUST NEVER LAND ON THE SHUTTER ───────────────────────────────────────── */
{
  console.log('\n— the message toast clears the capture button —');
  /* Same class of bug, third instance on one screen: #chToast was pinned at bottom:126px,
     which cleared a shutter at 30. The bar moved the shutter to 128 and the toast printed
     itself inside the capture ring — the founder's photograph, 2026-08-29.
     ⚠️ THE CALLER THAT WAS PHOTOGRAPHED IS GONE. That was the session recap, removed the same
     day at the founder's request; the hint-pack unlock is the only caller left and it fires
     inside a round, never over a shutter. So this asserts a rule nothing currently trips —
     deliberately, because #chToast is a SHARED surface with one fixed position whose default
     is still measured against a shutter that moved, and the next thing worth saying on the
     camera would land on the button exactly as the recap did.
     ⚠️ WHICH IS ALSO WHY THE ELEMENT IS BUILT BY HAND, AND THE PROBE SAYS SO OUT LOUD. There
     is no caller to stage. That makes the GEOMETRY real — the rule is the app's, the shutter
     is the app's, the bar is the app's — and nothing else is claimed: this block asserts
     placement and says nothing about any copy, because a test that read back a string it had
     just written would be asserting nothing.
     The rule itself lives in the main <style> rather than being injected on first use, which
     is what makes it readable at all on a camera that has never opened the feed. */
  const p = await boot({ arm: 'camera' });
  await p.waitForTimeout(400);
  const geo = await p.evaluate(() => {
    const st = document.getElementById('start'); if (st) st.style.display = 'none';
    const sw = document.getElementById('shutterWrap');
    const n = document.getElementById('kNav');
    if (!sw || !n) return { missing: true };
    sw.style.display = 'block';
    const d = document.createElement('div'); d.id = 'chToast'; d.className = 'on';
    d.innerHTML = '<b>x</b><span>y</span>';
    document.body.appendChild(d);
    const r = d.getBoundingClientRect(), sr = sw.getBoundingClientRect();
    const out = { onShutter: !(r.bottom <= sr.top || r.top >= sr.bottom),
                  above: Math.round(sr.top - r.bottom),
                  navOn: document.body.classList.contains('nav-on') };
    d.remove();
    return out;
  });
  if (geo.missing) bad('no camera to measure the recap against');
  else {
    geo.navOn
      ? ok('the camera carries nav-on, which is what the recap hangs its lift on')
      : bad('no nav-on class on the camera — the recap keeps its old 126px and lands on the shutter');
    /* ⚠️ A GAP, NOT MERELY "NO OVERLAP" — the same correction the shutter's own assertion
       needed. Two rectangles that miss each other by 12px read as one crowded pile on a
       phone, which is how the Capture label got onto the bar at 86px and passed. */
    !geo.onShutter && geo.above >= 16
      ? ok(`the recap sits above the capture button (${geo.above}px clear)`)
      : bad(`the session recap ${geo.onShutter ? 'is printed ON' : 'is only ' + geo.above
          + 'px above'} the shutter — the founder photographed the first version of this on `
          + '2026-08-29');
  }
  await p.close();
}

/* ── ④ THE GLASS, AND THE THING IT MUST NEVER COST ─────────────────────────────────────── */
{
  console.log('\n— the glass adds, and never subtracts —');
  /* ⚠️ backdrop-filter TAKES ONE VALUE. A browser that rejects `url(#kGlass)` drops the whole
     declaration — the blur and the saturation with it — leaving a transparent strip over
     somebody's photograph, which is far worse than plain frosted glass. WebKit's support for
     SVG filters on backdrops is exactly the uneven part, and this app IS a WKWebView. So the
     base rule owns the blur unconditionally and the refraction is only ever an added class.
     This asserts the property, not the pixels: whatever the environment decides about the
     filter, the bar still blurs. */
  const p = await boot({ arm: 'feed' });
  await p.waitForTimeout(500);
  const g = await p.evaluate(() => {
    const n = document.getElementById('kNav');
    if (!n) return null;
    const cs = getComputedStyle(n);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
    return { bf, glass: n.classList.contains('glass'),
             filterEl: !!document.getElementById('kGlass'),
             supports: !!(window.CSS && CSS.supports && CSS.supports('backdrop-filter', 'url(#k) blur(1px)')) };
  });
  g ? ok(`the bar reports a backdrop (${JSON.stringify(g.bf).slice(0, 70)})`) : bad('no bar to measure');
  /blur\(/.test(g && g.bf || '')
    ? ok('and it blurs whatever the environment decided about the filter')
    : bad(`the backdrop lost its blur: ${JSON.stringify(g && g.bf)} — this is the failure the `
        + 'feature test exists to prevent, a transparent strip over a photograph');
  /* The class and the filter element travel together: one without the other is either a
     reference to nothing or a filter nobody uses. */
  (g && g.glass === g.filterEl)
    ? ok(`the refraction class and its filter agree (${g.glass ? 'both on' : 'both off'})`)
    : bad(`class ${g && g.glass} but filter element ${g && g.filterEl}`);
  (!g.glass || g.supports)
    ? ok('and the class is only added where the chained value is actually supported')
    : bad('the glass class was added without a feature test passing');
  await p.close();
}

/* ⑨ THE LINK ROUND, AND THE ONE PLACE THE RULE HAD TO STOP.
   navShouldShow() drops the bar on CH_SEEK, which is right for the stranger following a
   friend's link in Safari: nothing is installed and the tabs lead nowhere. Inside the app the
   same rule is a trap, and the widget is how it surfaced — KamoWidget opens
   https://playkamo.com/h/<id>, the share-link route, so tapping your own widget landed you in
   a link round with no camera, no feed and no board. Both halves are asserted because either
   one alone reads as correct. */
async function linkRoundBar() {
  console.log('\n⑨ A LINK ROUND KEEPS THE BAR INSIDE THE APP, AND DROPS IT IN A BROWSER');
  const web = await boot({ seek: true });
  await seekUp(web)
    ? ok('a share link opens its round in the browser')
    : bad('the browser link round never mounted — the case below would assert nothing');
  const webBar = await web.evaluate(() => {
    const n = document.getElementById('kNav');
    return { shown: !!n && getComputedStyle(n).display !== 'none', cls: document.body.classList.contains('nav-on') };
  });
  !webBar.shown && !webBar.cls
    ? ok('and a browser gets no tab bar — the tabs lead nowhere for somebody with no app')
    : bad(`the browser link round showed the bar (display shown=${webBar.shown}, nav-on=${webBar.cls})`);
  await web.close();

  const app = await boot({ seek: true, wrapper: true });
  const appBar = await app.evaluate(() => {
    const n = document.getElementById('kNav');
    const r = n && n.getBoundingClientRect();
    return {
      shown: !!n && getComputedStyle(n).display !== 'none',
      cls: document.body.classList.contains('nav-on'),
      tabs: n ? [...n.querySelectorAll('[data-tab]')].map(b => b.dataset.tab) : [],
      box: r ? Math.round(r.width) : 0,
    };
  });
  appBar.shown && appBar.box > 0
    ? ok(`the same round inside the app keeps its bar (${appBar.tabs.join('/')})`)
    : bad('the widget trap is still there — a link round in the app has no way out');
  /* The lift class is not decoration: body.nav-on is what moves .chQuit and .chHint above the
     bar. A bar shown without it puts the give-up button underneath — present, visible and
     untappable, the shape this product has already paid for three times. */
  appBar.cls
    ? ok('and body.nav-on is set, so the round\'s own controls lift above it')
    : bad('the bar is up without body.nav-on — give-up and hint are sitting under it');
  await app.close();
}
await linkRoundBar();

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} tab-bar check(s) failed` : '\n✓ the tab bar is where it belongs, and out of the way where it is not');
process.exit(failed ? 1 : 0);
