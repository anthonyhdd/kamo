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
async function openHide(name, extra) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript((a) => {
    const [n, x] = a;
    window.__seed = {
      get_hide: Object.assign({ img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: n }, (x && x.hide) || {}),
      submit_attempt: (x && x.attempt) || { hit: false, tries: 1, missed: 1, secs: 9 },
      create_hide: 'newhide00000000',
      set_hide_lang: null,
      /* Stubbed so the ending card is not waiting on a network call that this container
         cannot make: unstubbed, chRpc reaches for supabase.co, the proxy refuses it, and how
         long that takes is what decides whether a fixed sleep here passes. */
      reveal_hide: null,
      save_seek_trace: null,
    };
    if (x && x.mine) { try { localStorage.setItem('kamo_hides', JSON.stringify(x.mine)); } catch (e) {} }
  }, [name, extra || {}]);
  await page.goto(base + '?h=abc123def4567890', { waitUntil: 'load' });
  await page.waitForSelector('#chQuit', { timeout: 10000 });
  return page;
}

async function replyFrom(name) {
  const page = await openHide(name);
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

  /* AND WHO MADE IT. Without a key on the row there is no blocking at all — feed_page's
     block clause passes author_key IS NULL straight through, so an unkeyed hide is one no
     viewer can ever get rid of. It rides the widest rung only: the narrower overloads have
     no argument for it. */
  const key = forms[0] && forms[0].p_author_key;
  typeof key === 'string' && /^[a-z0-9]{16,40}$/.test(key)
    ? ok(`the widest form carries an author key, so the hide can be blocked (${key.length} chars)`)
    : bad('author key on the widest form: ' + JSON.stringify(key));
  forms.slice(1).every(f => !('p_author_key' in f))
    ? ok('and no narrower rung claims to carry one')
    : bad('a fallback form carries p_author_key: ' + JSON.stringify(forms.slice(1)));

  /* STABLE, OR EVERY BLOCK EVER PLACED AGAINST THIS DEVICE LAPSES IN SILENCE. A key that
     regenerates per call would pass every assertion above and still be useless. */
  const again = await page.evaluate(() => window.KAMOREPLY.forms()[0].p_author_key);
  again === key
    ? ok('and it is the same key on the next publish, so a block outlives one hide')
    : bad(`author key changed between calls: ${key} then ${again}`);
  await page.close();
}

console.log('\nA CHAIN SAYS HOW DEEP IT IS');
{
  const page = await openHide('tony', { hide: { round: 6 } });
  const sub = await page.evaluate(() => document.getElementById('chSub').textContent);
  sub === 'Round 6 · One tap to find'
    ? ok(`the seeker is told which round it is ("${sub}")`)
    : bad('round 6 subtitle reads ' + JSON.stringify(sub));
  await page.close();

  const first = await openHide('tony', { hide: { round: 1 } });
  const sub1 = await first.evaluate(() => document.getElementById('chSub').textContent);
  sub1 === 'One tap to find'
    ? ok('and a hide that is not an answer says nothing about rounds')
    : bad('round 1 subtitle reads ' + JSON.stringify(sub1));
  await first.close();
}

console.log('\nFINDING AN OLD FIGURE IS NOT "YOU MISSED"');
{
  /* THE BUG THIS WHOLE MIGRATION EXISTS FOR. By round six the photo holds six camouflaged
     people and the answer key is one of them, so five correct finds were being scored as
     failures — and the deeper the chain, the likelier that is, which means it landed hardest
     on the players who had gone furthest. Driven with a real tap, because the copy is chosen
     inside buzz() off the server's answer. */
  const page = await openHide('tony', {
    hide: { round: 4 },
    attempt: { hit: false, tries: 2, missed: 2, secs: 9, pct: null, others: 0, scope: 'all', old_round: 2, old_name: 'tony', old_id: 'someoneelse0000' },
  });
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await page.waitForSelector('#chReh', { timeout: 10000 });
  const t = await page.evaluate(() => ({
    head: document.getElementById('chHead').textContent,
    sub: document.getElementById('chSub').textContent,
  }));
  t.head === 'Wrong body.' && /@tony's, from round 2/.test(t.sub) && /still in there/.test(t.sub)
    ? ok(`a wrong-one tap is named, not failed ("${t.sub}")`)
    : bad('old-find ending reads ' + JSON.stringify(t));
  await page.close();

  /* Unsigned is the common case and must not print "@'s". */
  const anon = await openHide(null, {
    hide: { round: 3 },
    attempt: { hit: false, tries: 2, missed: 2, secs: 9, pct: null, others: 0, scope: 'all', old_round: 1, old_name: null },
  });
  await anon.mouse.move(200, 500); await anon.mouse.down(); await anon.waitForTimeout(80); await anon.mouse.up();
  await anon.waitForSelector('#chReh', { timeout: 10000 });
  const sub = await anon.evaluate(() => document.getElementById('chSub').textContent);
  /the one from round 1/.test(sub) && !/@/.test(sub)
    ? ok(`and an unsigned one is named without inventing a handle ("${sub}")`)
    : bad('unsigned old-find reads ' + JSON.stringify(sub));

  /* Seeded through the same door the app uses (kamo_hides is chMine()'s key), so the page
     believes it published that hide — which is exactly the state a real ping-pong produces. */
  const self = await openHide('tony', {
    hide: { round: 3 },
    attempt: { hit: false, tries: 2, missed: 2, secs: 9, pct: null, others: 0, scope: 'all', old_round: 1, old_name: 'tony', old_id: 'ownhide000000001' },
    mine: ['ownhide000000001'],
  });
  await self.mouse.move(200, 500); await self.mouse.down(); await self.waitForTimeout(80); await self.mouse.up();
  await self.waitForSelector('#chReh', { timeout: 10000 });
  const selfSub = await self.evaluate(() => document.getElementById('chSub').textContent);
  /you hid in round 1/.test(selfSub) && !/@/.test(selfSub)
    ? ok(`finding your own figure says so ("${selfSub}")`)
    : bad('self old-find reads ' + JSON.stringify(selfSub));
  await self.close();
  await anon.close();

  /* A PLAIN MISS MUST STAY A PLAIN MISS. Without this, any regression that always reports an
     old find would still pass the two assertions above. */
  const plain = await openHide('tony', { hide: { round: 2 } });
  await plain.mouse.move(200, 500); await plain.mouse.down(); await plain.waitForTimeout(80); await plain.mouse.up();
  await plain.waitForSelector('#chReh', { timeout: 10000 });
  const head = await plain.evaluate(() => document.getElementById('chHead').textContent);
  /* The loss states its clock; the reveal line is the subtitle now. */
  /^Lost in \d+\.\d+s$/.test(head)
    ? ok('a miss that hit nothing still reads as a miss')
    : bad('plain miss reads ' + JSON.stringify(head));
  await plain.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a reply knows who it answers, and says so');
process.exit(failed ? 1 : 0);
