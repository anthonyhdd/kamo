#!/usr/bin/env node
/**
 * THE SCREEN BETWEEN THE TAP AND APPLE'S SHEET.
 *
 * Two designs have been tried on the hint door and both end at zero sales, failing in
 * different places: a button with no price is tapped by 11.9% who then meet Apple's sheet cold
 * (91% cancel), and a button carrying the price is tapped by 2.4%. Measured on the same days
 * and the same web code, 1.1.5 against 1.1.6, so it is the binary and not the audience.
 *
 * This suite covers the third design and, more importantly, the four ways it could ship
 * looking correct and sell nothing:
 *
 *   · the buy button present, visible, and not reachable by a thumb — this app has lost the
 *     send to exactly that twice, and no DOM assertion noticed either time
 *   · an await sneaking in ahead of the purchase, which spends the user activation StoreKit
 *     needs and turns every tap into silence (the defect 1e927b9 fixed for this same pack)
 *   · the demo ellipse drawn from the real region, which hands the answer over for free
 *   · the control arm quietly acquiring a modal, which would leave the experiment comparing
 *     a screen against itself
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-hintmodal-dom.mjs
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
  /* EVERY EVENT THIS FILE SENDS, RECORDED. Added for ⑨: "where does the hint sale die" is
     answered by which of three names fires, and none of them has a DOM consequence to assert
     on. Patched at track()'s own declaration so it catches names routed direct and names routed
     through the bridge alike — whether a name reaches Amplitude at all is a different question,
     asserted in check.mjs against WEB_ONLY. */
  ['function track(event,props){', 'try{ (window.__ev=window.__ev||[]).push([event,props||{}]); }catch(e){}'],
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
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

/* Seeds the arm and a run before the page boots. The arm is stored, not rolled: a coin here
   would put this suite's subject on stage in half its own runs. */
async function hunt2({ arm = 'on', run = 0, life = true, price = '$0.99' } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page, true);
  await page.addInitScript(([h, pr, a, r, l]) => {
    window.__hintsLive = true;
    window.__seed = { get_hide: h, save_seek_trace: null,
                      hint_state: { balance: 0, free_available: false },
                      hint_intent: { ok: true }, hint_claim: { claimed: false, reason: 'no_grant' } };
    window.__price = pr; window.__caps = { hints: true }; window.__uid = 'rc_user_1';
    try {
      localStorage.setItem('kamo_hint_modal_arm', a);
      localStorage.setItem('kamo_seek_run', String(r));
      localStorage.setItem('kamo_seek_life', l ? '1' : '0');
    } catch (e) {}
    window.__posted = [];
    window.ReactNativeWebView = { postMessage(m) { try { window.__posted.push(JSON.parse(m)); } catch (e) {} } };
  }, [HIDE, price, arm, run, life]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return page;
}
const posted = (p) => p.evaluate(() => (window.__posted || []).filter(m => m && m.type === 'purchase'));
const modalUp = (p) => p.evaluate(() => { const w = document.querySelector('.hpWrap');
  return !!(w && getComputedStyle(w).display !== 'none'); });

/* ── ① the control arm is untouched, which is the only way the experiment means anything ── */
{
  console.log('\n— the control arm still goes straight to the sheet —');
  const p = await hunt2({ arm: 'off' });
  const label = await btn(p);
  (label && /\$0\.99/.test(label.text))
    ? ok(`"off" still carries the price on the button (${JSON.stringify(label.text)})`)
    : bad(`"off" should show the priced label; it showed ${JSON.stringify(label && label.text)}`);
  await p.click('#chHint');
  await p.waitForTimeout(400);
  (await modalUp(p)) === false
    ? ok('and no modal was mounted over it')
    : bad('the control arm opened the modal — both arms now show the same screen and the '
        + 'experiment is comparing a design against itself');
  (await posted(p)).length === 1
    ? ok('the tap reached StoreKit directly, as it does today')
    : bad('the control arm stopped posting the purchase');
  await p.close();
}

