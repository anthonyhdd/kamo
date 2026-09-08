#!/usr/bin/env node
/**
 * THE PERMISSION-ASK ARM — who spends iOS's one prompt, and when.
 *
 * armResultsPing() has always posted notif-schedule at PUBLISH, and the wrapper spends iOS's
 * single lifetime prompt answering it: seconds after the share sheet opened, on a hide nobody
 * has sent. 4170 refusals against 838 grants in the 30 days to 2026-09-08, every refusal
 * permanent. NOTIF_ASK_ROLLOUT holds half of devices back from that and lets chMarkSent()
 * spend the prompt instead, after a challenge has provably gone out.
 *
 * Every way this can be wrong is silent — it is one message that does or does not cross a
 * bridge, with no pixel anywhere saying so:
 *
 *   - THE LEAKING HOLDOUT. If `auto` also defers, there is no control arm and no measurement,
 *     and the screen is identical on both sides. This is the failure that wastes the weeks,
 *     not the users, and it is the first thing asserted here.
 *   - THE ARM THAT NEVER ASKS. If `tap` also swallows the send, nobody is ever asked at all
 *     and the app quietly loses its only return path — a far worse outcome than the refusals
 *     this arm exists to stop. chMarkSent() must always arm.
 *   - TAKING SOMETHING FROM SOMEBODY WHO ALREADY SAID YES. A push token exists only on the
 *     far side of a grant. A granted device has no prompt left to protect, so it must keep the
 *     publish-time "you never sent that one" nudge exactly as before.
 *   - THE UNROUTED COUNT. notif_ask_deferred is what makes the deferral readable rather than
 *     inferred from an absence. A new event name is silently dropped by the live build's
 *     compiled allow-list unless it is on WEB_ONLY, so the arm would read as if the mechanism
 *     never fired.
 *   - THE UNSPLITTABLE READ. Without ask_arm on the payload, web_notif_armed cannot be split
 *     and the whole experiment is one undifferentiated number.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-askarm-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the ask-arm test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/* ── READ OFF THE SOURCE, BEFORE A BROWSER IS INVOLVED ──────────────────────────────────
   Both of these are compile-time facts about a string, and both fail in production as
   silence rather than as an error, which is the worst possible way to learn them. */
console.log('\nTHE DEFERRAL IS COUNTABLE AT ALL');
{
  const webOnly = real.match(/const WEB_ONLY=new Set\(\[([\s\S]*?)\]\);/);
  if (!webOnly) bad('WEB_ONLY is gone — every web-side event name is now at the mercy of the wrapper allow-list');
  else webOnly[1].includes('"notif_ask_deferred"')
    ? ok('notif_ask_deferred is on WEB_ONLY, so it reaches Amplitude instead of the bridge')
    : bad('notif_ask_deferred is NOT on WEB_ONLY — the live build drops unknown names silently, '
        + 'so the arm would read as though it never deferred anything');

  const carrier = real.match(/const CARRIER_102=\{([\s\S]*?)\};/);
  carrier && !carrier[1].includes('notif_ask_deferred')
    ? ok('and it is not also rented out through CARRIER_102 — the two sets stay disjoint')
    : bad('notif_ask_deferred appears in CARRIER_102 as well');

  /* ⚠️ THE DECLARATION, NOT THE FIRST MENTION. The name appears in the #ssBell and #ssSub
     notes hundreds of lines earlier, so a bare indexOf lands in prose and reports a missing
     kill note that is sitting right where it should be. */
  const decl = real.indexOf('const NOTIF_ASK_ROLLOUT');
  decl > 0 && /KILL: rollout to 0 and push/.test(real.slice(Math.max(0, decl - 2600), decl))
    ? ok('and the kill switch is written down next to the constant')
    : bad('NOTIF_ASK_ROLLOUT has no kill note above its declaration — the one thing needed at '
        + '3am is how to turn it off without a build');
}

/* ── AND THEN THE BEHAVIOUR ─────────────────────────────────────────────────────────────── */
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
/* The far side of track()'s decoration — see "THE SPLIT IS READABLE" for why the raw call is
   the wrong thing to assert on. */
html = html.replace('function chWebTrack(event,props){',
  'function chWebTrack(event,props){window.__web=window.__web||[];window.__web.push([event,props]);');
/* THE UNIT, REACHED DIRECTLY. The alternative is a camera, a paint, an upload and a share
   sheet to observe one message crossing one bridge — a test about four other things, three of
   which already have their own suite. Written before the declaration because functions hoist. */
if (!html.includes('function armResultsPing(sent){')) throw new Error('anchor missing: armResultsPing');
html = html.replace('function armResultsPing(sent){',
  'window.__arm=(s)=>armResultsPing(s);\nfunction armResultsPing(sent){');

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
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(failed ? 1 : 0); }
const browser = await chromium.launch({ executablePath: exe });

/**
 * A page inside a faked wrapper, with the arm seeded.
 *
 * `arm` is written to localStorage before boot: navigator.webdriver pins a fresh device to
 * `auto` for every other suite in scripts/, and the stored value is read first precisely so
 * this one can ask for the other side.
 * `token` is a push token already in hand — somebody who has granted.
 */
async function open({ arm = 'tap', token = '', caps = { notifSchedule: true } } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    window.__seed = { attach_push_token: null };
    window.__msgs = [];
    window.ReactNativeWebView = { postMessage: (s) => { try { window.__msgs.push(JSON.parse(s)); } catch (_) {} } };
    if (a.arm) localStorage.setItem('kamo_notif_ask_arm', a.arm);
  }, { arm });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate((a) => {
    window.KAMO.setNativeCaps(a.caps);
    if (a.token) window.KAMO.setPushToken(a.token);
  }, { caps, token });
  return page;
}

