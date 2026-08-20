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
const servePhoto = (page) => page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const HIDE = { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' };

/** Boot a hunt with the given capabilities, user id and canned hint_spend answer. */
async function hunt({ caps = {}, uid = '', spend = undefined } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  await page.addInitScript(([h, c, u, s]) => {
    window.__hintsLive = true;          // on, unless a case below turns it off
    /* hint_state is read on mount by every hunt now (the balance decorates the idle label),
       and hint_intent/hint_claim are on the unidentified-device purchase path. Seeded flat so
       no case reaches the network; individual cases override what they are about. */
    window.__seed = { get_hide: h, save_seek_trace: null,
                      hint_state: { balance: 0, free_available: true },
                      hint_intent: { ok: true }, hint_claim: { claimed: false, reason: 'no_grant' } };
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
  b0 && b0.text === '1 Hint'
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
  b && b.text === '1 Hint' && !b.disabled ? ok('the hint button is rendered and tappable') : bad(`button is ${JSON.stringify(b)}`);

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
  /* THAT SPEND EMPTIED THE WALLET (balance 0), SO THE BUTTON BECOMES THE OFFER.
     It used to read "Hint used" and go dead, and this assertion used to demand exactly that.
     The consequence was that the only route to the pack ran through ANOTHER hide: leave this
     one, open the next, tap into an empty wallet, and meet the sheet on the round trip — a
     purchase nobody navigates toward because nobody has been shown it. App Review least of
     all, since hint_spend spends the free daily first: one tap reveals the zone for nothing
     and the sheet is never reached at all. PR #295. */
  const b2 = await btn(p);
  b2 && b2.text === 'No more hints. Get 5 Hints' && !b2.disabled
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
  b && b.text === '3 Hints available' && b.disabled
    ? ok('a spend off a stocked wallet locks the button and states the balance')
    : bad(`button after a stocked spend: ${JSON.stringify(b)}`);
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
  zone && after && after.text === '4 Hints available'
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
  after && after.text === '5 Hints available'
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
    after && after.text === 'No more hints. Get 5 Hints' && !after.disabled
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

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} hint check(s) failed` : '\n✓ hint checks passed');
process.exit(failed ? 1 : 0);
