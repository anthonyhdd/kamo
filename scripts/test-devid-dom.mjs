#!/usr/bin/env node
/**
 * THE DEVICE ID, WHICH IS THE HINT WALLET'S KEY.
 *
 * hintOwner() keys the wallet on `chUserId || ("dev:"+chDeviceId())`, and chUserId — the
 * RevenueCat app user id — is empty for the entire live population: on 2026-08-20, of the
 * 152 wallets that had ever spent a hint, ZERO were keyed on one. So chDeviceId() IS the
 * wallet, and until this suite existed it lived in localStorage alone — which a reinstall,
 * a "clear website data" or iOS's own eviction throws away. 149 of those 152 wallets (98%)
 * spent exactly one hint ever, and one phone minted three keys inside a day.
 *
 * That failure is silent in both directions and neither direction reports itself: the free
 * daily hint comes back for anyone who clears storage, and a bought pack is credited to a
 * key the phone can no longer produce. Nothing throws, nothing 500s, and the only witness is
 * a support message from someone whose five hints did not arrive.
 *
 * So what is asserted here is survival, and the ONE rule that makes survival safe:
 *
 *   - the id survives localStorage.clear() — the headline, via the cookie;
 *   - it survives localStorage AND the cookie going together — via IndexedDB, adopted
 *     asynchronously, because chDeviceId()'s callers are synchronous and cannot await;
 *   - an id that is ALREADY in a store always wins over minting a new one, in every
 *     combination of stores, so nothing here can ever be the thing that loses a wallet;
 *   - every store that came back empty is repaired from the survivor, or one survival buys
 *     nothing the next time round;
 *   - and with every store throwing — Safari private mode, a partitioned frame — the module
 *     still evaluates. A throw during module evaluation is a blank app for the whole fleet
 *     within minutes of a push, which is a far worse bug than the one this fixes.
 *
 * WHY A HOOK. The page's script is a module, so chDeviceId is unreachable from
 * page.evaluate, and exposing it on window would ship a test-only global to every user. The
 * hook is injected into the TEST COPY of index.html only — the served bytes, never the file —
 * the same trick test-session-dom and test-seek-dom use.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-devid-dom.mjs
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
  console.log('· playwright-core not installed — skipping the device-id test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* The last line of the device-id block, so the hook is installed below every declaration it
   reaches — and it is the background restore itself, which is the half this suite exists to
   watch. If it moves, this anchor is supposed to break loudly rather than quietly test an
   older shape of the code. */
const ANCHOR = 'try{ didRestore(); }catch(e){}';
if (!real.includes(ANCHOR)) {
  console.error('  ✗ anchor ' + JSON.stringify(ANCHOR) + ' is gone — this test needs updating');
  process.exit(1);
}
const HOOK = ANCHOR + `
window.__did={
  /* THE ANSWER A MODULE-SCOPE CALLER GETS, taken on the same tick as didRestore() above —
     so the IndexedDB open cannot possibly have resolved yet. It is what a track() fired
     during evaluation would carry, it is the id the wallet would be keyed on if nothing
     repaired it, and reading it here is also a standing check that chDeviceId() is callable
     from module scope at all: a const in that block instead of a var would make this line a
     TDZ ReferenceError, which is the whole app gone. */
  sync0:(()=>{ try{ return chDeviceId(); }catch(e){ return "THREW: "+e.message; } })(),
  get:()=>chDeviceId(),
  ls:()=>{ try{ return localStorage.getItem("kamo_did")||""; }catch(e){ return "throws"; } },
  ck:()=>{ try{ return (document.cookie||""); }catch(e){ return "throws"; } }
};`;
const pageHtml = real.replace(ANCHOR, HOOK);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); process.exit(0); }

/* Real files for everything but the document: the page loads its script as a module, and a
   server that answers text/html to every path makes the browser refuse it under strict MIME
   checking — the whole app then does nothing, which looks exactly like a failing assertion. */
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
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: exe });

/* The test's own view of the third store. Deliberately NOT routed through the page's
   helpers: if didIdbPut() and this read shared an implementation, a store that never
   actually landed would still read back consistent. */
const IDB_READ = () => new Promise((res) => {
  try {
    const rq = indexedDB.open('kamo_id', 1);
    rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) {} };
    rq.onsuccess = () => {
      try {
        const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get('did');
        g.onsuccess = () => res(g.result || '');
        g.onerror = () => res('');
      } catch (e) { res(''); }
    };
    rq.onerror = () => res('');
    rq.onblocked = () => res('');
  } catch (e) { res(''); }
});
const IDB_WRITE = (v) => new Promise((res) => {
  try {
    const rq = indexedDB.open('kamo_id', 1);
    rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) {} };
    rq.onsuccess = () => {
      try {
        const t = rq.result.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, 'did');
        t.oncomplete = () => res(true);
        t.onerror = () => res(false);
      } catch (e) { res(false); }
    };
    rq.onerror = () => res(false);
    rq.onblocked = () => res(false);
  } catch (e) { res(false); }
});

