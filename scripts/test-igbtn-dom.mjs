#!/usr/bin/env node
/**
 * INSTAGRAM IS REACHABLE AGAIN, AND IT COSTS THE SEND NOTHING.
 *
 * The button was cut on 2026-08-15 (00db2d2) for two real reasons and one wrong one. The
 * real ones: a full-width labelled slab took a third of a row built for two — which is what
 * wrapped "Remove mark" onto a second line — and it sat above the send. The wrong one: a
 * seven-day average (instagram 6.8%) taken over the days BEFORE the wave, on a series that
 * was doubling (14 · 27 · 32 · 36 · 37 · 66) right up to the evening the markup was deleted.
 * `more` then absorbed 12 of the 66 it was supposed to inherit.
 *
 * So it comes back on the terms that were actually wrong with it, and this file is the
 * guarantee that it stays on them. Four assertions, and three of them are about restraint:
 *
 *   1. HIDDEN IN A PLAIN BROWSER. The 2026-07-13 slab had no gate: it rendered on the web
 *      too, where nativeShare() ends on a postNative nobody receives. A dead button that
 *      looks exactly like the working one.
 *   2. SHOWN IN THE WRAPPER, where Share.shareSingle's INSTAGRAM_STORIES branch is.
 *   3. IT DOES NOT TAKE THE ROW. 48px square, and More keeps a real label width — the
 *      regression the removal comment describes, asserted rather than argued.
 *   4. AND IT ACTUALLY SENDS: a tap reaches native with target "instagram".
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-igbtn-dom.mjs
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
  console.log('· playwright-core not installed — skipping the Instagram button test — run: ' + PW_SETUP);
  process.exit(0);
}
const MIME={'.js':'text/javascript','.glb':'model/gltf-binary','.woff2':'font/woff2','.png':'image/png'};
const real=readFileSync(join(ROOT,'index.html'),'utf8');
const html=real.replace('async function chRpc(fn,body){','async function chRpc(fn,body){ if(window.__rpc) return window.__rpc(fn,body);');
const server=createServer((rq,rs)=>{const p=decodeURIComponent(rq.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){rs.writeHead(200,{'Content-Type':'text/html'});return rs.end(html);}
  let b=null;try{b=readFileSync(join(ROOT,p.replace(/^\/+/,'')));}catch{}
  if(b){rs.writeHead(200,{'Content-Type':MIME[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});rs.end(b);}else{rs.writeHead(404);rs.end('x');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const exe = chromeExe();
if(!exe){ console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser=await chromium.launch({executablePath:exe});
let failed=0; const ok=m=>console.log('  ✓ '+m), bad=m=>{failed++;console.error('  ✗ '+m);};

const shown=(page,id)=>page.evaluate(i=>{ const e=document.getElementById(i);
  return !!(e && getComputedStyle(e).display!=='none'); }, id);

/* ---- 1. A PLAIN BROWSER. No ReactNativeWebView at all, which is the whole gate. ---- */
{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>bad('PAGE ERROR (web): '+e.message));
  await page.goto(base+'?debug',{waitUntil:'load'});
  await page.waitForTimeout(600);
  (await shown(page,'ssIG'))===false
    ? ok('a plain browser never sees the Instagram button')
    : bad('#ssIG is visible on the web, where postNative goes nowhere — the 2026-07-13 dead button is back');
  await page.close();
}

/* ---- 2-4. THE WRAPPER. ---- */
const page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>bad('PAGE ERROR: '+e.message));
await page.route('**/storage/v1/object/hides/**', r=>r.fulfill({status:200,body:'{}'}));
await page.addInitScript(()=>{
  localStorage.setItem('kamo_handle','tony');
  let n=0;
  window.__rpc=(fn,body)=>{ if(fn==='create_hide'){ n++; return Promise.resolve('hide'+n); } return Promise.resolve(null); };
  window.__native=[];
  window.ReactNativeWebView={postMessage:(raw)=>{ try{ window.__native.push(JSON.parse(raw)); }catch(e){} }};
});
await page.goto(base+'?debug',{waitUntil:'load'});
await page.waitForTimeout(600);
/* No `revealVideo` on purpose: this is the OLDER binary, the one that falls back to the
   static-image branch inside nativeShare. If the button ever starts depending on a
   capability nothing announces, it disappears here first — the failure #ssInvite lived. */
await page.evaluate(()=>window.KAMO.setNativeCaps({invite:true,notifSchedule:true}));
await page.waitForTimeout(400);

(await shown(page,'ssIG'))
  ? ok('the wrapper gets the Instagram button, with no capability flag to announce')
  : bad('#ssIG is hidden inside the app — the destination is unreachable again');

/* A real round, because the tap has to produce a real image: the sheet's share path encodes
   the board, and a stubbed one would assert the handler without asserting the send. */
await page.evaluate(()=>window.HIDEY.setBg('data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="100%" height="100%" fill="#8a9299"/></svg>')));
await page.waitForTimeout(900);
await page.evaluate(()=>window.HIDEY.capture());
await page.waitForTimeout(400);
await page.evaluate(()=>{ const b=document.getElementById('board'); const r=b.getBoundingClientRect();
  const ev=(t,x,y)=>b.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,pointerId:1,buttons:1,pressure:.5}));
  for(let y=r.top+r.height*0.25;y<r.top+r.height*0.62;y+=6){ ev('pointerdown',r.left+r.width/2-40,y);
    for(let x=r.left+r.width/2-40;x<r.left+r.width/2+40;x+=8) ev('pointermove',x,y);
    ev('pointerup',r.left+r.width/2+40,y); } });
