#!/usr/bin/env node
/**
 * THE FEED IS WALLED IN A BROWSER, AND NOTHING ELSE IS.
 *
 * Measured 2026-08-17 (August 1-17, uniques, split on `host`): 19,388 browser players put 176
 * hides back — 0.9%. In the app, 3,261 players put back 2,877 — 88%. The browser is a place
 * people play an unlimited feed of other people's work and contribute nothing, so the feed is
 * what the wall is for.
 *
 * Every assertion here is about WHERE the wall is not. The failure that would actually cost
 * something is not "the wall never shows" — it is the wall showing one door too far left:
 *
 *   A. no round played yet  → no wall. A stranger's first visit must never meet it.
 *   B. one round played     → wall, and the feed does NOT mount behind it.
 *   C. "Not now"            → the wall goes, and the feed still does not open.
 *   D. inside the wrapper   → no wall, ever. Those people already installed.
 *   E. seeded by a publish  → no wall. "See it live" belongs to somebody who just contributed,
 *      and walling them is the one move that costs the supply side its browser contribution.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-feedwall-dom.mjs
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
  console.log('· playwright-core not installed — skipping the feed-wall test — run: ' + PW_SETUP);
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

const has=(page,id)=>page.evaluate(i=>!!document.getElementById(i),id);

/* rounds: what the seeker writes to localStorage after a round. wrapper: stub ReactNativeWebView. */
async function open(rounds,wrapper){
  const page=await browser.newPage({ locale: 'en-US', viewport:{width:390,height:844}});
  /* ⚠️ ONLY WHILE THE PAGE IS STILL OURS. The note below already explains that case B clicks
     "Get KAMO" and sends the page at kamo.onelink.me, and that a document is created for that
     navigation even though it cannot complete offline. It guarded the seeding against that
     document — and left this listener wide open to it. On 2026-08-27 the gate went red with
     "PAGE ERROR: Unexpected identifier 'loading'", which is not a string that exists in any
     inline script of index.html: it came from whatever the browser managed to parse at the
     other end, and was reported as a defect in this app. The suite passed alone, so it read
     as one more timing flake and it is not one — it is an error attributed to the wrong
     document, and it will come back at random until the attribution is fixed.
     A flag rather than an origin check, because pageerror carries no URL: nothing after the
     deliberate departure belongs to us, and every assertion this file makes has already run
     by then. */
  let ours = true;
  page.leaveApp = () => { ours = false; };
  page.on('pageerror', e => { if (ours) bad('PAGE ERROR: ' + e.message); });
  await page.route('**/storage/v1/object/hides/**', r=>r.fulfill({status:200,body:'{}'}));
  await page.addInitScript(([n,w])=>{
    /* ⚠️ GUARDED, AND THE REASON IS THE ONE ASSERTION IN THIS FILE THAT NAVIGATES AWAY.
       An init script is re-run by Playwright on EVERY document the page creates, not just the
       first — and case B clicks "Get KAMO", which sends the page at kamo.onelink.me. That
       navigation cannot complete in this offline harness, but a document IS created for it, and
       reading localStorage there throws SecurityError ("Access is denied for this document").
       Unguarded, that throw was uncaught, so the page.on('pageerror') listener a few lines up
       reported it as a PAGE ERROR and this suite failed — on the seeding, in a document the app
       never runs in, while every assertion about the wall itself passed.
       It looked exactly like an app bug: a real unguarded localStorage read on a real
       storage-denied device is precisely the failure mode this codebase has been chasing, so the
       message was believed rather than traced. The stack said `<anonymous>`, which is an injected
       script and never index.html. Trace before believing a red gate. */
    try {
      localStorage.setItem('kamo_handle','tony');
      if(n) localStorage.setItem('kamo_rounds',String(n));
    } catch(e) {}
    let k=0;
    window.__rpc=(fn)=>{ if(fn==='create_hide'){ k++; return Promise.resolve('hide'+k); }
      /* The feed asks for a page of hides; one row is enough to prove it mounted. */
      if(fn==='feed_page') return Promise.resolve([{id:'seed1',img_path:'a.jpg',handle:'zoe'}]);
      return Promise.resolve(null); };
    window.__nav=[];
    if(w) window.ReactNativeWebView={postMessage:()=>{}};
  },[rounds,wrapper]);
  await page.goto(base+'?debug',{waitUntil:'load'});
  await page.waitForTimeout(700);
  return page;
}

