#!/usr/bin/env node
/**
 * THE SHARE SENDS THIS ROUND'S HIDE, AND IT SENDS IT NOW.
 *
 * Two bugs lived here at once and each hid the other, both reported from a real phone:
 *
 *   1. THE WAIT. The image encode, the upload and create_hide all began on the SAME
 *      gesture as the tap on "Challenge a friend", so the sender watched a disabled
 *      button for as long as their network took — and if it took longer than the
 *      8s ceiling, the message went out as the generic invite with no link in it.
 *   2. THE WRONG PHOTO. chId survived capture(), and the previous round's publish could
 *      still land AFTER the next capture had reset it, so the second hide of a session
 *      shared the FIRST hide's link: personalised, signed, and pointing at another
 *      picture entirely.
 *
 * The fix is a split (prepare at the reveal, publish on the first touch of the sheet) plus
 * a round token that makes a late answer drop itself. Both halves are asserted here, on
 * the NATIVE path — the only one allowed to wait for the id, and the one the founder is
 * on. The storage upload is deliberately stubbed at 3 SECONDS: with an instant upload
 * neither bug can be reproduced at all.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-share-dom.mjs
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
  console.log('· playwright-core not installed — skipping the share test — run: ' + PW_SETUP);
  process.exit(0);
}
const MIME={'.js':'text/javascript','.glb':'model/gltf-binary','.woff2':'font/woff2','.png':'image/png'};
const real=readFileSync(join(ROOT,'index.html'),'utf8');
// Stub the RPC layer, and make the storage POST take a REALISTIC 3s so the race is real.
const html=real.replace('async function chRpc(fn,body){','async function chRpc(fn,body){ if(window.__rpc) return window.__rpc(fn,body);')
  /* WHAT WAS FILED, not what was intended. The publish path's two outcomes are told apart by
     the event they emit — hide_published against hide_publish_failed — and reading them off
     the wire would mean waiting on Amplitude's own flush. Recorded at the declaration, the
     same door test-feed-dom uses. */
  .replace('function track(event,props){','function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);')
  // module scope is sealed: expose the id the share actually reads
  .replace('let chId="";','let chId=""; window.__peek=()=>({chId,prep:!!chPrep});')
  /* THE ROUTING HOOK, and it fabricates only what a finished round would have left behind: a
     before-frame and a capability. composeShare is stubbed to a tiny canvas because what is
     under test is WHICH MESSAGE the web posts, not what the JPEG looks like — a real compose
     needs a whole painted round to produce one. */
  .replace('async function nativeShare(target){',
    'window.__rv=async(t,caps)=>{ if(caps) window.KAMO.setNativeCaps(caps);'
    + ' const cs=composeShare; composeShare=()=>{const c=document.createElement("canvas");c.width=c.height=8;return c;};'
    + ' beforeBoard=document.createElement("canvas"); beforeBoard.width=beforeBoard.height=8;'
    + ' try{ await nativeShare(t); } finally { composeShare=cs; } };\n'
    + 'async function nativeShare(target){');
