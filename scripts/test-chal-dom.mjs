#!/usr/bin/env node
/**
 * THE CHALLENGES PANEL, AND THE THREE WAYS IT FAILS WITHOUT LOOKING BROKEN.
 *
 * 1. THE HANDLE IS A STRANGER'S STRING. Every cell prints a name typed on somebody else's
 *    device, and this panel is built in JS rather than markup — one innerHTML with the name
 *    interpolated and the trust boundary the seeker headline and kbRow defend is gone, on the
 *    screen a recipient is MOST likely to open (it is addressed to them). Asserted by serving
 *    a name that is markup and requiring it to arrive as text.
 *
 * 2. THE REPLAY FLAG IS THE CORRECTNESS ARGUMENT, same as the mine grid and the second lap: a
 *    reply already played must open with replay:true so a tap from somebody who has seen the
 *    answer never reaches submit_attempt — and a FRESH reply must open with replay:false,
 *    because the recipient genuinely never saw the answer and their buzz is the one attempt
 *    in this app that is most a real round. Either flag stuck the wrong way is invisible on
 *    screen; both directions are read off the feed_slide stamp activate() already emits.
 *
 * 3. A DEVICE WITH NO HIDES CANNOT HAVE BEEN ANSWERED, so the panel must say that in words
 *    without ever asking the network a question whose answer is [] by construction.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-chal-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the challenges test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Same three doors as test-feed-dom, stubbed at their declarations for the same reason:
   chFeed() and chalShow() both go to the network before anything appended to the module
   could run. */
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

const FEED = [{ id: 'hide0', img_path: 'p0.jpg', name: 'tony', n_attempts: 0, n_found: 0, created_at: '2026-08-12T10:00:00Z' }];
/* The name is deliberately markup: if any cell lets it through as HTML the <b> renders and
   the textContent assertion below reads differently from the string that was served. */
const REPLIES = [
  { id: 'r-fresh', reply_to: 'mine1', name: '<b>evil</b>', img_path: 'ra.jpg', created_at: '2026-08-16T09:00:00Z' },
  { id: 'r-played', reply_to: 'mine1', name: 'tony', img_path: 'rb.jpg', created_at: '2026-08-15T09:00:00Z' },
];

async function open({ mine, replies, seen, hasReplies } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    if (a.mine) localStorage.setItem('kamo_hides', JSON.stringify(a.mine));
    if (a.seen) localStorage.setItem('kamo_feed_seen', JSON.stringify(a.seen));
    /* The cached "this device has been answered before" flag the menu row is gated on. Set
       explicitly rather than left to the launch probe: the probe fires 1200ms after boot and
       this harness opens the feed before that, so relying on it would make every assertion
       below a race. */
    if (a.hasReplies) localStorage.setItem('kamo_has_replies', '1');
    window.__seed = {
      feed_page: a.feed,
      my_replies: a.replies || [],
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      hide_reactions_of: [],
      set_hide_public: null,
    };
  }, { mine: mine || null, replies: replies || null, seen: seen || null, hasReplies: !!hasReplies, feed: FEED });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('btnFeed').click());
  await page.waitForTimeout(800);
  return page;
}
async function toChal(page) {
  await page.evaluate(() => document.getElementById('kfScope').click());
  await page.evaluate(() => document.querySelector('#kfMenu [data-s="chal"]').click());
  await page.waitForTimeout(500);
}

