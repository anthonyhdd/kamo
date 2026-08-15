#!/usr/bin/env node
/**
 * WHAT COMES AFTER THE SEND.
 *
 * The share sheet ended on itself: #ssGet returns early inside the wrapper and #ssAgain was
 * deleted from the markup, so somebody who had just sent a challenge — the highest-intent
 * moment in the session, and the 24% who actually finished the loop — was shown no next step
 * at all. #ssLive is that step, and the two things worth asserting are both about WHO sees it:
 *
 *   · in the app  → #ssLive, never #ssGet   (selling the app to somebody holding it)
 *   · in a browser → #ssGet, never #ssLive  (there is no push to promise)
 *
 * Neither may appear before something has actually been sent. An unearned button on a sheet
 * nobody has used is noise, and #ssGet has shipped that rule since it existed.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-sentlive-dom.mjs
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
  console.log('· playwright-core not installed — skipping the sent-live test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__s={'
  /* chId is what chMarkSent() bails on — it is the id of the hide that just went out, and
     without one nothing has provably been sent. Setting it is how the fixture says "a real
     send happened" without standing up Supabase. chRpc is neutered for the same reason. */
  + 'send(){ chId="fixture-hide"; chRpc=async(fn)=>(fn==="get_hide"?{img_path:"x.jpg",name:"tony",n_attempts:0,n_found:0}:null); chMarkSent(); return this.state(); },'
  + 'privateSend(){ kfSetWantPublic(false); return this.send(); },'
  + 'hint(){ const h=document.getElementById("kfHint"); return h?h.textContent:null; },'
  + 'state(){ const v=(id)=>{const e=document.getElementById(id);'
  + 'return e?getComputedStyle(e).display!=="none":null;};'
  + 'return{live:v("ssLive"),get:v("ssGet")};},'
  + 'tap(){ window.__tracked=[]; const t=track;'
  + 'track=(n,p)=>{window.__tracked.push(n);return t(n,p);};'
  + 'try{ document.getElementById("ssLive").click(); }finally{ track=t; }'
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

console.log('\nNEITHER OFFER EXISTS BEFORE SOMETHING IS SENT');
{
  const p = await open(true);
  const s = await p.evaluate(() => window.__s.state());
  !s.live && !s.get ? ok('a sheet nobody has used shows no post-send offer') : bad(`before send: ${JSON.stringify(s)}`);
  await p.close();
}

console.log('\nIN THE APP: THE CHALLENGE IS LIVE, AND NOBODY IS SOLD THE APP THEY HAVE');
{
  const p = await open(true);
  const s = await p.evaluate(() => window.__s.send());
  s.live ? ok('#ssLive appears after a proven send') : bad('#ssLive did not appear in the wrapper');
  !s.get ? ok('and #ssGet stays hidden — it would sell the app to somebody holding it')
         : bad('#ssGet is showing inside the wrapper');

  const t = await p.evaluate(() => window.__s.tap());
  t.tracked.includes('sent_feed_tapped')
    ? ok('the tap is counted as sent_feed_tapped, so hide_sent → feed_opened has a middle step')
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

console.log('\nA PRIVATE HIDE IS NEVER TOLD IT IS IN THE FEED');
{
  const p = await open(true);
  const s = await p.evaluate(() => window.__s.privateSend());
  !s.live
    ? ok('somebody who chose private gets no "see it in the feed" — it would not be there')
    : bad('#ssLive offered the feed for a hide that was never published to it');
  await p.close();
}

console.log('\nIN A BROWSER: THE OPPOSITE HALF, AND ONLY THAT HALF');
{
  const p = await open(false);
  const s = await p.evaluate(() => window.__s.send());
  s.get ? ok('#ssGet appears — a browser tab cannot promise a notification')
        : bad('#ssGet did not appear in a browser');
  !s.live ? ok('and #ssLive stays hidden, so the two are never two asks at once')
          : bad('#ssLive is showing in a browser');
  await p.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} sent-live check(s) failed` : '\n✓ sent-live checks passed');
process.exit(failed ? 1 : 0);
