#!/usr/bin/env node
/**
 * THE ONE-LINE MESSAGE HAS TO BE ON TOP OF WHATEVER IT IS ABOUT.
 *
 * showHint() is the only channel this app has for a sentence: "Reported. Thank you.", "Link
 * copied — paste it with your post", "Couldn't load the replay", "Still going up — give it a
 * second and tap again", "That one is in the app — tap to get KAMO, free", "Your hints are on
 * the way". Every one of those is fired FROM a full-screen surface — the reveal, the share
 * sheet, a seek round, the feed, My kamos, the player card.
 *
 * And #hint shipped at z-index 12, inside #app. So it was painted, with the right text and
 * opacity 1, underneath every one of them. The only screen it ever worked on was the camera.
 * The file already knew about one case — camFail() routes camera errors into #heroMsg with
 * the note "#hint lives under the opaque #start overlay (z-index 30) → invisible on the hero"
 * — a workaround written for the hero and never generalised as five more surfaces landed.
 *
 * TWO THINGS MAKE IT WORK AND A TEST ON EITHER ALONE WOULD PASS ON A BROKEN APP:
 *   · the z-index, and
 *   · the PARENT. #app is position:fixed, which creates a stacking context in every engine
 *     this ships on, so a z-index inside it can never beat the feed, the seek round or the
 *     player card — those are appended to <body>. Raising the number alone fixed the reveal
 *     and changed nothing on the three that matter most.
 *
 * ASSERTED BY HIT-TESTING, NOT BY READING z-index. Hit-testing follows paint order, so
 * elementFromPoint over the pill answers the real question — "is this the thing on screen
 * there" — rather than the arithmetic question. The pill ships pointer-events:none, so the
 * probe turns that on for the duration of the read and puts it back.
 *
 * The last case is the opposite claim: the full-bleed paywall covers the screen ON PURPOSE
 * and the pill must go quiet under it. That rule used to hang off #stage.pwCover; the element
 * is not inside #stage any more, so if it were not re-hung the pill would now float over the
 * one screen the arm exists to keep clean.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-toast-dom.mjs
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
if (!chromium) {
  console.log('· playwright-core not installed — skipping the toast test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const anchor = 'async function chRpc(fn,body){';
if (!real.includes(anchor)) { console.error('  ✗ chRpc anchor missing from index.html'); process.exit(1); }
let html = real.replace(anchor, anchor +
  'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');
html = html.replace('async function chRpcRows(fn,body){', 'async function chRpcRows(fn,body){' +
  'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)){const v=window.__seed[fn];return Array.isArray(v)?v:(v?[v]:[]);}');

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MIME = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const ROWS = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'h' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'marie',
  n_attempts: 4, n_found: 1, created_at: '2026-08-19T10:0' + i + ':00Z',
}));

async function open(url, before) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => bad('PAGE ERROR: ' + e.message));
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.addInitScript((rows) => {
    window.__seed = {
      feed_page: rows, feed_best: [], my_replies: [], save_seek_trace: null,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 4, n_found: 1, limit_s: null, max_taps: null, name: 'marie' },
      submit_attempt: { hit: false, tries: 2, missed: 1, secs: 9, pct: 20, others: 0 },
      reveal_hide: { cx: 0.5, cy: 0.5, r: 0.1 },
    };
  }, ROWS(3));
  if (before) await before(page);
  await page.goto(base + (url || ''), { waitUntil: 'load' });
  await page.waitForTimeout(1100);
  return page;
}

/* Set a message and ask the page what is painted where the pill is. pointer-events is flipped
   only for the duration of the read: hit-testing follows paint order, so with it on, "the pill
   answers" and "the pill is the thing you can see" are the same statement. */
const onTop = (page) => page.evaluate(() => {
  const h = document.getElementById('hint');
  if (!h) return { err: 'no #hint' };
  h.textContent = 'PROBE'; h.style.opacity = '1';
  const pe = h.style.pointerEvents;
  h.style.pointerEvents = 'auto';
  const r = h.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  h.style.pointerEvents = pe;
  const cs = getComputedStyle(h);
  return {
    top: !!(el && (el === h || h.contains(el))),
    by: el ? (el.id || el.className || el.tagName) : 'nothing',
    parent: h.parentElement ? h.parentElement.tagName : '?',
    vis: cs.visibility, w: Math.round(r.width),
  };
});