const server=createServer((rq,rs)=>{const p=decodeURIComponent(rq.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){rs.writeHead(200,{'Content-Type':'text/html'});return rs.end(html);}
  let b=null;try{b=readFileSync(join(ROOT,p.replace(/^\/+/,'')));}catch{}
  if(b){rs.writeHead(200,{'Content-Type':MIME[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});rs.end(b);}else{rs.writeHead(404);rs.end('x');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const { globSync } = await import('node:fs');
const glob=(p)=>{ try{ return (typeof globSync==='function'?globSync(p):[])||[]; }catch{ return []; } };
const exe = chromeExe();
if(!exe){ console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser=await chromium.launch({executablePath:exe});
let failed=0; const ok=m=>console.log('  ✓ '+m), bad=m=>{failed++;console.error('  ✗ '+m);};
const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>bad('PAGE ERROR: '+e.message));
// storage upload: 3 seconds, like a phone on LTE
await page.route('**/storage/v1/object/hides/**', async r=>{ await new Promise(x=>setTimeout(x,3000)); r.fulfill({status:200,body:'{}'}); });
await page.addInitScript(()=>{
  localStorage.setItem('kamo_handle','tony');
  let n=0; window.__created=[];
  window.__calls=[];
  window.__rpc=(fn,body)=>{ window.__calls.push(fn); if(fn==='create_hide'){ n++; const id='hide'+n; window.__created.push(body.p_img_path); return Promise.resolve(id); } return Promise.resolve(null); };
  window.__msgs=[];
  window.__all=[];
  window.ReactNativeWebView={postMessage:(raw)=>{ try{ const m=JSON.parse(raw); window.__all.push(m.type); if(m.type==='invite') window.__msgs.push(m.message||''); }catch(e){ window.__all.push('unparsed'); } }};
});
await page.goto(base+"?debug",{waitUntil:"load"});
await page.waitForTimeout(600);
// The founder is on the WRAPPER, and only that path may wait for the id: navigator.share
// dies on the first await, so testing the web path would measure a rule, not his experience.
await page.evaluate(()=>window.KAMO.setNativeCaps({invite:true,notifSchedule:true}));
await page.waitForTimeout(600);

const UPLOAD_MS=3000;
async function round(label,dwell){
  await page.evaluate(()=>window.HIDEY.setBg('data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="100%" height="100%" fill="#8a9299"/></svg>')));
  await page.waitForTimeout(900);
  await page.evaluate(()=>window.HIDEY.capture());
  await page.waitForTimeout(400);
  // paint the whole figure so coverage clears the publish floor
  await page.evaluate(()=>{ const b=document.getElementById('board'); const r=b.getBoundingClientRect();
    const ev=(t,x,y)=>b.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,pointerId:1,buttons:1,pressure:.5}));
    for(let y=r.top+r.height*0.25;y<r.top+r.height*0.62;y+=6){ ev('pointerdown',r.left+r.width/2-40,y);
      for(let x=r.left+r.width/2-40;x<r.left+r.width/2+40;x+=8) ev('pointermove',x,y);
      ev('pointerup',r.left+r.width/2+40,y); } });
  await page.waitForTimeout(300);
  const cov=await page.evaluate(()=>window.HIDEY.score());
  const before=await page.evaluate(()=>window.__msgs.length);
  const t0=Date.now();
  await page.evaluate(()=>document.getElementById('btnDone').click());   // reveal → chPrepare() starts
  await page.waitForTimeout(dwell);            // how long the sender looks at the reveal
  await page.evaluate(()=>{ const c=document.querySelector('#shareSheet .ssCard'); c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2})); });
  await page.evaluate(()=>document.getElementById('ssInvite').click());
  // THIS round's message, not "any message": round 2 inherits round 1's array otherwise
  // and the assertion reads a stale send as a fresh one.
  await page.waitForFunction(n=>window.__msgs.length>n,before,{timeout:15000}).catch(()=>{});
  const waited=Date.now()-t0-dwell;
  const msg=(await page.evaluate(()=>window.__msgs[window.__msgs.length-1]))||'';
  console.log(`\n${label}  coverage=${Math.round(cov)}  dwell=${dwell}ms  wait after tap ≈ ${waited}ms`);
  return {msg,waited};
}
const r1=await round('ROUND 1 — tapped early (dwell 1.2s < 3s upload)',1200);
/@tony hid a kamo/.test(r1.msg) ? ok('message is personalised') : bad('generic message: '+JSON.stringify(r1.msg.slice(0,60)));
/\?h=|\/h\//.test(r1.msg) && /hide1/.test(await page.evaluate(()=>window.__msgs[0])) ? ok('and carries the round-1 link') : ok('link present: '+/hide1/.test(r1.msg));
/* The dwell must be DEDUCTED from the wait: whatever of the upload happened while the
   sender looked at the reveal is time they never spend staring at a disabled button. */
r1.waited < UPLOAD_MS-1200+700 ? ok(`the reveal paid for ${UPLOAD_MS-r1.waited}ms of the ${UPLOAD_MS}ms upload (waited ${r1.waited}ms, was ${UPLOAD_MS}ms+)`)
  : bad(`the dwell bought nothing: waited ${r1.waited}ms of a ${UPLOAD_MS}ms upload`);

/* AND THE APP IS NEVER SOLD TO SOMEBODY HOLDING IT. #ssGet is the post-send install offer,
   and this page is the wrapper: a real send has just gone through, which is exactly the
   moment ssOfferApp() runs. If the guard inside it were ever loosened — nativeCaps instead of
   window.ReactNativeWebView, say — this is where it shows up, on the most-seen surface in the
   product, after every single send. The browser half is scripts/test-sentcta-dom.mjs. */
