#!/usr/bin/env node
/**
 * THE OPEN EXPERIMENT — what is in front when the app opens, and the four ways an arm like
 * this fails while looking perfectly fine.
 *
 * Founder's question, 2026-08-22: feed or camera on open? The app has only ever opened on the
 * camera, so there was nothing to compare and openArm is a 50/50 coin rather than an opinion.
 * It sits on the BOOT LINE, which is the one line in index.html where a mistake is a blank app
 * for every user at once — hence a suite rather than a comment.
 *
 *   - THE LEAKING HOLDOUT. A control arm that also opens on the feed is not a smaller effect,
 *     it is no measurement, and the screen looks identical to a working experiment.
 *   - THE STOLEN SHARE LINK. chSeek() has to outrank the coin. A link is somebody being handed
 *     a specific hide; if the arm wins, the sender's hide is replaced by a feed of strangers
 *     and the most valuable arrival in the product is spent on the wrong screen.
 *   - THE HIJACKED FIRST LAUNCH. A device that has never been here has a designed hero and a
 *     permission sheet. Diverting that to the feed changes onboarding and open-destination in
 *     one move — unreadable — and raises a permission prompt behind a feed being read.
 *   - THE VANISHED CAMERA. The arm puts the feed IN FRONT of a booted camera. If the camera
 *     stops booting, closing the feed lands on nothing and the arm measures two changes.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-openarm-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the open-arm test — run: ' + PW_SETUP); process.exit(0); }

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
/* The camera never opens in a harness, so record that boot ASKED for it — that is the thing
   the arm must not take away, and it is not otherwise observable from the DOM. */
html = html.replace('function bootCamera(){', 'function bootCamera(){ window.__booted=(window.__booted|0)+1;');

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

const ROWS = Array.from({ length: 8 }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: null,
  n_attempts: i, n_found: 0, created_at: '2026-08-16T10:0' + i + ':00Z',
}));

/**
 * `returning` is the whole of the gate: camEverAsked() reads kamo_cam_asked, and the arm is
 * deliberately blind to devices that have never been here.
 */
async function launch({ arm = 'on', returning = true, link = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = { feed_page: a.rows, feed_best: [], log_skip: null, log_attempt: null, get_hide: null };
    localStorage.setItem('kamo_open_arm', a.arm);
    localStorage.setItem('kamo_feed_gate_arm', 'off');     // one experiment on stage at a time
    localStorage.setItem('kamo_feed_banger_arm', 'off');
    if (a.returning) localStorage.setItem('kamo_cam_asked', '1');
    localStorage.setItem('kamo_pw_first', '1');
    localStorage.setItem('kamo_feed_swiped', '1');
  }, { rows: ROWS, arm, returning });
  await page.goto(base + (link ? '?h=' + link : ''), { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  return page;
}
const feedUp = page => page.evaluate(() => !!document.getElementById('kfeed'));
const evs = page => page.evaluate(() => (window.__tr || []).map(e => e[0]));

console.log('\nTHE ARM DECIDES WHAT IS IN FRONT, AND ONLY THAT');
{
  const on = await launch({ arm: 'on' });
  await feedUp(on) ? ok('the "on" arm opens the app on the feed')
                   : bad('the "on" arm launched with no #kfeed — the experiment has no treatment');
  const booted = await on.evaluate(() => window.__booted | 0);
  booted === 1 ? ok('and the camera booted underneath it, so closing the feed lands on compose')
               : bad(`bootCamera ran ${booted} times on the "on" arm — the arm took the camera away instead of covering it`);
  const src = await on.evaluate(() => ((window.__tr || []).find(e => e[0] === 'feed_opened') || [])[1]);
  src && src.src === 'launch'
    ? ok('feed_opened names the door "launch", so the arm\'s exposure is readable')
    : bad(`feed_opened carried ${JSON.stringify(src)} — the arm\'s own opens are indistinguishable from taps`);
  await on.close();
}
{
  const off = await launch({ arm: 'off' });
  await feedUp(off) === false
    ? ok('the "off" arm opens on the camera, exactly as it does today')
    : bad('the control arm ALSO opened the feed — a leaking holdout is not a measurement');
  (await off.evaluate(() => window.__booted | 0)) === 1
    ? ok('and it boots the camera, once')
    : bad('the control arm did not boot the camera');
  await off.close();
}

console.log('\nA SHARE LINK OUTRANKS THE EXPERIMENT');
{
  const seek = await launch({ arm: 'on', link: 'abc123def4567890' });
  await feedUp(seek) === false
    ? ok('a ?h= link on the "on" arm still opens the hide it was sent for, not the feed')
    : bad('the arm took a share link — the sender\'s hide was replaced by strangers');
  (await seek.evaluate(() => window.__booted | 0)) === 0
    ? ok('and the seeker owns the launch, so no camera boots behind it')
    : bad('bootCamera ran on a share link — the seek path no longer owns its launch');
  await seek.close();
}

console.log('\nA FIRST LAUNCH IS NEVER DIVERTED');
{
  const fresh = await launch({ arm: 'on', returning: false });
  await feedUp(fresh) === false
    ? ok('a device that has never been here keeps its hero and its permission sheet')
    : bad('the arm hijacked a first launch — onboarding and open-destination changed together, and a permission sheet is now behind a feed');
  await fresh.close();
}

console.log('\nEVERY EVENT CARRIES THE ARM');
{
  const p = await launch({ arm: 'on' });
  const stamped = await p.evaluate(() => {
    const t = (window.__tr || []);
    return t.length ? t.every(e => e[1] && typeof e[1] === 'object') : false;
  });
  const names = await evs(p);
  names.includes('app_opened')
    ? ok('app_opened fires on the "on" arm, so the split has a denominator')
    : bad(`no app_opened in ${JSON.stringify(names.slice(0, 8))} — the arm has no denominator to divide by`);
  stamped ? ok('and every event carries a props object for the stamp to ride on')
          : bad('an event went out with no props — open_arm cannot ride it');
  await p.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the arm decides the first screen, the camera survives it, and a share link still wins');
process.exit(failed ? 1 : 0);
