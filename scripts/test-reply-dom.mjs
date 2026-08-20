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
 *     payload — the wire, not the label — because a button that says "Challenge @tony back"
 *     over a hide with no reply_to is worse than no button at all.
 *
 *  2. THE ADDRESS OUTLIVES ITS ROUND. This is the one with a victim: carry the target into the
 *     next photo and a stranger gets a lock-screen notification about a hide that has nothing
 *     to do with them. Asserted by taking a new photo after a reply and checking the state is
 *     empty again.
 *
 *  3. THE ANSWER SCREEN IS SOLD TO INSTEAD OF PAINTED ON. Reported by the founder on
 *     2026-08-16, from the browser his own share link lands in: "Challenge back" reaches
 *     compose in well under the 1500ms the seek ending card schedules pwFirstOffer at, so the
 *     paywall arrived on top of the reply he had just started making — on a page where a
 *     purchase has never once been possible. Asserted on the real path, past the dwell
 *     backstop, because the round's own timer was already cleared by chRehide and the bug came
 *     back through the other one.
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
const staged = real.replace(anchor, anchor +
  'window.__rpc=window.__rpc||[];window.__rpc.push([fn,body]);' +
  'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];')
  /* 45 seconds is the right number for a user and an absurd one for a suite. Shortened rather
     than stubbed: what block 3 asserts is that the REAL backstop, on its real path, no longer
     lands on the answer screen. */
  .replace('const PW_FIRST_DWELL_MS=45000;', 'const PW_FIRST_DWELL_MS=800;');

/* THE TWO FACTS THE RETURN NEEDS, AND NEITHER IS REACHABLE FROM THE DOM. `chReplyFromFeed` is
   set only inside a feed round — this suite's rounds arrive by link, which is the path that
   deliberately does NOT auto-return — and `chId` is the id create_hide answered with, which
   exists only after a real storage round trip. Both are module-scope `let`s, so the fixture is
   appended inside the module rather than bolted onto window: the same door test-sheetlive uses,
   and the reason nothing test-only has to live in index.html. */
const tail = staged.lastIndexOf('</script>');
const html = staged.slice(0, tail)
  + '\nwindow.__rb={'
  + 'arm(id){ chReplyFromFeed=true; chId=id; },'
  + 'sent(){ document.getElementById("ssInvite").click(); },'
  + 'feed(){ const h=document.getElementById("kfHint");'
  + ' return{open:!!document.getElementById("kfeed"),hint:h?h.textContent:null,'
  + ' slides:document.querySelectorAll("#kfeed .kfSlide").length,'
  + ' card:(document.getElementById("kfMid")||{}).textContent||""}; },'
  + '};\n'
  + staged.slice(tail);

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
const SHOT = readFileSync(join(ROOT, 'shot.jpg'));
async function openHide(name, extra) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  /* THE HIDE'S PHOTO, ANSWERED THE WAY STORAGE ANSWERS IT — 200, image/jpeg, ACAO:*. Without
     this the container's blocked egress is what decides whether chRehide reaches compose at
     all, and block 3 needs the screen it is asserting about to exist. */
  await page.route('**/storage/v1/object/public/hides/**', r =>
    r.fulfill({ status: 200, contentType: 'image/jpeg', body: SHOT, headers: { 'access-control-allow-origin': '*' } }));
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
  label === 'Challenge @tony back'
    ? ok(`the send button names them ("${label}")`)
    : bad('button reads ' + JSON.stringify(label));

  /* THE ONE WITH A VICTIM. A target that survives into the next photo puts a notification on
     a stranger's lock screen about a hide they were never part of. */
  /* ⚠️ AND IT IS ASYNCHRONOUS NOW, WHICH IS THE FIX AND NOT AN INCONVENIENCE. usePhotoSrc()
     decodes the picked image in an off-DOM probe before it touches anything, because both
     doors used to enter compose on an image that might never decode and leave the player on a
     black board with a live clock. So the clear lands one decode later than the call, and
     reading the state in the same evaluate() reads it before it has happened. Waited for
     rather than slept through: a fixed pause would pass on this machine and rot on a slower
     one. */
  await page.evaluate(() => {
    /* The real door a new photo comes through: window.KAMO.usePickedPhoto is what the native
       picker calls, so this exercises production wiring rather than a test-only shortcut. */
    window.KAMO.usePickedPhoto('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
  });
  await page.waitForFunction(() => window.KAMOREPLY.state().to === '', null, { timeout: 4000 }).catch(() => {});
  const cleared = await page.evaluate(() => ({ st: window.KAMOREPLY.state(), label: window.KAMOREPLY.label() }));
  cleared.st.to === '' && cleared.label === 'Send to a friend'
    ? ok('picking a different photo ends the conversation — no target, generic label')
    : bad('after a new photo: ' + JSON.stringify(cleared));

  await page.close();
}

/* THE OTHER DOOR, ON ITS OWN PAGE BECAUSE THE CASE ABOVE HAS ALREADY SPENT ITS REPLY.
   pickPhoto() reaches the native picker only when the wrapper advertises photoPicker, so in a
   BROWSER — which is where the mirror serves every challenge link — #fileInput is the only
   door there is. It used to be a second, hand-copied arrival that had never learned
   chClearReply(): a player who tapped "Challenge back" and then picked a different photo
   published it stamped as an answer to a round whose picture they had just discarded, and
   notify_hide_reply went to somebody with nothing to do with it. Measured on the real page
   before the fix — reply still {to:'abc123def4567890'}, button still "Challenge @tony back".
   Both doors land in usePhotoSrc() now, and this is the assertion that keeps them there. */
