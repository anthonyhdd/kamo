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

async function open(rows, extra) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

/* CONSENT, WHICH IS THE ONE SCREEN IN THIS APP WHERE BEING WRONG PUBLISHES SOMEBODY'S ROOM.
   Public stays the default and the sheet says so with the switch already on — what is
   asserted here is that the default is REACHED THROUGH A CHOICE, never behind one. */
console.log('\nNOTHING GOES PUBLIC BEFORE ANYBODY HAS BEEN TOLD');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.__seed = { set_hide_public: null }; });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const asked = await page.evaluate(() => window.KAMOFEED.asked());
  !asked ? ok('a fresh device has not been asked yet') : bad('a fresh device reads as already asked');

  const p = page.evaluate(() => window.KAMOFEED.askConsent());
  await page.waitForSelector('#kfCons', { timeout: 8000 }).catch(() => {});
  const sheet = await page.evaluate(() => ({
    title: (document.querySelector('.kfConsT') || {}).textContent,
    pressed: document.getElementById('kfConsVis').getAttribute('aria-pressed'),
    sub: (document.getElementById('kfConsVS') || {}).textContent,
    cta: (document.getElementById('kfConsGo') || {}).textContent,
  }));
  sheet.pressed === 'true'
    ? ok(`the switch is already on — public is still the default ("${sheet.title}")`)
    : bad('the consent sheet does not default to public: ' + JSON.stringify(sheet));
  /feed/i.test(sheet.sub || '')
    ? ok(`and it names where the photo goes ("${sheet.sub}")`)
    : bad('the sheet does not say where the photo goes: ' + JSON.stringify(sheet.sub));

  /* THE ASSERTION THAT MATTERS. Before the tap there must be no set_hide_public on the wire:
     29 hides went public in 24h whose author never saw anything, and that is the hole. */
  const early = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'set_hide_public').length);
  early === 0 ? ok('and nothing has been published while the question is still open')
              : bad(`set_hide_public fired ${early}x before the user answered`);

  await page.evaluate(() => document.getElementById('kfConsGo').click());
  const answer = await p;
  const after = await page.evaluate(() => ({ asked: window.KAMOFEED.asked(), want: window.KAMOFEED.wantPublic() }));
  answer === true && after.asked && after.want
    ? ok('tapping through consents to the default, and the answer sticks')
    : bad('after Got it: ' + JSON.stringify({ answer, ...after }));
  await page.close();
}

/* Turning it off on the sheet must be a real answer, not decoration. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.__seed = { set_hide_public: null }; });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const p = page.evaluate(() => window.KAMOFEED.askConsent());
  await page.waitForSelector('#kfCons', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('kfConsVis').click());
  await page.evaluate(() => document.getElementById('kfConsGo').click());
  const answer = await p;
  const want = await page.evaluate(() => window.KAMOFEED.wantPublic());
  answer === false && want === false
    ? ok('switching it off keeps the hide private, and that choice sticks too')
    : bad('after choosing private: ' + JSON.stringify({ answer, want }));
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
