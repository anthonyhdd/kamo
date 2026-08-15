#!/usr/bin/env node
/**
 * THE SHARE SHEET SAYS WHAT JUST HAPPENED, AND IT HAS TO BE TRUE.
 *
 * The sheet used to ask a question ("Can they find you?"), which cannot be wrong. Since
 * 2026-08-15 it makes a CLAIM — "Your challenge is now live!" — and directly underneath it
 * sits the control that decides whether that claim holds. 23% of publishers turn that control
 * off. So the whole surface is one answer with three faces, and this suite exists because
 * nothing else can see them disagree:
 *
 *   · the headline follows the toggle, both ways
 *   · "See it live" is not offered for a private hide — it would open a feed the hide is not
 *     in, about a link nobody else has
 *   · the grey line under the headline promises a notification only where one can be
 *     delivered. It is the only context iOS's permission prompt ever gets (armResultsPing
 *     fires seconds later and iOS asks exactly once), and in a browser it would also be
 *     arguing with #ssGet three rows below, which sells that exact gap.
 *
 * It replaces the #ssLive suite. That button waited for a proven send before offering the
 * feed, which made the feed a reward rather than the proof the hide exists — and publishing
 * happens one tap EARLIER, when the sheet is touched. #ssSeeLive is on the sheet from the
 * first frame instead, so the same lie (offering the feed to a private hide) is now reachable
 * by more people, not fewer. That is why the assertion moved here rather than being deleted.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-sheetlive-dom.mjs
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
  console.log('· playwright-core not installed — skipping the sheet-live test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__s={'
  /* THROUGH kfSetWantPublic + kfRenderVis, which is the pair the real toggle runs. Writing
     localStorage and reading the DOM would assert that the key round-trips, which was never
     in doubt; what is under test is that ONE function paints all three faces of the answer. */
  + 'vis(pub){ kfSetWantPublic(!!pub); kfRenderVis(); return this.state(); },'
  /* chId is the id of the hide that has been published — chUpload() sets it for real, and it
     is what "See it live" seeds the feed with. Set directly so the fixture never needs
     Supabase; chRpc is stubbed to answer the one call chFeed makes with it. */
  + 'publish(){ chId="fixture-hide"; chRpc=async(fn)=>(fn==="get_hide"'
  + '?{img_path:"x.jpg",name:"tony",n_attempts:0,n_found:0}:null); },'
  + 'send(){ this.publish(); chMarkSent(); return this.state(); },'
  /* NO ID, WHICH IS THE STATE THE BUTTON WAS REPORTED BROKEN IN. chId is only set once
     create_hide resolves, and for a paint under the floor it is never set at all —
     chUpload() and chSlot() both refuse. currentScore is the module variable both of
     them read, so setting it is how the fixture picks which of the two failures to be. */
  + 'unpublished(score){ chId=""; currentScore=score; chRpc=async()=>null; },'
  + 'hint(){ const h=document.getElementById("hint"); return h?h.textContent:""; },'
  /* The sheet has to be genuinely OPEN for "it stays put" to mean anything — a class
     that was never added cannot be observed surviving. */
  + 'openSheet(){ ssState="open"; shareSheetEl.classList.add("show"); return shareSheetEl.classList.contains("show"); },'
  + 'live(){ return{sheet:shareSheetEl.classList.contains("show"),feed:!!document.getElementById("kfeed")}; },'
  + 'feedHint(){ const h=document.getElementById("kfHint"); return h?h.textContent:null; },'
  + 'state(){ const v=(id)=>{const e=document.getElementById(id);'
  + 'return e?getComputedStyle(e).display!=="none":null;};'
  + 'const txt=(id)=>{const e=document.getElementById(id);return e?e.textContent.trim():null;};'
  + 'return{live:v("ssSeeLive"),get:v("ssGet"),title:txt("ssTitle"),sub:txt("ssSub")};},'
  /* The reveal has to be genuinely UP for "closing the feed leaves it" to mean anything —
     `finished` is what exitFinished()/backToCompose() branch on. */
  + 'reveal(){ finished=true; stage.classList.add("done"); return finished; },'
  + 'closeFeed(){ const x=document.getElementById("kfClose"); if(x) x.click();'
  + 'return{feed:!!document.getElementById("kfeed"),finished:finished,mode:mode,'
  + 'shutter:getComputedStyle(document.getElementById("shutterWrap")).display}; },'
  + 'tap(){ window.__tracked=[]; const t=track;'
  + 'track=(n,p)=>{window.__tracked.push(n);return t(n,p);};'
  + 'try{ document.getElementById("ssSeeLive").click(); }finally{ track=t; }'
  + 'return{tracked:window.__tracked,sheet:shareSheetEl.classList.contains("show"),'
  + 'feed:!!document.getElementById("kfeed")};}};\n'
  + real.slice(at);

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
const url = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

async function open(wrapper) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (wrapper) await page.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__s, null, { timeout: 10000 });
  return page;
}

