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
/* THE THIRD GATE IS DRIVEN, NOT BYPASSED. HINTS_LIVE ships false — the product is a separate
   Apple approval from the binary, and between the two every tap on Hint would open a purchase
   sheet for something that does not exist. The served copy reads it off window so BOTH states
   are reachable here; the shipped file is asserted to be false further down, which is the half
   that actually protects the fleet. */
/* The anchor matches EITHER shipped value. Pinning it to `false` meant that the day the flag was
   deliberately flipped (PR #293, Hint shown to App Review) this whole suite exited 1 before its
   first assertion — the gate went dark on the exact change it exists to watch, and took the
   repo's CI with it. Which state ships is asserted further down; getting the file instrumented
   is not the place to have an opinion about it. */
let real2 = real.replace(/const HINTS_LIVE=(?:false|true);/, 'const HINTS_LIVE=(window.__hintsLive===true);');
if (real2 === real) { console.error('  ✗ HINTS_LIVE anchor missing from index.html'); process.exit(1); }
let html = real2;
for (const [anchor, patch] of [
  ['async function chRpc(fn,body){', 'if(window.__seed&&window.__seed[fn]!==undefined) return window.__seed[fn];'],
  ['let nativeCaps={};', 'try{ if(window.__caps) nativeCaps=window.__caps; }catch(e){}'],
  ['let chUserId="";', 'try{ if(window.__uid) chUserId=window.__uid; }catch(e){}'],
  /* The pack's localized price does not exist on this side yet — setPrices() carries `weekly`
     and `lifetime` and nothing else, and sending a third needs App.js, a build and a review.
     It is seeded here anyway because the label appends it the day that ships, and the label's
     width is what ⑧ is about: the offer is the longest sentence this button ever holds, and it
     gets longer. Testing only the states that exist today would pin the geometry to the one
     storefront that has no currency symbol. */
  ['let hintPackPrice="";', 'try{ if(window.__price) hintPackPrice=window.__price; }catch(e){}'],
  /* EVERY EVENT THIS PAGE SENDS, recorded where they are all born. The tap rate the "last
     life" pill was shipped to move is a ratio over hint_offered and hint_tapped, and a suite
     that cannot see either one can only assert that a button exists. */
  ['function track(event,props){', 'try{ (window.__tracked=window.__tracked||[]).push([event,props]); }catch(e){}'],
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
/* THE ROUND'S PHOTO HAS TO ARRIVE, or this suite asserts against a failure screen.
   chSeek() grew an img.onerror: a camo image that never loads now says so on the headline
   ("This one didn't load"), stops the clock and refuses the buzz, instead of leaving a live
   round on a black rectangle. That is the fix — and it means a harness which never serves the
   photo is no longer testing the round it thinks it is. One transparent pixel is enough here:
   these cases are about what is written above the picture, not about the picture. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/* AND A REAL ONE FOR THE CASES THAT MEASURE THE ZONE. 600×800 of flat grey: the pixel above
   renders 1×1, so a zone drawn on it is 1px across and every geometric assertion about it
   passes on nothing. ⑦ is about where the ellipse LANDS and whether it is still there a
   moment later, which needs a frame with a size. */
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAlgAAAMgCAAAAADaC0MYAAAFdUlEQVR42u3SMQ0AAAzDsOIsfyAFMe2zIURJ4UEkwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWBhLAoyFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjIWxJMBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlgYSwKMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYCy4GsBZUnusS0pAAAAAASUVORK5CYII=', 'base64');
const servePhoto = (page, big) => page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: big ? PHOTO : PIXEL }));
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const HIDE = { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' };

/** Boot a hunt with the given capabilities, user id and canned hint_spend answer. */
async function hunt({ caps = {}, uid = '', spend = undefined, state = undefined, big = false, price = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page, big);
  await page.addInitScript(([h, c, u, s, st, pr]) => {
    window.__hintsLive = true;          // on, unless a case below turns it off
    /* hint_state is read on mount by every hunt now (the balance decorates the idle label),
       and hint_intent/hint_claim are on the unidentified-device purchase path. Seeded flat so
       no case reaches the network; individual cases override what they are about. */
    window.__seed = { get_hide: h, save_seek_trace: null,
                      hint_state: st || { balance: 0, free_available: true },
                      hint_intent: { ok: true }, hint_claim: { claimed: false, reason: 'no_grant' } };
    if (s !== undefined) window.__seed.hint_spend = s;
    if (pr) window.__price = pr;
    window.__caps = c; window.__uid = u;
    /* postNative's only real job in this suite is answering "did the purchase leave the
       page, and with which product". ReactNativeWebView has to exist or the web takes the
       browser branch and never posts at all — the shape of a false pass. */
    window.__posted = [];
    window.ReactNativeWebView = { postMessage(m) { try { window.__posted.push(JSON.parse(m)); } catch (e) {} } };
  }, [HIDE, caps, uid, spend, state, price]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return page;
}

const btn = (page) => page.evaluate(() => {
  const b = document.getElementById('chHint');
  return b ? { text: b.textContent, disabled: b.disabled, loading: b.classList.contains('chLoad') } : null;
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
  /* NO RevenueCat ID: THE BUTTON COMES, AND SO DOES THE SHEET — ONCE THE CREDIT HAS A ROUTE.
     This assertion has now been written three ways, and the middle one was wrong in a way
     worth recording. It first said "no id, no button", which protected the wallet by deleting
     the feature: App.js sets chUserId from ONE unretried getAppUserID(), so a device that
     loses that race could never see Hint again — which is exactly what happened on the
     founder's phone across 1.1.4 and 1.1.5. It then said "button yes, sheet never", which
     protected the money by making the only consumable this app sells unbuyable on those same
     devices. Both halves are recoverable: hint_intent() stamps the sheet opening and
     hint_claim() hands the grant to the device key, so the sheet may open — but ONLY if that
     stamp answers. A purchase with no route to a credit is the one outcome worth refusing. */
  const p = await hunt({ caps: { hints: true }, uid: '',
                         spend: { used: 'none', reason: 'empty', balance: 0, free_available: false } });
  const b0 = await btn(p);
  b0 && b0.text === 'Free hint'
    ? ok('the free hint is offered with no RevenueCat id — the wallet falls back to the device')
    : bad(`no button without a user id: ${JSON.stringify(b0)} — the unidentified device is the bug, not the guard`);
  await p.click('#chHint');
  await p.waitForTimeout(600);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 1 && posted[0].product === 'com.blisscoach.kamo.hints5'
    ? ok('and the pack can be bought once the intent is stamped — the claim brings the credit back')
    : bad(`no purchase left the page with the intent stamped: ${JSON.stringify(posted)}`);
  await p.close();
}
{
  /* THE STAMP IS THE SWITCH. Migration not applied, network gone — either way the credit has
     no route home, so nothing is sold. */
  const p = await hunt({ caps: { hints: true }, uid: '',
                         spend: { used: 'none', reason: 'empty', balance: 0, free_available: false } });
  await p.evaluate(() => { window.__seed.hint_intent = { ok: false }; });
  await p.click('#chHint');
  await p.waitForTimeout(600);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 0
    ? ok('and nothing is sold when the intent cannot be stamped — a credit with no route home')
    : bad(`a purchase left the page with no claim path: ${JSON.stringify(posted)}`);
  /* ⚠️ AND WHAT IT SAYS WHILE REFUSING, WHICH WAS A LIE ON THE TAP THAT MATTERS MOST.
     This retired the button reading "Hint used" — on a wallet that was EMPTY, i.e. after a
     button that read "No more hints. Get 5 Hints". The player accepted an offer to buy and
     was told they had already spent something they never had, on the only paid door in this
     app, which then greyed out and vanished. Refusing the sale is right; describing it as a
     spend is not, and there is no way back from it.
     The refusal has two causes and this side cannot tell them apart, so the first one is
     treated as the blink it usually is — button alive, real sentence, offer intact. */
  const b1 = await btn(p);
  b1 && !b1.disabled && /store/i.test(b1.text) && !/used/i.test(b1.text)
    ? ok(`a refused stamp says what actually went wrong and keeps the offer ("${b1.text}")`)
    : bad(`the refusal reads ${JSON.stringify(b1)} — "Hint used" is a spend that never happened`);
  /* Twice on one screen is a wall, not a blink, and a control that cannot succeed should not
     sit there looking tappable — the same rule retireHint() was written under, now applied to
     a sentence that is true. */
  await p.click('#chHint');
  await p.waitForTimeout(600);
  const b2 = await btn(p);
  b2 && b2.disabled && /unavailable/i.test(b2.text)
    ? ok(`and a second refusal retires it honestly ("${b2.text}")`)
    : bad(`the second refusal reads ${JSON.stringify(b2)}`);
  const posted2 = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted2.length === 0
    ? ok('and still nothing was sold across either tap')
    : bad(`a purchase left the page on retry: ${JSON.stringify(posted2)}`);
  await p.close();
}

console.log('\n② THE BUTTON APPEARS ON A BUILD THAT CAN HONOUR IT');
const REG = { cx: 0.5, cy: 0.4, r: 0.2 };
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'free', region: REG, balance: 0, free_available: false } });
  const b = await btn(p);
  /* "1 Hint" until 2026-08-20, which is a quantity and never said the word that gets the first
     tap. The free daily is also the reason to come back tomorrow, and an allowance nobody is
     told about is an allowance nobody returns for. */
  b && b.text === 'Free hint' && !b.disabled ? ok('the free daily is named on the button') : bad(`button is ${JSON.stringify(b)}`);

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
    /* FOUR radii, not two: the element is the mask, 2x the region on each axis, with the clear
       core at the gradient's 50% — see .chHintZone and ⑦. The per-axis scaling is the point
       and is unchanged; only the multiple moved. */
    const wantW = Math.round(4 * REG.r * z.iw), wantH = Math.round(4 * REG.r * z.ih);
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
  /* THAT SPEND EMPTIED THE WALLET (balance 0), SO THE BUTTON BECOMES THE OFFER.
     It used to read "Hint used" and go dead, and this assertion used to demand exactly that.
     The consequence was that the only route to the pack ran through ANOTHER hide: leave this
     one, open the next, tap into an empty wallet, and meet the sheet on the round trip — a
     purchase nobody navigates toward because nobody has been shown it. App Review least of
     all, since hint_spend spends the free daily first: one tap reveals the zone for nothing
     and the sheet is never reached at all. PR #295. */
  const b2 = await btn(p);
  b2 && b2.text === 'Get 5 hints' && !b2.disabled
    ? ok('the spent button becomes the pack offer, still tappable')
    : bad(`button after use: ${JSON.stringify(b2)}`);
  /* AND IT QUOTES NO PRICE. setPrices() carries `weekly` and `lifetime` and nothing else, so
     a figure here could only be hardcoded — right in the US and wrong everywhere else, which
     is the misstatement #pwPerDay stays hidden to avoid. Apple's sheet states the real one. */
  /[$€£¥₹]|\d+[.,]\d{2}/.test((b2 && b2.text) || '')
    ? bad(`the offer label quotes a price (${b2.text}) — the pack's price does not exist on this side`)
    : ok('and quotes no price, because the page has none to quote');

  await p.click('#chHint');
  await p.waitForTimeout(400);
  const bought = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  bought.length === 1 && bought[0].product === 'com.blisscoach.kamo.hints5'
    ? ok('and one tap on it opens StoreKit for the pack, by its exact product id')
    : bad(`tapping the offer posted ${JSON.stringify(bought)}`);
  await p.close();
}