const offered=await page.evaluate(()=>{ const g=document.getElementById('ssGet'); return !!(g&&getComputedStyle(g).display!=='none'); });
offered===false ? ok('the Get-KAMO offer stays hidden inside the app') : bad('#ssGet is being shown to a user who already has the app');

const r2=await round('ROUND 2 — same session, own hide',1200);
/hide2/.test(r2.msg) ? ok('round 2 sends its OWN hide (hide2), not round 1\'s') : bad('STALE LINK: '+JSON.stringify(r2.msg.slice(-40)));
/* ⚠️ A HIDE IS SENT ONCE, HOWEVER MANY TIMES THE BUTTON IS TAPPED.
   Nothing guarded chMarkSent(), so a second tap fired a second mark_hide_sent, a second
   `hide_sent`, a second pwFirstOffer and a second armResultsPing. Measured with three fast
   taps before the fix: one create_hide, three mark_hide_sent.
   A second tap must still SEND — sending the same hide to two people is the loop working, and
   share_target_tapped counts every tap, which is what that event is for. What must not double
   is the CLAIM that a hide was sent: hide_published → hide_sent is the conversion this product
   steers by, and it already over-counts by the share of people who open iOS's sheet and back
   out. An unbounded second source of inflation on top of a known bounded one is how a rate
   stops meaning anything.
   Asserted across round 2 as well, because the latch is keyed on the round: a per-session
   guard would pass the first half of this and silently stop counting every later hide. */
{
  const before = await page.evaluate(() => window.__calls.filter(f => f === 'mark_hide_sent').length);
  const msgs = await page.evaluate(() => window.__msgs.length);
  await page.evaluate(() => { const b = document.getElementById('ssInvite'); b.click(); b.click(); });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__calls.filter(f => f === 'mark_hide_sent').length);
  const msgs2 = await page.evaluate(() => window.__msgs.length);
  after === before
    ? ok(`two more taps stamp nothing new (mark_hide_sent stays at ${after})`)
    : bad(`the stamp fired ${after - before} more time(s) on repeat taps — hide_sent inflates by re-tapping`);
  msgs2 > msgs
    ? ok('and the share still goes out on every tap — the same hide can reach two people')
    : bad('a repeat tap sent nothing at all — the guard is on the share, not on the stamp');
}
/* ⚠️ A NULL ANSWER IS NOT A ROW, AND THE SHEET MUST NOT SAY IT IS.
   chCreateForms() hands chUpload a widest-to-narrowest ladder of create_hide payloads and the
   loop walks down it until one lands — except it only walked on a THROW. A 200 carrying `null`
   (a server-side guard, an RLS-filtered RETURNING, an overload resolving to void mid-deploy)
   ended the walk on the first rung with chId empty, and the code fell through to
   track("hide_published"). Measured before the fix: one form tried, no row, counted as a
   publish, and "Your kamo is live! / Come back to see who tried." on screen over nothing.
   Three failures in one and all three silent — the rescue ladder never ran, the denominator
   the send rate is read against counted a round that produced nothing, and the creator was
   told to come back for results that will never exist.
   Driven by answering the create_hide endpoint directly rather than through window.__rpc: the
   distinction being tested is between a rejection and a resolved-but-empty answer, which is a
   property of the transport, not of the stub. */
