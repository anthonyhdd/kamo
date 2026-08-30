#!/usr/bin/env node
/**
 * THE SWIPE IS NOT FREE — AND THE LOCK IS NOT A TRAP.
 *
 * chNoteSeek() runs from ending(), and ending() only happens on a buzz. So until 2026-08-20
 * scrolling past a feed round cost nothing: no attempt, no trace, and above all no broken run.
 * The consequence was not cosmetic. A run kept by scrolling counts only the rounds the player
 * was already sure about — the same selection bias `n_attempts` carries, which is why feed
 * rounds read 59.2% found in 3.6s against 48.0% in 7.3s on a link. And a hint pack whose whole
 * pitch is "protect your run" was selling insurance against a risk nobody was exposed to.
 *
 * So the slide under the thumb is held until its round is answered. Two things have to be true
 * about that, and neither is provable by reading the code:
 *
 * ① IT ACTUALLY HOLDS. touch-action refuses the pan on a phone; a wheel, a trackpad, Page Down
 *    and a fling's leftover momentum all reach the scroller without ever being a touch, and any
 *    of them would carry a live round away. The clamp is the backstop and this suite drives it
 *    the only way a headless browser can — by setting scrollTop, which is exactly the case
 *    touch-action does NOT cover.
 *
 * ② IT ALWAYS LETS GO. There is no clock any more (limit_s stopped being sent when the chrono
 *    was found to amputate 41% of rounds), so a slide that locks and never releases is a dead
 *    end with no timer and no gesture out of it. Every release path is asserted here: the buzz,
 *    the give-up button, and a photo that never loads — that last one being the trap by the
 *    back door, because chPhotoDead does not go through ending() and so fires no onEnded of its
 *    own accord.
 *
 * And the give-up has to cost the run, or the lock is just an inconvenience: the whole point is
 * that leaving a round you cannot solve is a LOSS, which is what makes a hint worth buying.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feedlock-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the feed-lock test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
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

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ROWS = n => Array.from({ length: n }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'tony',
  n_attempts: i, n_found: 0, created_at: '2026-08-1' + (2 - (i % 3)) + 'T10:0' + i + ':00Z',
}));

/** Boot the feed. `photo:false` serves no picture at all, which is the chPhotoDead path. */
async function feed({ photo = true, run = 0, passSpent = false } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r =>
    photo ? r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : r.fulfill({ status: 404, body: 'x' }));
  await page.addInitScript((a) => {
    if (a.run) localStorage.setItem('kamo_seek_run', String(a.run));
    /* ⚠️ SEEDED EXPLICITLY, LIKE THE RUN'S LIFE. The day's skip is available unless the stored
       day IS today, so an unseeded case is always the FREE one — a "second give-up" test that
       forgot this would quietly be a first give-up, pass, and assert nothing. UTC, because
       that is the day the product uses (see CH_PASS_KEY). */
    if (a.ps) { try { localStorage.setItem('kamo_giveup_day', new Date().toISOString().slice(0, 10)); } catch (e) {} }
    else { try { localStorage.removeItem('kamo_giveup_day'); } catch (e) {} }
    /* Past the 5-round floor, so the run is a real one rather than a number the counter has
       not started trusting yet. */
    localStorage.setItem('kamo_seeks', '20');
    localStorage.setItem('kamo_seek_hits', '12');
    window.__seed = {
      feed_page: a.r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 },
      save_seek_trace: null, reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 }, log_skip: null,
    };
  }, { r: ROWS(3), run, ps: passSpent });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.KAMOFEED.open());
  await page.waitForTimeout(900);
  return page;
}

/** What the feed looks like right now, from the outside only. */
const state = page => page.evaluate(() => {
  const sc = document.getElementById('kfScroll');
  const sl = [...document.querySelectorAll('.kfSlide')];
  const h = document.getElementById('kfHint');
  return {
    top: sc ? sc.scrollTop : -1,
    slideH: sc ? sc.clientHeight : 0,
    locked: sl.map(x => x.classList.contains('kfLock')),
    rounds: document.querySelectorAll('.chS').length,
    quit: !!document.querySelector('.chS.chIn #chQuit'),
    hintShown: !!h && getComputedStyle(h).visibility !== 'hidden',
    run: localStorage.getItem('kamo_seek_run'),
  };
});
/* The one gesture a headless browser can make, and the one touch-action does not cover — so
   this drives the clamp rather than the CSS, which is the half that could silently rot. */
