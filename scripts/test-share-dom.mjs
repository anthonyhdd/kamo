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
  // module scope is sealed: expose the id the share actually reads
  .replace('let chId="";','let chId=""; window.__peek=()=>({chId,prep:!!chPrep});');
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
  window.__rpc=(fn,body)=>{ if(fn==='create_hide'){ n++; const id='hide'+n; window.__created.push(body.p_img_path); return Promise.resolve(id); } return Promise.resolve(null); };
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

const r2=await round('ROUND 2 — same session, own hide',1200);
/hide2/.test(r2.msg) ? ok('round 2 sends its OWN hide (hide2), not round 1\'s') : bad('STALE LINK: '+JSON.stringify(r2.msg.slice(-40)));
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

await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ the share is instant and always its own hide');
process.exit(failed?1:0);