async function fresh(opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') process.env.KAMO_VERBOSE && console.log('    [page] ' + m.text()); });
  if (opts && opts.init) await page.addInitScript(opts.init);
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__did, null, { timeout: 15000 });
  return { ctx, page };
}
const idOf = (page) => page.evaluate(() => window.__did.get());
const lsOf = (page) => page.evaluate(() => window.__did.ls());
const ckOf = (page) => page.evaluate(() => window.__did.ck());
const idbOf = (page) => page.evaluate(IDB_READ);
/* IndexedDB is a round trip, so "it landed" is a state to wait for, not to read once. */
async function waitFor(fn, want, label) {
  for (let i = 0; i < 60; i++) {
    const got = await fn();
    if (got === want) return got;
    await new Promise((r) => setTimeout(r, 100));
  }
  bad(`${label} — never became ${JSON.stringify(want)} within 6s (last: ${JSON.stringify(await fn())})`);
  return null;
}

console.log('\nONE ID, WRITTEN TO ALL THREE STORES');
const first = await fresh();
const ID = await idOf(first.page);
{
  /^w[a-z0-9]+$/.test(ID)
    ? ok(`a first visit mints one id (${ID})`)
    : bad(`chDeviceId() returned ${JSON.stringify(ID)} on a browser with working storage`);
  (await lsOf(first.page)) === ID
    ? ok('localStorage holds it — the store every wallet in the table today is keyed on')
    : bad(`localStorage holds ${JSON.stringify(await lsOf(first.page))}, not the id it returned`);
  (await ckOf(first.page)).includes('kamo_did=' + ID)
    ? ok('the cookie holds it')
    : bad(`the cookie does not carry the id (${JSON.stringify(await ckOf(first.page))})`);
  await waitFor(() => idbOf(first.page), ID, 'IndexedDB never received the id');
  if (!failed) ok('IndexedDB holds it too, written in the background');
}
{
  /* A session cookie dies with the tab, which would make the cookie leg worthless against
     the failure it is here for — a reinstall or a week away from the app. */
  const c = (await first.ctx.cookies(base)).find((x) => x.name === 'kamo_did');
  const YEAR = 365 * 24 * 3600;
  if (!c) bad('no kamo_did cookie in the jar at all');
  else if (!(c.expires > 0) || c.expires - Date.now() / 1000 < YEAR)
    bad(`the cookie expires in ${c.expires > 0 ? Math.round((c.expires - Date.now() / 1000) / 86400) + ' days' : 'this session'} — too soon to outlive an eviction`);
  else ok(`the cookie is long-lived (${Math.round((c.expires - Date.now() / 1000) / 86400)} days), not a session cookie`);
}

console.log('\nAND IT SURVIVES A CLEARED localStorage — THE WHOLE POINT');
{
  await first.page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  (await lsOf(first.page)) === '' ? ok('localStorage.clear() emptied the store it used to live in') : bad('localStorage did not clear — the rest of this proves nothing');
  await first.page.reload({ waitUntil: 'load' });
  await first.page.waitForFunction(() => !!window.__did, null, { timeout: 15000 });
  const after = await idOf(first.page);
  after === ID
    ? ok(`the same id comes back after the clear (${after}) — the wallet is still reachable`)
    : bad(`the id changed across localStorage.clear(): ${ID} → ${after}.\n`
      + '    That is the bug: a new wallet, a renewed free hint, and a bought pack stranded in the old one.');
  await waitFor(() => lsOf(first.page), ID, 'localStorage was never repaired from the survivor');
  (await lsOf(first.page)) === ID
    ? ok('...and localStorage is repaired from the survivor, so the next clear is survivable too')
    : null;
}

console.log('\nAND IT SURVIVES localStorage AND THE COOKIE GOING TOGETHER');
{
  await first.page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await first.ctx.clearCookies();
  await first.page.reload({ waitUntil: 'load' });
  await first.page.waitForFunction(() => !!window.__did, null, { timeout: 15000 });
  /* Taken during module evaluation, before the background read could have landed: this is
     the synchronous answer, and with both fast stores empty it is allowed — required, even —
     to be a freshly minted id. What is not allowed is for it to STAY minted. */
  const sync = await first.page.evaluate(() => window.__did.sync0);
  sync !== ID && /^w[a-z0-9]+$/.test(sync)
    ? ok(`a module-scope caller gets a minted id (${sync}) — IndexedDB is asynchronous and chDeviceId() is not`)
    : bad(`the synchronous answer with two empty stores was ${JSON.stringify(sync)}; expected a freshly minted id`);
  const settled = await waitFor(() => idOf(first.page), ID, 'the id never came back from IndexedDB');
  if (settled === ID) {
    ok(`and the background read adopts the stored id over the minted one (${ID}) — the wallet is reachable again`);
    await waitFor(() => lsOf(first.page), ID, 'localStorage was never repaired from IndexedDB');
    (await ckOf(first.page)).includes('kamo_did=' + ID)
      ? ok('both synchronous stores are repaired from it, so the id is three-deep again')
      : bad('the cookie was not rewritten from the IndexedDB id — the next eviction loses it for good');
  }
  await first.ctx.close();
}