/* THE HEADLINE IS ONE SENTENCE, AND IT IS TRUE IN BOTH STATES.
   It followed the toggle for one release and said "Only people you send it to" on a private
   hide — a true sentence answering the wrong question, since the row directly below it answers
   that one with a switch. "Live" is a claim about EXISTING, and the hide is uploaded and
   playable by anyone holding the link the moment this sheet opens. Private keeps it out of the
   public feed; it does not make it less live.
   So what is asserted is the opposite of what used to be: the headline must NOT change, and it
   must say `live` either way. A headline that starts varying again is the sheet drifting back
   toward answering the visibility question twice. */
console.log('\nTHE HEADLINE SAYS THE SAME TRUE THING IN BOTH STATES');
{
  const p = await open(true);
  const pub = await p.evaluate(() => window.__s.vis(true));
  const priv = await p.evaluate(() => window.__s.vis(false));
  /\blive\b/i.test(pub.title || '')
    ? ok(`it announces the hide exists ("${pub.title}")`)
    : bad(`the headline reads ${JSON.stringify(pub.title)} — nothing on this sheet says the `
        + 'hide is actually out there');
  priv.title === pub.title
    ? ok('and a private hide gets the same sentence — private is not less live, it is less public')
    : bad(`private changes the headline to ${JSON.stringify(priv.title)} — that is the audience `
        + 'question, and the row below already answers it with a switch');
  /* The row itself still has to follow the toggle. Moving the claim out of the headline is only
     safe because this is where the audience is stated, and it is the half that must never go
     quiet: it is the one disclosure in front of the send. */
  const rowPub = await p.evaluate(() => { window.__s.vis(true); return document.getElementById('ssVisT').textContent; });
  const rowPriv = await p.evaluate(() => { window.__s.vis(false); return document.getElementById('ssVisT').textContent; });
  rowPub !== rowPriv && /public/i.test(rowPub) && /private/i.test(rowPriv)
    ? ok(`the visibility row still carries the answer ("${rowPub}" / "${rowPriv}")`)
    : bad(`the row reads "${rowPub}" public and "${rowPriv}" private — with the headline no `
        + 'longer stating it, this is the ONLY place the audience is disclosed before the send');
  await p.close();
}

/* AND THE PROOF IS OFFERED TO EVERYONE. This was gated on the toggle for one release, on the
   theory that "See it live" would open a feed a private hide is not in — it does not.
   chFeed({first}) fetches that hide BY ID and seeds it as slide 0, the same get_hide call that
   makes private hides render in the My-kamos grid, so the creator sees their own photo playing
   the real round whatever the toggle says. Gating it hid the proof from the people with the
   fewest other ways to check: a private hide is one nobody will stumble across. */
console.log('\nTHE PROOF IS OFFERED WHATEVER THE TOGGLE SAYS');
{
  const p = await open(true);
  const pub = await p.evaluate(() => window.__s.vis(true));
  const priv = await p.evaluate(() => window.__s.vis(false));
  pub.live && priv.live
    ? ok('"See it live" is on the sheet for a public hide AND a private one')
    : bad(`#ssSeeLive is public=${pub.live} private=${priv.live} — the button seeds the hide by `
        + 'id, so there is no state in which it opens something the creator cannot see');
  await p.close();
}

console.log('\nTHE NOTIFICATION IS PROMISED ONLY WHERE IT CAN BE DELIVERED');
{
  const inApp = await open(true);
  const a = await inApp.evaluate(() => window.__s.vis(true));
  /tell you/i.test(a.sub || '')
    ? ok(`the wrapper promises the ping ("${a.sub}") — the context iOS's prompt needs`)
    : bad(`in the app the line reads ${JSON.stringify(a.sub)} — armResultsPing() is about to ask `
        + 'for permission with nothing in front of it, and iOS asks exactly once');
  await inApp.close();

  const web = await open(false);
  const b = await web.evaluate(() => window.__s.vis(true));
  b.sub && !/tell you/i.test(b.sub)
    ? ok(`a browser promises something it can keep instead ("${b.sub}")`)
    : bad(`a browser tab is promising a notification: ${JSON.stringify(b.sub)} — and #ssGet three `
        + 'rows below is selling the app on exactly that gap');
  await web.close();
}

console.log('\nTAPPING IT OPENS THE FEED ON THAT HIDE');
{
  const p = await open(true);
  /* Driven from the PRIVATE state on purpose: it is the one that could not be tapped at
     all until now, and the seeding path is identical. */
  await p.evaluate(() => { window.__s.vis(false); window.__s.publish(); });
  const t = await p.evaluate(() => window.__s.tap());
  t.tracked.includes('sent_feed_tapped')
    ? ok('the tap is counted as sent_feed_tapped, so hide_published → feed_opened has a middle step')
    : bad(`tap tracked ${JSON.stringify(t.tracked)}`);
  !t.sheet ? ok('the sheet closes first, so the feed is not stacked on top of it')
           : bad('the share sheet is still open under the feed');
  t.feed ? ok('and the feed actually opens') : bad('no #kfeed after the tap');

  /* THE SLIDE IS THE PLAYER'S OWN, so the hint has to say so. Without it they meet a round
     whose tap does nothing — the replay flag, working correctly — and read it as broken. */
  await p.waitForTimeout(700);
  const hint = await p.evaluate(() => window.__s.feedHint());
  hint && /yours/i.test(hint) && /scroll/i.test(hint)
    ? ok(`the first slide is named as theirs and points onward ("${hint}")`)
    : bad(`hint reads ${JSON.stringify(hint)} — the seeded slide is unlabelled`);
  await p.close();
}

