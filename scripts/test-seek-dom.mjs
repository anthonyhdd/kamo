#!/usr/bin/env node
/**
 * THE RECEIVING HALF OF THE SIGNED CHALLENGE.
 *
 * The handle is only worth anything if the person who opens the link sees it. It travels three
 * layers to get there — the page narrows it as it is typed, create_hide narrows it again on
 * insert, get_hide returns it, and this screen prints it — and every one of those layers can
 * be right while the last one silently does nothing.
 *
 * Both branches matter equally. Most hides will never carry a name (it is optional, and every
 * hide published before today has none), so "unsigned still reads exactly as it always did" is
 * not a nicety — it is the majority case.
 *
 * chRpc is stubbed by injecting immediately after its declaration rather than by appending a
 * hook: the seeker fetches its hide during load, so anything added at the end of the module
 * arrives after the screen has already been drawn.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-seek-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of [process.env.PW_CORE, ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the seeker test (set PW_CORE=<dir with node_modules>)');
  process.exit(0);
}
const real=readFileSync(join(ROOT,'index.html'),'utf8');
/* chRpc is stubbed BEFORE the seeker IIFE runs, by injecting right after its declaration —
   the seeker fetches the hide on load, so a hook appended at the end of the module is too
   late. NAME is what the whole change is about. */
const anchor='async function chRpc(fn,body){';
const html=real.replace(anchor, anchor +
  'if(window.__seed&&window.__seed[fn]) return window.__seed[fn];');
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css'};
const server=createServer((rq,rs)=>{const p=decodeURIComponent(rq.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){rs.writeHead(200,{'Content-Type':'text/html'});return rs.end(html);}
  try{const b=readFileSync(join(ROOT,p.replace(/^\/+/,'')));rs.writeHead(200,{'Content-Type':MIME[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});rs.end(b);}catch{rs.writeHead(404);rs.end('x');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const { globSync }=await import('node:fs');
const exe=(globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')||[])[0];
if(!exe){ console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
const browser=await chromium.launch({executablePath:exe});
let failed=0;
const ok=m=>console.log('  ✓ '+m), bad=m=>{failed++;console.error('  ✗ '+m);};
async function head(name){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  await page.addInitScript((n)=>{ window.__seed={get_hide:{img_path:'x.jpg',secs:9,n_attempts:0,n_found:0,limit_s:20,max_taps:5,name:n}}; }, name);
  await page.goto(base+'?h=abc123',{waitUntil:'load'});
  await page.waitForTimeout(900);
  const t=await page.evaluate(()=>{const e=document.getElementById('chHead');return e?e.textContent:null;});
  await page.close();
  return t;
}
console.log('\nTHE SEEKER IS TOLD WHO THEY ARE PLAYING');
{
  const t=await head('tony');
  t==='Find @tony' ? ok(`a signed hide names its sender ("${t}")`) : bad(`signed hide shows ${JSON.stringify(t)}`);
}
{
  const t=await head(null);
  t==='Find the body' ? ok(`an unsigned hide keeps the original line ("${t}")`) : bad(`unsigned hide shows ${JSON.stringify(t)}`);
}
await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ the seeker screen names the sender');
process.exit(failed?1:0);
