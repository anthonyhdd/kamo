#!/usr/bin/env node
/**
 * THE CARD ON SLIDE 4 — the feed's first ask, and the four ways it goes wrong in silence.
 *
 * It exists because 69% of feed openings die on the first slide and the people who survive
 * that far are the ones who publish: feed_opened → hide_published converts at 10.3% with a
 * median of 94 seconds, which is three or four slides. So the ask rides slide 4.
 *
 * Every failure mode here looks fine on screen and throws nothing:
 *
 *   - SHOWN TO A CREATOR. The sentence is "your turn" — said to somebody with forty hides it
 *     is an insult and a bug. chMine() is the only local record of having published, and a
 *     storage that throws must take the card AWAY, never show it.
 *   - SHOWN TO THE CONTROL ARM. The whole point of the holdout is that half the devices meet
 *     nothing. An arm that leaks is not a smaller effect, it is no measurement at all — and
 *     nothing on screen would say so.
 *   - UNDERNEATH THE PAYWALL. The first offer fires on slide 3 and lands full-screen. A card
 *     mounted under it files feed_gate_shown for an impression nobody saw, and the only ratio
 *     the card has — tapped over shown — quietly deflates. It must wait, and it must NOT give
 *     up: a card deferred once and never retried is a card the session never gets.
 *   - COUNTING THE TAP TWICE. The CTA leaves the feed through close(), which is also where a
 *     card still on screen is filed as passed. Shown = tapped + passed or the ratio is fiction.
 *
 * And one that is not about measurement at all: the photo under the card is a LIVE round, so
 * a tap that does not stop propagating also lands on the scene as a guess and books a miss on
 * the way out.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feedgate-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the feed-gate test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Stubbed at the declaration, not appended: chFeed() fetches its first page the moment it is
   called, so a hook added at the end of the module is already too late. */
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
/* THE SECOND HOOK IS NOT REDUNDANT. track() is recorded at its own first line, which is
   BEFORE the object carrying trial_arm, plan_arm and gate_arm is built — so __tr answers
   "which events fired, with what the caller passed" and nothing about the arm. chWebTrack()
   receives the finished payload, and in a plain browser (no wrapper, no bridge) every event
   reaches it. That is the only place the assignment record is observable. */
html = html.replace('function chWebTrack(event,props){',
  'function chWebTrack(event,props){window.__sent=window.__sent||[];window.__sent.push([event,props]);');
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

/* Eight strangers' hides — enough to scroll past slide 4 without the queue running dry and
   turning this into a test of the second lap. None of them is this device's own. */
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: null,
  n_attempts: i, n_found: 0, created_at: '2026-08-16T10:0' + i + ':00Z',
}));

/**
 * A feed opened by a device with the arm, the hide list and the first offer in a known state.
 *
 * `arm` is what the coin already landed on — seeded, never flipped, so the test is not
 * measuring Math.random(). `mine` is this device's published hides: empty is the only state
 * the card is for. `firstOffer:'spent'` marks the paywall's one-per-install offer as already
 * made, which is what most devices reaching slide 4 actually look like; 'pending' leaves it
 * armed so the collision on slide 3 is the thing under test.
 */
async function open({ arm = 'on', mine = [], seen = false, firstOffer = 'spent' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = {
      feed_page: a.rows,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: null },
      log_skip: null,
      log_attempt: null,
    };
    localStorage.setItem('kamo_feed_gate_arm', a.arm);
    if (a.mine.length) localStorage.setItem('kamo_hides', JSON.stringify(a.mine));
    if (a.seen) localStorage.setItem('kamo_feed_gate_seen', '1');
    if (a.firstOffer === 'spent') localStorage.setItem('kamo_pw_first', '1');
    localStorage.setItem('kamo_feed_swiped', '1');   // no teaching hint in the way
  }, { rows: ROWS, arm, mine, seen, firstOffer });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__chFeed({}));
  await page.waitForTimeout(900);
  return page;
}