const swipe = async (page) => {
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(700);
};
const buzz = async (page) => {
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage'); if (!st) return;
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 195, clientY: 400 };
    st.dispatchEvent(new PointerEvent('pointerdown', o));
    st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  /* Waited for, not slept on: ending() lands behind the reveal frames, whose load time is not
     a constant and is worst exactly when the whole gate is running at once. */
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.kfSlide')].some(x => x.classList.contains('kfLock')),
    { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(200);
};

console.log('\n① AN UNANSWERED ROUND HOLDS THE SLIDE');
{
  const page = await feed();
  const a = await state(page);
  a.locked[0] === true ? ok('the live slide is locked on arrival') : bad(`slide 0 lock=${a.locked[0]}`);
  /* The instruction has to stop being printed while the surface is refusing to obey it. It is
     the first sentence a first-round player reads, and "Swipe up for the next hide ↑" over a
     slide that will not swipe is the app telling them it is broken. */
  a.hintShown === false ? ok('and the swipe instruction is not printed while the swipe is refused') : bad('the feed still says "swipe up" while locked');

  await swipe(page);
  const b = await state(page);
  b.top === 0 ? ok('a swipe past an unanswered round is refused (scrollTop back to 0)') : bad(`scrollTop is ${b.top}, expected 0`);
  b.rounds === 1 ? ok('and the round it belongs to is still the one alive') : bad(`${b.rounds} rounds alive`);
  await page.close();
}

console.log('\n② THE BUZZ RELEASES IT');
{
  const page = await feed();
  await buzz(page);
  const a = await state(page);
  a.locked[0] === false ? ok('answering unlocks the slide') : bad('the slide stayed locked after the buzz');
  a.hintShown === true ? ok('and the instruction comes back, which is how the way out is announced') : bad('the swipe instruction never returned');
  await swipe(page);
  const b = await state(page);
  b.top > 0 ? ok(`and the swipe now moves the feed (scrollTop ${b.top})`) : bad('the feed would not advance after the round was answered');
  await page.close();
}

console.log('\n③ THE EXIT EXISTS, IT IS FREE ONCE A DAY, AND IT COSTS THE RUN AFTER THAT');
/* Without a button this is a trap: there is no clock to end the round and no gesture to leave
   it. With a button that costs nothing it is a slower swipe. It has to be both — reachable and
   expensive — or the lock does not create a stake, it just creates friction.
   ⚠️ THIS BLOCK USED TO ASSERT THAT EVERY GIVE-UP BREAKS THE RUN, and that changed on
   2026-08-29. A DAILY CAP IS NOT THE FREE EXIT THE OLD RULE REFUSED: "free every other round"
   hands the life straight back on the next easy find and the lock becomes a slower swipe
   again, which is what chNoteSeek's note is about. ONE a day is bounded — the second give-up
   of the same day costs the run exactly as it always did, and that is asserted below, because
   it is the half that keeps the stake real. */
{
  const page = await feed({ run: 4 });
  const a = await state(page);
  a.quit ? ok('an exit is mounted in the feed') : bad('no give-up in the feed — a locked slide with no clock is a dead end');
  a.run === '4' ? ok('with a run of 4 going in') : bad(`run seeded wrong: ${a.run}`);

  /* NAMED BEFORE IT IS SPENT. A pass the player cannot see is not a mechanic: the decision in
     front of them is unchanged unless the screen says the first exit of the day is free. */
  const label = await page.evaluate(() => {
    const q = document.querySelector('.chS.chIn #chQuit');
    return q ? { text: q.textContent, free: q.classList.contains('free') } : null;
  });
  label && label.free && /1 today/i.test(label.text)
    ? ok(`the day's skip announces itself ("${label.text}")`)
    : bad('the free exit is not named: ' + JSON.stringify(label));

  await page.evaluate(() => document.querySelector('.chS.chIn #chQuit').click());
  await page.waitForTimeout(900);
  const b = await state(page);
  b.run === '4'
    ? ok('the first skip of the day leaves the run standing')
    : bad(`the day's pass still broke the run: kamo_seek_run=${b.run}`);
  b.locked[0] === false ? ok('and the slide is released') : bad('skipping did not release the slide');

  /* AND IT MOVES THE FEED ITSELF. The player did not ask for a verdict, they asked to leave;
     making them swipe afterwards is asking twice for one decision. ⚠️ WITHOUT A SWIPE — the
     assertion is worthless if the test performs the gesture it is meant to prove unnecessary.
     After the card has been read, not instead of it: the jump waits 1100ms so "Your run is
     safe" is on screen long enough to be the reason the run survived. */
  await page.waitForTimeout(1500);
  const c = await state(page);
  c.top > 0
    ? ok(`and the feed advances on its own (scrollTop ${Math.round(c.top)}) — no second gesture`)
    : bad('after the day\'s skip the feed sat still, so leaving still costs a swipe on top of '
        + 'the decision to leave');
  await page.close();
}