/* AND IT NEVER ANSWERS "SHOW ME MINE" WITH STRANGERS' PHOTOS.
   Reported twice, the second time after a bounded wait had already been added: "dirige vers le
   feed mais n'ouvre toujours pas la bonne". The wait was the wrong half to stop at, because for
   a bare paint there is nothing to wait for — chUpload() refuses to publish under the floor and
   chSlot() returns null, so the id is never coming. The old code then opened chFeed(""), which
   is the plain public feed: the right screen for a different question.
   Both no-id paths are asserted, because they fail identically from the outside and need
   different sentences: one is "this will never publish, here is what would fix it", the other
   is "it has not landed yet, that tap cost you nothing". */
/* AND CLOSING THE FEED GOES FORWARD, NOT BACK.
   The feed is an overlay, so ✕ has always just uncovered what was underneath — right when it
   was opened from the camera, wrong from here. "See it live" is reached from the reveal of a
   hide that is finished, published and sent; the screen behind the feed is that hide's receipt,
   and dropping somebody back onto it is dropping them onto a round that is over. Reported as
   "ça renvoie vers le paint qui nous a fait ouvrir le feed au lieu de diriger vers le screen
   capture".
   Asserted through the real ✕, and on `mode` rather than on a class, because the thing that
   went wrong was the destination and not the styling. */
console.log('\nCLOSING THE FEED FROM THE REVEAL LANDS ON THE CAMERA');
{
  const p = await open(true);
  await p.evaluate(() => { window.__s.vis(true); window.__s.reveal(); window.__s.publish(); });
  await p.evaluate(() => window.__s.tap());
  await p.waitForTimeout(900);
  (await p.evaluate(() => !!document.getElementById('kfeed')))
    ? ok('the feed opened from the reveal')
    : bad('the feed did not open, so the close cannot be tested');
  const out = await p.evaluate(() => window.__s.closeFeed());
  !out.feed ? ok('and ✕ closes it') : bad('the feed is still up after ✕');
  out.mode === 'compose' && !out.finished
    ? ok(`and lands on the capture screen (mode ${out.mode})`)
    : bad(`✕ left mode=${out.mode} finished=${out.finished} — back on the hide that was already `
        + 'finished, published and sent');
  out.shutter !== 'none'
    ? ok('with the shutter back, so the next hide is one tap away')
    : bad(`the shutter is ${out.shutter} — the camera screen is not actually usable`);
  await p.close();
}

console.log('\nWITH NO HIDE TO SHOW, IT SAYS SO AND STAYS PUT');
for (const [label, score, needle] of [
  ['a paint under the publish floor', 5, /paint more/i],
  ['a publish still in flight', 90, /second|going up/i],
]) {
  const p = await open(true);
  await p.evaluate((sc) => { window.__s.vis(true); window.__s.openSheet(); window.__s.unpublished(sc); }, score);
  await p.evaluate(() => window.__s.tap());
  /* PAST THE CEILING. The in-flight branch waits on chAwaitId(2500) before it can say anything,
     so anything read on the same tick reads the state of a handler that has not run yet — which
     is a green light for a button that never speaks. */
  await p.waitForTimeout(3200);
  const t = await p.evaluate(() => window.__s.live());
  !t.feed
    ? ok(`${label}: the public feed is not opened`)
    : bad(`${label}: chFeed ran with no id — that is a screen of strangers' hides in answer to `
        + '"show me mine", which is exactly how this was reported');
  t.sheet
    ? ok('and the sheet stays, so the tap costs nothing')
    : bad('the sheet closed on a tap that could not be answered, leaving the reveal with no sheet');
  const said = await p.evaluate(() => window.__s.hint());
  needle.test(said || '')
    ? ok(`and it says why ("${said}")`)
    : bad(`the hint reads ${JSON.stringify(said)} — a button that silently does nothing is the `
        + 'defect being fixed, not the fix');
  await p.close();
}

console.log('\nTHE BROWSER OFFER IS STILL EARNED, AND STILL BROWSER-ONLY');
{
  const p = await open(false);
  const before = await p.evaluate(() => window.__s.state());
  !before.get ? ok('a sheet nobody has used sells nothing') : bad('#ssGet is showing before any send');
  const after = await p.evaluate(() => window.__s.send());
  after.get ? ok('#ssGet appears once something has provably been sent')
            : bad('#ssGet did not appear in a browser after a send');
  await p.close();

  const inApp = await open(true);
  const s = await inApp.evaluate(() => window.__s.send());
  !s.get ? ok('and never inside the wrapper — it would sell the app to somebody holding it')
         : bad('#ssGet is showing inside the wrapper');
  await inApp.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} sheet-live check(s) failed` : '\n✓ sheet-live checks passed');
process.exit(failed ? 1 : 0);
