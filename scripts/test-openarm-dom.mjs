#!/usr/bin/env node
/**
 * THE WAITING-REPLY ARM — a challenge that came back opens its own card, and the four ways
 * that turns from a delivery into an interruption.
 *
 * A reply is the only thing in KAMO that is both waiting for you and worth doing: somebody
 * built a round as an answer to yours. Today it lights an 18px dot on the wordmark and waits
 * for a tap most people never make. "on" opens the card chReplyCheck already has the rows for.
 *
 *   - THE LEAKING HOLDOUT. A control arm whose card also opens is not a smaller effect, it is
 *     no measurement, and the screen looks identical to a working experiment.
 *   - THE INTERRUPTION. The probe lands more than a second after launch, by which time the
 *     user may be composing, seeking, reading the feed or holding the share sheet. A card that
 *     takes the screen from any of those is the failure this arm has to avoid to be worth
 *     running at all.
 *   - THE STALE REOPEN. It must fire only on a reply NEWER than the mark this device stamped.
 *     Out of that branch it opens on every launch, forever, for the same old reply.
 *   - THE UNROUTED EXPOSURE. reply_auto_opened separates "arm was on" from "card actually
 *     opened". A new event name that never reaches Amplitude makes the arm read weaker than
 *     it is, and it is silently dropped on the live build unless it is on WEB_ONLY.
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

/* One reply, newer than any mark the device carries, so chReplyCheck's fresh branch fires. */
const REPLY = { id: 'r1', img_path: 'r1.jpg', name: 'zoe', created_at: '2026-08-22T10:00:00Z' };

/**
 * A device that published something (so my_replies is even asked) and has a reply waiting.
 * `seenAt` is the high-water mark; `busy` decides whether something owns the screen when the
 * probe lands, which is the whole of chHomeIdle().
 */
async function launch({ arm = 'on', reply = REPLY, seenAt = '', busy = null, link = '', hero = false } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = {
      my_replies: a.reply ? [a.reply] : [],
      my_reactions: [], feed_page: [], feed_best: [],
      log_skip: null, log_attempt: null, get_hide: null,
    };
    localStorage.setItem('kamo_reply_open_arm', a.arm);
    localStorage.setItem('kamo_feed_gate_arm', 'off');
    localStorage.setItem('kamo_feed_banger_arm', 'off');
    localStorage.setItem('kamo_hides', JSON.stringify(['mine1']));   // so chMine() is non-empty
    if (a.seenAt) localStorage.setItem('kamo_replies_seen', a.seenAt);
    localStorage.setItem('kamo_cam_asked', '1');
    localStorage.setItem('kamo_pw_first', '1');
    localStorage.setItem('kamo_feed_swiped', '1');
  }, { reply, arm, seenAt });
  await page.goto(base + (link ? '?h=' + link : ''), { waitUntil: 'load' });
  /* THE HERO HAS TO BE DOWN, and this is not harness convenience — it is the state the arm
     targets. A real returning device with the camera already granted reaches compose in
     ~200ms and never sees the hero; the harness has no camera, so the hero stays up forever
     and chHomeIdle() correctly refuses. `hero: true` leaves it up, which is its own test. */
  if (!hero) await page.evaluate(() => { const el = document.getElementById('start'); if (el) el.style.display = 'none'; });
  /* Put something on screen BEFORE the 1200ms probe lands — that is the race the idle test
     exists for, and testing it after the fact would test nothing. */
  if (busy) await page.evaluate((b) => {
    const el = document.getElementById(b);
    if (el) el.classList.add('show');
  }, busy);
  await page.waitForTimeout(2200);
  return page;
}
const homeUp = page => page.evaluate(() => {
  const el = document.getElementById('kamoHome');
  return !!(el && el.classList.contains('show'));
});
const feedUp = page => page.evaluate(() => !!document.getElementById('kfeed'));
const evs = page => page.evaluate(() => (window.__tr || []).map(e => e[0]));

console.log('\nA REPLY THAT CAME BACK OPENS ITSELF');
{
  const on = await launch({ arm: 'on' });
  await homeUp(on) ? ok('the "on" arm opens the card on a fresh reply, with no tap on the dot')
                   : bad('the "on" arm left the card closed — the experiment has no treatment');
  const ev = await on.evaluate(() => (window.__tr || []).filter(e => e[0] === 'reply_auto_opened').length);
  ev === 1 ? ok('and files reply_auto_opened once, which is the arm\'s real exposure')
           : bad(`reply_auto_opened fired ${ev} times — "on" and "on but stood down" are one number`);
  await on.close();
}
{
  const off = await launch({ arm: 'off' });
  await homeUp(off) === false
    ? ok('the "off" arm still just lights the dot, exactly as it does today')
    : bad('the control arm ALSO opened the card — a leaking holdout is not a measurement');
  await off.close();
}

console.log('\nAND IT NEVER TAKES THE SCREEN FROM SOMEBODY');
for (const [id, what] of [['shareSheet', 'the share sheet is up'], ['kamoPlus', 'the member card is up'], ['paywall', 'the paywall is up'], ['confirmSheet', 'a confirm sheet is up']]) {
  const p = await launch({ arm: 'on', busy: id });
  await homeUp(p) === false
    ? ok(`it stands down while ${what}`)
    : bad(`the card opened while ${what} — that is an interruption, not a delivery`);
  await p.close();
}
{
  const seek = await launch({ arm: 'on', link: 'abc123def4567890' });
  await homeUp(seek) === false
    ? ok('and it stands down on a share link — that arrival belongs to the hide it was sent for')
    : bad('the card opened over a share link, taking the screen from the hide somebody was handed');
  await seek.close();
}

console.log('\nONLY A REPLY THAT IS ACTUALLY NEW');
{
  const stale = await launch({ arm: 'on', seenAt: '2026-08-23T00:00:00Z' });
  await homeUp(stale) === false
    ? ok('a reply already seen does not reopen the card on the next launch')
    : bad('the card reopened on a reply this device has already seen — it will do that forever');
  await stale.close();
}
{
  const onHero = await launch({ arm: 'on', hero: true });
  await homeUp(onHero) === false
    ? ok('a launch still sitting on the hero is left alone — that screen is a permission ask')
    : bad('the card opened over the hero, on top of a camera permission ask');
  await onHero.close();
}
{
  const none = await launch({ arm: 'on', reply: null });
  await homeUp(none) === false
    ? ok('and a device with nothing waiting is left alone')
    : bad('the card opened with no reply at all');
  await none.close();
}

await browser.close(); server.close();
console.log(failed ? `\n\u2717 ${failed} failure(s)` : '\n\u2713 a fresh reply opens its own card, and only ever over an idle launch');
process.exit(failed ? 1 : 0);