/* ---- A. FIRST VISIT, NOTHING PLAYED ---- */
{
  const page=await open(0,false);
  await page.evaluate(()=>window.KAMOFEED.open());
  await page.waitForTimeout(700);
  const wall=await has(page,'kfWall'), feed=await has(page,'kfeed');
  (!wall&&feed) ? ok('a first visit opens the feed, with no wall')
                : bad(`first visit: wall=${wall} feed=${feed} — the wall must never be the first thing a stranger meets`);
  await page.close();
}

/* ---- B. ONE ROUND PLAYED ---- */
{
  const page=await open(1,false);
  await page.evaluate(()=>window.KAMOFEED.open());
  await page.waitForTimeout(700);
  const wall=await has(page,'kfWall'), feed=await has(page,'kfeed');
  (wall&&!feed) ? ok('after one round the browser gets the wall, and the feed does not mount behind it')
                : bad(`after one round: wall=${wall} feed=${feed}`);
  /* THE CTA HAS TO REACH THE STORE, and it is asserted on the REQUEST rather than on
     page.url(): the destination is apps.apple.com, which this offline harness cannot load, so
     the navigation is attempted and then fails and the URL bar never changes. Asserting the
     final URL therefore tests the network, not the button — the first version of this file
     did exactly that and reported a working CTA as broken. A request listener sees the
     attempt, which is the whole of what this page controls. */
  if(wall){
    const tried=[];
    page.on('request',r=>{ const u=r.url(); if(/apps\.apple\.com|onelink/i.test(u)) tried.push(u); });
    /* From here the page is leaving for the store, and nothing it throws is ours — see the
       pageerror listener. Every assertion above has already run. */
    page.leaveApp();
    await page.evaluate(()=>{
      const b=[...document.querySelectorAll('#kfWall button')].find(x=>/Get KAMO/i.test(x.textContent));
      b.click(); });
    await page.waitForTimeout(900);
    tried.length ? ok(`the CTA leaves for the store (${tried[0].slice(0,44)}…)`)
                 : bad('the CTA attempted no store navigation at all');
  }
  await page.close();
}

/* ---- C. "NOT NOW" ---- */
{
  const page=await open(1,false);
  await page.evaluate(()=>window.KAMOFEED.open());
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#kfWall button')].find(x=>/Not now/i.test(x.textContent)); b.click(); });
  await page.waitForTimeout(400);
  const wall=await has(page,'kfWall'), feed=await has(page,'kfeed');
  (!wall&&!feed) ? ok('"Not now" dismisses the wall without opening the feed')
                 : bad(`after Not now: wall=${wall} feed=${feed} — dismissing must not be a way through`);
  await page.close();
}

/* ---- D. INSIDE THE WRAPPER ---- */
{
  const page=await open(9,true);
  await page.evaluate(()=>window.KAMOFEED.open());
  await page.waitForTimeout(700);
  const wall=await has(page,'kfWall'), feed=await has(page,'kfeed');
  (!wall&&feed) ? ok('the installed app is never walled, whatever the browser counter says')
                : bad(`in the wrapper: wall=${wall} feed=${feed}`);
  await page.close();
}

/* ---- E. SEEDED BY A PUBLISH — the exemption that protects the supply side ---- */
{
  const page=await open(1,false);
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
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ const c=document.querySelector('#shareSheet .ssCard');
    c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2})); });
  await page.waitForTimeout(900);
  const live=await page.evaluate(()=>{ const b=document.getElementById('ssSeeLive');
    if(!b||getComputedStyle(b).display==='none') return false; b.click(); return true; });
  await page.waitForTimeout(900);
  if(!live){ bad('#ssSeeLive never appeared — case E asserted nothing (the publish path changed)'); }
  else {
    const wall=await has(page,'kfWall'), feed=await has(page,'kfeed');
    (!wall&&feed) ? ok('"See it live" after a publish goes through — a seeded feed is never the substitute')
                  : bad(`seeded entry: wall=${wall} feed=${feed} — this walls the 0.9% who actually contribute`);
  }
  await page.close();
}

await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ the wall is on the feed, and only on the feed');
process.exit(failed?1:0);
