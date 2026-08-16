#!/usr/bin/env node
/**
 * THE FEED'S QUALITY PASS — the LQIP and the banger slot — and the ways each fails silently.
 *
 * 1. THE LQIP IS CSS BUILT FROM A STRANGER'S STRING. create_hide clamps it and addSlide
 *    re-validates it, and this asserts the second door actually shuts: a row carrying
 *    anything that is not a JPEG data URL must paint NO background at all, because the
 *    alternative is a feed row injecting url() values into other people's CSS.
 *
 * 2. THE BANGER RIDES AN INSERTION, NOT AN APPEND. addSlide(row, replay, at) splices DOM and
 *    S.slides together; get that wrong and every index-based reader (activate, drop,
 *    blockDrop) is renumbered against a screen that no longer matches — invisible in a diff,
 *    chaos on a phone. Asserted by position: the seeded hide must be the FOURTH slide, with
 *    the page's own rows intact around it.
 *
 * 3. A SEEN BANGER IS NO BANGER. The slot exists to guarantee a strong moment, and a hide
 *    this device already played is the opposite of one — the filter must hold even when
 *    feed_best serves nothing else.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feedq-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the feed-quality test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
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

/* A real (if tiny) JPEG data URL — the shape the validator accepts. */
const LQ = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const ROWS = (n, lq) => Array.from({ length: n }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'tony',
  n_attempts: i, n_found: 0, created_at: '2026-08-1' + (2 - (i % 3)) + 'T10:0' + i + ':00Z',
  lqip: i === 0 ? lq : null,
}));
const BEST = [{ id: 'best1', img_path: 'best.jpg', name: 'tony', n_attempts: 9, n_found: 4, created_at: '2026-08-10T09:00:00Z', lqip: null }];

async function open({ rows, best, seen } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    if (a.seen) localStorage.setItem('kamo_feed_seen', JSON.stringify(a.seen));
    window.__seed = {
      feed_page: a.rows,
      feed_best: a.best || [],
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      hide_reactions_of: [],
      my_reactions: [],
      set_hide_public: null,
    };
  }, { rows: rows, best: best || null, seen: seen || null });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('btnFeed').click());
  await page.waitForTimeout(900);
  return page;
}

console.log('\nTHE LQIP PAINTS, AND ONLY THE REAL SHAPE PAINTS');
{
  const page = await open({ rows: ROWS(5, LQ), best: BEST });
  const bg = await page.evaluate(() => {
    const s = document.querySelectorAll('.kfSlide');
    return { first: (s[0] && s[0].style.backgroundImage) || '', n: s.length };
  });
  /data:image\/jpeg;base64/.test(bg.first)
    ? ok('the first slide paints its lqip as a background before any fetch')
    : bad(`no lqip background on slide 0: ${JSON.stringify(bg.first.slice(0, 60))}`);

  console.log('\nTHE BANGER LANDS FOURTH, BETWEEN THE PAGE\'S OWN ROWS');
  const seeded = await page.evaluate(() => ({
    n: document.querySelectorAll('.kfSlide').length,
    fourth: (document.querySelectorAll('.kfSlide .kfPrev')[3] || {}).src || '',
    ev: (window.__tr || []).some(t => t[0] === 'feed_best_seeded'),
  }));
  seeded.ev ? ok('feed_best_seeded fired') : bad('no feed_best_seeded event');
  seeded.n === 6 ? ok('five page slides plus one seeded (6)') : bad(`expected 6 slides, got ${seeded.n}`);
  /best\.jpg/.test(seeded.fourth)
    ? ok('the seeded hide is the FOURTH slide — inserted, not appended')
    : bad(`slide 3 shows ${JSON.stringify(seeded.fourth)} — the insertion landed elsewhere`);
  await page.close();
}
{
  const page = await open({ rows: ROWS(5, 'url(javascript:alert(1))'), best: [] });
  const bg = await page.evaluate(() => (document.querySelector('.kfSlide') || {}).style.backgroundImage || '');
  bg === ''
    ? ok('a malformed lqip paints NOTHING — the second door holds')
    : bad(`a non-data-URL lqip reached CSS: ${JSON.stringify(bg)}`);
  await page.close();
}