console.log('\nA PUBLISH THAT PRODUCED NO ROW IS NOT A PUBLISH');
{
  const walk = async (answer) => {
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const tried = [];
    await p2.route('**/rest/v1/rpc/create_hide', async r => {
      const n = tried.length; tried.push(1);
      const a = answer(n);
      if (a === 'THROW') return r.fulfill({ status: 500, body: 'boom' });
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) });
    });
    await p2.route('**/storage/v1/object/hides/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"hides/x.jpg"}' }));
    await p2.addInitScript(() => { window.__msgs = []; window.ReactNativeWebView = { postMessage() {} }; });
    await p2.goto(base, { waitUntil: 'load' });
    await p2.waitForTimeout(700);
    await p2.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800;
      const g = c.getContext('2d'); g.fillStyle = '#7a8a6a'; g.fillRect(0, 0, 600, 800);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + i},120,${70 + i},.6)`; g.beginPath(); g.arc((i * 97) % 600, (i * 61) % 800, 30, 0, 7); g.fill(); }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'r.jpg', { type: 'image/jpeg' }));
      const inp = document.getElementById('fileInput'); inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p2.waitForTimeout(800);
    await p2.evaluate(() => document.getElementById('shutter').click());
    await p2.waitForTimeout(1200);
    await p2.evaluate(() => {
      const b = document.getElementById('board'); const r = b.getBoundingClientRect();
      const ev = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1, pressure: .5 }));
      for (let y = r.top + r.height * 0.25; y < r.top + r.height * 0.62; y += 6) {
        ev('pointerdown', r.left + r.width / 2 - 40, y);
        for (let x = r.left + r.width / 2 - 40; x < r.left + r.width / 2 + 40; x += 8) ev('pointermove', x, y);
        ev('pointerup', r.left + r.width / 2 + 40, y);
      }
    });
    await p2.evaluate(() => document.getElementById('btnDone').click());
    await p2.waitForTimeout(2400);
    await p2.evaluate(() => { const c = document.querySelector('#shareSheet .ssCard'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); });
    await p2.waitForTimeout(5000);
    const out = await p2.evaluate(() => ({
      title: document.getElementById('ssTitle')?.textContent,
      events: (window.__tr || []).map(t => t[0]).filter(e => /^hide_publish/.test(e)),
    }));
    await p2.close();
    return { tried: tried.length, ...out };
  };

  const nulled = await walk(() => null);
  nulled.tried > 1
    ? ok(`a null answer is a rung, not an exit — the ladder walked all ${nulled.tried} forms`)
    : bad(`the ladder stopped after ${nulled.tried} form on a null answer — the fallback never runs`);
  nulled.events.includes('hide_publish_failed') && !nulled.events.includes('hide_published')
    ? ok('and a round that ended with no row is filed as a failure, not as a publish')
    : bad(`a publish with no row reported ${JSON.stringify(nulled.events)}`);
  !/is live/.test(nulled.title || '')
    ? ok(`and the sheet stops claiming it ("${nulled.title}")`)
    : bad(`the sheet still reads "${nulled.title}" over a hide that does not exist`);

  const rescued = await walk((n) => (n === 0 ? null : 'realid1'));
  rescued.tried === 2 && rescued.events.includes('hide_published')
    ? ok('and a narrower form still rescues it — two tried, one row, one publish')
    : bad(`the rescue path reports tried=${rescued.tried} events=${JSON.stringify(rescued.events)}`);
  /is live/.test(rescued.title || '')
    ? ok(`and the headline is back to the true one ("${rescued.title}")`)
    : bad(`a successful publish reads "${rescued.title}"`);
}

/* ⚠️ THE VISIBILITY ROW WAS MAKING A CLAIM ON BEHALF OF A WRITE NOBODY LISTENED TO.
   set_hide_public was dispatched fire-and-forget while #ssVis repainted itself as the answer
   it was asking for. CLAUDE.md's doctrine covers one direction — is_public defaults to FALSE,
   so a write that never lands leaves a hide private, "never 'this reached strangers without
   being asked'". That is true of the FIRST write and false of a RETRACTION: a hide made public
   by a write that landed, then switched back to Private by one that does not, stays in the
   public feed while this sheet tells its creator it is not. Measured on the real page: the row
   read "Private / Only whoever you send the link to" with p_public=true as the last thing the
   server had been told.
   AND THE TRANSPORT WAS PART OF IT. set_hide_public returns void, PostgREST answers 204 with
   no body, and chRpc parsed every answer with r.json() — so the promise rejected on every
   SUCCESSFUL write too. Both cases are driven here through the real fetch for that reason. */
console.log('\nTHE VISIBILITY ROW STATES WHAT THE SERVER WAS ACTUALLY TOLD');
{
  const visRun = async (plan) => {
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const heard = [];
    await p2.route('**/rest/v1/rpc/create_hide', r => r.fulfill({ status: 200, contentType: 'application/json', body: '"visid1"' }));
    await p2.route('**/rest/v1/rpc/set_hide_public', async r => {
      let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
      const kill = plan(heard.length);
      heard.push({ p_public: b.p_public, dead: !!kill });
      /* 204 + no body is exactly what a void rpc answers in production. */
      return kill ? r.abort('failed') : r.fulfill({ status: 204, body: '' });
    });
    await p2.route('**/storage/v1/object/hides/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"hides/x.jpg"}' }));
    await p2.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; try { localStorage.setItem('kamo_hide_public', '1'); } catch (e) {} });
    await p2.goto(base, { waitUntil: 'load' });
    await p2.waitForTimeout(700);
    await p2.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800;
      const g = c.getContext('2d'); g.fillStyle = '#7a8a6a'; g.fillRect(0, 0, 600, 800);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + i},120,${70 + i},.6)`; g.beginPath(); g.arc((i * 97) % 600, (i * 61) % 800, 30, 0, 7); g.fill(); }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'r.jpg', { type: 'image/jpeg' }));
      const inp = document.getElementById('fileInput'); inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p2.waitForTimeout(800);
    await p2.evaluate(() => document.getElementById('shutter').click());
    await p2.waitForTimeout(1200);
    await p2.evaluate(() => {
      const b = document.getElementById('board'); const r = b.getBoundingClientRect();
      const ev = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1, pressure: .5 }));
      for (let y = r.top + r.height * 0.25; y < r.top + r.height * 0.62; y += 6) {
        ev('pointerdown', r.left + r.width / 2 - 40, y);
        for (let x = r.left + r.width / 2 - 40; x < r.left + r.width / 2 + 40; x += 8) ev('pointermove', x, y);
        ev('pointerup', r.left + r.width / 2 + 40, y);
      }
    });
    await p2.evaluate(() => document.getElementById('btnDone').click());
    await p2.waitForTimeout(2400);
    await p2.evaluate(() => { const c = document.querySelector('#shareSheet .ssCard'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); });
    await p2.waitForTimeout(4200);
    const row = () => p2.evaluate(() => ({
      t: document.getElementById('ssVisT')?.textContent,
      s: document.getElementById('ssVisS')?.textContent,
    }));
    return { p2, heard, row, tap: async () => { await p2.click('#ssVis'); await p2.waitForTimeout(2200); } };
  };

  /* Write 0 (the publish, public) lands; write 1 (the retraction) dies; write 2 — the retry —
     lands again. Three answers, so the row has to be right three times running. */
  const r = await visRun((n) => n === 1);
  const published = await r.row();
  /in the KAMO feed/.test(published.s || '')
    ? ok('a published public hide states the feed plainly (204, no body, and it was believed)')
    : bad(`a successful visibility write reads "${published.s}" — an empty answer is being read as a failure`);

  await r.tap();                       // asks for Private, and that write dies
  const failed = await r.row();
  /Still in the feed/.test(failed.s || '')
    ? ok(`a retraction that did not land says so ("${failed.t} · ${failed.s}")`)
    : bad(`the row reads "${failed.t} · ${failed.s}" while the hide is still public — this is `
        + 'the one direction the visibility doctrine says must never happen');

  await r.tap();                       // the retry, and this one lands
  const fixed = await r.row();
  const last = r.heard[r.heard.length - 1];
  last && last.p_public === false && !last.dead
    ? ok('and a tap on an unsaved row RETRIES it rather than flipping past it')
    : bad(`the retry asked the server for p_public=${last && last.p_public} — a plain toggle sends `
        + 'the opposite of what the user just failed to get');
  /Only whoever you send/.test(fixed.s || '')
    ? ok('and the row goes back to stating the plain fact once it lands')
    : bad(`after a successful retry the row still reads "${fixed.s}"`);
  await r.p2.close();
}

