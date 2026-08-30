#!/usr/bin/env node
/**
 * THE CARD ON YOUR OWN PHOTO — the one surface where every control was pointed backwards.
 *
 * "See it live" seeds the feed with the hide you just published (chFeed({first,fromReveal})),
 * and feed_page/the second lap both skip chMine(), so that seed is the ONLY way your own
 * photograph ever lands under your own thumb. Until this suite existed nothing asserted what
 * the round's ending card says when it does, and what it said was:
 *
 *   Challenge @tony back      -> your own handle, and chReplyTo=HID would file a reply to a
 *                                hide this device made: the notification points home
 *   Don't show me this person -> block_author() on your own author key, stored by kfAddBlock
 *                                and applied to every later feed_page. Correctly wired, aimed
 *                                at the person pressing it
 *
 * Both are gone on your own hide, "Send to a friend" takes the primary slot (a hide nobody was
 * sent is a hide nobody plays), and "Hide another one" goes to the camera.
 *
 * THE HALF THAT IS EASY TO GET WRONG IN A DIFF is the exit. The card already had a way out of
 * the feed — OPT.onClose, which is close(TRUE), silent on purpose because chRehide is already
 * on its way into compose carrying a photo and the camera must not be put back underneath it.
 * "Hide another one" wants the opposite: the non-silent close(), the one that actually reaches
 * the camera (exitFinished + backToCompose). Wiring it to the callback that was already there
 * would leave the feed's ✕ behaviour looking right and drop the user on a torn-down screen.
 * `feed_closed` is emitted by exactly one of the two, so that event IS the assertion.
 *
 * And the last block asserts the negative: a STRANGER's hide is untouched, both controls in
 * their original order, block link present.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-ownpost-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the own-post test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Stubbed at the declaration, not appended: chFeed() fetches its first page the moment it is
   called, so a hook added at the end of the module is too late. Same three doors as the feed
   suite — chRpcRows is separate because PostgREST hands a set-returning function back as an
   ARRAY and chRpc unwraps to the first element. */
const stub = (src, anchor) => {
  if (!src.includes(anchor)) throw new Error('anchor missing: ' + anchor);
  return src.replace(anchor, anchor +
    'window.__rpc=window.__rpc||[];window.__rpc.push([fn,body]);' +
    'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');
};
let html = stub(real, 'async function kfRpc(fn,body){');
html = stub(html, 'async function chRpc(fn,body){');
html = stub(html, 'async function chRpcRows(fn,body){');
html = html.replace('function track(event,props){',
  'function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);');
/* The page is a <script type="module">, so nothing in it lands on window — and the door this
   suite needs is reached in the app only from the share sheet's "See it live", at the far end
   of a capture, a paint, an upload and a publish. Written BEFORE the declaration because
   function declarations hoist. */
html = html.replace('function chFeed(opts){',
  'window.__chFeed=(o)=>chFeed(o);\nfunction chFeed(opts){');

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const body = readFileSync(join(ROOT, p.replace(/^\//, '')));
    const ext = p.slice(p.lastIndexOf('.'));
    rs.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end(''); }
});
await new Promise(r => server.listen(0, r));
const base = 'http://127.0.0.1:' + server.address().port;

let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/* THE ROUND'S PHOTO HAS TO ARRIVE, or this suite asserts against a failure screen.
   chSeek() grew an img.onerror: a camo image that never loads now says so on the headline
   ("This one didn't load"), stops the clock and refuses the buzz, instead of leaving a live
   round on a black rectangle. That is the fix — and it means a harness which never serves the
   photo is no longer testing the round it thinks it is. One transparent pixel is enough here:
   these cases are about what is written above the picture, not about the picture. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const servePhoto = (page) => page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
const browser = await chromium.launch({ executablePath: chromeExe(ROOT) || undefined,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

const MINE = 'mine0';
const ROWS = [
  { id: 'hide1', img_path: 'p1.jpg', name: 'zoe', n_attempts: 4, n_found: 1, created_at: '2026-08-12T10:00:00Z' },
  { id: 'hide2', img_path: 'p2.jpg', name: null, n_attempts: 0, n_found: 0, created_at: '2026-08-12T10:01:00Z' },
];

/* The answer key is dead centre and the buzz lands in the corner, so every round in this file
   is a MISS — which is the ending that carries rehide:true and therefore the card under test.
   reveal_hide is seeded rather than submit_attempt because the own-hide slide runs with
   replay:true and is judged locally against exactly this row (see the REPLAY branch). */
const ANSWER = { reveal_hide: { cx: 0.5, cy: 0.5, r: 0.05 }, save_seek_trace: null,
  react_to_hide: null, hide_reactions_of: [],
  submit_attempt: { hit: false, tries: 1, missed: 1, secs: 9, pct: null, others: 0 } };

/* `mine` plants the published-id list the app reads on boot — addInitScript is the one hook
   that survives the navigation, and chMine() is read while the round is being built. */