console.log('\nA SEEN BANGER IS NO BANGER');
{
  const page = await open({ rows: ROWS(5, null), best: BEST, seen: ['best1'] });
  const r = await page.evaluate(() => ({
    n: document.querySelectorAll('.kfSlide').length,
    ev: (window.__tr || []).some(t => t[0] === 'feed_best_seeded'),
  }));
  !r.ev && r.n === 5
    ? ok('an already-played best hide is filtered, and nothing is seeded in its place')
    : bad(`seen banger leaked: slides=${r.n} seeded=${r.ev}`);
  await page.close();
}

console.log('\nA BLACK RECTANGLE IS NOT A ROUND');
{
  /* Founder's report, 2026-08-16: the feed serves photos that are entirely black. They pass
     every server filter — coverage is 100%, because the whole frame got painted — and they
     are unplayable. The source is fixed in chRehide (a reply photo that failed to load left
     the scene on coverInto's #223 slab, and that slab got painted and published); this is the
     half that cleans up what is already in the database, read off the lqip so it costs no
     network.
     THE SECOND CASE IS THE ONE THAT MATTERS. Dropping black rectangles is easy; dropping them
     WITHOUT dropping a legitimately dark photograph is the whole difficulty, and a mean-only
     test fails it. A filter that eats real photos is worse than the rectangles it removes. */
  const LQ_BLACK = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAbABQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ+AAAAAAAD/2Q==";
  const LQ_DARK = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAbABQDASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAIBBv/EACcQAAICAQMDAgcAAAAAAAAAAAERAAIhEjFRAyLwQZFxgaGxwdHh/8QAFwEAAwEAAAAAAAAAAAAAAAAAAAECA//EABwRAAMAAgMBAAAAAAAAAAAAAAABESFRAgNhE//aAAwDAQACEQMRAD8A5WwAwBUAbjdbzHXSrXyGU/3vtDNArOyC4C5ilT26QERg8Hz7yrQmzR1BSoFQSPhEitraAelUmpDw8e0R/G5wXfC97aimM+e0xFY1l5fK8/sqwxUeiP5k9TsANcEoE/MReEXYOAGKMh9yJ+sSbXNUlkM4G8TLk1WJ9jTh/9k=";
  const rows = [
    { id: 'ok0', img_path: 'p0.jpg', name: 'tony', n_attempts: 0, n_found: 0, created_at: '2026-08-16T10:00:00Z', lqip: null },
    { id: 'blk', img_path: 'p1.jpg', name: null, n_attempts: 1, n_found: 0, created_at: '2026-08-16T09:00:00Z', lqip: LQ_BLACK },
    { id: 'night', img_path: 'p2.jpg', name: null, n_attempts: 2, n_found: 1, created_at: '2026-08-16T08:00:00Z', lqip: LQ_DARK },
  ];
  const page = await open({ rows, best: [] });
  await page.waitForTimeout(900);   // the drop lands a frame after the slides mount
  const left = await page.evaluate(() => [...document.querySelectorAll('.kfSlide .kfPrev')].map(i => i.src.split('/').pop()));
  const ev = await page.evaluate(() => (window.__tr || []).filter(t => t[0] === 'feed_black_dropped').length);
  !left.includes('p1.jpg') && ev === 1
    ? ok('the black rectangle is pulled out of the feed')
    : bad(`black slide survived: slides=${left.join(',')} drops=${ev}`);
  left.includes('p2.jpg')
    ? ok('and a genuinely dark photograph is NOT — flat AND dark is the test, not dark alone')
    : bad('a real dark photo was dropped with the rectangles — the filter is too greedy');
  left.includes('p0.jpg')
    ? ok('and a hide with no placeholder at all is left alone')
    : bad('a hide published before the lqip column was dropped on a guess');
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the feed quality pass behaves');
process.exit(failed ? 1 : 0);
