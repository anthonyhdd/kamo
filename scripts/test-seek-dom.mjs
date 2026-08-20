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
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the seeker test — run: ' + PW_SETUP);
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
const exe = chromeExe();
if(!exe){ console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
/* THE ROUND'S PHOTO HAS TO ARRIVE, or this suite asserts against a failure screen.
   chSeek() grew an img.onerror: a camo image that never loads now says so on the headline
   ("This one didn't load"), stops the clock and refuses the buzz, instead of leaving a live
   round on a black rectangle. That is the fix — and it means a harness which never serves the
   photo is no longer testing the round it thinks it is. One transparent pixel is enough here:
   these cases are about what is written above the picture, not about the picture. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const servePhoto = (page) => page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
const browser=await chromium.launch({executablePath:exe});
let failed=0;
const ok=m=>console.log('  ✓ '+m), bad=m=>{failed++;console.error('  ✗ '+m);};
async function head(name){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  await servePhoto(page);
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
  /* THE HEADLINE IS THE NAME NOW. It spent the widest line on the screen restating the
     game ("hid a kamo here") when the only thing that differs between two feed slides is
     WHO made them; the sentence moved to the sub. What must not change is that the sender is
     named as the AUTHOR — the bug this assertion was written for was a headline that read as
     if @tony were the one hidden. */
  t==='@tony hid a kamo here' ? ok(`a signed hide names its sender as the AUTHOR ("${t}")`) : bad(`signed hide shows ${JSON.stringify(t)}`);
}
{
  const t=await head(null);
  t==='Someone hid a kamo here' ? ok(`an unsigned hide still says what happened ("${t}")`) : bad(`unsigned hide shows ${JSON.stringify(t)}`);
}
/* ⚠️ AND THE NAME HAS TO BE READABLE, WHICH IS NOT THE SAME CLAIM.
   The headline shares its row with the clock pill (top:12px, right:12px, ~35px tall). The note
   beside .chRun said it could not reach it — ".chHead is max-width:20ch and centred, which
   caps it around 226px on a 390pt screen — the pill starts at x≈320" — and the arithmetic was
   wrong: 20ch of clamp(20px,5.8vw,26px) is 293px at 390pt. Measured on the real screen before
   the fix: at 320pt the ink reached x=267 against a pill starting at 251 for EVERY handle,
   "@tony" included, and at 390/430 it collided at 16 characters, which is the exact length
   cleanHandle() allows.
   THE SECOND HALF IS WORSE AND IS A DIFFERENT BUG. A handle is one unbreakable token, so a
   16-character one wider than the box does not wrap — it overflows. "@WWWWWWWWWWWWWWWW"
   painted to x=390 on a 390pt screen and x=430 on a 430pt one: the sender's own name running
   off the edge of the display, on the screen that exists to say who is challenging you.
   ASSERTED ON THE INK, NOT THE BOX. A centred element with max-width can have a wide box and
   narrow glyphs; Range.getClientRects gives the line boxes the text actually paints into,
   which is the only version of this question a reader would recognise. Three widths, because
   the collision and the overflow appear at different ones. */
console.log('\nAND IT IS READABLE — CLEAR OF THE CLOCK, AND ON THE SCREEN');
{
  const geo = async (name, W, H) => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await servePhoto(page);
    await page.addInitScript((n) => { window.__seed = { get_hide: { img_path: 'x.jpg', secs: 9, n_attempts: 0, n_found: 0, limit_s: null, max_taps: null, name: n } }; }, name);
    await page.goto(base + '?h=abc123', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const g = await page.evaluate(() => {
      const h = document.querySelector('.chHead'), c = document.getElementById('chClock');
      if (!h || !c) return null;
      const r = document.createRange(); r.selectNodeContents(h);
      const L = [...r.getClientRects()]; const cb = c.getBoundingClientRect();
      return {
        right: Math.round(Math.max(...L.map(l => l.right))),
        left: Math.round(Math.min(...L.map(l => l.x))),
        clash: L.filter(l => l.right > cb.x && l.x < cb.right && l.bottom > cb.y && l.top < cb.bottom).length,
        clockX: Math.round(cb.x), vw: innerWidth,
      };
    });
    await page.close();
    return g;
  };
  /* 4 characters is the shortest realistic handle and 16 is the longest cleanHandle() permits;
     the all-caps one is the token that cannot be broken at a space. */
  for (const [W, H] of [[320, 568], [390, 844], [430, 932]]) {
    for (const name of ['tony', 'SixteenCharNamee', 'WWWWWWWWWWWWWWWW']) {
      const g = await geo(name, W, H);
      if (!g) { bad(`${W}pt / @${name}: no headline or clock to measure`); continue; }
      /* CLEAR, not "to the left of". What separates them is vertical — the stack starts below
         the chips — so a headline whose ink passes x=361 is fine as long as no LINE shares a
         row with the pill. The test is the intersection, which is the thing a reader sees. */
      g.clash === 0
        ? ok(`${W}pt · @${name} shares no row with the clock`)
        : bad(`${W}pt · @${name}: ${g.clash} line(s) of the headline are painted under the clock (ink ends ${g.right}, pill starts ${g.clockX})`);
      (g.right <= W && g.left >= 0)
        ? ok(`${W}pt · @${name} stays on the screen`)
        : bad(`${W}pt · @${name} runs off the display: ink spans ${g.left}..${g.right} on a ${W}pt screen`);
    }
  }
}

await browser.close(); server.close();
console.log(failed?`\n✗ ${failed} failure(s)`:'\n✓ the seeker screen names the sender, readably');
process.exit(failed?1:0);
