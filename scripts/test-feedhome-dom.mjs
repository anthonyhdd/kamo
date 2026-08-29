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

/* ── ① the two arms actually differ, and only in what is in front ────────────────────────── */
{
  console.log('\n— the arm decides what is in front, and nothing else —');
  const f = await boot({ arm: 'feed' });
  (await feedUp(f)) ? ok('"feed" opens on the feed') : bad('"feed" did not open the feed');
  (await cameraBooted(f)) ? ok('and the camera is booted underneath it, so closing lands on compose')
                          : bad('the feed arm has no camera behind it — closing the feed strands the user');
  await f.close();

  const c = await boot({ arm: 'camera' });
  (await feedUp(c)) === false ? ok('the 15% holdout still opens on the camera') : bad('THE HOLDOUT LEAKED — it opened on the feed, and the only contemporary control group is now empty');
  (await cameraBooted(c)) ? ok('with the camera in front, exactly as it shipped yesterday') : bad('the holdout lost its camera');
  await c.close();
}

/* ── ② a share link outranks the home, at any rollout ────────────────────────────────────── */
{
  console.log('\n— a share link is not a session to redirect —');
  const p = await boot({ arm: 'feed', seek: true });
  const [s, f] = [await seekUp(p), await feedUp(p)];
  (s && !f) ? ok('?h= still lands on the sender\'s hide, not on a feed of strangers')
            : bad(`a share link was diverted (seeker=${s} feed=${f}). Somebody was handed a specific `
                + 'kamo and got somebody else\'s instead — the one thing this rollout may never do.');
  await p.close();
}

/* ── ③ a first launch is never diverted ──────────────────────────────────────────────────── */
{
  console.log('\n— a device that has never been here keeps its hero —');
  const p = await boot({ arm: 'feed', everAsked: false });
  (await feedUp(p)) === false
    ? ok('no camEverAsked, no feed — the hero, the priming line and the permission sheet survive')
    : bad('a FIRST LAUNCH was dropped onto the feed. Strangers\' photographs with nothing saying '
        + 'this is a camera, and a permission prompt raised behind a feed being read.');
  await p.close();
}

/* ── ④ THE ROLLOUT MAY COST THE DOOR, IT MAY NOT COST THE APP ────────────────────────────── */
{
  console.log('\n— the feed failing lands on the camera —');
  const p = await boot({ arm: 'feed', feedFails: true });
  const cam = await cameraBooted(p);
  const errs = p.__errs;
  cam ? ok('with the feed\'s own RPC unseeded, the camera is still there and the app is usable')
      : bad('the feed failed and took the app with it — this is a blank screen for 85% of the '
          + 'fleet, on a file that deploys on push');
  errs.length === 0 ? ok('and nothing threw on the boot line') : bad('page error during boot: ' + errs[0]);
  await p.close();
}
/* Static, because the runtime case above can only prove the ONE failure it simulates. What has
   to stay true is the shape: the camera boots first, and the feed call is wrapped. */
{
  /* ANCHORED ON chSeek(), not on a bare `else {` — this file has dozens of those and the first
     version of this assertion matched one of them, went red against correct code, and would
     have taught the next reader that the check is noise. */
  const i = real.indexOf('if(CH_SEEK){ chSeek(); }');
  const blk = i < 0 ? '' : real.slice(i, i + 2200);
  /* ⚠️ ANCHORED ON THE CALL, NOT ON ITS ARGUMENTS. This matched the literal
     chFeed({src:"launch"}) until 2026-08-29, when the launch gained a step — it now asks
     whether a reply is waiting and opens the feed ON it. The assertion went red against
     correct code, which is how a guard starts reading as noise. What it protects is the
     SHAPE, so it is written against the shape: the camera boots first, and whatever opens
     the feed is inside a try. Renaming that call again must not cost a red. */
  const call = /(chFeedFromLaunch\(\)|chFeed\(\{src:"launch"[^)]*\}\))/;
  const m = blk.match(call);
  const shaped = !!m && /bootCamera\(\)\s*;/.test(blk)
    && blk.indexOf('bootCamera()') < blk.indexOf(m[0])
    && new RegExp('try\\s*\\{[^}]*' + m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^}]*\\}\\s*catch').test(blk);
  shaped
    ? ok('bootCamera() still runs BEFORE the feed, and the feed call is still wrapped')
    : bad('the boot line lost its shape — either bootCamera() no longer runs first, or the '
        + 'chFeed() call is no longer inside a try. Both mean a throw here is a blank app for '
        + 'everyone at once, which is the 2026-08-06 outage with a different cause.');
}

