#!/usr/bin/env node
/**
 * ONE ACTION, ONE EVENT NAME — the carrier router, driven in a real browser.
 *
 * Two funnel events are emitted twice on purpose: `track(kind)` for anyone who can receive
 * the real name, and `trackCarried(kind)` right after it for the 1.0.2 fleet, whose compiled
 * WEB_EVENTS allow-list drops anything it has not heard of. That is correct only while the
 * second call sends a name the first one could NOT deliver.
 *
 * It stopped doing that the day eventsV2 shipped. The router reads
 * `caps.eventsV2 ? kind : CARRIER_102[kind]`, so on 1.0.9+ it resolved straight back to the
 * name the call site had already sent, and every buy tap and every finished round was counted
 * twice. In Amplitude on 2026-08-19 `purchase_initiated` split EXACTLY 38 without `carrier_for`
 * and 38 with — the same 50/50 every day for a week. 90 buy taps on 08-17 were read as 180
 * (quoted as 184, the extra 4 being amelie/sofia in the same project), and `round_finished`
 * read 4 311 for ~2 200 rounds. Nothing looked broken: a doubled numerator makes a checkout
 * rate look half as good, and half of a rate nobody can verify is indistinguishable from a
 * product problem. It nearly bought a redesign of a paywall that converts fine.
 *
 * check.mjs 5c-bis cannot see this. It forbids a CARRIER name from doubling as a real event —
 * the 2026-08 torch_toggled incident — and here it is the REAL name that doubles. Opposite
 * direction, same consequence, so the rule needed a second half.
 *
 * The second half is the browser: with no wrapper there is no allow-list to dodge, the direct
 * name already reached Amplitude through chWebTrack, and a carrier on top of it put plain
 * browser rounds inside `reveal_previewed` — the one number that is supposed to mean "a round
 * from a build that cannot say round_finished".
 *
 * Asserted through the router itself rather than through the call sites, deliberately: the
 * invariant belongs to trackCarried (it must never emit `kind`), and a test that re-typed the
 * call sites' two lines would pass on the day someone rewrites them. The buy tap is then
 * driven for real, end to end, so the pair is proven once on the path that pays.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-carrier-dom.mjs
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
  console.log('· playwright-core not installed — skipping the carrier test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');

/* Both emitters are stubbed, not just postNative: which ONE of them a name leaves through is
   the whole subject. postNative returns what the real one returns — whether a wrapper is
   wrapped around this page — so track()'s early return behaves exactly as it does in
   production, and chWebTrack catches whatever falls past it. Restored in a finally, because a
   later assertion in the same page must see the real functions again. */
const html = real.slice(0, at)
  + '\nwindow.__cr={'
  + 'caps(c){window.KAMO.setNativeCaps(c);},'
  + 'carried(kind){return window.__cr._cap(()=>trackCarried(kind,{}));},'
  + 'buy(){return window.__cr._cap(()=>pwPurchase());},'
  + '_cap(fn){const out=[];const pn=postNative,cw=chWebTrack;'
  /* Recorded only when the post would really have LANDED, or a browser — where postNative
     returns false and track() falls through to chWebTrack — would record one send twice and
     every count here would be the probe's own artefact. */
  + 'postNative=(m)=>{const sent=!!window.ReactNativeWebView;if(sent&&m&&m.type==="track")out.push(m.event);return sent;};'
  + 'chWebTrack=(e)=>{out.push(e);};'
  + 'try{fn();}finally{postNative=pn;chWebTrack=cw;}return out;}};\n'
  + real.slice(at);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const body = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

/* Nothing may leave the machine: the page posts to Amplitude on its own from the boot beacon,
   and a test that let those out would be reporting fake events into the live project. */
async function open(wrapper) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (wrapper) await page.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(url.slice(0, -1))) return route.continue();
    if (u.includes('amplitude.com')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cr, null, { timeout: 10000 });
  return page;
}

