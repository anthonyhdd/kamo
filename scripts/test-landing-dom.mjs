#!/usr/bin/env node
/**
 * WHERE A FINISHED HIDE LEAVES YOU — the landing arm, and the four ways it goes wrong quietly.
 *
 * Today a finished hide ends on the reveal, which is a dead end: the creator's own kamo is the
 * one hide in the world they have no reason to play, and the only exits are the ✕ and
 * #ssSeeLive. On the live arm the screen BEHIND the share sheet becomes the feed, seeded on
 * the hide they just made, so closing the sheet leaves them one swipe from somebody else's.
 *
 *   - THE LEAKING HOLDOUT. A control arm that also lands in the feed is not a smaller effect,
 *     it is no measurement, and it looks identical to a working experiment.
 *   - THE SHEET TAKEN AWAY. The whole point is landing there WITH the share modal: the send
 *     has not happened yet, and the send is the flattest number in the product. A landing that
 *     dismisses the sheet buys scroll with sends.
 *   - THE LANDING ON NOTHING. No id means the publish failed or never ran. Seeding a feed on a
 *     hide that does not exist is the bug that was fixed hours before this arm was written.
 *   - THE HIJACKED REPLY. A reply round has its own return to the feed; two returns racing
 *     each other is a screen that jumps.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-landing-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the landing test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const html = real.replace('function track(event,props){',
  'function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);');

const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
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

const ROWS = Array.from({ length: 8 }, (_, i) => ({
  id: 'other' + i, img_path: 'p' + i + '.jpg', name: null,
  n_attempts: i, n_found: 0, created_at: '2026-08-20T10:0' + i + ':00Z',
}));

/** A whole round on a given arm, ending where the arm says it ends. */
async function round({ arm = 'on', publishes = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  await page.addInitScript((a) => {
    localStorage.setItem('kamo_land_arm', a);
    localStorage.setItem('kamo_feed_gate_arm', 'off');
    localStorage.setItem('kamo_feed_banger_arm', 'off');
    localStorage.setItem('kamo_reply_open_arm', 'off');
    localStorage.setItem('kamo_feed_swiped', '1');
  }, arm);
  /* Broadest first, most specific last — the LAST matching route wins in Playwright, and
     getting this backwards makes every publish answer null. */
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/api*.amplitude.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('**/rest/v1/rpc/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/rpc/feed_page', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));
  await page.route('**/rest/v1/rpc/get_hide', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ img_path: 'mine.jpg', name: null, n_attempts: 0, n_found: 0, created_at: '2026-08-22T12:00:00Z' }) }));
  await page.route('**/rest/v1/rpc/create_hide', r => publishes
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '"mineid1"' })
    : r.fulfill({ status: 500, body: 'boom' }));
  await page.route('**/storage/v1/object/hides/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1600;
    const g = c.getContext('2d'); g.fillStyle = '#6b7f5a'; g.fillRect(0, 0, 1200, 1600);
    for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(${90 + Math.random() * 90 | 0},${110 + Math.random() * 70 | 0},${80 + Math.random() * 60 | 0},.6)`; g.beginPath(); g.arc(Math.random() * 1200, Math.random() * 1600, 12 + Math.random() * 60, 0, 7); g.fill(); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'room.jpg', { type: 'image/jpeg' }));
    const inp = document.getElementById('fileInput'); inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1300);
  await page.click('#shutter'); await page.waitForTimeout(1500);
  const b = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  for (let k = 0; k < 22; k++) {
    const y = b.y + b.h * (.28 + k * .016);
    await page.mouse.move(b.x + b.w * .30, y); await page.mouse.down();
    for (let i = 0; i <= 14; i++) await page.mouse.move(b.x + b.w * (.30 + .40 * i / 14), y);
    await page.mouse.up();
  }
  await page.click('#btnDone');
  await page.waitForTimeout(9000);            // the reveal, the row, and the landing after it
  const st = await page.evaluate(() => ({
    feed: !!document.getElementById('kfeed'),
    sheetUp: (() => { const s = document.getElementById('shareSheet'); return !!(s && (s.classList.contains('peek') || s.classList.contains('show'))); })(),
    sheetVisible: (() => { const s = document.getElementById('shareSheet'); return !!s && getComputedStyle(s).display !== 'none'; })(),
    landed: (window.__tr || []).filter(e => e[0] === 'land_on_own_hide').length,
    ev: (window.__tr || []).map(e => e[0]),
  }));
  await page.close();
  return st;
}

console.log('\nA FINISHED HIDE LEAVES YOU IN THE FEED, ON IT');
{
  const r = await round({ arm: 'on' });
  r.feed ? ok('the live arm lands the creator in the feed')
         : bad(`no #kfeed after a publish on the live arm — events were ${JSON.stringify(r.ev.slice(-7))}`);
  r.landed === 1 ? ok('and files land_on_own_hide once, so the arm has its own exposure')
                 : bad(`land_on_own_hide fired ${r.landed} times`);
}

console.log('\nAND THE SHARE SHEET COMES WITH IT');
{
  const r = await round({ arm: 'on' });
  r.sheetUp && r.sheetVisible
    ? ok('the sheet is still up over the feed — the send has not happened yet')
    : bad('the landing dismissed the share sheet, which buys scroll with sends');
}

console.log('\nTHE CONTROL ARM STILL ENDS ON THE REVEAL');
{
  const r = await round({ arm: 'off' });
  !r.feed ? ok('the control arm does not open a feed')
          : bad('the control arm ALSO landed in the feed — a leaking holdout is not a measurement');
  r.landed === 0 ? ok('and files no land_on_own_hide') : bad('the control arm filed the arm event');
}

console.log('\nAND NOTHING LANDS ON A HIDE THAT DOES NOT EXIST');
{
  const r = await round({ arm: 'on', publishes: false });
  !r.feed ? ok('a publish with no row leaves the creator on the reveal, exactly as today')
          : bad('the arm opened a feed seeded on a hide that was never created');
  r.landed === 0 ? ok('and files nothing, so a failed publish is not counted as a landing')
                 : bad('land_on_own_hide fired for a hide with no row');
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a finished hide lands in the feed with its sheet, and only when it is really there');
process.exit(failed ? 1 : 0);
