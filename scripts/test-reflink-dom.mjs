#!/usr/bin/env node
/**
 * THE ONLY LINK IN KAMO THAT LEADS TO AN INSTALL.
 *
 * The seeker's "Play KAMO" button is the end of the viral loop: a stranger has just played
 * someone's hide in a browser and is deciding whether to install. Everything upstream of it
 * is already measured — 236 link opens and 43 taps on the day this was written — and
 * everything downstream was not, because the button pointed at the bare App Store listing,
 * so every install it earned was filed as organic and the loop looked like nothing.
 *
 * THIS CLICKS THE BUTTON AND READS WHERE THE BROWSER TRIES TO GO. It does not call refLink()
 * directly — the page's script is a module, so its top-level names are not reachable from
 * page.evaluate, and exposing one on window just to test it would ship a test-only global to
 * every user. Intercepting the navigation tests the thing that actually matters anyway: what
 * a real tap does.
 *
 * The empty-hide seed is the shortest route to the button. A hide with no img_path takes the
 * `seek_missing` branch, which renders the same ending card with the same CTA immediately,
 * with no gameplay to simulate — and it is a real state a stranger reaches, since hides expire.
 *
 * WHAT IT GUARDS, each a way to lose attribution without anything looking broken:
 *   1. The CTA must not fall back to the bare listing — the silent regression, where the loop
 *      keeps working and only the measurement disappears.
 *   2. The hide id must ride in deep_link_sub1, or an install is known to be referred but not
 *      by which hide.
 *   3. `c` must stay off `in_app_share`, which belongs to the wrapper's oneLinkFor() — merging
 *      a browser stranger into the members' campaign makes both unreadable.
 *   4. No af_referrer_customer_id: the browser has no customer id, and a wrong join key
 *      attributes installs to a user that does not exist.
 *   5. Blanking ONELINK_URL must degrade to the plain listing, never to a dead redirect.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-reflink-dom.mjs
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
  console.log('· playwright-core not installed — skipping the referral-link test — run: ' + PW_SETUP);
  process.exit(0);
}
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Same injection point as test-seek-dom: the seeker fetches its hide during load, so a stub
   appended at the end of the module arrives after the screen has already been drawn. */
const anchor = 'async function chRpc(fn,body){';
const withStub = (src) => src.replace(anchor, anchor + 'if(window.__seed&&window.__seed[fn]) return window.__seed[fn];');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

const { globSync } = await import('node:fs');
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

/* Serve one page, open it as a seeker, tap the CTA, and return the URL the browser was
   heading to. Every off-host request is aborted, so nothing leaves the machine and the
   store page is never actually fetched. */
