#!/usr/bin/env node
/**
 * THE BELL ON YOUR OWN HIDE — the first notification opt-in the USER opens.
 *
 * Every other door into the permission is one we choose: after a challenge is sent, or on
 * the second hide of somebody who never sends. This one is a control on the creator's own
 * hide in the feed, and every way it can be wrong is a way that looks fine on screen:
 *
 *   - SHOWN TO THE WRONG PERSON. On a stranger's slide the sentence is a lie — you cannot be
 *     told when somebody plays a photo you did not make. The feed skips your own hides for
 *     everyone else, so the only slide this may appear on is a `replay` one.
 *   - SHOWN TO SOMEBODY WHO ALREADY SAID YES. A push token exists only on the far side of a
 *     grant, so its presence is the one unambiguous "this device is already reachable". A
 *     bell offered there is furniture that asks for something the user has given.
 *   - SHOWN WHERE IT CANNOT WORK. In a browser, or in a wrapper too old to know the
 *     notif-ask message, the tap has nowhere to go. A dead control is worse than none.
 *   - NOT ANSWERING. The wrapper replies with the real outcome; anything other than a grant
 *     has to leave the button where it was. A button that says "done" on a denial is a lie
 *     the user only discovers when nobody ever tells them anything.
 *
 * None of that is visible in a screenshot, and none of it throws. Hence a test.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-bell-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the bell test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Stubbed at the declaration, not appended: chFeed() fetches its first page the moment it is
   called, so a hook added at the end of the module is already too late. */
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
/* The post-send door into the feed. Reached in the app only from the share sheet, at the far
   end of a capture, a paint, an upload and a send — driving all of that to assert one chip is
   a test about the wrong thing. Written before the declaration because functions hoist. */
html = html.replace('function chFeed(opts){',
  'window.__chFeed=(o)=>chFeed(o);\nfunction chFeed(opts){');

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

const ROWS = n => Array.from({ length: n }, (_, i) => ({
  id: 'hide' + i, img_path: 'p' + i + '.jpg', name: i ? null : 'tony',
  n_attempts: i, n_found: 0, created_at: '2026-08-1' + (2 - (i % 3)) + 'T10:0' + i + ':00Z',
}));

/**
 * A page with the wrapper faked around it.
 *
 * `wrapper:false` is a plain browser tab — no window.ReactNativeWebView at all, which is 97%
 * of this app's traffic and the case where the bell must not appear.
 * `caps` is what the wrapper announces on load; an OLD binary is `{}`, not a missing call.
 * `token` is a push token already in hand, i.e. somebody who has granted.
 * `mine` seeds this device's own hide ids, which is what makes a slide a replay.
 */
async function open({ wrapper = true, caps = { notifAsk: true }, token = '', mine = ['hide0'], rows = ROWS(3) } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = {
      feed_page: a.rows,
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: 'tony' },
      set_hide_public: null,
      attach_push_token: null,
    };
    /* THE MESSAGES THE PAGE SENDS THE WRAPPER, recorded rather than swallowed: the assertion
       for a tap is that {type:'notif-ask'} actually goes over the bridge, not that a class
       changed. Nothing answers on its own — the test plays the wrapper by hand, which is the
       only way to cover a denial. */
    if (a.wrapper) {
      window.__msgs = [];
      window.ReactNativeWebView = { postMessage: (s) => { try { window.__msgs.push(JSON.parse(s)); } catch (_) {} } };
    }
    if (a.mine && a.mine.length) localStorage.setItem('kamo_hides', JSON.stringify(a.mine));
    localStorage.setItem('kamo_feed_swiped', '1');   // no teaching hint in the way
  }, { rows, wrapper, mine });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  if (wrapper) {
    await page.evaluate((a) => {
      window.KAMO.setNativeCaps(a.caps);
      if (a.token) window.KAMO.setPushToken(a.token);
    }, { caps, token });
  }
  /* Through the same door the share sheet uses: the creator's own hide, seeded as slide 0. */
  await page.evaluate(() => window.__chFeed({ first: 'hide0', fromReveal: true }));
  await page.waitForTimeout(1200);
  return page;
}

const bellText = page => page.evaluate(() => {
  const b = document.querySelector('.kfBell');
  return b ? (b.textContent || '').trim() : null;
});