async function open({ mine, first, fromReveal, extra }) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  await page.addInitScript((a) => {
    if (a.mine) localStorage.setItem('kamo_hides', JSON.stringify(a.mine));
    /* Spent already, so the swipe hint does not float over the card being read. */
    localStorage.setItem('kamo_feed_swiped', '1');
    window.__seed = Object.assign({
      feed_page: a.rows,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
    }, a.answer, a.extra || {});
  }, { mine: mine || null, rows: ROWS, answer: ANSWER, extra: extra || null });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate((o) => window.__chFeed(o), { first: first || undefined, fromReveal: !!fromReveal });
  await page.waitForTimeout(1200);
  return page;
}

/* One buzz, in the corner, on whichever round is mounted. */
async function buzz(page) {
  await page.evaluate(() => {
    const st = document.querySelector('.chS.chIn .chStage') || document.querySelector('.chStage');
    const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 40, clientY: 120 };
    st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o));
  });
  await page.waitForSelector('#chFoot .chCard', { timeout: 8000 });
}

const readCard = page => page.evaluate(() => {
  const btns = [...document.querySelectorAll('#chFoot .chCard button')];
  return {
    ids: btns.map(b => b.id),
    labels: btns.map(b => (b.textContent || '').trim()),
    sendClass: (document.getElementById('chSend') || {}).className || '',
    newClass: (document.getElementById('chNew') || {}).className || '',
  };
});

const readRail = page => page.evaluate(() => {
  const box = document.getElementById('chRx');
  if (!box) return null;
  const chips = [...box.children];
  return {
    tags: chips.map(c => c.tagName),
    classes: chips.map(c => c.className),
    counts: chips.map(c => { const n = c.querySelector('.chRxN'); return n ? n.textContent : null; }),
  };
});

/* ══ THE RAIL AND THE FLAG, the two controls left over after the card was fixed ══════════════
   Both assumed the photo belonged to somebody else, because until "See it live" every photo in
   the feed did. The rail invited you to put 🔥 on your own painting; the ⚑ offered to report it
   to moderation. The counts survive — they are what OTHER people said, and the only thing on
   that screen that tells a creator anything — but nothing on it may write. */
console.log('\nTHE REACTION RAIL IS A READOUT ON YOUR OWN PHOTO');
{
  const page = await open({ mine: [MINE], first: MINE, fromReveal: true,
                            extra: { hide_reactions_of: [{ emoji: '🔥', n: 7 }, { emoji: '😂', n: 2 }] } });
  /* THE RAIL MOUNTS WITH THE ENDING CARD NOW, not with the round — so even on your own
     photo, reaching it takes the same buzz (REPLAY makes it a guaranteed hit regardless of
     where it lands, see the note on ANSWER above). */
  await buzz(page);
  const rail = await readRail(page);

  rail && rail.tags.length === 4 && rail.tags.every(t => t === 'DIV')
    ? ok('the four chips are divs — inert by construction, not buttons talked out of it')
    : bad(`the rail is ${JSON.stringify(rail && rail.tags)}`);
  rail && rail.classes.every(c => /\bread\b/.test(c))
    ? ok('and every one wears .read, so the press response and the lit border are gone')
    : bad(`chip classes: ${JSON.stringify(rail && rail.classes)}`);
  /* THE HALF THAT IS WORTH KEEPING. A rail that showed nothing would be a simpler diff and a
     worse screen: the counts are the creator's only feedback anywhere in this app. */
  rail && rail.counts[0] === '7' && rail.counts[1] === '2'
    ? ok('and the counts still paint — 7 and 2, straight off hide_reactions_of')
    : bad(`counts read ${JSON.stringify(rail && rail.counts)}`);

  /* NOTHING MAY BE WRITTEN. A tap that reached react_to_hide would let a creator inflate the
     one number on their own hide that is supposed to belong to everybody else. */
  await page.evaluate(() => { window.__rpc.length = 0; [...document.getElementById('chRx').children].forEach(c => c.click()); });
  await page.waitForTimeout(400);
  const wrote = await page.evaluate(() => (window.__rpc || []).filter(c => c[0] === 'react_to_hide'));
  wrote.length === 0
    ? ok('and tapping all four writes nothing — the counts stay everybody else\'s')
    : bad(`react_to_hide was called ${wrote.length}×`);

  await page.close();
}

console.log('\nAND THE ⚑ IS NOT OFFERED ON YOUR OWN PHOTO');
{
  const page = await open({ mine: [MINE], first: MINE, fromReveal: true });
  const own = await page.evaluate(() => {
    const f = document.getElementById('kfFlag');
    return f ? getComputedStyle(f).display : 'absent';
  });
  own === 'none' ? ok('slide 0 is yours, and the flag is not on the bar') : bad(`the flag reads display:${own} on your own hide`);

  /* THE OTHER HALF, and the one that keeps Apple's 1.2 obligation intact: a stranger's hide
     still has a reporting path. The flag is a bar fixture, so this is a per-slide question and
     scrolling is the only way to ask it. */
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(900);
  const next = await page.evaluate(() => {
    const f = document.getElementById('kfFlag');
    return f ? getComputedStyle(f).display : 'absent';
  });
  next !== 'none' && next !== 'absent'
    ? ok('and it comes back on the very next slide, which is a stranger\'s')
    : bad(`the flag stayed ${next} after scrolling onto somebody else's hide — reporting is now unreachable`);

  await page.close();
}