console.log('\nTHE PILL IS ON TOP OF EVERY SURFACE THAT CAN SEND A MESSAGE');
{
  /* THE PARENT IS HALF THE FIX. Asserted on its own as well as through the surfaces, because
     a future tidy-up that moves the element back inside #app would put every one of those
     messages back under the feed, and the z-index would still read 9800. */
  const page = await open();
  const g = await onTop(page);
  g.parent === 'BODY'
    ? ok('#hint hangs off <body>, outside #app\'s fixed-position stacking context')
    : bad(`#hint's parent is ${g.parent} — inside #app no z-index can clear the feed`);
  /* The HERO, which is the case the file already knew about: camFail()'s note says #hint is
     "invisible on the hero" under #start (z 30) and routes camera errors to #heroMsg instead.
     That workaround stays — a message inside the card reads better there — but the pill is no
     longer buried, so every OTHER line spoken while the hero is up now arrives. */
  g.top ? ok('on the hero (#start, z 30) — the case camFail had to work around') : bad(`covered on the hero by ${g.by}`);
  await page.close();
}
{
  const page = await open('?h=abc123');
  const g = await onTop(page);
  g.top ? ok('on a seek round (.chS, z 9000)') : bad(`covered on a seek round by ${g.by}`);
  await page.close();
}
{
  const page = await open();
  await page.evaluate(() => window.KAMOFEED.open());
  await page.waitForTimeout(1300);
  const g = await onTop(page);
  g.top ? ok('on the feed (#kfeed, z 9400)') : bad(`covered on the feed by ${g.by}`);
  await page.close();
}
{
  /* My kamos and Challenges live INSIDE #kfeed, and they are where the replay errors, the
     heat-map errors and the locked-Watch upsell are spoken. */
  const page = await open('', (p) => p.addInitScript(() => {
    try { localStorage.setItem('kamo_hides', JSON.stringify(['m1'])); } catch (e) {}
  }));
  await page.evaluate(() => window.KAMOFEED.open());
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('kfScope').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = document.querySelector('#kfMenu button[data-s="mine"]'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  const g = await onTop(page);
  g.top ? ok('over My kamos, where the replay and the upsell speak') : bad(`covered over My kamos by ${g.by}`);
  await page.close();
}
{
  const page = await open();
  /* The wordmark is a real tap — pointerdown, no drift, under 600ms — not element.click(). */
  const r = await page.evaluate(() => { const b = document.querySelector('.brand').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForTimeout(1100);
  const shown = await page.evaluate(() => document.getElementById('kamoHome').classList.contains('show'));
  shown ? ok('the player card opens on a wordmark tap') : bad('the player card never opened — this case proves nothing');
  const g = await onTop(page);
  g.top ? ok('and the pill clears it too (#kamoHome, z 9450)') : bad(`covered on the player card by ${g.by}`);
  await page.close();
}

console.log('\nAND IT STILL GOES QUIET WHERE IT IS MEANT TO');
{
  /* The full-bleed arm covers the screen deliberately — see the .pwCover block. That rule was
     written as `#stage.pwCover #hint`, which stopped reaching the element the moment it moved
     to <body>; body.pwCover is set by the same line and is what carries it now. */
  const page = await open('', (p) => p.addInitScript(() => {
    try { localStorage.setItem('kamo_pw_design', 'full'); } catch (e) {}
    window.ReactNativeWebView = { postMessage() {} };
    const iv = setInterval(() => {
      if (window.KAMO && window.KAMO.setPrices) { clearInterval(iv); window.KAMO.setPrices({ weekly: '$2.99', lifetime: '$19.99', trial: '3 days' }); }
    }, 10);
  }));
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 80;
    c.getContext('2d').fillStyle = '#7a8a6a'; c.getContext('2d').fillRect(0, 0, 60, 80);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'r.jpg', { type: 'image/jpeg' }));
    const inp = document.getElementById('fileInput'); inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('btnPlus').click());
  await page.waitForTimeout(1300);
  const armed = await page.evaluate(() => document.body.classList.contains('pwCover'));
  armed ? ok('the full-bleed arm is up') : bad('the full arm never engaged — the case below proves nothing');
  const g = await onTop(page);
  g.vis === 'hidden'
    ? ok('and the pill is hidden under it, the way .pwCover intends')
    : bad(`the pill is ${g.vis} over the full-bleed paywall — body.pwCover no longer reaches #hint`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the message channel is above every surface that speaks through it');
process.exit(failed ? 1 : 0);