async function tapCta(pageHtml, hid) {
  /* Real files for everything but the document. The page loads its script as a module, and a
     server that answers text/html to every path makes the browser refuse it under strict MIME
     checking — the whole app then silently does nothing, which looks exactly like a dead CTA. */
  const server = createServer((rq, rs) => {
    const p = decodeURIComponent(rq.url.split('?')[0]);
    if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(pageHtml); }
    try {
      const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
      rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
      rs.end(b);
    } catch { rs.writeHead(404); rs.end('x'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  let went = null;
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return route.continue();
    /* NAVIGATIONS ONLY. track() posts seek_cta_tapped to api.eu.amplitude.com from the same
       click handler, one line before the redirect — so "first off-host request" catches the
       analytics beacon and reports the CTA as broken when it is working perfectly. */
    if (!went && route.request().isNavigationRequest()) went = u;
    return route.abort();
  });
  /* No img_path → the seek_missing ending, which draws the CTA with no round to play. */
  await page.addInitScript(() => { window.__seed = { get_hide: {} }; });
  await page.goto(`${origin}/?h=${hid}`, { waitUntil: 'load' });
  await page.waitForSelector('#chGo', { timeout: 5000 }).catch(() => {});
  await page.click('#chGo').catch(() => {});
  await page.waitForTimeout(600);
  await page.close(); server.close();
  return went;
}

/* THE SAME CARD, OPENED INSIDE THE APP. Everything above is the browser stranger this button
   exists for. This is the other reader of the same markup: somebody who tapped the widget, or
   a notification, played the round in the wrapper, and was then offered the app they were
   already holding — a primary control that navigates an existing user to the App Store.
   Returns BOTH ids on purpose. "#chGo is absent" passes just as well when the ending card
   never rendered at all, which would hide a real break behind a green check; #chRep is drawn
   by the same expression list, so requiring it present is what makes the absence mean what it
   says. */
async function cardInWrapper(pageHtml, hid) {
  const server = createServer((rq, rs) => {
    const p = decodeURIComponent(rq.url.split('?')[0]);
    if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(pageHtml); }
    try {
      const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
      rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
      rs.end(b);
    } catch { rs.writeHead(404); rs.end('x'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__seed = { get_hide: {} };
    /* The wrapper, as the page tests for it everywhere: the object's presence IS the signal.
       postMessage has to exist and swallow — the page posts dom-ready from the first frame. */
    window.ReactNativeWebView = { postMessage() {} };
  });
  await page.goto(`${origin}/?h=${hid}`, { waitUntil: 'load' });
  await page.waitForSelector('#chRep', { timeout: 5000 }).catch(() => {});
  const seen = await page.evaluate(() => ({
    go: !!document.getElementById('chGo'),
    card: !!document.getElementById('chRep'),
  }));
  await page.close(); server.close();
  return seen;
}

console.log('\nTHE REFERRAL LINK AT THE END OF THE LOOP');

/* ---- the shipped page ---- */
{
  const u = await tapCta(withStub(real), 'abc123');
  if (!u) bad('tapping "Play KAMO" navigated nowhere — the CTA is dead');
  else {
    u.startsWith('https://kamo.onelink.me/')
      ? ok('the CTA sends the stranger through the OneLink, not the bare listing')
      : bad(`the CTA navigated to ${u} — an install from it lands as organic`);
    const q = new URLSearchParams(u.split('?')[1] || '');
    q.get('deep_link_sub1') === 'abc123'
      ? ok('deep_link_sub1 carries the hide id — an install can be traced to the hide that earned it')
      : bad(`deep_link_sub1 is ${JSON.stringify(q.get('deep_link_sub1'))}, expected the hide id`);
    q.get('pid') === 'user_referral'
      ? ok('pid=user_referral')
      : bad(`pid is ${JSON.stringify(q.get('pid'))}`);
    /* Present on every link AppsFlyer's own UI builds for this template. Without it the
       redirect still works and the install still happens — only the campaign stays empty,
       which reads as "the loop brings nobody" rather than as a broken link. */
    q.get('af_xp') === 'custom'
      ? ok('af_xp=custom — the click is declared the way AppsFlyer\'s own links declare it')
      : bad(`af_xp is ${JSON.stringify(q.get('af_xp'))} — the click may not be classified as acquisition`);
    q.get('c') && q.get('c') !== 'in_app_share'
      ? ok(`c=${q.get('c')} — separable from the wrapper's in_app_share`)
      : bad(`c is ${JSON.stringify(q.get('c'))} — browser referrals must not merge into the members' campaign`);
    q.get('af_referrer_customer_id') === null
      ? ok('no af_referrer_customer_id — the browser has no customer id to put there')
      : bad(`af_referrer_customer_id=${q.get('af_referrer_customer_id')} — that is not a customer id`);
  }
}

/* ---- the kill switch, exercised rather than read ---- */
{
  const off = real.replace('const ONELINK_URL="https://kamo.onelink.me/dc9X";', 'const ONELINK_URL="";');
  if (off === real) bad('could not find the ONELINK_URL constant to blank — the kill switch may be gone');
  else {
    const u = await tapCta(withStub(off), 'abc123');
    u === 'https://apps.apple.com/app/id6789639784'
      ? ok('blanking ONELINK_URL falls back to the plain listing — switching it off keeps the loop working')
      : bad(`with the template blanked the CTA went to ${u}`);
  }
}

/* ---- the id is interpolated into a URL, and it comes off a query string anyone can craft.
        CH_SEEK already strips it to [a-f0-9], so this asserts the SECOND layer: refLink must
        encode rather than concatenate, so the narrowing is not the only thing standing
        between a crafted link and a rewritten OneLink. Read from source because the first
        layer makes the hostile case unreachable through the URL — which is the point. ---- */
{
  const fn = real.match(/function refLink\(campaign,sub1\)\{[\s\S]*?\n\}/);
  if (!fn) bad('refLink() is gone from index.html');
  else {
    (fn[0].match(/encodeURIComponent/g) || []).length >= 2
      ? ok('refLink percent-encodes both the campaign and the id before splicing them in')
      : bad('refLink interpolates into the query string without encodeURIComponent on every value');
  }
}

/* ---- and the same card inside the app ---- */
console.log('\nAND IT IS NOT OFFERED TO SOMEBODY WHO ALREADY HAS THE APP');
{
  const seen = await cardInWrapper(withStub(real), 'abc123');
  if (!seen.card) bad('the ending card did not render in the wrapper at all — this case proves nothing');
  else if (seen.go) bad('#chGo is on the card inside the app — an existing user is being sent to the App Store to install what they are holding');
  else ok('no install button in the wrapper, and the card is still there');
}

await browser.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the referral link is attributed and safe');
process.exit(failed ? 1 : 0);