console.log('\nTHE BELL IS OFFERED ON YOUR OWN HIDE, TO SOMEBODY WHO HAS NOT SAID YES');
{
  const page = await open();
  const t = await bellText(page);
  t && /plays it/.test(t)
    ? ok('the creator lands on their own hide and is offered the ping')
    : bad(`no bell on the creator's own slide: ${JSON.stringify(t)}`);

  const shown = await page.evaluate(() => (window.__tr || []).filter(e => e[0] === 'notif_bell_shown').length);
  shown === 1
    ? ok('and it is counted once, so the tap has a denominator')
    : bad(`notif_bell_shown fired ${shown} times — once per feed session is the contract`);

  /* THE STRANGER'S SLIDE. Same feed, one swipe away: the sentence stops being true there. */
  await page.evaluate(() => { const s = document.getElementById('kfScroll'); s.scrollTop = s.clientHeight; });
  await page.waitForTimeout(900);
  const onStranger = await page.evaluate(() => {
    const sl = document.querySelectorAll('.kfSlide')[1];
    return !!(sl && sl.querySelector('.kfBell'));
  });
  !onStranger
    ? ok("and never on a stranger's hide — you cannot be told about a photo you did not make")
    : bad("the bell appeared on somebody else's slide");
  await page.close();
}

console.log('\nAND NOWHERE IT COULD NOT WORK');
{
  const granted = await open({ token: 'ExponentPushToken[abc123]' });
  await bellText(granted) === null
    ? ok('somebody who already granted is not asked again — the token is the proof')
    : bad('the bell was offered to a device that already has a push token');
  await granted.close();

  const oldBuild = await open({ caps: {} });
  await bellText(oldBuild) === null
    ? ok('a wrapper too old to know notif-ask shows no control rather than a dead one')
    : bad('the bell rendered on a build that cannot answer it');
  await oldBuild.close();

  const browserTab = await open({ wrapper: false });
  await bellText(browserTab) === null
    ? ok('and a plain browser tab — 97% of the traffic — is never offered a phone permission')
    : bad('the bell rendered outside the app');
  await browserTab.close();
}

console.log('\nA TAP GOES TO THE WRAPPER, AND THE ANSWER IS THE TRUTH');
{
  const page = await open();
  await page.evaluate(() => document.querySelector('.kfBell').click());
  await page.waitForTimeout(200);

  const asked = await page.evaluate(() => (window.__msgs || []).filter(m => m.type === 'notif-ask').length);
  asked === 1 ? ok('the tap reaches the wrapper as notif-ask') : bad(`notif-ask sent ${asked} times`);

  const tapped = await page.evaluate(() => (window.__tr || []).filter(e => e[0] === 'notif_bell_tapped').length);
  tapped === 1 ? ok('and it is counted') : bad(`notif_bell_tapped fired ${tapped} times`);

  const busy = await page.evaluate(() => document.querySelector('.kfBell').disabled);
  busy ? ok('the button locks while the dialog is up, so one tap is one prompt')
       : bad('the button stayed live under the system dialog');

  /* THE DENIAL. iOS renders nothing after one, so the wrapper offers Settings instead and
     says so in its own alert — the control here must simply come back, still tappable. */
  await page.evaluate(() => window.KAMO.notifAskResult('denied_recovery_declined'));
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const b = document.querySelector('.kfBell');
    return b ? { live: !b.disabled, txt: (b.textContent || '').trim() } : null;
  });
  after && after.live && /plays it/.test(after.txt)
    ? ok('a refusal leaves the offer exactly as it was — no false receipt')
    : bad(`the button lied about a refusal: ${JSON.stringify(after)}`);

  /* THE GRANT. Said once, then gone: it has nothing left to offer. */
  await page.evaluate(() => document.querySelector('.kfBell').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.KAMO.notifAskResult('system_granted'));
  await page.waitForTimeout(150);
  const receipt = await bellText(page);
  receipt && /✓/.test(receipt)
    ? ok('a grant is acknowledged on the control the user tapped')
    : bad(`no receipt after a grant: ${JSON.stringify(receipt)}`);
  await page.waitForTimeout(2400);
  await bellText(page) === null
    ? ok('and then it leaves — the question has been answered')
    : bad('the bell stayed on screen after the grant');

  /* AND THE OTHER DOOR CLOSES IT TOO. A grant can land on the send path while a feed slide
     sits underneath; the token arriving is what tells this page so. */
  const other = await open();
  await other.evaluate(() => window.KAMO.setPushToken('ExponentPushToken[xyz789]'));
  await other.waitForTimeout(150);
  await bellText(other) === null
    ? ok('a grant won elsewhere removes it too, off the token alone')
    : bad('the bell survived a token arriving from another path');
  await other.close();
  await page.close();
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} bell check(s) failed`); process.exit(1); }
console.log('\n✓ the bell is offered where it is true, and answers honestly');