console.log('\nYOUR OWN HIDE: NOTHING ON THE CARD POINTS AT YOU');
{
  const page = await open({ mine: [MINE], first: MINE, fromReveal: true });
  await buzz(page);
  const card = await readCard(page);

  !card.ids.includes('chReh')
    ? ok('there is no "Challenge back" — the card names no counterparty because there is none')
    : bad('the reply button is still on your own hide: ' + JSON.stringify(card.labels));
  !card.ids.includes('chBlk')
    ? ok('and no block link — block_author() would tag the key this device publishes with')
    : bad('"Don\'t show me this person" is offered on your own photograph');

  card.ids[0] === 'chSend' && /chCta(?!2)/.test(card.sendClass)
    ? ok('"Send to a friend" is first and wears the primary treatment')
    : bad(`the primary slot is ${JSON.stringify(card.ids[0])} (${card.sendClass})`);
  card.ids[1] === 'chNew' && card.labels[1] === 'Hide another one' && /chCta2/.test(card.newClass)
    ? ok('and "Hide another one" sits under it as the secondary')
    : bad(`the second control is ${JSON.stringify(card.labels[1])} (${card.newClass})`);

  card.ids.length === 2
    ? ok('two controls, and nothing else on the card')
    : bad(`the card carries ${card.ids.length}: ${JSON.stringify(card.labels)}`);

  await page.close();
}

/* THE EXIT, AND THE ONE THAT IS NOT THE SAME AS THE OTHER EXIT.
   close(true) — what OPT.onClose has always been — tears the feed down and deliberately does
   NOT put the camera back, because the reply path is already carrying a photo into compose.
   Reusing it here would leave this button looking like it worked and landing the user on a
   dead screen. Only the non-silent close() emits `feed_closed`, so the event is the proof
   that the right one ran. */
console.log('\nAND "HIDE ANOTHER ONE" GOES TO THE CAMERA, NOT MERELY OUT OF THE FEED');
{
  const page = await open({ mine: [MINE], first: MINE, fromReveal: true });
  await buzz(page);
  await page.evaluate(() => { window.__tr.length = 0; document.getElementById('chNew').click(); });
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => ({
    feed: !!document.getElementById('kfeed'),
    events: (window.__tr || []).map(e => e[0]),
    closed: (window.__tr || []).filter(e => e[0] === 'feed_closed').map(e => e[1]),
  }));

  !after.feed ? ok('the feed is gone') : bad('#kfeed survived the tap');
  after.closed.length === 1 && after.closed[0].from === 'reveal'
    ? ok('through the non-silent close — the one that runs exitFinished + backToCompose')
    : bad('feed_closed did not fire once with from:"reveal" — this is close(true), the silent '
        + 'exit that leaves the camera down: ' + JSON.stringify(after.events));
  /* The reply path must not have been taken on the way out: chRehide() stamps chReplyTo with
     this hide's id, and a reply addressed to your own hide is the bug this card exists to fix. */
  !after.events.includes('seek_rehide_tapped') && !after.events.includes('reply_started')
    ? ok('and no reply was opened — the camera is a fresh hide, not an answer to yourself')
    : bad('the button routed through chRehide(): ' + JSON.stringify(after.events));

  await page.close();
}

/* THE NEGATIVE, and it is the half that keeps this change scoped. Everything above is keyed on
   chMine(); a test that only proved the own-hide card would pass just as happily if the branch
   had swallowed the stranger's card too. */
console.log("\nA STRANGER'S HIDE IS UNTOUCHED");
{
  const page = await open({ mine: [MINE], fromReveal: false });
  await buzz(page);
  const card = await readCard(page);

  card.ids[0] === 'chReh' && card.ids[1] === 'chSend'
    ? ok('"Challenge back" is still first and "Send to a friend" still second')
    : bad('the feed card lost its order: ' + JSON.stringify(card.ids));
  /* Signed hides name the sender, via textContent — the rule the seeker headline follows.
     THE HANDLE COMES FROM get_hide, NOT FROM THE FEED ROW: the round fetches the hide itself
     and reads `h.name` off that response, which is why the fixture's row name is irrelevant
     here. It is also the whole reason the old card was absurd on your own photo — get_hide
     answers with YOUR handle for a hide you published, so the button printed the reader's own
     name back at them. */
  card.labels[0] === 'Challenge @tony back'
    ? ok('and it still names the person who hid it, off get_hide')
    : bad(`the reply button reads ${JSON.stringify(card.labels[0])}`);
  card.ids.includes('chBlk')
    ? ok('and the block link is where it was')
    : bad('the block link was removed from a stranger\'s hide too');
  !card.ids.includes('chNew')
    ? ok('with no "Hide another one" — that control belongs to your own photo only')
    : bad('#chNew leaked onto a stranger\'s card');

  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} problem(s)` : '\n✓ the own-hide card is its own card');
process.exit(failed ? 1 : 0);