/* ⚠️ EACH SWIPE HAS TO LAND BEFORE THE NEXT ONE IS ISSUED, and this file has now been wrong
   about that twice. First it slept a flat 1100ms, so two `scrollTop +=` could be in flight at
   once and coalesce. Then it waited for the scrollbar to ARRIVE at one viewport further on —
   which still ends a slide short, two ways, both silent:
     - `+= clientHeight` compounds. If the previous swipe's snap had not settled, the read is
       mid-slide, so the target is mid-slide, and the snap resolves to whichever edge is
       nearer — sometimes the one it came from. The swipe is spent and the feed has not moved.
     - the arrival wait `.catch`es its own timeout, so a swipe that never landed and one that
       did are the same thing to everything downstream.
   THE COUNT OF SLIDES IS WHAT EVERY ASSERTION HERE IS INDEXED ON. The gate is armed from
   `S.played >= 4`, so a run that ends on slide 3 has no card armed and no wait however long
   will produce one: a waitForSelector held for 8s in the section below and the card still
   never came, because nothing had asked for it. Which is why waiting for the SCROLLBAR is the
   wrong thing to wait for at all — the app registering the slide is the thing, and it says so
   itself with `feed_slide`, emitted from the same block that arms the gate's 900ms timer. */
async function swipe(page, n = 1) {
  for (let i = 0; i < n; i++) {
    /* ONE ABSOLUTE TARGET, HELD UNTIL THE FEED AGREES. Setting scrollTop once and waiting is
       what kept failing: instrumented, a lost swipe reads
       {"top":3376,"h":844,"scroll":6752,"slides":8,"slid":[1,2,3,4,5]} — eight slides mounted,
       room to scroll, and the scroller sitting exactly one slide BELOW where it was put. The
       swipe was not lost, it was reverted; scroll-snap resolves a programmatic jump against a
       layout that is still settling and can land back on the slide it came from, and every
       read after that is then answering about the wrong slide.
       So the target is computed ONCE, outside the wait, and re-applied on each poll until the
       app's own counter moves. Re-applying a fixed number is idempotent — it cannot walk the
       feed forward past the slide asked for, which recomputing the index inside the loop
       would. The exit condition is `feed_slide`, not the scrollbar: that event is emitted from
       the same block that arms the gate's 900ms timer, so it is the app registering the slide
       in the sense every assertion here depends on. */
    const to = await page.evaluate(() => {
      const s = document.getElementById('kfScroll');
      const idx = Math.round(s.scrollTop / s.clientHeight) + 1;
      return { want: (window.__tr || []).filter(e => e[0] === 'feed_slide').length + 1,
               top: idx * s.clientHeight };
    });
    const landed = await page.waitForFunction((t) => {
      const s = document.getElementById('kfScroll');
      if (!s) return false;
      if ((window.__tr || []).filter(e => e[0] === 'feed_slide').length >= t.want) return true;
      if (Math.abs(s.scrollTop - t.top) > 4) s.scrollTop = t.top;
      return false;
    }, to, { timeout: 20000, polling: 250 }).then(() => true, () => false);
    /* A LOST SWIPE IS REPORTED AS A LOST SWIPE. Every other wait in this file `.catch`es its
       own timeout, which is right for the reads — a card that never mounts should fail as the
       assertion it is, not as an uncaught throw — and wrong here: a swipe that did not land is
       not an assertion at all, it makes every read after it meaningless, and they then fail as
       if the gate were broken. Three reds, one cause, and the cause not among them. The
       scroller's own numbers come with it, because "never landed" has several lookalike causes
       — never moved, snapped back, ran out of slides — and printing them makes the next
       occurrence a diagnosis rather than a rerun. */
    if (!landed) {
      const st = await page.evaluate(() => {
        const s = document.getElementById('kfScroll');
        return s ? { top: s.scrollTop, h: s.clientHeight, scroll: s.scrollHeight,
                     slides: s.querySelectorAll('.kfSlide').length,
                     slid: (window.__tr || []).filter(e => e[0] === 'feed_slide').map(e => e[1] && e[1].n) }
                 : { missing: true };
      });
      bad(`swipe ${i + 1} of ${n} never landed — no feed_slide ${to.want} in 20s: ${JSON.stringify(st)}`);
    }
    /* Registering the slide is what STARTS the gate's 900ms timer, so the beat stays after it. */
    await page.waitForTimeout(1100);
  }
}
const card = page => page.evaluate(() => {
  const g = document.querySelector('.kfGate');
  return g ? (g.textContent || '').trim() : null;
});
const evs = (page, name) => page.evaluate(n => (window.__tr || []).filter(e => e[0] === n), name);

