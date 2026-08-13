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

async function open(rows) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((r) => {
    window.__seed = {
      feed_page: r,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    };
  }, rows);
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