/* Every notif-schedule that reached the bridge since the page loaded. The key is always
   "results" — what is being counted is whether the message crossed at all. */
const schedules = page => page.evaluate(() =>
  (window.__msgs || []).filter(m => m.type === 'notif-schedule').map(m => (m.notif && m.notif.key) || ''));
const deferrals = page => page.evaluate(() =>
  (window.__tr || []).filter(e => e[0] === 'notif_ask_deferred').length);

console.log('\nTHE HOLDOUT STILL SPENDS THE PROMPT AT PUBLISH');
{
  const page = await open({ arm: 'auto' });
  const armed = await page.evaluate(() => { window.__arm(false); return true; });
  const s = armed && await schedules(page);
  s.length === 1 && s[0] === 'results'
    ? ok('`auto` arms on a published, unsent hide exactly as it always has')
    : bad(`the holdout posted ${JSON.stringify(s)} — if the control arm also defers there is no `
        + 'experiment, only two identical halves and a month spent finding that out');
  await deferrals(page) === 0
    ? ok('and counts no deferral, because it deferred nothing')
    : bad('the holdout logged notif_ask_deferred — it is running the treatment');
  await page.close();
}

console.log('\nAND THE ARM DOES NOT — NOT UNTIL SOMETHING HAS BEEN SENT');
{
  const page = await open({ arm: 'tap' });
  await page.evaluate(() => window.__arm(false));
  const s = await schedules(page);
  s.length === 0
    ? ok('a published, unsent hide asks for nothing — iOS keeps its one prompt')
    : bad(`the tap arm still posted ${JSON.stringify(s)} at publish — the prompt is spent and `
        + 'iOS never asks again');
  await deferrals(page) === 1
    ? ok('and the deferral is counted once, so the mechanism is readable rather than inferred')
    : bad(`notif_ask_deferred fired ${await deferrals(page)} times — the arm cannot be read off an absence`);

  /* THE SEND. This is the earned moment the whole arm waits for; swallowing it too would
     leave nobody asked at all, which is strictly worse than the problem being fixed. */
  await page.evaluate(() => window.__arm(true));
  const after = await schedules(page);
  after.length === 1 && after[0] === 'results'
    ? ok('and a sent challenge arms for real — the prompt lands on somebody who did something')
    : bad(`the send posted ${JSON.stringify(after)} — this arm now never asks anyone, and the `
        + 'app has no other way to tell a creator their hide was played');
  await page.close();
}

console.log('\nNOTHING IS TAKEN FROM A DEVICE THAT ALREADY SAID YES');
{
  const page = await open({ arm: 'tap', token: 'ExponentPushToken[abc123]' });
  await page.evaluate(() => window.__arm(false));
  const s = await schedules(page);
  s.length === 1 && s[0] === 'results'
    ? ok('a granted device keeps its publish-time nudge — there is no prompt left to protect')
    : bad(`a device holding a push token posted ${JSON.stringify(s)} — the arm is withholding a `
        + 'notification from somebody who can actually receive it, which costs the unsent-hide '
        + 'reminder for no benefit at all');
  await deferrals(page) === 0
    ? ok('and nothing is counted as deferred, because nothing was')
    : bad('a granted device logged notif_ask_deferred');
  await page.close();
}

console.log('\nA WRAPPER THAT CANNOT SCHEDULE IS UNTOUCHED BY ANY OF THIS');
{
  const page = await open({ arm: 'tap', caps: {} });
  await page.evaluate(() => window.__arm(true));
  const s = await schedules(page);
  s.length === 0 && await deferrals(page) === 0
    ? ok('an old binary posts nothing and counts nothing — the caps gate still runs first')
    : bad(`a build without notifSchedule produced ${JSON.stringify(s)} and ${await deferrals(page)} deferrals`);
  await page.close();
}

console.log('\nTHE SPLIT IS READABLE');
{
  /* ASSERTED ON THE DECORATED PAYLOAD, NOT ON THE CALL. track() adds every arm on the way out,
     so the props handed to track() do not carry ask_arm and never will — reading them would
     assert the wrong object and pass while Amplitude received nothing to split on. chWebTrack
     is the far side of that decoration and the path a WEB_ONLY event actually takes. */
  const page = await open({ arm: 'tap' });
  const arm = await page.evaluate(() => {
    window.__arm(false);
    const e = (window.__web || []).find(x => x[0] === 'notif_ask_deferred');
    return e ? (e[1] || {}).ask_arm : null;
  });
  arm === 'tap'
    ? ok('the payload that leaves the page carries ask_arm, so web_notif_armed can be split')
    : bad(`ask_arm reached Amplitude as ${JSON.stringify(arm)} — without it this experiment is `
        + 'one undifferentiated number and cannot be read at all');

  /* AND THE STORED ARM IS AUTHORITATIVE, which is what lets a device keep its side across
     launches — and what let this suite ask for `tap` under a harness pinned to `auto`. */
  const stored = await page.evaluate(() => localStorage.getItem('kamo_notif_ask_arm'));
  stored === 'tap'
    ? ok('and the arm is read from storage, so a device does not re-roll on every launch')
    : bad(`the stored arm reads ${JSON.stringify(stored)} — a device that changes sides between `
        + 'launches is in both halves of the experiment and in neither');
  await page.close();
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} ask-arm check(s) failed`); process.exit(1); }
console.log('\n✓ the prompt is spent on the send, the holdout is intact, and the split is readable');