/* The other half of that branch, and the reason it is a branch at all: somebody who still
   holds hints is not a buyer, so the button must lock exactly as it always did rather than
   sell them what they already have. */
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'paid', region: REG, balance: 3, free_available: false } });
  await p.click('#chHint');
  await p.waitForTimeout(400);
  const b = await btn(p);
  b && b.text === '\u2713 3 hints left' && b.disabled
    ? ok('a spend off a stocked wallet locks the button and states the balance')
    : bad(`button after a stocked spend: ${JSON.stringify(b)}`);
  /* ⚠️ AND IT IS NOT DIMMED. .chHint[disabled] is 45% opacity, which is the right reading for a
     control that died and the wrong one for the receipt of something bought: this is the only
     place in the app that states what a purchase is still worth, and it was rendering as the
     greyed-out husk of a broken button. Untappable is correct — one hint per hide, and the
     server answers `already` to a second ask — so the attribute stays and only the dimming goes. */
  const opac = await p.evaluate(() => { const e = document.getElementById('chHint'); return e && +getComputedStyle(e).opacity; });
  opac === 1
    ? ok('and a paid balance is drawn at full strength, not as a dead control')
    : bad(`the balance receipt is drawn at opacity ${opac} — a purchase reading as broken`);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 0
    ? ok('and nothing is sold to somebody who already has hints')
    : bad(`offered a purchase anyway: ${JSON.stringify(posted)}`);
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
  zone && after && after.text === '\u2713 4 hints left'
    ? ok('hintsPurchased() polls the wallet, draws the zone and shows what is left')
    : bad(`after purchase: zone=${zone} button=${JSON.stringify(after)}`);
  await p.close();
}