console.log('\nAN ID THAT IS ALREADY THERE ALWAYS WINS OVER MINTING A NEW ONE');
{
  /* The failure this rule prevents is the one that is invisible: minting over a store that
     already had an id retires a wallet that may hold a purchase. */
  const PRE = 'wpreexisting1234';
  const { ctx, page } = await fresh({ init: `try{ localStorage.setItem("kamo_did", ${JSON.stringify(PRE)}); }catch(e){}` });
  const got = await idOf(page);
  got === PRE
    ? ok(`an id already in localStorage is returned untouched (${PRE})`)
    : bad(`an existing localStorage id was replaced: ${PRE} → ${got}`);
  (await ckOf(page)).includes('kamo_did=' + PRE)
    ? ok('...and the empty cookie is repaired from it rather than the other way round')
    : bad('the cookie was not seeded from the existing id');
  await waitFor(() => idbOf(page), PRE, 'IndexedDB was not seeded from the existing id');
  await ctx.close();
}
{
  /* Cookie alone — a device whose localStorage was cleared before this shipped. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const CK = 'wcookieonly98765';
  await ctx.addCookies([{ name: 'kamo_did', value: CK, url: base, expires: Math.round(Date.now() / 1000) + 3600 * 24 * 365 }]);
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__did, null, { timeout: 15000 });
  const got = await idOf(page);
  got === CK
    ? ok(`an id that only the cookie still has is adopted (${CK})`)
    : bad(`the cookie's id was ignored and ${JSON.stringify(got)} was minted over it`);
  (await lsOf(page)) === CK ? ok('...and written back into localStorage') : bad('localStorage was not repaired from the cookie');
  await ctx.close();
}
{
  /* The one genuine conflict: two stores, two different ids. localStorage wins — it is where
     every wallet that exists today is keyed — and IndexedDB is converged onto it, because a
     divergence left alone resurrects the loser the next time the other two are cleared. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'load' });
  const OLD = 'wstaleidb123456', LIVE = 'wlivelocal12345';
  await page.evaluate(IDB_WRITE, OLD);
  await page.addInitScript(`try{ localStorage.setItem("kamo_did", ${JSON.stringify(LIVE)}); }catch(e){}`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__did, null, { timeout: 15000 });
  const got = await idOf(page);
  got === LIVE
    ? ok(`localStorage beats a stale IndexedDB row (${LIVE} over ${OLD}) — the read id is never replaced by an older store`)
    : bad(`the id read from localStorage was replaced: ${LIVE} → ${got}`);
  await waitFor(() => idbOf(page), LIVE, 'IndexedDB was never converged onto the live id');
  await ctx.close();
}

console.log('\nAND WITH EVERY STORE THROWING, THE MODULE STILL EVALUATES');
{
  /* Safari private mode, a partitioned third-party frame, an enterprise cookie policy. The
     id is unrecoverable there and that is accepted; a blank app for the whole fleet is not. */
  const HOSTILE = `
    const boom=()=>{ throw new Error("storage refused"); };
    try{ Object.defineProperty(window,"localStorage",{configurable:true,get:boom}); }catch(e){}
    try{ Object.defineProperty(window,"indexedDB",{configurable:true,get:boom}); }catch(e){}
    try{ Object.defineProperty(document,"cookie",{configurable:true,get:boom,set:boom}); }catch(e){}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(HOSTILE);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base, { waitUntil: 'load' });
  let booted = true;
  try { await page.waitForFunction(() => !!window.__did && !!window.KAMO, null, { timeout: 15000 }); } catch { booted = false; }
  booted
    ? ok('the module evaluates to the end with localStorage, cookies and IndexedDB all throwing')
    : bad('THE MODULE DIED with every store throwing — that is a blank app for everyone, which is\n'
      + `    a worse bug than the one this file fixes. Page errors: ${errs.slice(0, 3).join(' | ') || 'none reported'}`);
  if (booted) {
    const got = await idOf(page);
    typeof got === 'string' && got.length
      ? ok(`chDeviceId() still answers a string there (${got})`)
      : bad(`chDeviceId() returned ${JSON.stringify(got)} with no store available`);
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the device id survives a cleared store, and an existing one is never minted over');
process.exit(failed ? 1 : 0);
