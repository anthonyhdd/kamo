#!/usr/bin/env node
/**
 * THE ROW LANDED AND THE PHOTO DID NOT — the failure that reads exactly like success.
 *
 * create_hide is deliberately not made to wait for the bytes: the share link has to be
 * instant, so the row is written while the upload is still in flight. When that upload is
 * then refused, the row survives with an img_path pointing at nothing, and until this suite
 * existed every sentence on the share sheet went on saying the hide was live — over a Send
 * button, for a hide nobody would ever be able to play.
 *
 * That is the creator's half of 2026-08-21, when x-upsert took every upload in the app down
 * for fifteen hours: 364 hides published with no photo behind them, each one announced as
 * live. The seeker's half is answered server-side — get_hide refuses a hide whose object is
 * gone — and this is the half that faces the person who made it.
 *
 * Three things have to hold, and the middle one is why this is a suite and not a comment:
 *   - a refused upload retracts the claim,
 *   - a SUCCESSFUL round still says "live" (a retraction that fires on everything is just a
 *     broken sheet, and it would look like a fix),
 *   - and the two failures stay distinguishable: no row is not the same as no picture.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-photoless-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the photoless-publish test — run: ' + PW_SETUP); process.exit(0); }

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

/** A whole round: pick a photo, capture, paint past the floor, finish, open the sheet. */
async function round({ upload = 200, create = 200 } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  /* ⚠️ BROADEST FIRST, MOST SPECIFIC LAST — in Playwright the LAST matching route registered
     wins. Registered the intuitive way round (specific first), `*.supabase.co/**` swallows
     create_hide, every publish answers null, and all three cases report the rowless failure,
     which reads as the fix being broken rather than as the harness being wrong. This cost two
     runs. */
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/api*.amplitude.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('**/rest/v1/rpc/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/rpc/create_hide', r => create === 200
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '"newid1"' })
    : r.fulfill({ status: 500, body: 'boom' }));
  /* The exact answer production gave for fifteen hours on 2026-08-21. */
  await page.route('**/storage/v1/object/hides/**', r => upload === 200
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    : r.fulfill({ status: 400, contentType: 'application/json',
        body: '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy","code":"AccessDenied"}' }));

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
  await page.click('#btnDone'); await page.waitForTimeout(2600);
  await page.evaluate(() => { const c = document.querySelector('#shareSheet .ssCard'); if (c) c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); });
  await page.waitForTimeout(7000);
  const st = await page.evaluate(() => ({
    head: (document.getElementById('ssTitle') || {}).textContent || null,
    sub: (document.getElementById('ssVisS') || {}).textContent || null,
    ev: (window.__tr || []).map(e => e[0]),
  }));
  await page.close();
  return st;
}

console.log('\nA REFUSED UPLOAD RETRACTS THE CLAIM');
{
  const r = await round({ upload: 400 });
  /didn't upload/i.test(r.head || '')
    ? ok(`the headline says what happened ("${r.head}")`)
    : bad(`the headline still reads ${JSON.stringify(r.head)} over a hide with no photo in it`);
  /didn't upload|nothing to play/i.test(r.sub || '')
    ? ok(`and the row under it stops promising a feed ("${r.sub}")`)
    : bad(`the visibility row still says ${JSON.stringify(r.sub)} about a hide that cannot be played`);
  r.ev.includes('hide_photo_missing')
    ? ok('hide_photo_missing files it, so the creator-side count exists at all')
    : bad(`no hide_photo_missing in ${JSON.stringify(r.ev.slice(-6))} — this failure stays invisible in Amplitude`);
}

console.log('\nAND A ROUND THAT WORKS STILL SAYS SO');
{
  const r = await round({});
  /live/i.test(r.head || '')
    ? ok(`a successful publish still reads "${r.head}"`)
    : bad(`a WORKING round now reads ${JSON.stringify(r.head)} — the retraction fires on everything, which looks like a fix and is a broken sheet`);
  !r.ev.includes('hide_photo_missing')
    ? ok('and files no hide_photo_missing')
    : bad('hide_photo_missing fired on a round whose photo landed');
}

console.log('\nNO ROW AND NO PICTURE STAY DIFFERENT FAILURES');
{
  const r = await round({ create: 500 });
  /didn't go up/i.test(r.head || '')
    ? ok(`a publish with no row still reads "${r.head}", not the photo sentence`)
    : bad(`a rowless publish reads ${JSON.stringify(r.head)} — the two failures need opposite fixes and this collapses them`);
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a hide with no photo is never announced as live, and a working one still is');
process.exit(failed ? 1 : 0);