/* ⑤ IS THE DOOR THE PRODUCT ACTUALLY SELLS THROUGH, and it had no test at all.
   ④ above buys from an EMPTY wallet on a fresh hide, where hint_spend has no region to give
   until the credit lands — so a poll that waits for a region happens to be right there. The
   offer that sells is the other one: the free daily is spent on THIS hide, the zone is
   already on screen, and hint_spend answers `already` WITH that region on the very first
   poll, before the webhook has credited anything. A poll that exits on the region there tells
   somebody who has just paid that their hint is "used" and their balance is zero. */
console.log('\n⑤ BOUGHT FROM THE POST-USE OFFER — THE POLL WAITS FOR THE CREDIT, NOT THE ZONE');
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'free', region: REG, balance: 0, free_available: false } });
  await p.click('#chHint');                       // the free daily: zone drawn, wallet empty
  await p.waitForTimeout(400);
  /* What the server says from here on: this hide's hint is spent, so the same region comes
     back under `already` and the wallet is untouched — 0 until the webhook lands. */
  const ALREADY = { used: 'already', via: 'free', region: REG, balance: 0, free_available: false };
  await p.evaluate((s) => { window.__seed.hint_spend = s; }, ALREADY);
  await p.click('#chHint');                       // the empty-wallet offer → StoreKit
  await p.waitForTimeout(200);
  const bought = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  bought.length === 1 ? ok('the offer opens StoreKit once') : bad(`posted ${JSON.stringify(bought)}`);

  await p.evaluate(() => window.KAMO.hintsPurchased());
  await p.waitForTimeout(700);
  const mid = await btn(p);
  mid && mid.loading
    ? ok('and the button holds while the webhook is still in flight')
    : bad(`the poll gave up before the credit — the button reads ${JSON.stringify(mid)}, which `
        + 'is what somebody who has just paid would be looking at');

  await p.evaluate((s) => { window.__seed.hint_spend = s; },
                   { used: 'already', via: 'free', region: REG, balance: 5, free_available: false });
  await p.waitForTimeout(2200);
  const after = await btn(p);
  after && after.text === '\u2713 5 hints left'
    ? ok('and states the pack the moment the wallet grows')
    : bad(`after the credit the button reads ${JSON.stringify(after)}`);
  await p.close();
}

