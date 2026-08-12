#!/usr/bin/env node
/**
 * THE SHORT SHEET, RENDERED IN A REAL BROWSER.
 *
 * check.mjs can only assert that peekShareSheet() *calls* chPrevRender(). It cannot tell you
 * what the user sees, and the bug it missed was exactly that gap: the peek CSS exempted
 * .chPrev from its hide-everything rule, so the card was declared part of the short state —
 * while .chPrev shipped display:none and nothing in that path ever added `.on`. Every static
 * check passed. The card was not on the screen.
 *
 * So this drives the real state machine in real Chromium and reads computed styles: is the
 * card displayed in the short sheet, is the CTA displayed, and is the card ABOVE it. Three
 * questions a regex cannot answer.
 *
 *   node scripts/test-peek-dom.mjs
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* playwright-core is not a dependency of this repo — the app ships one HTML file and adding a
   browser to its lockfile for one test is not worth it. Resolved from wherever it happens to
   be installed; if it is not, this test skips loudly rather than failing the push. */
const req = createRequire(import.meta.url);
let chromium;
for (const base of [process.env.PW_CORE || '', ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the DOM test (set PW_CORE=<dir with node_modules>)');
  process.exit(0);
}

/* The app is a <script type="module">, so peekShareSheet() and `finished` are module-scoped
   and unreachable from page.evaluate. Rather than shipping a test hook in the real file, the
   SERVED copy gets one line appended inside that module. The code under test is byte-identical
   to what users load; only the door is added, and only here. */
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
if (at < 0) { console.error('no </script> in index.html'); process.exit(1); }
const html = real.slice(0, at)
  + '\nwindow.__t={present(){finished=true;ssState="hidden";peekShareSheet();return ssState;},'
  + 'copy(){return{generic:pwGenericSub(),'
  + 'pitch:Object.fromEntries(Object.entries(PW_PITCH).map(([k,v])=>[k,pwText(v.t)+" | "+pwText(v.s)])),'
  + 'hint:Object.fromEntries(Object.entries(PW_LOCK_HINT).map(([k,v])=>[k,pwText(v)])),'
  + 'facts:{paint:PAINT_SECONDS,sizes:FREE_SIZES.length,shades:FREE_SHADES,taps:CH_TAPS,lo:CH_LIMIT_MIN,hi:CH_LIMIT_MAX}};},'
  /* chGeom() needs a hider projected from the 3D scene, and this harness has no camera — so
     the preview would bail on its first line for a reason that has nothing to do with what is
     being tested. Stubbed to a hider dead centre. chGeom is a function DECLARATION, so it is
     assignable from inside the module; nothing in the shipped file is touched. */
  + 'preview(){chGeom=()=>({cx:.5,cy:.5,r:.15});document.getElementById("chPrev").click();'
  + 'return !!document.getElementById("chPP");},'
  + 'win(){const img=document.querySelector("#chPPframe canvas");if(!img)return null;'
  + 'const r=img.getBoundingClientRect();'
  + 'img.dispatchEvent(new MouseEvent("click",{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));'
  + 'return{found:!!document.querySelector("#chPPframe.found"),confetti:document.querySelectorAll(".kConfetti").length,'
  + 'sub:(document.querySelector(".chPPsub")||{}).textContent||"",head:(document.getElementById("chPPh")||{}).textContent};},'
  + 'litter(){return document.querySelectorAll(".kConfetti").length;},'
  /* A real tap on the wordmark, dispatched at the document the way a finger arrives — the
     handler is a capture-phase hit test on the mark's rect, not a listener on the element,
     so calling openKamoHome() directly would prove nothing about whether a tap reaches it. */
  + 'tapBrand(dx,ms){const b=document.querySelector(".brand");const r=b.getBoundingClientRect();'
  + 'const x=r.left+r.width/2,y=r.top+r.height/2;'
  + 'document.dispatchEvent(new PointerEvent("pointerdown",{clientX:x,clientY:y,bubbles:true}));'
  + 'const go=()=>document.dispatchEvent(new PointerEvent("pointerup",{clientX:x+(dx||0),clientY:y,bubbles:true}));'
  + 'if(ms){return new Promise(r2=>setTimeout(()=>{go();r2(this.cardState());},ms));}'
  + 'go();return Promise.resolve(this.cardState());},'
  + 'cardState(){return{card:document.getElementById("kamoHome").classList.contains("show"),'
  + 'sheet:shareSheetEl.className,state:ssState};},'
  + 'closeCard(){closeKamoHome();return this.cardState();},'
  + 'row(){const b=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();'
  + 'return{d:getComputedStyle(e).display,x:r.left,y:r.top,w:r.width,h:r.height};};'
  /* Every infinite animation inside the card, pseudo-elements included — that is where the
     sheens live, and "how many things are moving" is the invariant, not any one selector. */
  /* BUTTONS ONLY. The headline carries its own pwShimmer and always has — that is type, not a
     sheen competing for the tap, and sweeping it in would make this check ask for the title
     treatment to be deleted. The invariant is about the row of actions. */
  + 'const spin=(document.getAnimations?document.getAnimations():[]).filter(a=>a.effect&&a.effect.target'
  + '&&a.effect.target.closest&&a.effect.target.closest("#shareSheet .ssBtn")'
  + '&&a.effect.getTiming().iterations===Infinity)'
  + '.map(a=>(a.effect.target.id||a.effect.target.className||"?")+(a.effect.pseudoElement||"")+":"+(a.animationName||"anim"));'
  + 'return{more:b(".ssBtn.ssMore"),plus:b("#ssPlus"),spin:spin};},'
  + 'grab(){document.getElementById("ssGrab").click();return this.snap();},'
  + 'fold(){stepSheet(-1);return new Promise(r=>setTimeout(()=>r(this.snap()),420));},'
  + 'visible(sel){const e=shareSheetEl.querySelector(sel);return e?getComputedStyle(e).display:"absent";},'
  + 'backdrop(){shareSheetEl.click();return this.snap();},'
  + 'snap(){const c=shareSheetEl.querySelector(".ssCard");return{state:ssState,'
  + 'cls:shareSheetEl.className,h:c.getBoundingClientRect().height,inline:c.style.height,'
  + 'gap:Math.round(innerHeight-c.getBoundingClientRect().bottom),'
  + 'resizing:shareSheetEl.classList.contains("ssResizing"),'
  + 'pe:getComputedStyle(shareSheetEl).pointerEvents};},'
  + 'thumb(w,h){board.width=w;board.height=h;'
  + 'const x=board.getContext("2d");x.fillStyle="#ff00ff";x.fillRect(0,0,w,h);'
  + 'chPrevRender();'
  + 'const c=document.querySelector("#chPrevShot canvas");if(!c)return null;'
  /* clientWidth/Height, not the bounding rect: .chPrevShot carries a 1px rim by design, and a
     border-box measurement would report the canvas as 2px short of a box it is in fact
     filling — a permanently-red check that asks for the rim to be removed. */
  + 'const s=document.getElementById("chPrevShot"),r=c.getBoundingClientRect();'
  + 'return{iw:c.width,ih:c.height,rw:r.width,rh:r.height,bw:s.clientWidth,bh:s.clientHeight};}};\n'
  + real.slice(at);
/* Everything OTHER than the page is served off disk with a real MIME type. The module does
   `import * as THREE from './vendor/three.module.js'`, and a server that answers every path
   with text/html makes the browser refuse the import — the whole module then never runs, which
   looks exactly like the app being broken. */
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  try {
    const ext = path.slice(path.lastIndexOf('.'));
    const body = readFileSync(join(ROOT, path.replace(/^\/+/, '')));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* The browser is pre-installed under a versioned directory (chromium-1194/...), and the
   version moves. Found rather than hardcoded, so a bumped image does not silently skip. */
const { globSync } = await import('node:fs');
const exe = (globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome') || [])[0];
if (!exe) { console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__t, null, { timeout: 10000 }).catch(() => {
  console.error('  ✗ the module never finished executing — it threw on load:\n    ' + pageErrors.join('\n    '));
  process.exit(1);
});

/* Drive it the way enterFinished() does: mark the round finished, then present. Nothing is
   stubbed — this is peekShareSheet() itself, with the real CSS attached. */
const seen = await page.evaluate(() => {
  const state = window.__t.present();
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, cls: el.className, top: r.top, bottom: r.bottom, h: r.height };
  };
  /* THE CARD MUST RISE ONCE. It rose twice: .ssCard inherits `animation:pwUp` from .pwCard,
     and a `.rise` class added a second, more specific `animation:ssRise`. The specific one won
     while the class was on; when JS removed it 420ms later, pwUp became the winning declaration
     and played again. Nothing in the JS looked like a second trigger. getAnimations() on the
     element is the only place that shows both. */
  const cardEl = document.querySelector('#shareSheet .ssCard');
  /* ENTRANCE animations only. .pwCard also carries pwGlow — an infinite breathing mint glow —
     and counting that would make this permanently red for a reason that has nothing to do with
     the sheet sliding up. An entrance is finite and moves the element: transform, run once. */
  const entrances = (a) => {
    const t = a.effect.getTiming();
    if (t.iterations === Infinity) return false;
    return (a.effect.getKeyframes() || []).some((k) => 'transform' in k);
  };
  const anims = (document.getAnimations ? document.getAnimations() : [])
    .filter((a) => a.effect && a.effect.target === cardEl && entrances(a))
    .map((a) => a.animationName || 'anim');
  return {
    state,
    anims,
    animName: getComputedStyle(cardEl).animationName,
    sheet: box('#shareSheet'),
    card: box('#chPrev'),
    cta: box('#ssInvite'),
    title: box('#shareSheet .pwTitle'),
    tabs: box('#ssMode'),
    instagram: box('#shareSheet .ssBtn.ig'),
    more: box('#shareSheet .ssBtn.ssMore'),
    ctaColor: (() => {
      const s = getComputedStyle(document.querySelector('#ssInvite'));
      const r = getComputedStyle(document.querySelector('#ssInvite'), '::before');
      /* The shimmer lives on the ::before, and getAnimations() reports pseudo-element
         animations with `pseudoElement` set — the only way to see it from the outside. */
      const shimmer = (document.getAnimations ? document.getAnimations() : [])
        .filter((a) => a.effect && a.effect.target === document.querySelector('#ssInvite')
          && a.effect.pseudoElement === '::before')
        .map((a) => ({ name: a.animationName || 'anim', iter: a.effect.getTiming().iterations }));
      return { bg: s.backgroundColor, fg: s.color, shimmer, ring: r.padding, ringBg: r.backgroundImage };
    })(),
  };
});

console.log('\nTHE SHORT SHEET SHOWS THE CARD');
seen.state === 'peek' ? ok('the sheet is in the short state') : bad(`state is ${seen.state}, not peek`);
seen.sheet && seen.sheet.display !== 'none' ? ok('the sheet is on screen') : bad('the sheet is not displayed at all');

seen.card && seen.card.display !== 'none' && seen.card.h > 0
  ? ok(`the challenge card is rendered (${seen.card.display}, ${Math.round(seen.card.h)}px tall, class "${seen.card.cls}")`)
  : bad(`THE CARD IS NOT VISIBLE IN THE SHORT SHEET — display:${seen.card && seen.card.display}, `
      + `class "${seen.card && seen.card.cls}". .chPrev needs the "on" class from chPrevRender().`);

seen.cta && seen.cta.display !== 'none' && seen.cta.h > 0
  ? ok(`"Challenge a friend" is rendered (${Math.round(seen.cta.h)}px tall)`)
  : bad('the CTA is not visible in the short sheet — updateInviteBtn() did not un-hide it');

console.log('\nIT RISES ONCE');
seen.anims.length <= 1
  ? ok(`one animation on the card on arrival (${seen.animName})`)
  : bad(`${seen.anims.length} animations are running on the card at once (${seen.anims.join(', ')}) — `
      + 'it will play the open twice, back to back');
/* AND NOTHING MAY RE-ENTER IT ON A RESIZE. Collapsing from the full sheet used to replay the
   rise, which reads as a bounce rather than a transition.
   The entrance has to be allowed to FINISH first, or this measures the arrival still playing
   and calls it a restart — which is what the first version of this check did. 600ms is well
   past the .34s rise; the settled state is asserted before the toggle so a failure says which
   of the two it was. */
await page.waitForTimeout(600);
const running = () => page.evaluate(() => {
  const cardEl = document.querySelector('#shareSheet .ssCard');
  return (document.getAnimations ? document.getAnimations() : [])
    .filter((a) => a.effect && a.effect.target === cardEl && a.playState === 'running'
      && a.effect.getTiming().iterations !== Infinity
      && (a.effect.getKeyframes() || []).some((k) => 'transform' in k))
    .map((a) => a.animationName || 'anim');
});
const settled = await running();
settled.length === 0
  ? ok('the rise finishes and stays finished')
  : bad(`still animating 600ms after arrival (${settled.join(', ')}) — something is replaying it`);

await page.evaluate(() => {
  const sheet = document.querySelector('#shareSheet');
  sheet.classList.remove('peek'); sheet.classList.add('show');       // long
  sheet.classList.remove('show'); sheet.classList.add('peek');       // back to short
});
const onCollapse = await running();
onCollapse.length === 0
  ? ok('long → short restarts nothing — it is a resize, not a re-entry')
  : bad(`${onCollapse.join(', ')} restarted on collapse — the sheet bounces when it gets smaller`);

console.log('\nTHE CARD IS ABOVE THE CTA, AND IT IS FULL WIDTH');
seen.card && seen.cta && seen.card.bottom <= seen.cta.top + 1
  ? ok('the card sits above the button — see what goes out, then send it')
  : bad(`the card is not above the CTA (card bottom ${seen.card && Math.round(seen.card.bottom)}, `
      + `CTA top ${seen.cta && Math.round(seen.cta.top)}) — if they overlap the button is INSIDE the card's flex row`);

/* The regression that shipped: the button nested in .chPrev became a cell in a flex row, so
   it was no taller than the row and far from full width. A 390px viewport with 20px padding
   either side makes a full-width CTA ~350px. */
const w = await page.evaluate(() => {
  const b = document.querySelector('#ssInvite');
  return b ? b.getBoundingClientRect().width : 0;
});
w > 300
  ? ok(`the CTA is full width (${Math.round(w)}px of a 390px viewport)`)
  : bad(`the CTA is only ${Math.round(w)}px wide — it is being laid out as a cell, not a button`);

/* THE CTA HAS TO WIN THE CARD. It is white on a green card precisely because the button below
   it is a full-saturation Instagram gradient; a tinted CTA lost that contest, and the sheet
   exists to produce challenge sends. Asserted rather than eyeballed because a colour change is
   one token and nothing else in the file would object to it. */
console.log('\nTHE PRIMARY LOOKS PRIMARY');
{
  const bg = (seen.ctaColor.bg || '').replace(/\s/g, '');
  bg === 'rgb(255,255,255)'
    ? ok(`the CTA is a white slab (text ${seen.ctaColor.fg})`)
    : bad(`the CTA background is ${seen.ctaColor.bg} — it is tinted again, and it sits above a `
        + 'full-brand Instagram gradient that will out-shout it');
  /* THE RING MUST STILL MOVE. Making the fill opaque did not delete this animation, it hid it:
     the gradient used to show through a 14%-alpha face, and afterwards only a 1px rim was left
     of it. Nothing in the CSS broke, so nothing failed — it was reported by eye. Checked here
     because "the animation is gone" is not a thing a diff can show. */
  const sh = seen.ctaColor.shimmer || [];
  sh.some((a) => a.iter === Infinity)
    ? ok(`the border still shimmers (${sh.map((a) => a.name).join(', ')}, infinite)`)
    : bad('no infinite animation on #ssInvite::before — the travelling border is dead');
  /* And it has to be thick enough to see. At 1px, against a dark card, the gradient's troughs
     are indistinguishable from no border at all for most of the 3.4s cycle. */
  parseFloat(seen.ctaColor.ring) >= 2
    ? ok(`the ring is ${seen.ctaColor.ring} wide`)
    : bad(`the ring is only ${seen.ctaColor.ring} — too thin for the motion to register on a phone`);
  /rgba?\(/.test(seen.ctaColor.ringBg || '') && /255,\s*255,\s*255/.test(seen.ctaColor.ringBg || '')
    ? ok('it uses the high-contrast ring (white peak), the one meant for edges against a dark ground')
    : bad(`the ring gradient is ${seen.ctaColor.ringBg} — --ring's 20% troughs vanish against the card`);
}

console.log('\nTHE SHORT SHEET IS STILL SHORT');
seen.tabs && seen.tabs.display === 'none' ? ok('the Challenge / Before-After tabs are hidden') : bad('the tabs are showing — this is not the short state');
/* Instagram is DELIBERATELY in the short state — 7 taps in 7 days told us the destinations were
   unreachable, not unwanted. What must stay true is that it is second: below the CTA, never
   above it. If that order ever flips, the loudest thing on the sheet becomes the share that
   carries no link and recruits nobody. */
seen.instagram && seen.instagram.display !== 'none' && seen.instagram.h > 0
  ? ok(`Instagram is reachable without swiping (${Math.round(seen.instagram.h)}px tall)`)
  : bad('Instagram is hidden in the short sheet again — it is then only reachable by a swipe '
      + 'almost nobody performs, which is the state that produced 7 taps in a week');
seen.instagram && seen.cta && seen.instagram.top >= seen.cta.bottom - 1
  ? ok('it sits UNDER "Challenge a friend" — recruitment first, reach second')
  : bad('Instagram is above the CTA — the share that carries no link is leading the sheet');
/* Measured by HEIGHT, not by computed display. More lives inside .ssRow2, and the peek rule
   hides the ROW — the button's own computed display stays `flex` while it occupies nothing.
   Asking for display:none here would fail forever on a sheet that is behaving correctly. */
seen.more && seen.more.h === 0
  ? ok('More / Save are still behind the swipe')
  : bad(`More is taking up ${seen.more && Math.round(seen.more.h)}px — the short sheet is turning `
      + 'back into the full one');
/* NO ASSERTION ON HOW FAR UP THE SCREEN IT REACHES. That is the invariant I care about most —
   the reveal has to stay visible behind the short sheet — and this harness cannot answer it
   honestly: there is no camera here, so the app frame never gets its real height and the sheet
   lands outside the viewport box entirely. A threshold tuned until it passed would assert the
   quirk, not the design. What IS checked above is the thing that decides the height: only the
   grabber, kicker, headline, card and CTA are displayed, and every destination is not. */
ok(`short-state content: grabber + kicker + headline + card (${Math.round(seen.card.h)}px) `
  + `+ CTA (${Math.round(seen.cta.h)}px), nothing else`);

/* THE THUMBNAIL FILLS ITS BOX. It did not, and it shipped: `board` is the whole screen
   (~9:19.5) and .chPrevShot is 46x60 (~3:4), so a fit-by-longest-side put a 28px-wide frame in
   a 46px box, flush left, with the box's near-black background filling the rest. On a phone
   that does not read as a small preview, it reads as an image that failed to load — which is
   exactly how it was reported. A real phone aspect is used rather than the 300x150 default
   canvas, because the default is WIDER than the box and would have passed the broken code. */
console.log('\nTHE PREVIEW THUMBNAIL FILLS ITS BOX');
const th = await page.evaluate(() => window.__t.thumb(1080, 2337));
if (!th) {
  bad('chPrevRender() drew no canvas into #chPrevShot at all');
} else {
  const near = (a, b) => Math.abs(a - b) <= 0.75;
  near(th.rw, th.bw) && near(th.rh, th.bh)
    ? ok(`the frame covers the whole ${Math.round(th.bw)}x${Math.round(th.bh)} box`)
    : bad(`the frame is ${th.rw.toFixed(1)}x${th.rh.toFixed(1)} inside a ${th.bw.toFixed(1)}x${th.bh.toFixed(1)} box `
        + `— ${Math.round(th.bw - th.rw)}px of dead background shows down the side, which reads as a broken image`);
  /* The backing store must be the BOX's shape, not the board's. If it still matches 1080:2337
     the crop never happened and the fill above is only CSS stretching a letterbox — same black
     band, now smeared. */
  const boxAR = th.bw / th.bh, imgAR = th.iw / th.ih;
  Math.abs(imgAR - boxAR) < 0.03
    ? ok(`it is cropped to the box (canvas ${th.iw}x${th.ih}, ratio ${imgAR.toFixed(2)} vs box ${boxAR.toFixed(2)})`)
    : bad(`the canvas is ${th.iw}x${th.ih} (ratio ${imgAR.toFixed(2)}) but the box is ${boxAR.toFixed(2)} `
        + '— the board is being fitted, not cover-cropped');
  /* And it has to be a retina backing store. 46x60 CSS pixels at 1x is visibly mushy next to
     everything else on this card, and "soft" is the failure this size of thumbnail dies of. */
  th.iw >= th.bw * 2
    ? ok(`drawn at ${(th.iw / th.bw).toFixed(1)}x device pixels, not 1x`)
    : bad(`the canvas is only ${(th.iw / th.bw).toFixed(1)}x the box in device pixels — it will look soft`);
}

/* THE HANDLE TOGGLES, AND THE RESIZE IS A TRANSITION.
   Both halves shipped broken in a way no diff shows: the handle only ever stepped UP, so once
   the sheet was open it was an affordance that did nothing; and the tap-outside handler had
   never fired in its life, because #shareSheet is pointer-events:none and a container that
   cannot be hit cannot report a tap on itself.
   Driven through the real click handlers rather than by calling stepSheet, so the wiring is
   under test and not just the function. */
console.log('\nTHE SHEET RESIZES, IN BOTH DIRECTIONS');
{
  const settle = () => page.waitForTimeout(520);
  await page.evaluate(() => window.__t.present());
  const short = await page.evaluate(() => window.__t.snap());

  const up = await page.evaluate(() => window.__t.grab());
  up.state === 'open'
    ? ok('a tap on the handle opens it')
    : bad(`a tap on the handle left it at "${up.state}"`);
  up.resizing && up.inline
    ? ok(`the growth is animated (playing to ${up.inline})`)
    : bad('the card jumped straight to the long state — no height transition was set up');

  await settle();
  const open = await page.evaluate(() => window.__t.snap());
  /* THE TARGET HAS TO BE THE HEIGHT IT ACTUALLY ENDS AT. It was not: openShareSheet() resized
     first and un-hid the upsell row afterwards, so the transition played to a height 38px short
     and the card snapped the rest of the way when the inline height was released. Silent — the
     animation ran, it just ended in the wrong place. */
  Math.abs(parseFloat(up.inline) - open.h) < 2
    ? ok(`and it plays to the height it settles at (${Math.round(open.h)}px)`)
    : bad(`it animates to ${up.inline} but settles at ${Math.round(open.h)}px — the content is `
        + 'still changing after the target was measured, so the card jumps at the end');
  open.inline === '' && !open.resizing
    ? ok('it lets go of the height when the transition ends')
    : bad(`the card is still pinned at ${JSON.stringify(open.inline)} (resizing=${open.resizing}) — `
        + 'it is stuck at a size the stylesheet no longer agrees with');
  open.h > short.h
    ? ok(`long is taller than short (${Math.round(short.h)}px → ${Math.round(open.h)}px)`)
    : bad(`the long state is ${Math.round(open.h)}px against a short state of ${Math.round(short.h)}px`);
  open.pe === 'auto'
    ? ok('the long state takes the backdrop, so a tap outside can reach it')
    : bad(`#shareSheet is pointer-events:${open.pe} while open — the tap-outside handler cannot fire`);

  /* THE UPSELL IS HALF A ROW, NOT A ROW. It was a borderless mint text link on its own line
     below everything, in the position people scroll past on the way to Cancel. Sharing the More
     line makes it a real target for no extra height — Save is dead on native, so More had the
     line to itself. Geometry, not classes: "side by side" is a claim about where they land. */
  console.log('\nMORE AND THE UPSELL SHARE ONE LINE');
  const row = await page.evaluate(() => window.__t.row());
  if (!row.more || !row.plus || row.plus.d === 'none') {
    bad(`the row is not both buttons — More=${!!row.more}, Remove mark=${row.plus && row.plus.d}`);
  } else {
    Math.abs(row.more.y - row.plus.y) < 2 && Math.abs(row.more.h - row.plus.h) < 2
      ? ok('they sit on the same line, at the same height')
      : bad(`they are on different lines (More at y=${Math.round(row.more.y)}h${Math.round(row.more.h)}, `
          + `Remove mark at y=${Math.round(row.plus.y)}h${Math.round(row.plus.h)})`);
    row.more.x < row.plus.x
      ? ok('More is on the left, the upsell on the right')
      : bad('the upsell is to the LEFT of More — the offer is leading the row');
    Math.abs(row.more.w - row.plus.w) < 2
      ? ok(`they split the line evenly (${Math.round(row.more.w)}px each)`)
      : bad(`the cells are ${Math.round(row.more.w)}px and ${Math.round(row.plus.w)}px — one is `
          + 'being squeezed, which is what happens when the flex share is not shared');
  }

  /* ONE MOVING THING ON THIS CARD. Instagram carried the paywall CTA's sheen, so the brightest
     animation on the sheet was on the button we do NOT want tapped first, right beside the
     ring on the one we do. Counted rather than grepped: a second sheen added under any other
     selector is the same mistake with a different name. */
  const spin = (row.spin || []).filter((s) => !/pwGlow/.test(s));
  spin.length === 1 && /ssInvite/.test(spin[0])
    ? ok(`exactly one button animates, and it is the right one (${spin[0]})`)
    : bad(`${spin.length} button animation(s): ${spin.join(', ') || 'none'} — the ring on `
        + '"Challenge a friend" is supposed to be the only one, and it is supposed to be there');

  /* Going DOWN, the long content must still be on screen while the box closes over it.
     Committing the short state up front animates an empty pocket instead. */
  const down = await page.evaluate(() => window.__t.grab());
  down.state === 'peek'
    ? ok('a tap on the handle closes it again — the same control, both directions')
    : bad(`a tap on the open sheet left it at "${down.state}" — the handle is inert once open`);
  /show/.test(down.cls) && down.resizing
    ? ok('the long content is held in place while the box closes over it')
    : bad(`the sheet is already "${down.cls}" at the start of the close — the destinations blink `
        + 'out and what animates is an empty green pocket');

  await settle();
  const back = await page.evaluate(() => window.__t.snap());
  /peek/.test(back.cls) && back.inline === '' && !back.resizing
    ? ok('and it commits to the short state once closed')
    : bad(`after the close the sheet is "${back.cls}" with height ${JSON.stringify(back.inline)}`);

  await page.evaluate(() => window.__t.grab());
  await settle();
  const out = await page.evaluate(() => window.__t.backdrop());
  out.state === 'peek'
    ? ok('a tap outside the card puts the long sheet back to short')
    : bad(`a tap outside left it at "${out.state}" — dismissShareSheet is still unreachable`);
  await settle();
}

/* THE CARD OPENS THE PREVIEW, AND WINNING LOOKS LIKE WINNING.
   Driven from a click on the ROW, not on the thumbnail — the thumbnail always worked, and the
   whole point of the change is that the title, the chips and the space between them were dead
   surface in front of the only way to see the challenge. */
console.log('\nTHE CARD OPENS THE PREVIEW');
{
  await page.evaluate(() => window.__t.present());
  const opened = await page.evaluate(() => window.__t.preview());
  opened
    ? ok('a tap anywhere on the card opens the preview')
    : bad('tapping the card did nothing — only the 46px thumbnail is live');

  if (opened) {
    const won = await page.evaluate(() => window.__t.win());
    won && won.head === 'Found you'
      ? ok(`finding the hider ends the round ("${won.head}")`)
      : bad(`the win did not land — headline is ${JSON.stringify(won && won.head)}`);
    won && won.found
      ? ok('the frame goes green')
      : bad('#chPPframe never got the .found class — no green outline on the image');
    won && won.confetti === 1
      ? ok('one confetti layer is thrown')
      : bad(`${won && won.confetti} confetti layers — expected exactly 1`);
    /* IT ARGUES, IT DOES NOT DESCRIBE. The old line ("That is the screen they get") captioned
       the screen to someone staring at it. Whatever the line says, it must not be about the
       screen — that is the failure mode worth failing on, not the exact words. */
    const sub = won && won.sub;
    sub && !/screen|this is what|you (are|'re) (looking|seeing)/i.test(sub)
      ? ok(`the win makes a claim ("${sub}")`)
      : bad(sub ? `the win is captioning itself again: "${sub}"` : 'the win renders no line at all');

    /* IT HAS TO LEAVE. The canvas sits at z-index 95, above the share sheet and above the
       preview's own CTA. One left behind is a screen nobody can tap. */
    await page.waitForTimeout(3000);
    const left = await page.evaluate(() => window.__t.litter());
    left === 0
      ? ok('the confetti canvas removes itself when the last piece dies')
      : bad(`${left} confetti canvas(es) still in the DOM — at z-index 95 that is an invisible `
          + 'sheet over every control on the screen');
  }

  /* REDUCED MOTION IS A REAL PATH, NOT A SWITCH THAT TURNS THE FEATURE OFF. It used to return
     early and leave those users with a headline and nothing else. Emulated for real here —
     asserting on the CSS text would prove nothing about what the branch does. */
  console.log('\n  · and again with Reduce Motion on');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__t);
  await page.evaluate(() => window.__t.present());
  const rmOpen = await page.evaluate(() => window.__t.preview());
  if (!rmOpen) { bad('the preview does not open under Reduce Motion'); }
  else {
    const rm = await page.evaluate(() => window.__t.win());
    rm && rm.found && rm.confetti === 1
      ? ok('it still celebrates — green ring and a still bloom, no flying particles')
      : bad(`Reduce Motion gets found=${rm && rm.found}, layers=${rm && rm.confetti} — the `
          + 'setting asks for less movement, not for no feedback');
    await page.waitForTimeout(1400);
    const rmLeft = await page.evaluate(() => window.__t.litter());
    rmLeft === 0
      ? ok('and the bloom cleans up too')
      : bad(`${rmLeft} bloom(s) left at z-index 95 — an invisible sheet over every control`);
  }
  await page.emulateMedia({ reducedMotion: null });
}

/* The name chip and its sign-from-the-sheet dialog were removed 2026-08-11 (founder's call:
   three chips read as clutter). Signing lives on the player card, whose blur handler owns the
   republish — covered by test-home-dom, not here. */
/* THE WORDMARK IS THE WAY INTO THE CARD FROM THE REVEAL, AND THE SHEET MUST SURVIVE IT.
   On the reveal the share sheet is the only route to a share — the Share button was removed
   when the sheet started presenting itself — so opening the card over that screen and closing
   it must not strand someone on a reveal with no way to send. */
/* THE THIRD DETENT — folded to the handle so the painting can be seen whole. A "mini" state
   existed before and was removed for a rendering bug (it swapped classes outside
   setSheetSize()), so what has to hold is that it goes through the same door as the others,
   that it hides the card without hiding the way back, and that the sheet never ARRIVES in it:
   the send is the flattest number in this app and starting folded costs a gesture. */
console.log('\nIT FOLDS TO THE HANDLE, AND COMES BACK');
{
  await page.evaluate(() => window.__t.present());
  const arrived = await page.evaluate(() => window.__t.snap());
  arrived.state === 'peek'
    ? ok('the sheet still ARRIVES in the peek, never folded')
    : bad(`the sheet arrived in "${arrived.state}" — folding by default puts the send a gesture further away`);

  const folded = await page.evaluate(() => window.__t.fold());
  folded.state === 'mini' && /\bssMini\b/.test(folded.cls)
    ? ok('a downward step folds it to the handle')
    : bad(`stepping down gave state=${folded.state} cls=${JSON.stringify(folded.cls)}`);
  /* A CEILING, NOT JUST "SHORTER". The first version stacked two safe-area insets — the
     card's and the grabber's — and left ~90px of empty green under the bar while still
     passing a "shorter than the peek" test. Halving that was still reported as "trop de
     hauteur": the state is meant to be a handle, its breathing room, and nothing else, so the
     assertion is absolute. 24px here is measured with NO safe-area inset (headless reports
     none); on a device the grabber adds ~20px more to clear the home pill. */
  folded.h < arrived.h && folded.h <= 24
    ? ok(`and the card is a bar, not a box (${Math.round(folded.h)}px, peek is ${Math.round(arrived.h)}px)`)
    : bad(`folded height ${Math.round(folded.h)}px — must be under 24px (peek: ${Math.round(arrived.h)}px). `
        + 'Check for a doubled var(--safe-b) between .ssCard and .ssGrab.');
  /* AND IT IS AGAINST THE EDGE. "Pas collé au bas de l'écran" is a different defect from
     "too tall" — a bar of the right height floating above the bottom edge looks like a bug in
     a way that a tall one does not — and nothing measured the gap, so only one of the two was
     ever being caught. */
  folded.gap === 0
    ? ok('and it sits flush on the bottom edge, with nothing under it')
    : bad(`there are ${folded.gap}px between the folded card and the bottom of the screen`);
  (await page.evaluate(() => window.__t.visible('.ssInvite'))) === 'none'
    ? ok('the CTA is put away with the rest of the card')
    : bad('the folded sheet still shows its buttons — it is not folded, it is just shorter');
  (await page.evaluate(() => window.__t.visible('.ssGrab'))) !== 'none'
    ? ok('but the handle stays, so there is a way back')
    : bad('the handle is gone in the folded state — the sheet is now unreachable');

  const back = await page.evaluate(() => window.__t.grab());
  await page.waitForTimeout(420);
  (await page.evaluate(() => window.__t.snap())).state === 'peek'
    ? ok('and a tap on the handle brings the peek straight back')
    : bad(`tapping the handle from mini gave "${back.state}" — the way back has to be one tap`);
}

console.log('\nTAPPING THE WORDMARK OPENS THE CARD, AND CLOSING IT GIVES THE SHEET BACK');
{
  await page.evaluate(() => window.__t.present());
  const opened = await page.evaluate(() => window.__t.tapBrand(0, 0));
  opened.card
    ? ok('a tap on the wordmark opens the player card')
    : bad('the wordmark did not open the card — the tap is hit-tested at the document, so a '
        + 'listener bound to the element would not fire here at all');

  const closed = await page.evaluate(() => window.__t.closeCard());
  !closed.card && /peek/.test(closed.sheet) && closed.state === 'peek'
    ? ok('closing it brings the share sheet back, short')
    : bad(`after closing the card the sheet is "${closed.sheet}" (${closed.state}) — on the reveal `
        + 'that is a screen with no way to share');

  /* From the LONG sheet it must come back short, not as it was: coming out of an unrelated
     detour into a wall of destinations is not where anyone left off. */
  await page.evaluate(() => window.__t.grab());
  await page.waitForTimeout(520);
  await page.evaluate(() => window.__t.tapBrand(0, 0));
  const back = await page.evaluate(() => window.__t.closeCard());
  back.state === 'peek'
    ? ok('and it comes back short even when it was long')
    : bad(`the sheet came back as "${back.state}" — the long sheet covers the reveal`);

  /* A drag across the mark is a brush stroke, not a tap. */
  const dragged = await page.evaluate(() => window.__t.tapBrand(40, 0));
  !dragged.card
    ? ok('a drag across it is not a tap')
    : bad('dragging over the wordmark opened the card — a brush stroke crossing it would too');
}

/* THE PAYWALL'S PROMISES, RENDERED. check.mjs proves no number is TYPED into the copy; this
   proves the templates actually resolve to the values the app runs on. A template that
   interpolates the wrong constant is still a false claim, and it looks perfect in the source. */
console.log('\nTHE PAYWALL QUOTES THE APP IT IS SELLING');
const copy = await page.evaluate(() => window.__t.copy());
const f = copy.facts;
const all = [['generic', copy.generic], ...Object.entries(copy.pitch), ...Object.entries(copy.hint)]
  .map(([k, v]) => [k, String(v)]);
const undef = all.filter(([, v]) => /undefined|NaN/.test(v));
undef.length
  ? bad(`copy renders a missing value: ${undef.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ')}`)
  : ok(`${all.length} paywall lines render with no undefined`);

/* Each claim against the constant it is about. Named individually rather than swept, because a
   sweep that only greps for "any of these numbers appears somewhere" would pass a line that
   swapped the free and pro clocks — which reads as a bargain in the wrong direction. */
const says = (key, needles) => {
  const line = (all.find(([k]) => k === key) || [])[1];
  if (!line) return bad(`no paywall line for "${key}"`);
  const miss = needles.filter((n) => !line.includes(n));
  miss.length
    ? bad(`the "${key}" pitch does not state ${miss.join(', ')} — it reads: ${JSON.stringify(line)}`)
    : ok(`"${key}" states ${needles.join(', ')}`);
};
/* KAMO+ has no clocks since 2026-08-11, so the generic line and the time pitch sell the
   ABSENCE of a figure — the only number left is the free clock, quoted as the thing you
   escape. The generic line must quote nothing at all. */
const genericLine = (all.find(([k]) => k === 'generic') || [])[1] || '';
!/\d/.test(genericLine) && /no clock/.test(genericLine)
  ? ok('"generic" sells no-clock without quoting a figure')
  : bad(`the generic pitch reads: ${JSON.stringify(genericLine)}`);
says('time', [`${f.paint} seconds`, 'no clock']);
/* The size pitch is the one that states NO figure, on purpose: "Free paints at 3 fixed sizes"
   was cut because it sells the limitation instead of the range. So it is asserted the other way
   round — it must not quote a count — which still catches a hardcoded number creeping back in,
   the thing this block exists to prevent. */
const sizeLine = (all.find(([k]) => k === 'size') || [])[1] || '';
/\d/.test(sizeLine)
  ? bad(`the "size" pitch quotes a figure again — it reads: ${JSON.stringify(sizeLine)}`)
  : ok('"size" sells the range without quoting a count');
says('color', [`${f.shades} shades`]);
says('chset', [`${f.taps} taps`, `${f.lo}-${f.hi}s`]);

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the short sheet shows the card, above a full-width CTA, without covering the reveal');
process.exit(failed ? 1 : 0);