console.log('\nTHE CARD MEETS SOMEBODY WHO HAS NEVER MADE ONE, ON SLIDE 4');
{
  const page = await open();
  await card(page) === null ? ok('nothing on the first slide — one photo is a glance, not a session')
                            : bad('the card was up before the user had seen anything');
  await swipe(page, 2);
  await card(page) === null ? ok('and nothing on the third — the ask sits behind the offer, not next to it')
                            : bad('the card appeared before slide 4');

  await swipe(page);
  /* WAIT FOR THE CARD, for the same reason the third section below already does. The two
     negative reads above must NOT wait — a card that is absent is what they assert — but this
     one is positive, and swipe()'s 1100ms sleep is only 200ms clear of the gate's own 900ms
     timer, which does not even start until the feed has registered the slide. When it does not
     clear, all THREE assertions in this section fail together: the card text, feed_gate_shown,
     and "the card replaced the round" (that last one reads `.kfGate` too, so a missing card
     fails it as a behavioural claim it never tested). Three reds, one cause, none of them the
     gate. Reproduced 2 runs in 5 here on 2026-08-23, and once on CI, against 0 in 5 on the
     unchanged tree — small numbers either way, which is exactly why this waits instead of
     being argued about. `.catch` keeps a card that genuinely never mounts as the readable
     assertion below rather than an uncaught timeout. */
  await page.waitForSelector('.kfGate', { timeout: 20000 }).catch(() => {});
  const t = await card(page);
  t && /Make one/.test(t) ? ok('slide 4 asks, in a card the thumb can pass')
                          : bad(`no card on slide 4: ${JSON.stringify(t)}`);

  const shown = await evs(page, 'feed_gate_shown');
  shown.length === 1 && shown[0][1] && shown[0][1].n === 4
    ? ok('and it is counted once, carrying the slide it landed on')
    : bad(`feed_gate_shown fired ${shown.length} times: ${JSON.stringify(shown.map(e => e[1]))}`);

  /* THE ROUND UNDER IT IS STILL THERE. That is the whole difference between this and a wall:
     the card is a child of the slide, mounted alongside the round's host, not in place of it.
     Asserted on the host rather than on a painted canvas because the photos 404 in this
     harness — a bitmap that never arrives would fail this for a reason that is not the card. */
  const over = await page.evaluate(() => {
    const g = document.querySelector('.kfGate');
    const sl = g && g.closest('.kfSlide');
    return !!(sl && sl.querySelector('.kfHost'));
  });
  over ? ok('the hide underneath keeps its round — the card sits over it, not in place of it')
       : bad('the card replaced the round instead of sitting over it');
  await page.close();
}

