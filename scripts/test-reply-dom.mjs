#!/usr/bin/env node
/**
 * SENDING ONE BACK, TO THE PERSON WHO SENT IT.
 *
 * iOS never tells us who a share went to, and gives no API for messaging a contact the user
 * has not picked. The way round that is not a better share sheet — it is noticing that the
 * recipient of a REPLY is already known: it is the creator of the hide just played. So the
 * seeker's "Send one back" captures that address, and the published hide carries it.
 *
 * Everything about that is invisible until it fails, and it fails silently in both directions:
 *
 *  1. THE ADDRESS IS NOT CAPTURED. The round publishes as an ordinary hide, nobody is
 *     notified, and the app looks exactly as it did before. Asserted on the create_hide
 *     payload — the wire, not the label — because a button that says "Send it back to @tony"
 *     over a hide with no reply_to is worse than no button at all.
 *
 *  2. THE ADDRESS OUTLIVES ITS ROUND. This is the one with a victim: carry the target into the
 *     next photo and a stranger gets a lock-screen notification about a hide that has nothing
 *     to do with them. Asserted by taking a new photo after a reply and checking the state is
 *     empty again.
 *
 * The unsigned case is not an edge case — 117 of 3191 hides carry a name, so the anonymous
 * label is what most people will actually see, and it gets its own assertion.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-reply-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the reply test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Stubbed at the declaration, not appended: the seeker fetches its hide during load, so a
   hook added at the end of the module arrives after the screen has been drawn. Every call is
   recorded so the create_hide payload can be read back — the point of this feature is what
   goes over the wire, and a test that only reads the button would pass on a broken build. */
const anchor = 'async function chRpc(fn,body){';
if (!real.includes(anchor)) throw new Error('anchor missing: ' + anchor);
const html = real.replace(anchor, anchor +
  'window.__rpc=window.__rpc||[];window.__rpc.push([fn,body]);' +
  'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');

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

/* Open a challenge, give up, take the "Send one back" exit. Giving up rather than buzzing:
   both endings mount the same card and a miss needs a real pointer gesture on a real image,
   which is the seeker's own test's job, not this one's. */
async function replyFrom(name) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((n) => {
    window.__seed = {
      get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: n },
      create_hide: 'newhide00000000',
      set_hide_lang: null,
      /* Stubbed so the ending card is not waiting on a network call that this container
         cannot make: unstubbed, chRpc reaches for supabase.co, the proxy refuses it, and how
         long that takes is what decides whether a fixed sleep here passes. */
      reveal_hide: null,
      save_seek_trace: null,
    };
  }, name);
  await page.goto(base + '?h=abc123def4567890', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.waitForSelector('#chQuit', { timeout: 10000 });
  await page.evaluate(() => document.getElementById('chQuit').click());
  /* Waited for, never slept on: the ending card mounts behind the reveal frames, whose load
     time is not a constant. A fixed sleep here is a test that fails on a slow morning. */
  await page.waitForSelector('#chReh', { timeout: 10000 });
  await page.evaluate(() => document.getElementById('chReh').click());
  await page.waitForFunction(() => !document.querySelector('.chS'), { timeout: 10000 });
  return page;
}

console.log('\nTHE REPLY KNOWS WHO IT IS FOR');
{
  const page = await replyFrom('tony');
  const st = await page.evaluate(() => window.KAMOREPLY.state());
  st && st.to === 'abc123def4567890' && st.name === 'tony'
    ? ok('"Send one back" captures the hide it answers, and its author')
    : bad('reply state after rehide: ' + JSON.stringify(st));

  const label = await page.evaluate(() => window.KAMOREPLY.label());
  label === 'Send it back to @tony'
    ? ok(`the send button names them ("${label}")`)
    : bad('button reads ' + JSON.stringify(label));

  /* THE ONE WITH A VICTIM. A target that survives into the next photo puts a notification on
     a stranger's lock screen about a hide they were never part of. */
  const cleared = await page.evaluate(() => {
    /* The real door a new photo comes through: window.KAMO.usePickedPhoto is what the native
       picker calls, so this exercises production wiring rather than a test-only shortcut. */
    window.KAMO.usePickedPhoto('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
    return { st: window.KAMOREPLY.state(), label: window.KAMOREPLY.label() };
  });
  cleared.st.to === '' && cleared.label === 'Challenge a friend'
    ? ok('picking a different photo ends the conversation — no target, generic label')
    : bad('after a new photo: ' + JSON.stringify(cleared));

  await page.close();
}

console.log('\nAND IT STILL WORKS WHEN NOBODY SIGNED IT');
{
  const page = await replyFrom(null);
  const st = await page.evaluate(() => window.KAMOREPLY.state());
  const label = await page.evaluate(() => window.KAMOREPLY.label());
  st.to === 'abc123def4567890' && st.name === ''
    ? ok('an unsigned hide is still answerable — the address does not need a name')
    : bad('unsigned reply state: ' + JSON.stringify(st));
  label === 'Send it back'
    ? ok(`and the button says so without inventing one ("${label}")`)
    : bad('unsigned button reads ' + JSON.stringify(label));
  await page.close();
}

console.log('\nAND THE ADDRESS REACHES THE SERVER');
{
  const page = await replyFrom('tony');
  /* The payload chUpload() would send, built by the same function chUpload() calls — not a
     re-implementation of it. Driving a real publish would need a painted board, a mask canvas
     and a storage round trip, and a test that expensive is a test that gets skipped. */
  const forms = await page.evaluate(() => window.KAMOREPLY.forms());
  Array.isArray(forms) && forms[0] && forms[0].p_reply_to === 'abc123def4567890'
    ? ok('the widest create_hide form carries p_reply_to — the reply is addressed on the wire')
    : bad('first create_hide form: ' + JSON.stringify(forms && forms[0]));

  /* THE LADDER MATTERS AS MUCH AS THE TOP RUNG. If the 10-argument overload is missing —
     the page deploys on push and the database does not — a reply must still publish as an
     ordinary hide rather than not at all. */
  const last = forms && forms[forms.length - 1];
  forms.length > 1 && last && !('p_reply_to' in last)
    ? ok(`it falls back to a plain hide rather than to nothing (${forms.length} forms)`)
    : bad('fallback ladder: ' + JSON.stringify(forms));
  await page.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a reply knows who it answers, and says so');
process.exit(failed ? 1 : 0);