console.log('\nTHE MENU CARRIES THE DOOR');
{
  const page = await open({ mine: ['mine1'], replies: REPLIES, seen: ['r-played'], hasReplies: true });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#kfMenu [data-s]')].map(b => b.dataset.s));
  rows.includes('chal')
    ? ok(`the scope menu offers Challenges (${rows.join(' / ')})`)
    : bad(`no chal row in the menu — got ${rows.join(', ')}`);

  console.log('\nTHE GRID PRINTS A STRANGER\'S NAME AS TEXT');
  await toChal(page);
  const grid = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#kfChal .kmCell')];
    return {
      n: cells.length,
      bold: !!document.querySelector('#kfChal .kmMeta b'),
      names: cells.map(c => (c.querySelector('.kmM') || {}).textContent || ''),
      played: cells.map(c => c.classList.contains('krPlayed')),
    };
  });
  grid.n === 2 ? ok('every reply becomes a cell (2)') : bad(`expected 2 cells, got ${grid.n}`);
  !grid.bold && grid.names.some(n => n === '@<b>evil</b>')
    ? ok('the handle arrives as text, markup and all — never as an element')
    : bad(`the served <b> name rendered as ${grid.bold ? 'MARKUP' : JSON.stringify(grid.names)}`);
  grid.played.filter(Boolean).length === 1
    ? ok('the already-played reply is the one that dims')
    : bad(`played flags were ${JSON.stringify(grid.played)}`);

  console.log('\nTAP = PLAY, WITH THE HONEST REPLAY FLAG');
  await page.evaluate(() => [...document.querySelectorAll('#kfChal .kmCell')]
    .find(c => !c.classList.contains('krPlayed')).click());
  await page.waitForTimeout(700);
  const fresh = await page.evaluate(() => ({
    panel: document.getElementById('kfChal').style.display,
    round: document.querySelectorAll('.chS').length,
    slide: (window.__tr || []).filter(t => t[0] === 'feed_slide').pop(),
  }));
  fresh.panel === 'none' ? ok('the panel closes under the photo it opened') : bad('the panel stayed over the round');
  fresh.round >= 1 ? ok('a real round mounts') : bad('no round mounted');
  fresh.slide && fresh.slide[1] && fresh.slide[1].replay === false
    ? ok('a fresh reply plays as a REAL round — the buzz will file')
    : bad(`fresh reply stamped ${JSON.stringify(fresh.slide)}`);

  await toChal(page);
  /* By name, not by class: the fresh reply just got played, so by now BOTH cells wear
     .krPlayed and the first of them is the slide already active — a click there is a no-op
     by design (activate() refuses the current index) and asserts nothing. */
  await page.evaluate(() => [...document.querySelectorAll('#kfChal .kmCell')]
    .find(c => (c.querySelector('.kmM') || {}).textContent === '@tony').click());
  await page.waitForTimeout(700);
  const spent = await page.evaluate(() => (window.__tr || []).filter(t => t[0] === 'feed_slide').pop());
  spent && spent[1] && spent[1].replay === true
    ? ok('a spent reply replays — its tap can never inflate the author\'s attempts')
    : bad(`spent reply stamped ${JSON.stringify(spent)}`);
  await page.close();
}

console.log('\nNO CHALLENGES, NO DOOR');
{
  /* Founder's call, 2026-08-16, and the same doctrine as the feed button's own gate: a menu
     line that can only ever lead to "No challenges yet" spends the one bit of curiosity a new
     control gets on an empty room. Most devices are this one — a reply needs somebody to have
     published, sent, been played AND answered — so this is the DEFAULT state of the menu, not
     an edge case. */
  const page = await open({});
  const rows = await page.evaluate(() => [...document.querySelectorAll('#kfMenu [data-s]')].map(b => b.dataset.s));
  /* Spelled out rather than counted: the count was 3 until Today's runs was removed on
     2026-08-16, and a bare length is a test that fails for the wrong reason every time the
     menu is edited. These two are the PERMANENT scopes — every device has a feed and a grid
     of its own hides — and chal is the conditional one this block is about. */
  !rows.includes('chal') && rows.join(',') === 'all,mine'
    ? ok(`a device that has never been answered is not offered the row (${rows.join(' / ')})`)
    : bad(`the empty Challenges row is still in the menu: ${rows.join(', ')}`);
  /* And nothing downstream trips over its absence — the menu still works. */
  const still = await page.evaluate(() => {
    document.getElementById('kfScope').click();
    document.querySelector('#kfMenu [data-s="mine"]').click();
    return true;
  });
  await page.waitForTimeout(400);
  const mineOpen = await page.evaluate(() => getComputedStyle(document.getElementById('kfMine')).display);
  still && mineOpen === 'block'
    ? ok('and the rest of the menu is untouched by the missing row')
    : bad(`the menu broke without the chal row: mine panel display=${mineOpen}`);
  await page.close();
}

console.log('\nA CACHE THAT OUTLIVED ITS REPLIES STILL EXPLAINS ITSELF');
{
  /* The row is painted from a cached flag so it does not pop in 1200ms late, which means it
     can outlive the replies themselves — they expire at 30 days. That device opens a panel
     with nothing in it, and the empty card is what makes that honest rather than broken. */
  const page = await open({ mine: ['mine1'], replies: [], hasReplies: true });
  await toChal(page);
  const copy = await page.evaluate(() => (document.querySelector('#kfChal p') || {}).textContent || '');
  /answers to your kamos|lands here/i.test(copy)
    ? ok('the empty card explains what a challenge is and how to earn one')
    : bad(`empty copy reads ${JSON.stringify(copy)}`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the challenges panel behaves');
process.exit(failed ? 1 : 0);