/* AND WHEN THE CREDIT NEVER ARRIVES, THE BUTTON MUST NOT BE A SECOND PURCHASE. The copy on
   this path invites exactly one gesture — tap again in a moment — and it used to land on
   offerHintPack, i.e. Apple's sheet, for a pack that has already been paid for. */
{
  const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                         spend: { used: 'free', region: REG, balance: 0, free_available: false } });
  await p.click('#chHint');
  await p.waitForTimeout(400);
  await p.evaluate((s) => { window.__seed.hint_spend = s; },
                   { used: 'already', via: 'free', region: REG, balance: 0, free_available: false });
  await p.click('#chHint');
  await p.waitForTimeout(200);
  await p.evaluate(() => window.KAMO.hintsPurchased());
  await p.waitForTimeout(11000);                  // six polls at 1.5s, and not one of them credited
  const b = await btn(p);
  b && !b.disabled ? ok('the button comes back after a credit that never lands') : bad(`button is ${JSON.stringify(b)}`);
  // Tolerated rather than awaited: a dead button is a failure this suite REPORTS, not one it
  // crashes on — the assertion below is what says whether a second sheet was opened.
  await p.click('#chHint', { timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(300);
  const posted = await p.evaluate(() => window.__posted.filter((m) => m && m.type === 'purchase'));
  posted.length === 1
    ? ok('and tapping it re-checks the wallet instead of buying the pack twice')
    : bad(`the same pack was bought ${posted.length} times — the slow-credit button re-opens StoreKit`);
  await p.close();
}

/* THE CANCEL, WHICH IS THE COMMONEST OUTCOME OF ANY PURCHASE SHEET. Native answers a
   userCancelled with buyDone() and every failure with a toast through window.KAMO.hint —
   both of which used to clear the paywall's spinner and nothing else, leaving the hint
   button spinning for the full 45s of its own timer. */
{
  for (const [name, fire] of [
    ['buyDone() after a StoreKit cancel', () => window.KAMO.buyDone()],
    ['an error toast from native', () => window.KAMO.hint('Purchase failed — please try again')],
  ]) {
    const p = await hunt({ caps: { hints: true }, uid: 'user-1',
                           spend: { used: 'free', region: REG, balance: 0, free_available: false } });
    await p.click('#chHint');
    await p.waitForTimeout(400);
    await p.click('#chHint');                     // the empty-wallet offer → the sheet, button spinning
    await p.waitForTimeout(200);
    const during = await btn(p);
    if (!during || !during.loading) bad(`button did not show the spinner before the cancel: ${JSON.stringify(during)}`);
    await p.evaluate(fire);
    await p.waitForTimeout(200);
    const after = await btn(p);
    after && after.text === 'Get 5 hints' && !after.disabled
      ? ok(`${name} hands the offer back at once`)
      : bad(`after ${name} the button is ${JSON.stringify(after)} — it will sit there for 45s`);
    await p.close();
  }
}

console.log('\n⑥ THE ROUND IS OVER — THE HINT GOES WITH IT');
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

/* THE FLAG THAT SHIPS, AND THE ONE THAT MATTERS. Everything above runs with HINTS_LIVE forced
   on, so none of it can see the state the fleet is actually in. Two assertions close that:
   the button must be absent when the flag is off even with every other gate open, and the
   FILE must ship with it off until com.blisscoach.kamo.hints5 reads APPROVED in App Store
   Connect. Apple will not take a first consumable without a version, so the binary lands
   before the product does — and in that window a visible Hint sells a product that does not
   exist. */
console.log('\n⑦ THE ZONE SURVIVES THE ROUND — THIS IS THE THING THAT WAS PAID FOR');
/* ⚠️ IT DID NOT. .chHintZone ran chPop, the flash the buzz mark uses on its way to .stay, and
   chPop ends at opacity:0 with animation-fill-mode:forwards — so the one thing a player buys
   was on screen for 0.45s and then gone for the rest of a round they still had to win.
   Measured before the fix, on this harness: computed opacity 0.61 at 100ms, 0.10 at 300ms,
   0 from 450ms onward, permanently.
   AND chPop ANIMATES `transform`, which erases the translate(-50%,-50%) that centres the
   ellipse on the region — so for its short life it hung down and right of the answer by half
   its own size, i.e. it pointed somewhere the kamo was not.
   The old suite passed through both because it read el.style.left/width — the inline values
   the code had just written — and never asked the browser what was on screen. These
   assertions go through getComputedStyle and getBoundingClientRect for that reason. */
{
  const REG7 = { cx: 0.42, cy: 0.33, r: 0.18 };
  const p = await hunt({ caps: { hints: true }, uid: 'user-1', big: true,
                         state: { balance: 3, free_available: true },
                         spend: { used: 'free', region: REG7, balance: 3, free_available: false } });
  /* THE BEAT THAT PROVES THE PURCHASE, now carried by the mask's own opacity rather than by a
     second element. The spotlight dips to full strength as it lands and eases back to its
     resting level — so the player SEES the search collapse instead of being handed a shape and
     left to infer it. The mask does NOT lift any more: it is the hint, not an announcement of
     one, and the old temporary dim left a naked ring behind within the second.
     ⚠️ SAMPLED OVER THE WINDOW, NOT READ AT AN INSTANT. This first asked for the opacity 300ms
     after the tap, which is where the 620ms entry peaks — and that passed alone and failed
     inside the full gate at 0.884, because a dozen Chromes sharing a machine do not run an
     animation to the same phase at the same wall-clock moment. The assertion is about whether
     a dip HAPPENS, so it takes the maximum the mask actually reached rather than betting on
     catching it mid-flight. Started before the tap so nothing can be missed ahead of it. */
  await p.evaluate(() => {
    window.__peak = 0;
    const t0 = performance.now();
    const tick = () => {
      const e = document.querySelector('.chHintZone');
      if (e) window.__peak = Math.max(window.__peak, +getComputedStyle(e).opacity);
      if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.click('#chHint');
  await p.waitForTimeout(1600);
  const peak = await p.evaluate(() => window.__peak);
  peak > 0.9
    ? ok(`the spotlight lands at full strength (peak opacity ${peak.toFixed(2)})`)
    : bad(`no beat on the reveal — the mask never went past ${peak}`);

  const seen = async () => p.evaluate(() => {
    const el = document.querySelector('.chHintZone'), fr = document.getElementById('chFrame');
    if (!el || !fr) return null;
    const r = el.getBoundingClientRect(), f = fr.getBoundingClientRect();
    return { op: +getComputedStyle(el).opacity,
             cx: r.left + r.width / 2 - f.left, cy: r.top + r.height / 2 - f.top,
             w: r.width, h: r.height, fw: f.width, fh: f.height };
  });
  await p.waitForTimeout(2400);
  const z = await seen();
  if (!z) bad('the zone is not in the DOM at all');
  else {
    z.op > 0.6
      ? ok(`the zone is still painted 2.7s in (opacity ${z.op.toFixed(2)})`)
      : bad(`the zone is at opacity ${z.op} — the hint erased itself and the round goes on without it`);
    z.op < 0.95
      ? ok('and it has eased back off the beat, so the rest of the photo stays readable')
      : bad(`the mask stayed at ${z.op} — the frame outside the region is too dark to sweep`);
    /* Centred, in pixels, on the region the server named — not on the inline style that says so. */
    const wantX = REG7.cx * z.fw, wantY = REG7.cy * z.fh;
    Math.abs(z.cx - wantX) < 2 && Math.abs(z.cy - wantY) < 2
      ? ok(`and centred on the answer (${Math.round(z.cx)},${Math.round(z.cy)} of ${Math.round(wantX)},${Math.round(wantY)})`)
      : bad(`the zone renders at ${Math.round(z.cx)},${Math.round(z.cy)} but the region is at ${Math.round(wantX)},${Math.round(wantY)} — it points where the kamo is not`);
    /* Still the ellipse ② was written for, now measured on the rendered box — but the box is
       FOUR radii across, not two. The mask is 2x the region so the gradient's outer half is the
       falloff, and `closest-side` puts the clear core at exactly 50%, i.e. exactly the region
       (see .chHintZone). So the region is still stated exactly: width/4 is r*frameW. */
    const wantW = 4 * REG7.r * z.fw, wantH = 4 * REG7.r * z.fh;
    Math.abs(z.w - wantW) / wantW < 0.06 && Math.abs(z.h - wantH) / wantH < 0.06
      ? ok(`and still an ellipse scaled per axis (${Math.round(z.w)}×${Math.round(z.h)} on ${Math.round(z.fw)}×${Math.round(z.fh)})`)
      : bad(`rendered ${Math.round(z.w)}×${Math.round(z.h)}, expected about ${Math.round(wantW)}×${Math.round(wantH)}`);
  }
  /* THE BUZZ FREEZES IT AND KEEPS IT. Motion here would compete with the celebration, but
     removing the ring would delete the most persuasive thing this product ever says about
     hints: on a miss, the flip shows the kamo was inside the circle and the one tap was not. */
  await p.mouse.click(120, 400);
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => {
    const el = document.querySelector('.chHintZone');
    return el && { calm: el.classList.contains('calm'), op: +getComputedStyle(el).opacity };
  });
  after && after.calm && after.op > 0.3
    ? ok('and it stays, frozen, once the buzz is spent — the miss is where the hint argues for itself')
    : bad(`after the buzz the zone is ${JSON.stringify(after)}`);
  await p.close();
}

console.log('\n⑧ THE OFFER DOES NOT SIT ON THE WAY OUT');
/* ⚠️ IT DID. Both pills live on the same row — bottom 16px + safe-area — with the hint on the
   right and the give-up button centred, and the hint's widest state is the OFFER, the longest
   sentence it ever holds. Measured at 390px: the offer occupied x 162-378 and "I give up"
   151-239, a 77px overlap, with the hint painting on top because it is appended second at the
   same z-index. So the screen where the pack is sold was also the screen where the way out was
   buried under the thing selling it — the same defect the swipe pill had over the ending card.
   Shortening the label was not the fix: a localized price is appended to it the moment a build
   sends one. Opposite corners cannot collide however long either label grows. */
for (const [name, st, price] of [
  ['the free daily', { balance: 0, free_available: true }, ''],
  ['a stocked wallet', { balance: 4, free_available: false }, ''],
  ['the pack offer', { balance: 0, free_available: false }, ''],
  /* THE STATE THAT DOES NOT EXIST YET, AND IS THE WHOLE REASON THIS IS GEOMETRY AND NOT COPY.
     Shortening the sentence cleared the collision on the day it was written; appending a
     localized price puts it straight back, and that append is one shipped build away. CHF is
     the widest ordinary storefront string. With the give-up button in the opposite corner
     neither label can reach the other however long it grows. */
  ['the offer once a build sends a price', { balance: 0, free_available: false }, 'CHF 1.00'],
]) {
  const p = await hunt({ caps: { hints: true }, uid: 'user-1', state: st, price });
  const g = await p.evaluate(() => {
    const b = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const h = document.getElementById('chHint');
    return { hint: b('chHint'), quit: b('chQuit'), label: h && h.textContent };
  });
  const clear = g.hint && g.quit && (g.hint.l >= g.quit.r || g.hint.r <= g.quit.l || g.hint.b <= g.quit.t || g.hint.t >= g.quit.b);
  clear
    ? ok(`${name} ("${g.label}") clears the give-up button by ${Math.round(g.hint.l - g.quit.r)}px`)
    : bad(`${name} ("${g.label}") overlaps the give-up button: hint ${JSON.stringify(g.hint)} quit ${JSON.stringify(g.quit)}`);
  await p.close();
}

console.log('\nTHE HINT STAYS OFF UNTIL THE PACK IS APPROVED');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  await page.addInitScript((h) => {
    window.__hintsLive = false;                     // the flag as it ships
    window.__seed = { get_hide: h, save_seek_trace: null };
    window.__caps = { hints: true };                // the build DOES advertise it
    window.__uid = 'user-1';                        // and the wallet exists
    window.ReactNativeWebView = { postMessage() {} };
  }, HIDE);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const b = await btn(page);
  !b
    ? ok('with the flag off there is no button, even on a build that advertises hints')
    : bad('the hint button is on screen with HINTS_LIVE off — between the build landing and '
        + 'the pack being approved, every tap opens a purchase sheet for a product Apple has '
        + 'not accepted yet');
  await page.close();
}
{
  /* WHAT SHIPS IS A DECISION, AND THIS IS WHERE IT IS WRITTEN DOWN.
     It shipped `false` until 2026-08-16, when PR #293 turned the Hint button on so App Review
     could see it rather than approving a build in which the feature is invisible. That is a
     deliberate call and the guard now records it — but it stays a guard, because the danger it
     was built for has not gone anywhere: if the hint pack is NOT approved in App Store Connect,
     every tap on Hint opens a purchase sheet for a product that does not exist.
     So the assertion is against the declared intent below, not against a hardcoded `false`. An
     accidental flip in either direction still fails here, loudly, with the reason attached. */
  const INTENDED = 'true';   // PR #293 — Hint shown to App Review. Set back to 'false' if the pack is pulled.
  const shipped = /const HINTS_LIVE=(\w+);/.exec(real);
  shipped && shipped[1] === INTENDED
    ? ok(`and index.html ships HINTS_LIVE=${INTENDED}, which is the recorded intent (PR #293)`)
    : bad(`index.html ships HINTS_LIVE=${shipped && shipped[1]} but the recorded intent is `
        + `${INTENDED}. If this was deliberate, move INTENDED in this test and say why; if it `
        + 'was not, an unapproved hint pack is being sold from the live build.');
}

console.log('\nTHE TAP IS MEASURABLE, AND CARRIES WHAT IS AT STAKE');
{
  /* The "last life" pill (2026-08-28) exists to test one thing: does somebody who KNOWS their
     run ends on a miss reach for a hint more often than somebody with nothing at risk. That is
     a ratio over two populations, so the stake has to ride BOTH ends of it — and before this
     change neither end carried it, and the tap had no event of its own at all. Every reading
     of "do people reach for hints" was reconstructed from hint_used plus hint_modal_shown plus
     hint_purchase_initiated: three names, two arms, a different shape on each. */
  /* ⚠️ caps.hints AND a uid, like every other case in this file: the button is gated on the
     wrapper's capability, so a fixture without it renders no hint at all and every assertion
     below would have been about the harness. A first version omitted both and read an empty
     hint_offered as "the event is broken". */
  const page = await hunt({ caps: { hints: true }, uid: 'user-1',
                            state: { balance: 2, free_available: false } });

  const offered = await page.evaluate(() =>
    (window.__tracked || []).filter((t) => t[0] === 'hint_offered').map((t) => t[1]));
  offered.length === 1 && offered[0] && typeof offered[0].run === 'number' && typeof offered[0].life === 'boolean'
    ? ok(`the offer carries the stake, so the ratio has a denominator (${JSON.stringify({ run: offered[0].run, life: offered[0].life })})`)
    : bad('hint_offered props: ' + JSON.stringify(offered));

  await page.evaluate(() => document.getElementById('chHint').click());
  await page.waitForTimeout(500);
  const tapped = await page.evaluate(() =>
    (window.__tracked || []).filter((t) => t[0] === 'hint_tapped').map((t) => t[1]));
  tapped.length === 1
    ? ok('one tap emits exactly one hint_tapped')
    : bad(`a single tap emitted ${tapped.length} hint_tapped events`);
  tapped[0] && typeof tapped[0].run === 'number' && typeof tapped[0].life === 'boolean'
    ? ok('and it carries the run and the life, so the two populations are separable')
    : bad('hint_tapped props: ' + JSON.stringify(tapped[0]));

  /* ⚠️ WEB_ONLY OR IT MEASURES NOTHING. A name the wrapper's compiled allow-list has never
     heard of is dropped in silence by the bridge, so a brand-new event on the live build is a
     number that never arrives. check.mjs holds the disjointness; this holds the membership. */
  /* ⚠️ READ OFF THE SOURCE, NOT THE PAGE. WEB_ONLY is a module-scope const and never reaches
     window, so asking the page for it returns null and the assertion would be about
     reachability rather than membership — green or red for the wrong reason. */
  const setLine = (real.match(/const WEB_ONLY=new Set\(\[[^\]]*\]/) || [''])[0];
  const routed = /"hint_tapped"/.test(setLine);
  routed === true
    ? ok('hint_tapped is routed WEB_ONLY, so the bridge cannot swallow it')
    : bad('hint_tapped is not in WEB_ONLY — it would be dropped in silence on the live build');
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} hint check(s) failed` : '\n✓ hint checks passed');
process.exit(failed ? 1 : 0);