const KINDS = ['purchase_initiated', 'round_finished'];
const CARRIER = { purchase_initiated: 'paint_started', round_finished: 'reveal_previewed' };
const list = (a) => (a.length ? a.join(', ') : 'nothing');

console.log('\nONE ACTION, ONE EVENT NAME');

/* ---- 1. the fleet that is now 99% of users ---- */
{
  const page = await open(true);
  await page.evaluate(() => window.__cr.caps({ eventsV2: true, revealVideo: true, handleStore: true }));
  for (const kind of KINDS) {
    const out = await page.evaluate((k) => window.__cr.carried(k), kind);
    out.includes(kind)
      ? bad(`on an eventsV2 build the carrier re-sends \`${kind}\`, which the call site above it already sent — every count of that event is doubled and every rate built on it is halved`)
      : ok(`eventsV2: the carrier adds nothing to \`${kind}\` (${list(out)}) — the direct name is the whole count`);
  }
  await page.close();
}

/* ---- 2. the old fleet, which is the only reason carriers exist ---- */
{
  const page = await open(true);
  /* A real 1.0.2-shaped capability set: present, announced, and without eventsV2. The empty
     case below it is a build that never called setNativeCaps at all — both are old builds and
     both must still be reachable, which is exactly what the 2026-08 torch_toggled outage got
     wrong in the other direction. */
  await page.evaluate(() => window.__cr.caps({ revealVideo: true }));
  for (const kind of KINDS) {
    const out = await page.evaluate((k) => window.__cr.carried(k), kind);
    out.length === 1 && out[0] === CARRIER[kind]
      ? ok(`old build: \`${kind}\` still reaches the wrapper as \`${CARRIER[kind]}\``)
      : bad(`old build: \`${kind}\` should ride \`${CARRIER[kind]}\` and sent ${list(out)} — the fleet that cannot receive the real name loses the funnel entirely`);
  }
  await page.close();
}
{
  const page = await open(true);
  for (const kind of KINDS) {
    const out = await page.evaluate((k) => window.__cr.carried(k), kind);
    out.length === 1 && out[0] === CARRIER[kind]
      ? ok(`no caps announced: \`${kind}\` rides \`${CARRIER[kind]}\` — a silent build is treated as an old one`)
      : bad(`no caps announced: \`${kind}\` sent ${list(out)} instead of \`${CARRIER[kind]}\``);
  }
  await page.close();
}

/* ---- 3. a plain browser has no allow-list to dodge ---- */
{
  const page = await open(false);
  for (const kind of KINDS) {
    const out = await page.evaluate((k) => window.__cr.carried(k), kind);
    out.length === 0
      ? ok(`browser: no carrier for \`${kind}\` — chWebTrack already delivered the real name`)
      : bad(`browser: the carrier still fired ${list(out)} for \`${kind}\` — browser traffic lands inside a name that is supposed to mean "an old build", and the round is counted twice`);
  }
  await page.close();
}

/* ---- 4. the buy tap, end to end, on the path that pays ---- */
{
  const page = await open(true);
  await page.evaluate(() => window.__cr.caps({ eventsV2: true }));
  const out = await page.evaluate(() => window.__cr.buy());
  const dupes = [...new Set(out.filter((n, i) => out.indexOf(n) !== i))];
  const taps = out.filter((n) => n === 'purchase_initiated').length;
  taps === 1
    ? ok(`a Buy tap emits purchase_initiated exactly once (${list(out)})`)
    : bad(`a Buy tap emitted purchase_initiated ${taps} time(s) (${list(out)}) — this is the 90-taps-read-as-180 bug`);
  dupes.length === 0
    ? ok('no event name is emitted twice by one tap')
    : bad(`one tap emitted ${dupes.join(', ')} more than once — whatever rate that name is the numerator of is wrong by that factor`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failed\n` : '\n✓ one action, one event name\n');
process.exit(failed ? 1 : 0);