console.log('\nA TAP LEAVES FOR THE CAMERA, AND IS COUNTED ONCE');
{
  const page = await open();
  await swipe(page, 3);
  /* WAIT FOR THE CARD BEFORE CLICKING IT. This block opens a FRESH page — the section above
     proved the gate mounts, but on its own page, and nothing here had established that this
     one had caught up. So querySelector could return null and the whole suite died on
     "Cannot read properties of null (reading 'click')" — not a failed assertion, an
     uncaught throw, which reads in CI as the feature being broken rather than the test
     racing it. Measured on an unchanged tree: 2 failures in 3 local runs, while the same
     commit had gone green on main twelve minutes earlier. Same idiom as the wait further
     down, which is the one place this file already got right. */
  const up = await page.waitForSelector('.kfGate button', { timeout: 20000 })
    .then(() => true, () => false);
  if (!up) bad('the card never mounted, so the tap below is not being tested');
  /* Guarded rather than assumed: without the card this line used to throw on a null, which
     ends the whole suite mid-section and reads in CI as the feature exploding. */
  if (up) await page.evaluate(() => document.querySelector('.kfGate button').click());
  await page.waitForTimeout(400);

  const tapped = await evs(page, 'feed_gate_tapped');
  tapped.length === 1 ? ok('the tap is filed') : bad(`feed_gate_tapped fired ${tapped.length} times`);

  const passed = await evs(page, 'feed_gate_passed');
  passed.length === 0
    ? ok('and never also as a thumb going by — the exit runs through close(), which files passes')
    : bad('the same card was counted as tapped AND passed, so shown ≠ tapped + passed');

  const gone = await page.evaluate(() => !document.getElementById('kfeed'));
  gone ? ok('and the feed is closed, which is what "Make one" promises')
       : bad('the CTA counted a tap and left the user in the feed');

  /* stopPropagation, stated as a number: the photo under the card is a live round and a tap
     that reaches it books a guess against a hide the user was leaving. */
  const guessed = await page.evaluate(() => (window.__tr || []).filter(e => e[0] === 'seek_tap').length);
  guessed === 0 ? ok('and the scene under it never took the tap as a guess')
                : bad(`the CTA also registered ${guessed} guess(es) on the way out`);
  await page.close();
}

console.log('\nA THUMB GOING PAST IS THE OTHER HALF OF THE RATIO');
{
  const page = await open();
  await swipe(page, 3);
  /* ⚠️ THESE THREE READS USED TO HAPPEN THE INSTANT swipe()'s 1100ms SLEEP EXPIRED, and on a
     loaded machine the feed had not finished reacting to the scroll yet. All three then fail
     together — "no card to scroll past", "feed_gate_passed fired 0 times", "the card
     survived" are three readings of one swipe that had not landed — which is exactly how
     this suite produced a random red in a gate that is otherwise green.
     Each read now waits for its OWN condition first, with the assertion left untouched
     underneath: a card that genuinely never mounts, an event that genuinely never fires and
     a card that genuinely outlives its slide all still fail, they just stop failing for
     being asked too early. The wait is inside the suite rather than in swipe() because the
     thing to wait for is the app reacting, not the scrollbar arriving — a settle-on-scroll
     wait was tried here first and is stricter than the app is, so it failed every run. */
  await page.waitForSelector('.kfGate', { timeout: 20000 }).catch(() => {});
  await card(page) !== null || bad('no card to scroll past');
  await swipe(page);
  await page.waitForFunction(
    () => (window.__tr || []).some(e => e[0] === 'feed_gate_passed'),
    { timeout: 20000 }).catch(() => {});
  const passed = await evs(page, 'feed_gate_passed');
  passed.length === 1 ? ok('scrolling on files it as passed, once')
                      : bad(`feed_gate_passed fired ${passed.length} times`);
  await page.waitForFunction(
    () => !document.querySelector('.kfGate'),
    { timeout: 20000 }).catch(() => {});
  await card(page) === null ? ok('and the card goes with the slide it belonged to')
                            : bad('the card survived the slide it was mounted on');
  const shown = await evs(page, 'feed_gate_shown');
  shown.length === 1 ? ok('and it is not asked again in the same session')
                     : bad(`feed_gate_shown fired ${shown.length} times in one session`);
  await page.close();
}

console.log('\nAND NOWHERE IT WOULD BE A LIE OR A LEAK');
{
  const control = await open({ arm: 'off' });
  await swipe(control, 5);
  await card(control) === null
    ? ok('the control arm meets nothing — a holdout that leaks measures nothing')
    : bad('the card rendered for the off arm');
  await control.close();

  const creator = await open({ mine: ['hide99'] });
  await swipe(creator, 5);
  await card(creator) === null
    ? ok('somebody who has already published is never told to make their first one')
    : bad('the card was shown to a device with hides of its own');
  await creator.close();

  const again = await open({ seen: true });
  await swipe(again, 5);
  await card(again) === null
    ? ok('and a device that has met it once is not asked again tomorrow')
    : bad('the card came back on a device that had already seen it');
  await again.close();
}

