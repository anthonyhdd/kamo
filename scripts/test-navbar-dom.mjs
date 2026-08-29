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
async function boot({ arm = 'feed', everAsked = true, seek = false, feedFails = false, replies = null, mine = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
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

  /* AND BACK. The camera tab closes the board and the feed underneath it. */
  await f.evaluate(() => document.querySelector('#kNav [data-tab="cam"]').click());
  await f.waitForTimeout(600);
  const home = await f.evaluate(() => ({
    board: !!document.querySelector('.chBoardWrap.show'),
    feed: !!document.querySelector('.kfBar'),
    board_el: !!document.getElementById('board'),
  }));
  (!home.board && !home.feed && home.board_el)
    ? ok('the camera tab lands on the capture screen, with the board and the feed closed')
    : bad('after the camera tap: ' + JSON.stringify(home));
  (await seen(f)).shown ? ok('and the bar is still there') : bad('the bar vanished on the camera screen');
  await f.close();
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
      pts: [[0.5, 0.5], [0.5, 0.14], [0.5, 0.86]].map(([fx, fy]) => {
        const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
        return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }),
    };
  });
  if (sh.missing || sh.collapsed) bad('the shutter could not be measured: ' + JSON.stringify(sh));
  else {
    !sh.overlap
      ? ok('the shutter sits clear of the bar')
      : bad('the shutter and the tab bar share the same band of screen');
    const blocked = sh.pts.filter((h) => !h.ours);
    blocked.length === 0
      ? ok('and a thumb reaches it top, middle and bottom')
      : bad('the SHUTTER is covered at ' + blocked.map((h) => h.at).join(', ')
          + ' — the tab bar is sitting on the capture button, which is the entry point of the '
          + 'entire product');
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

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} tab-bar check(s) failed` : '\n✓ the tab bar is where it belongs, and out of the way where it is not');
process.exit(failed ? 1 : 0);