await page.waitForTimeout(300);
await page.evaluate(()=>document.getElementById('btnDone').click());
await page.waitForTimeout(600);

/* THE SHEET HAS TO REACH `show`, AND THAT IS NOT A DETAIL — it is the difference between
   this suite measuring the row and this suite measuring nothing. The reveal lands on `peek`,
   where `#shareSheet.peek .ssCard > *:not(...)` hides .ssRow2 outright: every button then
   reports a 0x0 rect, `ig.w <= 56` is true because 0 <= 56, and "all buttons share one
   height" is true because they all share zero. The first run of this file passed both of
   those on a row that was not on screen. Tapping #ssGrab is the app's own route up (see
   stepSheet), and if it never arrives the run FAILS rather than quietly asserting on zeros. */
for(let i=0;i<4;i++){
  if(await page.evaluate(()=>document.getElementById('shareSheet').classList.contains('show'))) break;
  await page.evaluate(()=>document.getElementById('ssGrab').click());
  await page.waitForTimeout(450);
}
(await page.evaluate(()=>document.getElementById('shareSheet').classList.contains('show')))
  ? ok('the sheet is open on its full state, so the row below is really on screen')
  : bad('could not reach the full sheet — every layout assertion below would be measuring 0x0');

/* ---- 3. THE ROW STILL READS AS TWO BUTTONS AND A GLYPH. ---- */
const row=await page.evaluate(()=>{
  const kids=[...document.querySelectorAll('#ssRow2 .ssBtn')]
    .filter(b=>getComputedStyle(b).display!=='none')
    .map(b=>({id:b.id||b.className,w:Math.round(b.getBoundingClientRect().width),h:Math.round(b.getBoundingClientRect().height)}));
  return kids;
});
/* The zero guard, stated separately from the assertions it protects: a laid-out row can
   never be 0px, so this failing means the sheet moved, not that the button regressed. */
row.length && row.every(k=>k.w>0 && k.h>0)
  ? ok(`the row is laid out (${row.length} visible buttons)`)
  : bad('the row measured 0x0 — the sheet is not open, so nothing below is a real assertion: '+JSON.stringify(row));
const ig=row.find(k=>k.id==='ssIG');
const more=row.find(k=>/ssMore/.test(k.id));
ig && ig.w<=56
  ? ok(`Instagram is a ${ig.w}px glyph, not a share of the line`)
  : bad('Instagram is taking row width again: '+JSON.stringify(row));
/* MORE IS A GLYPH TOO NOW — founder's call, 2026-08-17, hours after this file was written,
   and the two decisions do not contradict each other: this suite exists so Instagram cannot
   take the row back, and a 56px `more` does not take it either. What changed is who gets the
   width Instagram is not allowed to have, and the answer is the upsell rather than a control
   that ran 64 taps in seven days against the send's 5768.
   THE ASSERTION IS INVERTED RATHER THAN DELETED, because the failure it was written against is
   still real in the other direction: a label creeping back onto `more` re-wraps "Remove mark",
   which is the regression the removal comment describes. Small is now the rule, and the height
   check below is what actually guards the wrap. */
more && more.w<=72
  ? ok(`and More is a ${more.w}px glyph beside it, so the width goes to the upsell`)
  : bad('More took the line back as a label — "Remove mark" is one word away from wrapping: '+JSON.stringify(row));
/* AND THE WIDTH REALLY LANDED ON THE UPSELL. Both glyphs being small is only half the point;
   without this, a row of three small buttons and a hole would pass. */
{ const plus=row.find(k=>k.id==='ssPlus');
  plus && plus.w>=140
    ? ok(`Remove mark takes the rest of the line (${plus.w}px)`)
    : bad('the upsell did not get the width the two glyphs gave up: '+JSON.stringify(row)); }
/* THE ACTUAL REGRESSION THE REMOVAL WAS ABOUT: unequal heights, because one label wrapped.
   Asserted across every visible button in the row, so it also covers "Remove mark". */
new Set(row.map(k=>k.h)).size===1
  ? ok(`all ${row.length} buttons on the row share one height (${row[0].h}px) — nothing wrapped`)
  : bad('the row lost its baseline — a label wrapped: '+JSON.stringify(row));

/* ---- 4. AND THE TAP REACHES NATIVE. ---- */
await page.evaluate(()=>{ window.__native.length=0; document.getElementById('ssIG').click(); });
await page.waitForFunction(()=>window.__native.some(m=>m&&m.target==='instagram'),null,{timeout:8000}).catch(()=>{});
const sent=await page.evaluate(()=>window.__native.filter(m=>m&&m.target==='instagram').map(m=>m.type));
sent.length
  ? ok(`the tap reaches native as ${sent.join('/')} with target "instagram"`)
  : bad('nothing with target "instagram" reached the wrapper: '+JSON.stringify(await page.evaluate(()=>window.__native.map(m=>m&&m.type))));

await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ Instagram is reachable, native-only, and it does not out-rank the send');
process.exit(failed?1:0);