console.log('\nTHE PAYWALL COLLISION — DEFERRED, NEVER CANCELLED');
{
  /* THE SHEET IS PUT UP BY HAND, not by the offer that normally raises it. openPaywall()
     refuses to render prices the store never returned, and there is no store in this harness —
     driving the real offer here would test StoreKit plumbing and call it a card. What the card
     actually contracts with is the CLASS: kfGateWanted() reads `show` on #paywall and refuses
     while it is set. Setting it directly is that contract, and nothing else. */
  const page = await open();
  await page.evaluate(() => document.getElementById('paywall').classList.add('show'));
  await swipe(page, 3);
  /* LET THE REFUSAL ACTUALLY HAPPEN BEFORE LIFTING THE SHEET. The gate's timer is armed when
     slide 4 registers and fires 900ms later; swipe()'s own 1100ms leaves only 200ms of margin
     for it to fire and be turned away. Miss that window and the sheet comes down first, the
     timer fires into a clear screen, and the card mounts on slide 4 — n=4 instead of 5. That
     reads as "the deferral is broken" when what actually happened is that this run never
     deferred anything: the case under test did not run. Waiting is the only way to be sure it
     did, since a refusal leaves no trace to poll for — it is the absence of a mount. */
  await page.waitForTimeout(1200);
  const covered = await page.evaluate(() => document.getElementById('paywall').classList.contains('show'));
  covered ? ok('the first offer is up on slide 4, as it is for most of this arm')
          : bad('the sheet came down on its own — this case is not being tested');
  await card(page) === null
    ? ok('and no card mounts under it — an impression nobody saw is a denominator that lies')
    : bad('the card mounted underneath the paywall');

  await page.evaluate(() => document.getElementById('paywall').classList.remove('show'));
  await page.waitForTimeout(300);
  await swipe(page);
  /* Same wait, same reason, and here the margin is thinner still: this card is not the one
     armed on slide 4, it is the RETRY armed on slide 5 after the refusal — so it is 900ms
     behind a slide that itself only starts counting once the feed reacts. This is the read
     that failed locally on 2026-08-23 run 1. */
  await page.waitForSelector('.kfGate', { timeout: 20000 }).catch(() => {});
  const t = await card(page);
  t && /Make one/.test(t)
    ? ok('and the next slide asks again — a refusal defers the card, it does not cancel it')
    : bad(`the card was lost for the session after the paywall: ${JSON.stringify(t)}`);
  const shown = await evs(page, 'feed_gate_shown');
  shown.length === 1 && shown[0][1].n === 5
    ? ok('counted once, on the slide it actually landed on')
    : bad(`feed_gate_shown: ${JSON.stringify(shown.map(e => e[1]))}`);
  await page.close();
}

console.log('\nAND EVERY EVENT CARRIES THE ARM');
{
  const page = await open();
  await swipe(page, 3);
  const armed = await page.evaluate(() => {
    const t = window.__sent || [];
    return { total: t.length, armed: t.filter(e => e[1] && e[1].gate_arm === 'on').length };
  });
  armed.total > 0 && armed.total === armed.armed
    ? ok('gate_arm rides every event this page sends — feed_slide and hide_published included')
    : bad(`${armed.total - armed.armed} of ${armed.total} events carried no arm`);

  /* AND THE OTHER ARM SAYS SO, rather than saying nothing. A missing property and "off" are
     the same shape in a segment builder — the first silently drops the holdout out of every
     comparison it is the point of. */
  const off = await open({ arm: 'off' });
  await swipe(off, 1);
  const ctrl = await off.evaluate(() => {
    const t = window.__sent || [];
    return { total: t.length, armed: t.filter(e => e[1] && e[1].gate_arm === 'off').length };
  });
  ctrl.total > 0 && ctrl.total === ctrl.armed
    ? ok('and the control arm is stamped "off", not left blank')
    : bad(`${ctrl.total - ctrl.armed} of ${ctrl.total} control events carried no arm`);
  await off.close();
  await page.close();
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} feed-gate check(s) failed`); process.exit(1); }
console.log('\n✓ the feed asks once, of the right person, and counts it once');
