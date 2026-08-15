#!/usr/bin/env node
/**
 * THE HINT, ON THE SEEK SCREEN.
 *
 * Two things this file exists to stop, and they are not the happy path.
 *
 * ① NO BUTTON ON A SHIPPED BINARY. The web deploys the instant a PR merges; the purchase
 *    needs App.js, a build and an App Store review. Every user on 1.0.2 through 1.1.3 must
 *    see the hunt they saw yesterday — no button, no request, nothing. The gate is
 *    nativeCaps.hints, which no released build advertises, and the assertion below is the
 *    only thing standing between that promise and a one-character typo.
 *
 * ② THE ZONE MUST BE AN ELLIPSE. submit_attempt tests sqrt((x-cx)^2+(y-cy)^2) <= r on
 *    coordinates normalised PER AXIS, so on any non-square frame the server's region is an
 *    ellipse in pixels. Drawing a true circle would show a shape the answer is NOT
 *    guaranteed to sit inside — a hint that can point outside itself. The pixel dimensions
 *    are asserted against the frame's own width and height for that reason.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-hint-dom.mjs
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
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the hint test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Same technique as test-seek-dom.mjs: the seeker runs on load, so a hook appended at the end
   of the module is too late for anything it reads while building the screen. Both of these
   are values native pushes in AFTER load in production — seeding them at their declaration is
   the only way to have them in place when the hunt boots. */
let html = real;
for (const [anchor, patch] of [
  ['async function chRpc(fn,body){', 'if(window.__seed&&window.__seed[fn]!==undefined) return window.__seed[fn];'],
  ['let nativeCaps={};', 'try{ if(window.__caps) nativeCaps=window.__caps; }catch(e){}'],
  ['let chUserId="";', 'try{ if(window.__uid) chUserId=window.__uid; }catch(e){}'],
]) {
  if (html.indexOf(anchor) < 0) { console.error('  ✗ anchor missing from index.html: ' + anchor); process.exit(1); }
  html = html.replace(anchor, anchor + patch);
}

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
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

const HIDE = { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' };

/** Boot a hunt with the given capabilities, user id and canned hint_spend answer. */
async function hunt({ caps = {}, uid = '', spend = undefined } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(([h, c, u, s]) => {
    window.__seed = { get_hide: h, save_seek_trace: null };
    if (s !== undefined) window.__seed.hint_spend = s;
    window.__caps = c; window.__uid = u;
    /* postNative's only real job in this suite is answering "did the purchase leave the
       page, and with which product". ReactNativeWebView has to exist or the web takes the
       browser branch and never posts at all — the shape of a false pass. */
    window.__posted = [];
    window.ReactNativeWebView = { postMessage(m) { try { window.__posted.push(JSON.parse(m)); } catch (e) {} } };
  }, [HIDE, caps, uid, spend]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return page;
}

const btn = (page) => page.evaluate(() => {
  const b = document.getElementById('chHint');
  return b ? { text: b.textContent, disabled: b.disabled } : null;
});

console.log('\n① A SHIPPED BINARY SEES NOTHING — THIS IS THE LIVE-USER GUARANTEE');
{
  /* Exactly what 1.0.2 … 1.1.3 push in: every capability they know about, and not `hints`. */
  const shipped = { revealVideo: true, torch: true, invite: true, settings: true, eventsV2: true,
                    notifSchedule: true, handleStore: true, photoPicker: true };
  const p = await hunt({ caps: shipped, uid: 'user-1' });
  (await btn(p)) === null
    ? ok('no hint button on a build that does not advertise nativeCaps.hints')
    : bad('a released build would show the hint button — the capability gate is broken');
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 0 ? ok('and nothing is posted to StoreKit') : bad(`posted ${JSON.stringify(posted)}`);
  await p.close();
}
{
  const p = await hunt({ caps: { hints: true }, uid: '' });
  (await btn(p)) === null
    ? ok('no button without a RevenueCat user id — the wallet would have no owner to credit')
    : bad('the button appeared with no user id');
  await p.close();
}

console.log('\n② THE BUTTON APPEARS ON A BUILD THAT CAN HONOUR IT');
const REG = { cx: 0.5, cy: 0.4, r: 0.2 };
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'free', region: REG, balance: 0, free_available: false } });
  const b = await btn(p);
  b && b.text === 'Hint' && !b.disabled ? ok('the hint button is rendered and tappable') : bad(`button is ${JSON.stringify(b)}`);

  await p.click('#chHint');
  await p.waitForTimeout(400);

  const z = await p.evaluate(() => {
    const el = document.querySelector('.chHintZone'), fr = document.getElementById('chFrame');
    const im = fr && fr.querySelector('img');
    if (!el || !im) return null;
    return { w: Math.round(parseFloat(el.style.width)), h: Math.round(parseFloat(el.style.height)),
             left: Math.round(parseFloat(el.style.left)), top: Math.round(parseFloat(el.style.top)),
             iw: im.offsetWidth, ih: im.offsetHeight,
             inFrame: el.parentElement === fr };
  });
  if (!z) bad('no hint zone was drawn');
  else {
    /* THE ASSERTION THIS FILE WAS WRITTEN FOR. */
    const wantW = Math.round(2 * REG.r * z.iw), wantH = Math.round(2 * REG.r * z.ih);
    z.w === wantW && z.h === wantH
      ? ok(`the zone is an ellipse scaled per axis (${z.w}×${z.h} on a ${z.iw}×${z.ih} frame)`)
      : bad(`zone is ${z.w}×${z.h}, expected ${wantW}×${wantH} — a circle here would mis-state the server's region`);
    z.left === Math.round(REG.cx * z.iw) && z.top === Math.round(REG.cy * z.ih)
      ? ok('centred on the region the server returned')
      : bad(`zone at ${z.left},${z.top} for region ${REG.cx},${REG.cy} on ${z.iw}×${z.ih}`);
    z.inFrame
      ? ok('and it lives inside #chFrame, so it rides the zoom instead of sliding off the photo')
      : bad('the zone is not a child of #chFrame — it will not follow a pinch');
  }
  const b2 = await btn(p);
  b2 && b2.disabled ? ok('the button locks after the zone is shown') : bad(`button after use: ${JSON.stringify(b2)}`);
  await p.close();
}