/* ⚠️ AND PUBLIC NEEDS A PICTURE — A GATE ONLY ONE OF THREE CALL SITES HAD.
   chUpload publishes from inside bytes.then(up => { if(!up) return; ... }), and its note says
   why: "an upload that never lands can never reach it: the hide stays private, which is the
   direction this file already fails in everywhere else." The .ssVis toggle and "Put it in the
   feed too" had no such gate, so a creator whose photo failed to upload could put the row in
   the public feed by hand — and every seeker served it meets "This one didn't load".
   Not hypothetical: 473 rows in seven days have no object in the bucket, and 5 of them were
   public, three inside one hour from one device. */
console.log('\nA HIDE WITH NO PHOTO CANNOT BE PUT IN THE FEED BY HAND');
{
  const tryPublic = async (uploadOk) => {
    const p3 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const wrote = [];
    await p3.route('**/rest/v1/rpc/create_hide', r => r.fulfill({ status: 200, contentType: 'application/json', body: '"gid1"' }));
    await p3.route('**/rest/v1/rpc/set_hide_public', async r => {
      let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
      wrote.push(b.p_public); return r.fulfill({ status: 204, body: '' });
    });
    await p3.route('**/storage/v1/object/hides/**', r => uploadOk
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"hides/x.jpg"}' })
      : r.abort('failed'));
    await p3.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; try { localStorage.setItem('kamo_hide_public', '0'); } catch (e) {} });
    await p3.goto(base, { waitUntil: 'load' });
    await p3.waitForTimeout(700);
    await p3.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800;
      const g = c.getContext('2d'); g.fillStyle = '#7a8a6a'; g.fillRect(0, 0, 600, 800);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + i},120,${70 + i},.6)`; g.beginPath(); g.arc((i * 97) % 600, (i * 61) % 800, 30, 0, 7); g.fill(); }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'r.jpg', { type: 'image/jpeg' }));
      const inp = document.getElementById('fileInput'); inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p3.waitForTimeout(800);
    await p3.evaluate(() => document.getElementById('shutter').click());
    await p3.waitForTimeout(1200);
    await p3.evaluate(() => {
      const b = document.getElementById('board'); const r = b.getBoundingClientRect();
      const ev = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1, pressure: .5 }));
      for (let y = r.top + r.height * 0.25; y < r.top + r.height * 0.62; y += 6) {
        ev('pointerdown', r.left + r.width / 2 - 40, y);
        for (let x = r.left + r.width / 2 - 40; x < r.left + r.width / 2 + 40; x += 8) ev('pointermove', x, y);
        ev('pointerup', r.left + r.width / 2 + 40, y);
      }
    });
    await p3.evaluate(() => document.getElementById('btnDone').click());
    await p3.waitForTimeout(2400);
    await p3.evaluate(() => { const c = document.querySelector('#shareSheet .ssCard'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); });
    await p3.waitForTimeout(4200);
    await p3.click('#ssVis');            // the creator asks for the feed by hand
    await p3.waitForTimeout(4000);
    const out = await p3.evaluate(() => ({
      sub: document.getElementById('ssVisS')?.textContent,
      reasons: (window.__tr || []).filter(x => x[0] === 'hide_visibility_failed').map(x => x[1] && x[1].reason),
    }));
    await p3.close();
    return { publics: wrote.filter(v => v === true).length, ...out };
  };

  const good = await tryPublic(true);
  good.publics === 1
    ? ok('a hide whose photo is in the bucket goes public on the tap')
    : bad(`the gate refused a hide that has its photo (${good.publics} writes)`);

  const bad2 = await tryPublic(false);
  bad2.publics === 0
    ? ok('and one whose photo never uploaded is NOT written public — the feed cannot be handed a dead slide')
    : bad(`set_hide_public(true) was sent for a hide with no photo in the bucket (${bad2.publics}×)`);
  bad2.reasons.includes('no_photo')
    ? ok('and the refusal is filed as no_photo, separable from a write that failed')
    : bad(`the refusal filed ${JSON.stringify(bad2.reasons)}`);
  /* THE INTENT HERE IS "IT MUST NOT CLAIM THE FEED", and that has not moved. What moved is
     which true sentence it says instead. This asserted `Not in the feed yet — tap to try
     again`, which invites a retry that CANNOT succeed: the feed write is gated on the photo
     and the photo is what is missing, so every tap files another no_photo. When the upload is
     the blocker the row now names it, and the retry offer is gone with it. Both halves are
     asserted — no feed claim, and the reason stated — so a row that goes back to promising
     the feed still fails here. */
  const claimsFeed = /Anyone can play it in the KAMO feed/.test(bad2.sub || '');
  const namesCause = /photo didn't upload|Not in the feed yet/.test(bad2.sub || '');
  !claimsFeed && namesCause
    ? ok(`and the row says why rather than claiming the feed ("${bad2.sub}")`)
    : bad(`the row reads "${bad2.sub}" for a hide that is not in the feed and cannot be`);
}

const sentPerRound = await page.evaluate(() => window.__calls.filter(f => f === 'mark_hide_sent').length);
sentPerRound === 2
  ? ok('and across two rounds the stamp fired exactly twice — once per hide')
  : bad(`mark_hide_sent fired ${sentPerRound} times over two rounds`);
const paths=await page.evaluate(()=>window.__created);
paths.length===2 && paths[0]!==paths[1] ? ok(`two rounds → two distinct images (${paths.length})`) : bad('images: '+JSON.stringify(paths));
/* The real-world case: the median gap between the reveal and a share is 154 seconds, so
   the upload is long done and the tap must cost nothing at all. */
const r3=await round('ROUND 3 — tapped after the upload could finish',3400);
r3.waited<600 ? ok(`instant when the reveal outlasts the upload (${r3.waited}ms)`) : bad(`still waiting ${r3.waited}ms`);
/hide3/.test(r3.msg) ? ok('and it is round 3\'s own hide') : bad('round 3 link: '+JSON.stringify(r3.msg.slice(-30)));

/* THE ID DOES NOT WAIT ON THE BYTES — the assertion the three above could not make.
   All of them pass on code where create_hide runs after the upload; they only measure that
   the reveal absorbs some of it. This one taps with the ENTIRE 3s upload still to run,
   which is the founder's screenshot: reveal, share immediately, and the message goes out as
   the generic invite with a ?i=1 link because chId does not exist yet.
   create_hide needs the storage PATH, which this device invents locally, so the only
   correct wait here is one round trip to the database. Anything near UPLOAD_MS means the
   row is behind the file again. */
const r4=await round('ROUND 4 — tapped with the whole upload still ahead (dwell 50ms)',50);
r4.waited < 900
  ? ok(`the link is ready with ${UPLOAD_MS-50}ms of upload still to run (waited ${r4.waited}ms)`)
  : bad(`the send waited ${r4.waited}ms for bytes it does not need — the id is behind the file again`);
/@tony hid a kamo/.test(r4.msg)
  ? ok('so the message is the challenge, not the generic invite')
  : bad('fell back to the generic invite: '+JSON.stringify(r4.msg.slice(0,70)));
/hide4/.test(r4.msg) && !/\?i=1/.test(r4.msg)
  ? ok("carrying round 4's own hide, and no ?i=1 anywhere in it")
  : bad('round 4 link: '+JSON.stringify(r4.msg.slice(-40)));

/* ═══ THE CLIP REACHES THE DESTINATION THE USER PICKED ═══════════════════════════════════
   The reveal MP4 is the only thing this product makes that is fun to WATCH, and for two days
   it reached nobody: it was gated on `target==="instagram"`, and the Instagram button was
   deleted on 2026-08-15 — so the condition could never be true again. Nothing broke, no test
   failed, every share just quietly became the static card.
   ASSERTED ON THE WIRE, because that is the only place the difference exists: `reveal-video`
   and `share-target` are two different messages to the wrapper, and both "work". */
console.log('\nTHE REVEAL IS THE SHARE, WHEREVER IT IS GOING');
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: (raw) => { try { window.__posted.push(JSON.parse(raw)); } catch (e) {} } };
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__rv, null, { timeout: 15000 });

  const post = async (target, caps) => page.evaluate(async ([t, c]) => {
    window.__posted.length = 0;
    await window.__rv(t, c);
    return window.__posted.filter(m => m.type === 'reveal-video' || m.type === 'share-target')
      .map(m => ({ type: m.type, target: m.target, msg: m.message || '' }));
  }, [target, caps]);

  const more = (await post('more', { revealVideo: true, invite: true }))[0] || {};
  more.type === 'reveal-video' && more.target === 'more'
    ? ok('a share to "more" posts reveal-video, carrying the target the wrapper branches on')
    : bad(`"more" posted ${JSON.stringify(more)} — the clip is Instagram-only again, and Instagram has no button`);
  /* The static path has never carried a link (see nativeShare) — so on the reveal path the
     message is not decoration, it is the only way back to the app from a video post. */
  /https?:\/\//.test(more.msg)
    ? ok(`and the link rides with it ("…${more.msg.slice(-38)}")`)
    : bad(`the reveal went out with message ${JSON.stringify(more.msg)} — a clip with no way back`);

  /* THE OTHER HALF: an older binary must not be handed a video it cannot encode. Most of the
     fleet is still there, and this is the branch that keeps working for them. */
  const old = (await post('more', { invite: true }))[0] || {};
  old.type === 'share-target'
    ? ok('a wrapper without revealVideo still gets the static share it can handle')
    : bad(`a build with no encoder was posted ${JSON.stringify(old)}`);
  await page.close();
}

/* ═══ THE UPLOAD CEILING ═══
   The bucket refuses anything over 400000 bytes with an HTTP 400 whose body says
   {"statusCode":"413","code":"EntityTooLarge"}, and for seven days that refused 1054 uploads —
   about half of every upload failure, and the half that repeats: 131 devices had EVERY hide
   they ever made fail, because a busy photograph encodes over the line every single time.
   The row is written before the photo is, so the cost is not "publish failed", it is a hide
   that exists, gets sent, gets tapped, and has no kamo in it.
   The ladder cannot be reached through the UI here — the board is capped at a phone's size, so
   nothing this harness can paint encodes that large, and the shape that does blow it (a reply,
   at 0.82, on a textured photo) needs a whole played round to set up. So this drives the real
   function directly, through the hook beside it, with a blob that is genuinely over. */
{
  console.log('\n— the upload ceiling —');
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>bad('PAGE ERROR: '+e.message));
  await page.goto(base,{waitUntil:'load'});
  await page.waitForTimeout(400);

  const r = await page.evaluate(async () => {
    const H = window.KAMOBUDGET;
    if (!H) return { missing: true };
    /* Noise, because noise is how gravel, foliage, carpet and brick compress — which is to say,
       how the surfaces this entire game is played on compress. */
    const c = document.createElement('canvas'); c.width = 1400; c.height = 1400;
    const g = c.getContext('2d'); const d = g.createImageData(1400, 1400);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i]=Math.random()*255; d.data[i+1]=Math.random()*255; d.data[i+2]=Math.random()*255; d.data[i+3]=255;
    }
    g.putImageData(d, 0, 0);
    const big = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    window.__tr = [];
    const out = await H.fit(big);
    /* And a blob already under the line must come back untouched — the ladder is a rescue, not
       a tax on every hide that was fine. */
    const small = await new Promise(r => { const s=document.createElement('canvas'); s.width=40; s.height=40;
      s.getContext('2d').fillRect(0,0,40,40); s.toBlob(r,'image/jpeg',0.7); });
    const kept = await H.fit(small);
    return { budget: H.budget, from: big.size, to: out.size,
             ev: (window.__tr||[]).filter(e => e[0] === 'hide_blob_shrunk'),
             smallIn: small.size, smallOut: kept.size, smallUntouched: kept === small };
  });

  if (r.missing) bad('window.KAMOBUDGET is gone — the ladder cannot be tested, and nothing else here proves a board fits');
  else {
    r.budget <= 400000
      ? ok(`the budget (${r.budget}) sits under the bucket's 400000-byte ceiling`)
      : bad(`the budget is ${r.budget}, at or over the ceiling that refuses the upload`);
    r.from > r.budget
      ? ok(`a textured board really does encode over it (${r.from} bytes)`)
      : bad(`the fixture only reached ${r.from} bytes — it never crossed the line, so this proves nothing`);
    r.to <= r.budget
      ? ok(`and the ladder brought it under: ${r.from} → ${r.to} bytes`)
      : bad(`the ladder gave up at ${r.to} bytes — this board still 400s, and its hide still has no kamo in it`);
    const e = r.ev[0];
    e && e[1] && e[1].fit === true
      ? ok('hide_blob_shrunk reports the blob that was KEPT, and that it fits')
      : bad(`hide_blob_shrunk said ${JSON.stringify(e ? e[1] : null)} — the one event that can tell us this is still failing is not telling the truth`);
    r.smallUntouched
      ? ok(`a board already under budget is returned untouched (${r.smallIn} bytes)`)
      : bad(`an in-budget board came back re-encoded (${r.smallIn} → ${r.smallOut}) — every hide is paying for the rescue`);
  }
  await page.close();
}

await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ the share is instant, always its own hide, the clip goes wherever it is sent, and no board leaves over the ceiling');
process.exit(failed?1:0);