console.log('\nAND THE FILE INPUT IS A DOOR TOO — THE ONLY ONE A BROWSER HAS');
{
  const page = await replyFrom('tony');
  const before = await page.evaluate(() => window.KAMOREPLY.state());
  before && before.to === 'abc123def4567890'
    ? ok('the reply is standing before the pick')
    : bad('no reply to clear: ' + JSON.stringify(before));

  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    c.getContext('2d').fillRect(0, 0, 8, 8);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.png', { type: 'image/png' }));
    const inp = document.getElementById('fileInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.KAMOREPLY.state().to === '', null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => ({ st: window.KAMOREPLY.state(), label: window.KAMOREPLY.label() }));
  after.st.to === '' && after.label === 'Send to a friend'
    ? ok('#fileInput ends the conversation exactly like the native picker')
    : bad('after a new photo through #fileInput: ' + JSON.stringify(after));

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
  label === 'Challenge back'
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
  t.head === 'Wrong kamo.' && /@tony's, from round 2/.test(t.sub) && /still in there/.test(t.sub)
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

console.log('\nAND NOBODY IS SOLD TO WHILE THEY ARE MAKING IT');
{
  /* THE FOUNDER'S 2026-08-16 REPORT, ON HIS OWN PATH. A challenge link in a browser is 63% of
     this product's traffic and 0% of its purchasable surface: no bridge, no StoreKit, no price
     — every paywall a web visitor ever saw was a sales screen with nothing behind it.
     THREE SCREENS, IN THE ORDER HE MET THEM. The ending card (where `seek_end` fires 1500ms
     out), then the compose screen of the reply, then the same screen past the dwell backstop —
     which is the one that came back after chRehide cleared the round's own timer.
     THE TOOLS ARE PART OF THE ASSERTION, not decoration: on the full arm openPaywall() stamps
     .pwCover, and that rule hides #shutterWrap and the whole tool row by visibility. The bug
     was not "a sheet appeared", it was "the answer to Challenge back was a photo you could not
     paint". */
  const page = await replyFrom('tony');
  const early = await page.evaluate(() => document.getElementById('paywall').classList.contains('show'));
  await page.waitForTimeout(2600);   // past the shortened dwell and its first retry
  const st = await page.evaluate(() => ({
    paywall: document.getElementById('paywall').classList.contains('show'),
    cover: document.getElementById('stage').classList.contains('pwCover'),
    shutter: getComputedStyle(document.getElementById('shutterWrap')).visibility,
    /* The reply is composed on the answered photo — the camera is never opened here, and a
       regression that reached for it would ask a browser for permission it was never given. */
    camera: getComputedStyle(document.getElementById('cam')).display,
    loaded: document.getElementById('photo').naturalWidth > 0,
  }));
  !early && !st.paywall && !st.cover
    ? ok('the answer screen is left alone — no paywall on a page that cannot sell')
    : bad(`a paywall reached the reply screen (on arrival: ${early}, after the dwell: ${st.paywall}, cover: ${st.cover})`);
  st.shutter !== 'hidden' && st.loaded && st.camera === 'none'
    ? ok('and it is the answered photo with its tools, not the camera')
    : bad(`the reply screen reads shutter:${st.shutter} photo-loaded:${st.loaded} camera:${st.camera}`);
  await page.close();
}

/* THE LAST FRAME OF A REPLY IS THE REPLY, NOT A ROOM FULL OF STRANGERS.
   A reply born in the feed sends without a share sheet — the address is already known — and the
   receipt is the button changing. The feed then comes back by itself, and for one release it
   came back as the PLAIN public feed: the answer to "I painted this and sent it back" was
   somebody else's photograph, and on a device that had already played what the room holds it
   was the cold-start card, "Nothing here yet.", printed over the spent round. Founder's report,
   2026-08-17, with the screenshot: "ça devrait renvoyer vers le feed sur le dessin que j'ai
   send back".
   ASSERTED ON THE WIRE AND ON THE SCREEN. get_hide carrying the id that was just published is
   what "seeded by id" MEANS — chFeed fetches slide 0 rather than rendering it locally — and the
   hint is how the screen says whose photo it is. Either one alone would pass on a build that
   opened the right feed and drew the wrong thing. */
console.log('\nAND THE FEED COMES BACK ON THE HIDE THAT WAS JUST SENT');
{
  const page = await replyFrom('tony');
  const MINE = 'sentback00000001';
  await page.evaluate((id) => { window.__rpc = []; window.__rb.arm(id); window.__rb.sent(); }, MINE);
  /* The return is deliberately a beat behind the receipt (1600ms), so this waits for the feed
     rather than sleeping past it — a fixed sleep here is a test that fails on a slow morning. */
  await page.waitForSelector('#kfeed', { timeout: 10000 });
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => window.__rb.feed());
  const seeded = await page.evaluate((id) =>
    window.__rpc.some(([fn, b]) => fn === 'get_hide' && b && b.p_id === id), MINE);

  seeded
    ? ok('the feed is opened ON the reply — get_hide asks for the id that was just published')
    : bad('no get_hide for the published id — the reply return opened the plain public feed');
  st.slides >= 1 && !/Nothing here yet/.test(st.card)
    ? ok('so the sender lands on a slide, never on the cold start over their own send')
    : bad(`the feed shows ${st.slides} slide(s) and says ${JSON.stringify(st.card.slice(0, 40))}`);
  st.hint && /yours/i.test(st.hint)
    ? ok(`and the slide is named as theirs ("${st.hint}")`)
    : bad(`the seeded slide is unlabelled — hint reads ${JSON.stringify(st.hint)}`);
  await page.close();
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a reply knows who it answers, and says so');
process.exit(failed ? 1 : 0);