/* ── ② the modal arm reproduces 1.1.5's label to the byte ───────────────────────────────── */
{
  console.log('\n— the modal arm —');
  const p = await hunt2({ arm: 'on', run: 4, life: true });
  const label = await btn(p);
  (label && label.text === 'Get 5 hints')
    ? ok('the button is byte-identical to 1.1.5\'s — "Get 5 hints", no price')
    : bad(`the modal arm's button reads ${JSON.stringify(label && label.text)}. It has to be `
        + '"Get 5 hints" exactly: that string IS the 11.9% condition, and changing it makes the '
        + 'arm answer a question nobody asked.');
  await p.click('#chHint');
  await p.waitForTimeout(500);
  (await modalUp(p)) ? ok('the tap opens the screen') : bad('the tap did not open the modal');
  (await posted(p)).length === 0
    ? ok('and nothing has been posted to StoreKit yet — the sheet is not met cold')
    : bad('the modal opened AND fired a purchase; the sheet is still being met cold');

  /* ── ③ the headline is priced against the run, and the run is real ── */
  const t = await p.evaluate(() => (document.querySelector('.hpTitle') || {}).textContent || '');
  /\b4\b/.test(t)
    ? ok(`the headline carries the seeded run (${JSON.stringify(t)})`)
    : bad(`the headline should interpolate the run of 4; it read ${JSON.stringify(t)}`);

  /* ── ③-bis THE SCREEN NAMES THE PRICE, AND IT IS THE ONLY THING THAT DOES ────────────────
     The round's button deliberately stops naming it on this arm; if the modal does not pick it
     up, the pack is sold by a screen that never says what it costs and Apple's sheet becomes
     the first disclosure — which is the cold sheet this whole design exists to abolish. This
     shipped that way for one run and the screenshot is what caught it, not the suite. */
  const buy = await p.evaluate(() => (document.querySelector('.hpBuy') || {}).textContent || '');
  /\$0\.99/.test(buy)
    ? ok(`the screen names the price (${JSON.stringify(buy)})`)
    : bad(`the modal's buy button reads ${JSON.stringify(buy)} — it must carry the price the `
        + 'wrapper sent. The round button drops it on purpose; the screen is where it belongs.');

  /* ── ④ NOTHING ON THIS SCREEN IS DRAWN FROM THE ROUND ───────────────────────────────────
     This used to assert that the demo ellipse carried no inline geometry, because the screen
     showed a blurred copy of the player's own photo with a lit region over it and the whole
     risk was that the region came from `reg`. The hero was removed on 2026-08-27 (it read as
     a black slab in a card with no other black in it), and with it the risk — so the
     assertion becomes the stronger one it could never be while a demo existed: there is no
     ellipse, no photo, and no inline background anywhere in the card. A guarantee kept by
     absence cannot be broken by a refactor that recomputes something. */
  const leak = await p.evaluate(() => ({
    zone: !!document.querySelector('.hpZone'),
    hero: !!document.querySelector('.hpHero, .hpShot'),
    bg: [...document.querySelectorAll('.hpCard, .hpCard *')]
          .some((e) => /background-image/i.test(e.getAttribute('style') || '')),
  }));
  (!leak.zone && !leak.hero && !leak.bg)
    ? ok('nothing on the screen is painted from the round — no ellipse, no photo, no inline background')
    : bad(`the screen still paints something from the round (${JSON.stringify(leak)}). Anything `
        + 'drawn from this hide is one refactor away from being the answer, given away free.');

  /* ── ⑤ A THUMB REACHES THE BUY, ACROSS ITS WHOLE WIDTH ──────────────────────────────────
     The send was lost twice to a button that was present, sized, on screen and untappable.
     querySelector and getComputedStyle both pass straight through that. */
  const probe = await p.evaluate(() => {
    const b = document.querySelector('.hpBuy');
    if (!b) return { missing: true };
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return { collapsed: true };
    if (r.y < 0 || r.y + r.height > innerHeight) return { offscreen: Math.round(r.y) };
    const d = (el) => !el ? 'nothing' : el.id ? '#' + el.id
      : '.' + String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    return { rect: { w: Math.round(r.width), h: Math.round(r.height) },
             hits: [[0.5, 0.5], [0.14, 0.5], [0.86, 0.5]].map(([fx, fy]) => {
               const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
               return { at: d(el), ours: !!(el && (el === b || b.contains(el))) }; }) };
  });
  if (probe.missing) bad('.hpBuy is gone — the modal has nothing to buy with');
  else if (probe.collapsed) bad('.hpBuy has no box');
  else if (probe.offscreen !== undefined) bad(`.hpBuy sits at y=${probe.offscreen}, outside the viewport`);
  else {
    const blocked = probe.hits.filter(h => !h.ours);
    blocked.length === 0
      ? ok(`a thumb reaches the buy across its whole width (${probe.rect.w}x${probe.rect.h})`)
      : bad(`the modal's buy button is covered at ${blocked.length} of 3 points — a thumb lands `
          + 'on ' + blocked.map(h => h.at).join(', ') + ' instead. This is how the send was lost '
          + 'on 2026-08-20 and again on 2026-08-23: present, visible, untappable.');
  }

  /* ── ⑥ and the buy reaches Apple, with the right product ── */
  await p.click('.hpBuy');
  await p.waitForTimeout(500);
  const pur = await posted(p);
  (pur.length === 1 && pur[0].product === 'com.blisscoach.kamo.hints5' && pur[0].source === 'hint')
    ? ok('the buy posts the hint pack, stamped source:"hint"')
    : bad(`the buy posted ${JSON.stringify(pur)}`);
  (await modalUp(p)) === false ? ok('and the screen steps out of the way') : bad('the modal stayed up over Apple\'s sheet');
  await p.close();
}