console.log('\n③b AND THE SECOND ONE THE SAME DAY COSTS THE RUN');
/* The half that keeps the exit expensive. Without this the cap is decoration and the feed lock
   is back to being friction: quit free on anything hard, take the next easy find for nothing. */
{
  const page = await feed({ run: 4, passSpent: true });
  const label = await page.evaluate(() => {
    const q = document.querySelector('.chS.chIn #chQuit');
    return q ? { text: q.textContent, free: q.classList.contains('free') } : null;
  });
  label && !label.free && /give up/i.test(label.text)
    ? ok(`with the pass gone it is the old exit again ("${label.text}")`)
    : bad('a spent pass still advertises itself as free: ' + JSON.stringify(label));

  await page.evaluate(() => document.querySelector('.chS.chIn #chQuit').click());
  await page.waitForTimeout(900);
  const b = await state(page);
  b.run === '0'
    ? ok('giving up a second time breaks the run — the loss is real, which is what a hint is bought against')
    : bad(`the run survived a second give-up on the same day: kamo_seek_run=${b.run}`);
  await swipe(page);
  (await state(page)).top > 0 ? ok('so the feed still moves on') : bad('still stuck after giving up');
  await page.close();
}

console.log('\n④ A PHOTO THAT NEVER LOADS IS NOT A ROUND, AND MUST NOT HOLD ANYTHING');
/* THE TRAP BY THE BACK DOOR. chPhotoDead() stops the clock and refuses the buzz without going
   through ending(), so it fires no onEnded of its own accord — and onEnded is the feed's only
   "this is over" signal. Left alone, a failed fetch produced a locked slide showing a black
   rectangle whose only control was a button that would have broken the player's run over a
   network blip. */
{
  const page = await feed({ photo: false, run: 3 });
  await page.waitForTimeout(1800);
  const a = await state(page);
  a.locked[0] === false ? ok('a slide whose photo never arrived is not locked') : bad('a failed fetch locks the feed — this is the trap');
  await swipe(page);
  const b = await state(page);
  b.top > 0 ? ok('and it can be swiped away') : bad('stuck on a photo that never loaded');
  b.run === '3' ? ok('and the run is untouched — a 404 is not a loss') : bad(`a failed photo moved the run to ${b.run}`);
  await page.close();
}

console.log('\nTHE SWITCH IS ONE CONSTANT, AND IT SHIPS ON');
/* It hardens the core loop on an audience that retains 2.5% on web. Reverting is a one-line
   push, fleet-wide in about two minutes — but only while it stays one line that says so. */
{
  const m = real.match(/const FEED_LOCK=(true|false);/);
  !m ? bad('FEED_LOCK is gone from index.html — the rollback switch has no line to flip')
     : m[1] === 'true' ? ok('index.html ships FEED_LOCK=true')
     : bad('FEED_LOCK ships false — the feed is a free swipe and the run is farmable again');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} feed-lock check(s) failed` : '\n✓ the feed holds a round until it is answered, and always lets go');
process.exit(failed ? 1 : 0);