/* ── ⑤ THE ONLY DOOR TO CREATION, AND A THUMB HAS TO REACH IT ────────────────────────────── */
{
  console.log('\n— the door out of the feed is the camera tab, and can be pressed —');
  /* ⚠️ THE DOOR MOVED ON 2026-08-29 AND THIS BLOCK FOLLOWED IT RATHER THAN BEING DELETED.
     It used to guard a 38px circle in the feed's top bar (#kfClose). The tab bar now owns that
     door and the circle is gone — two ways to one screen, one of them a corner button, is a
     choice nobody asked to make. What this block protects is unchanged and is the reason it
     exists: at 85% the feed is the launch, so this is the only route to creation most of the
     fleet ever sees, and it has to be reachable by a thumb.
     ⚠️ HIT-TESTED WITH elementFromPoint, NEVER ASSERTED IN THE DOM. This app has lost a button
     to something merely sitting near it TWICE — the feed's own .kfHint pill on 08-20 (-62% on
     sends) and the landing arm on 08-22 (halved) — and both shipped with the control present,
     visible, and untappable. A tab bar pinned to the bottom of every screen is exactly the
     shape of that failure, so it is tested the only way that catches it. */
  const p = await boot({ arm: 'feed' });
  const door = await p.evaluate(() => {
    const b = document.querySelector('#kNav [data-tab="cam"]');
    if (!b) return { missing: true };
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { collapsed: true, why: {
      nav: !!document.getElementById('kNav'),
      navDisp: document.getElementById('kNav') && document.getElementById('kNav').style.display,
      chS: !!document.querySelector('.chS'),
      kf: !!(window.kfState),
      start: (() => { const e = document.getElementById('start'); return e ? getComputedStyle(e).display : 'none'; })(),
      blockers: ['shareSheet','paywall','confirmSheet','kamoPlus','kamoHome']
        .filter((id) => { const e = document.getElementById(id); return e && e.classList.contains('show'); }),
    } };
    if (r.y < 0 || r.y + r.height > innerHeight) return { offscreen: Math.round(r.y) };
    const d = el => !el ? 'nothing' : el.id ? '#' + el.id
      : '.' + String(el.className.baseVal || el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return { svg: !!b.querySelector('svg'), text: (b.textContent || '').trim(), label: b.getAttribute('aria-label'),
             gone: !document.getElementById('kfClose'),
             rect: { w: Math.round(r.width), h: Math.round(r.height) },
             hits: [[0.5, 0.5], [0.16, 0.5], [0.84, 0.5]].map(([fx, fy]) => {
               const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
               return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }) };
  });
  if (door.missing) bad('the camera tab is gone — the feed has no way out and no way to create');
  else if (door.collapsed) bad('the camera tab has no box — ' + JSON.stringify(door.why));
  else if (door.offscreen !== undefined) bad(`the camera tab sits at y=${door.offscreen}, outside the viewport`);
  else {
    (door.svg && !door.text.includes('✕'))
      ? ok(`it is a camera glyph, not a ✕ (aria-label ${JSON.stringify(door.label)})`)
      : bad('the door is a ✕. At 85% this is the only creation door most of the fleet has, '
          + 'and a ✕ names what it leaves rather than what it opens.');
    door.gone
      ? ok('and the old corner circle is gone, so there is one door and not two')
      : bad('#kfClose is still in the feed bar next to the tab that replaced it');
    const blocked = door.hits.filter(h => !h.ours);
    blocked.length === 0
      ? ok(`and a thumb reaches it across its whole width (${door.rect.w}x${door.rect.h})`)
      : bad(`the camera tab is covered at ${blocked.length} of 3 points — a thumb lands on `
          + blocked.map(h => h.at).join(', ') + '. This app has lost a button to exactly that '
          + 'twice: the feed\'s own .kfHint pill on 08-20 and #chStage on 08-23.');
  }
  await p.close();
  /* And it is on the holdout too — shipping the affordance inside the arm would move two
     things at once and settle neither. */
  const h = await boot({ arm: 'camera' });
  await h.evaluate(() => document.getElementById('btnFeed').click());
  await h.waitForTimeout(800);
  (await h.evaluate(() => { const b = document.querySelector('#kNav [data-tab="cam"]'); return !!(b && b.querySelector('svg')); }))
    ? ok('the holdout gets the same tab bar — the arm moves the destination, not the affordance')
    : bad('the holdout has no camera tab: the arm now changes two things at once');
  await h.close();
}

/* ── ⑥ the kill switch reaches devices that already stored "feed" ────────────────────────── */
{
  console.log('\n— the kill is real —');
  const m = /const HOME_FEED_ROLLOUT=(\d+);/.exec(real);
  const guard = /if\(HOME_FEED_ROLLOUT<=0\)\s*homeArm="camera";/.test(real);
  (m && guard)
    ? ok(`rollout is ${m[1]}, and a stored "feed" is overridden when it goes to 0`)
    : bad('HOME_FEED_ROLLOUT has no <=0 override, so setting it to 0 would leave every device '
        + 'that already stored "feed" on the feed forever — a kill switch that kills nothing.');
}

if (process.env.SHOT) {
  const p = await boot({ arm: 'feed' });
  await p.screenshot({ path: process.env.SHOT });
  await p.close();
  console.log('  · screenshot -> ' + process.env.SHOT);
}

/* ── ⑤ a reply that waited is the feed's first slide, not a grey dot ───────────────────── */
{
  console.log('\n— a reply that waited is opened, not announced —');
  /* ⚠️ THE REGRESSION THIS FIXES WAS INVISIBLE. chReplyCheck opens the player card over an
     idle launch, and chHomeIdle() returns false the moment kfState exists — the feed outranks
     it, correctly, because taking the screen from a feed somebody opened is an interruption.
     But since 2026-08-27 the feed IS the launch for 85 of every 100 returning devices, so
     kfState is set before the reply check resolves. The auto-open stopped firing for them and
     nothing threw: the guard did exactly what it was written to do, to a screen that had
     changed underneath it. 1138 replies in 30 days, 891 with no push token behind them. */
  const REPLY = { id: 'replyhide0000001', reply_to: 'mine000000000001', name: 'po',
                  img_path: 'x.jpg', created_at: '2099-01-01T00:00:00Z' };
  const p = await boot({ arm: 'feed', mine: ['mine000000000001'], replies: [REPLY] });
  const asked = await p.evaluate(() => (window.__rpc || []).some(c => c[0] === 'my_replies'));
  asked ? ok('the launch asks whether anything is waiting') : bad('my_replies was never called on the boot path');

  /* ⚠️ ASSERTED ON THE FETCH, NOT ON "my_replies was called". A first version checked only
     that the launch asked and that a feed appeared — both of which stay true when the reply
     is thrown away — so disabling the whole feature left it green. chFeed({first}) seeds
     slide 0 by fetching that hide BY ID, exactly as the tray tile does, so the id going over
     the wire is the behaviour. */
  const seeded = await p.evaluate((id) => (window.__rpc || [])
    .some(c => c[0] === 'get_hide' && c[1] && String(c[1].p_id || c[1].id || '') === id), REPLY.id);
  seeded
    ? ok('the waiting reply is fetched by id and seeded as slide 0 — it is opened, not announced')
    : bad('the launch never fetched the waiting reply: it opened an ordinary feed and left the '
        + 'reply behind a grey dot, which is the regression this exists to prevent');
  (await p.evaluate(() => !!document.querySelector('.kfBar')))
    ? ok('and the feed still opens') : bad('the feed did not open on the reply path');
  await p.close();

  /* NO REPLY, NO ROUND TRIP, NO CHANGE. A device that never published must not pay for this
     on every launch, and the ordinary open has to look exactly like it did yesterday. */
  const q = await boot({ arm: 'feed', mine: null, replies: [] });
  const askedNone = await q.evaluate(() => (window.__rpc || []).some(c => c[0] === 'my_replies'));
  askedNone === false
    ? ok('a device that never published skips the call entirely')
    : bad('my_replies was called for a device with no hides of its own');
  (await feedUp(q)) ? ok('and its feed opens exactly as before') : bad('the no-reply launch lost its feed');
  await q.close();

  /* AN EMPTY ANSWER IS NOT A REPLY. The high-water mark and the empty list must both land on
     the ordinary feed rather than on a first slide that does not exist. */
  const r = await boot({ arm: 'feed', mine: ['mine000000000001'], replies: [] });
  (await feedUp(r)) ? ok('an empty answer still opens the ordinary feed') : bad('an empty my_replies broke the launch');
  r.__errs.length === 0 ? ok('and nothing threw on the boot path') : bad('boot errors: ' + JSON.stringify(r.__errs.slice(0, 2)));
  await r.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} feed-home check(s) failed` : '\n✓ the feed is home, the holdout holds, and the app survives the feed failing');
process.exit(failed ? 1 : 0);
