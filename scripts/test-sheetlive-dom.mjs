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
  + 'hint(){ const h=document.getElementById("kfHint"); return h?h.textContent:null; },'
  + 'state(){ const v=(id)=>{const e=document.getElementById(id);'
  + 'return e?getComputedStyle(e).display!=="none":null;};'
  + 'const txt=(id)=>{const e=document.getElementById(id);return e?e.textContent.trim():null;};'
  + 'return{live:v("ssSeeLive"),get:v("ssGet"),title:txt("ssTitle"),sub:txt("ssSub")};},'
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

console.log('\nTHE HEADLINE FOLLOWS THE TOGGLE, BOTH WAYS');
{
  const p = await open(true);
  const pub = await p.evaluate(() => window.__s.vis(true));
  /live/i.test(pub.title || '')
    ? ok(`public says the challenge is live ("${pub.title}")`)
    : bad(`public headline reads ${JSON.stringify(pub.title)}`);

  const priv = await p.evaluate(() => window.__s.vis(false));
  priv.title && priv.title !== pub.title && !/\blive\b/i.test(priv.title)
    ? ok(`private stops claiming it ("${priv.title}")`)
    : bad(`private headline reads ${JSON.stringify(priv.title)} — the sheet is announcing a `
        + 'public hide directly above a control that says Private');

  /* Back again, because a one-way switch is the failure that ships: the first render is the
     one everybody tests, and nobody taps the toggle twice. */
  const back = await p.evaluate(() => window.__s.vis(true));
  back.title === pub.title
    ? ok('and it comes back when the toggle does')
    : bad(`switching back left the headline at ${JSON.stringify(back.title)}`);
  await p.close();
}

console.log('\nA PRIVATE HIDE IS NEVER OFFERED THE FEED');
{
  const p = await open(true);
  const pub = await p.evaluate(() => window.__s.vis(true));
  pub.live ? ok('"See it live" is there for a public hide') : bad('#ssSeeLive is hidden for a public hide');
  const priv = await p.evaluate(() => window.__s.vis(false));
  !priv.live
    ? ok('and gone for a private one — it would open a feed the hide is not in')
    : bad('#ssSeeLive offered the feed for a hide that was never published to it');
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
  await p.evaluate(() => { window.__s.vis(true); window.__s.publish(); });
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
  const hint = await p.evaluate(() => window.__s.hint());
  hint && /yours/i.test(hint) && /scroll/i.test(hint)
    ? ok(`the first slide is named as theirs and points onward ("${hint}")`)
    : bad(`hint reads ${JSON.stringify(hint)} — the seeded slide is unlabelled`);
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