/* ── ⑤-bis THE HIT TEST, PROVEN IN THE OTHER DIRECTION ───────────────────────────────────────
   An assertion that has only ever been green is an assertion nobody has seen work. The cover
   is laid at ROUND level and not inside .hpCard, because that is where the real one came from
   both times: the feed's .kfHint pill and the landing arm's #chStage were siblings of the
   sheet, not children of it. */
{
  console.log('\n— and the hit test would catch a cover —');
  const p = await hunt2({ arm: 'on', run: 3 });
  await p.click('#chHint'); await p.waitForTimeout(400);
  const caught = await p.evaluate(() => {
    const b = document.querySelector('.hpBuy'), r = b.getBoundingClientRect();
    const cover = document.createElement('div');
    cover.className = 'intruder';
    cover.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;`
                        + `height:${r.height}px;z-index:99;background:transparent;`;
    document.querySelector('.hpWrap').parentElement.appendChild(cover);
    return [[0.5, 0.5], [0.14, 0.5], [0.86, 0.5]].every(([fx, fy]) => {
      const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
      return !(el && (el === b || b.contains(el)));
    });
  });
  caught
    ? ok('with an element laid over it, all three points report the intruder')
    : bad('the hit test did NOT notice a cover over .hpBuy — it is decoration, not an assertion');
  await p.close();
}

/* ── ⑥-bis THE PACK IS FIVE, AND THE BUTTON ONLY EVER SAYS ONE ───────────────────────────────
   What a buyer sees when the credit lands is the zone they wanted and a label reading
   "✓ 4 hints left" on a screen they are leaving. The two facts that make the pack worth 0.99
   rather than one hint worth 0.20 -- that FIVE arrived, and that the rest survive this hide --
   were never stated anywhere. 296 of the 331 wallets that have ever spent a hint spent exactly
   one, ever. */
{
  console.log('\n— the receipt —');
  const p = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(p, true);
  await p.addInitScript(([h]) => {
    window.__hintsLive = true;
    window.__seed = { get_hide: h, save_seek_trace: null,
                      hint_state: { balance: 0, free_available: false },
                      hint_intent: { ok: true }, hint_claim: { claimed: true },
                      /* the pack landed and one was spent on this hide: 5 bought, 4 left */
                      hint_spend: { region: { cx: .5, cy: .5, r: .12 }, balance: 4, used: 'ok' } };
    window.__price = '$0.99'; window.__caps = { hints: true }; window.__uid = 'rc_user_1';
    try { localStorage.setItem('kamo_hint_modal_arm', 'on'); } catch (e) {}
    window.__posted = [];
    window.ReactNativeWebView = { postMessage(m) { try { window.__posted.push(JSON.parse(m)); } catch (e) {} } };
  }, [HIDE]);
  await p.goto(base + '?h=abc123', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  await p.click('#chHint');           // empty wallet -> the modal
  await p.waitForTimeout(400);
  await p.click('.hpBuy');            // -> StoreKit
  await p.waitForTimeout(300);
  /* ⚠️ hintsPurchased(), NOT hint(). window.KAMO.hint is the wrapper's TOAST channel and it
     ends the buy — it hands the button back. The credit poll is started by
     window.KAMO.hintsPurchased(), which fans out to every mounted round and lets the guards
     decide which one paid. Getting this wrong made the first version of this test fail against
     correct code, which is the shape of a test that would have been "fixed" by deleting it. */
  await p.evaluate(() => { try { window.KAMO.hintsPurchased(); } catch (e) {} });
  const shown = await p.waitForFunction(() => {
    const t = document.getElementById('chToast'); return !!(t && t.textContent.trim());
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!shown) bad('nothing was said when the pack landed — the buyer is told "4 left" on a button '
               + 'and never that five arrived or that they survive this hide');
  else {
    const said = await p.evaluate(() => {
      const t = document.getElementById('chToast');
      return { b: (t.querySelector('b') || {}).textContent || '', s: (t.querySelector('span') || {}).textContent || '' };
    });
    /\b5\b/.test(said.b) ? ok(`it names what arrived (${JSON.stringify(said.b)})`)
                         : bad(`the moment does not name the pack size: ${JSON.stringify(said.b)}`);
    /* ⚠️ AND NO ARITHMETIC. The first version said "5 added / 4 left", which is true and asks
       for a subtraction at the moment you are trying to make somebody feel good. The line has
       one job beyond the reward: the fact the button can never fit. */
    (/next kamos/.test(said.s) && !/\b\d/.test(said.s))
      ? ok(`and that the rest keep, without making them do sums (${JSON.stringify(said.s)})`)
      : bad(`the second line should state that the balance survives this hide and carry no `
          + `figures: ${JSON.stringify(said.s)}`);
    const burst = await p.evaluate(() => document.querySelectorAll('.kConfetti,.particle').length > 0);
    burst ? ok('and a burst fires on the button — the same acknowledgement trial and lifetime get')
          : bad('no burst on the purchase. Trial and lifetime both land on showKamoPlus() with a '
              + 'burst, a haptic and a line naming the plan; the pack got a quiet label change.');
  }
  /* ── ⑥-ter AND THE NEXT EMPTY WALLET IS NOT A STRANGER'S ── */
  const label = await p.evaluate(() => {
    try { localStorage.setItem('kamo_hint_bought', '1'); } catch (e) {}
    return typeof hintEverBought === 'function' ? 'fn' : 'scoped';
  }).catch(() => 'scoped');
  await p.close();

  const q = await hunt2({ arm: 'on' });
  const stranger = await btn(q);
  stranger && stranger.text === 'Get 5 hints'
    ? ok('a stranger is still offered "Get 5 hints"')
    : bad(`stranger label is ${JSON.stringify(stranger && stranger.text)}`);
  await q.close();

  const r = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(r, true);
  await r.addInitScript(([h]) => {
    window.__hintsLive = true;
    window.__seed = { get_hide: h, save_seek_trace: null,
                      hint_state: { balance: 0, free_available: false },
                      hint_intent: { ok: true }, hint_claim: { claimed: false, reason: 'no_grant' } };
    window.__price = '$0.99'; window.__caps = { hints: true }; window.__uid = 'rc_user_1';
    try { localStorage.setItem('kamo_hint_modal_arm', 'on'); localStorage.setItem('kamo_hint_bought', '1'); } catch (e) {}
    window.ReactNativeWebView = { postMessage() {} };
  }, [HIDE]);
  await r.goto(base + '?h=abc123', { waitUntil: 'load' });
  await r.waitForTimeout(900);
  const back = await btn(r);
  back && back.text === 'Get 5 more'
    ? ok('somebody who has bought before is offered "Get 5 more", not the product explained again')
    : bad(`a returning buyer reads ${JSON.stringify(back && back.text)} — the one segment in this `
        + 'app that has ever paid is still being addressed as a stranger.');
  await r.close();
  void label;
}

/* ── ⑦ a screen you cannot leave turns a refusal into a delete ──────────────────────────── */
{
  console.log('\n— it can be left —');
  for (const [sel, name] of [['.hpSkip', 'Keep looking'], ['.hpClose', 'the close button']]) {
    const p = await hunt2({ arm: 'on', run: 3 });
    await p.click('#chHint'); await p.waitForTimeout(400);
    await p.click(sel); await p.waitForTimeout(300);
    const gone = (await modalUp(p)) === false;
    const clean = (await posted(p)).length === 0;
    const still = await p.evaluate(() => !!document.getElementById('chHint'));
    (gone && clean && still)
      ? ok(`${name} closes it, buys nothing, and leaves the round standing`)
      : bad(`${name}: up=${!gone} posted=${!clean} hintBtn=${still}`);
    await p.close();
  }
}

/* ── ⑧ NOT ONE await BETWEEN THE TAP AND StoreKit ───────────────────────────────────────────
   Static, because the failure is invisible at runtime on a fast machine and fatal on a phone:
   the first await spends the user activation the tap granted, and Apple's sheet never opens. */
{
  console.log('\n— the buy stays on the fast path —');
  const m = /hpBuy\.onclick\s*=\s*\(\)\s*=>\s*\{([\s\S]{0,300}?)\};/.exec(real);
  const body = m ? m[1] : '';
  (m && !/\bawait\b/.test(body) && /offerHintPack\(\)/.test(body))
    ? ok('hpBuy reaches offerHintPack() inside the gesture, with no await ahead of it')
    : bad('hpBuy either lost its call to offerHintPack() or gained an await before it — the '
        + 'user activation is spent by the first await and StoreKit will never open. Same '
        + 'defect 1e927b9 fixed for this pack.');
}

/* A picture of the thing, for the person who has to decide whether it sells. */
if (process.env.SHOT) {
  const p = await hunt2({ arm: 'on', run: 4, life: true });
  await p.click('#chHint'); await p.waitForTimeout(700);
  await p.screenshot({ path: process.env.SHOT });
  await p.close();
  console.log('  · screenshot -> ' + process.env.SHOT);
}

/* ── ⑨ WHERE THE SALE DIES, WHICH THE DATA COULD NOT SAY ───────────────────────────────── */
console.log('\n— every way the purchase can end has a name —');
{
  /* ⚠️ THIS EXISTS BECAUSE OF A REAL NUMBER: 112 people have opened the hint purchase and 0
     have completed one; the only grant in the database belongs to the founder's own device.
     Until now the page tracked hint_purchase_initiated and then went silent whatever happened,
     so "Apple's sheet never opened" and "the player looked at $0.99 and said no" produced the
     SAME telemetry — and those two call for opposite work. Three names separate them.
     The founder confirmed on 2026-08-30 that the purchase completes on his own phone, which
     makes the distinction the whole question rather than a detail. */
  const buyPage = async (bridge, slowTimer) => {
    const p = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await servePhoto(p, true);
    await p.addInitScript(([h, br, st]) => {
      window.__hintsLive = true;
      window.__seed = { get_hide: h, save_seek_trace: null,
                        hint_state: { balance: 0, free_available: false },
                        hint_intent: { ok: true }, hint_claim: { claimed: true } };
      window.__price = '$0.99'; window.__caps = { hints: true }; window.__uid = 'rc_user_1';
      try { localStorage.setItem('kamo_hint_modal_arm', 'on'); } catch (e) {}
      /* NO BRIDGE is the one case that must be built by ABSENCE — postNative returns false when
         window.ReactNativeWebView is missing, so a silent postMessage stub would exercise the
         opposite branch while looking identical from here. */
      if (br) window.ReactNativeWebView = { postMessage() {} };
      if (st) {
        /* Only the 45s backstop is shortened; every other timer the page sets is left alone so
           nothing else in the round is hurried into a different order. */
        const t = window.setTimeout;
        window.setTimeout = (fn, ms, ...a) => t(fn, ms === 45000 ? 40 : ms, ...a);
      }
    }, [HIDE, !!bridge, !!slowTimer]);
    await p.goto(base + '?h=abc123', { waitUntil: 'load' });
    await p.waitForTimeout(900);
    await p.click('#chHint');
    await p.waitForTimeout(400);
    await p.click('.hpBuy');
    await p.waitForTimeout(450);
    return p;
  };
  const names = (p) => p.evaluate(() => (window.__ev || []).map((e) => e[0]));

  const web = await buyPage(false, false);
  const wn = await names(web);
  wn.includes('hint_purchase_initiated') && wn.includes('hint_buy_no_bridge')
    ? ok('no bridge → the attempt AND its dead end are both named')
    : bad('a purchase with no bridge reported ' + JSON.stringify(wn.filter((x) => /hint_(buy|purchase)/.test(x))));

  /* THE SHEET CLOSED WITH NOTHING BOUGHT — native answered, so the store worked and the answer
     was no. window.KAMO.hint is the wrapper's toast channel, and it is what ends the buy. */
  const said = await buyPage(true, false);
  await said.evaluate(() => { try { window.KAMO.hint('Purchase failed'); } catch (e) {} });
  await said.waitForTimeout(300);
  const sn = await names(said);
  sn.includes('hint_buy_ended')
    ? ok('native says the sheet closed → hint_buy_ended, so a refusal is countable')
    : bad('the sheet closed and nothing was recorded: ' + JSON.stringify(sn.filter((x) => /hint_buy/.test(x))));
  !sn.includes('hint_buy_no_answer')
    ? ok('and it is NOT also counted as silence')
    : bad('one ending fired two names — the funnel would double-count and never reconcile');

  /* THE ONE THAT SETTLES IT: nothing answers at all. Reaching the backstop means the sheet
     never opened, or the wrapper does not handle this product — a different world from a
     refusal, and until today the same silence. */
  const dead = await buyPage(true, true);
  await dead.waitForTimeout(200);
  const dn = await names(dead);
  dn.includes('hint_buy_no_answer')
    ? ok('a wrapper that never answers → hint_buy_no_answer, which is the breakage signal')
    : bad('nothing answered and nothing was recorded: ' + JSON.stringify(dn.filter((x) => /hint_buy/.test(x)))
        + ' — this is the exact silence that made 112 dead purchases unreadable');
  !dn.includes('hint_buy_ended')
    ? ok('and silence is not filed as a refusal')
    : bad('silence was recorded as a refusal — the two answers call for opposite work');

  /* AND THE ATTEMPT CARRIES THE RevenueCat SPLIT. 493 of 494 wallets have no app user id, and
     the only one that does produced the only sale; without this property that stays a story. */
  const props = await dead.evaluate(() => (window.__ev || []).find((e) => e[0] === 'hint_purchase_initiated'));
  props && props[1] && typeof props[1].rc === 'boolean'
    ? ok('and the attempt says whether the device had a RevenueCat id')
    : bad('hint_purchase_initiated carries no rc flag: ' + JSON.stringify(props && props[1]));

  await web.close(); await said.close(); await dead.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} hint-modal check(s) failed` : '\n✓ the hint modal sells, and a thumb can reach it');
process.exit(failed ? 1 : 0);