console.log('\n③ THE SERVER REFUSES — NOTHING IS SOLD, THE CONTROL RETIRES');
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'none', reason: 'hide_too_easy', balance: 0, free_available: false } });
  await p.click('#chHint');
  await p.waitForTimeout(300);
  const b = await btn(p);
  b && b.text === 'No hint here' && b.disabled
    ? ok('a hide too easy to be worth selling says so instead of charging')
    : bad(`button reads ${JSON.stringify(b)}`);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 0 ? ok('and no purchase is offered for it') : bad(`offered a purchase anyway: ${JSON.stringify(posted)}`);
  await p.close();
}

console.log('\n④ AN EMPTY WALLET IS THE ONLY THING THAT OPENS STOREKIT');
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'none', reason: 'empty', balance: 0, free_available: false } });
  await p.click('#chHint');
  await p.waitForTimeout(300);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 1 && posted[0].product === 'com.blisscoach.kamo.hints5'
    ? ok('an empty wallet posts a purchase for the pack, by its exact product id')
    : bad(`posted ${JSON.stringify(posted)}`);
  const z = await p.evaluate(() => !!document.querySelector('.chHintZone'));
  !z ? ok('and no zone is revealed before it is paid for') : bad('a zone was drawn without a spend');

  /* The webhook credits the wallet a moment later; native then knocks. */
  await p.evaluate(() => { window.__seed.hint_spend = { used: 'paid', region: { cx: 0.5, cy: 0.4, r: 0.2 }, balance: 4 }; });
  await p.evaluate(() => window.KAMO.hintsPurchased());
  await p.waitForTimeout(600);
  const after = await btn(p);
  const zone = await p.evaluate(() => !!document.querySelector('.chHintZone'));
  zone && after && after.text === '4 left'
    ? ok('hintsPurchased() polls the wallet, draws the zone and shows what is left')
    : bad(`after purchase: zone=${zone} button=${JSON.stringify(after)}`);
  await p.close();
}

console.log('\n⑤ THE ROUND IS OVER — THE HINT GOES WITH IT');
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'free', region: REG, balance: 0 } });
  await p.evaluate(() => { window.__seed.submit_attempt = { hit: false, tries: 1, missed: 1, secs: 9 }; });
  const box = await p.evaluate(() => { const r = document.getElementById('chStage').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(900);
  (await btn(p)) === null
    ? ok('one tap ends the round and the hint button leaves with the give-up button')
    : bad('the hint button survived the buzz — it would sell help for a shot already spent');
  await p.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} hint check(s) failed` : '\n✓ hint checks passed');
process.exit(failed ? 1 : 0);
